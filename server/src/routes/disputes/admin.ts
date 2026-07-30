import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify, notifyRole } from '../../lib/disputes/notify';
import {
  DisputeStatus, DISPUTE_STATUSES, RefundMethod, REFUND_METHODS, TERMINAL_STATUSES, OPEN_STATUSES,
  recordTimeline, changeDisputeStatus, assembleDisputeDetail, finalizeRefund, generateDisputeReportFile,
  staffDisputeActionLimiter, canTransition,
} from './shared';

const router = express.Router();
const requireAdmin = requireRole('Admin Office');

// ─── Case Oversight — platform-wide stats, staff performance, fraud signals ───
router.post('/admin/disputes/stats', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const counts = await Promise.all(DISPUTE_STATUSES.map(s => prisma.dispute.count({ where: { status: s, deletedAt: null } })));
    const total = counts.reduce((a, b) => a + b, 0);

    const escalations = await prisma.dispute.count({ where: { priority: 'High', deletedAt: null } });
    const pendingSla = await prisma.dispute.count({
      where: { status: { in: ['Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary', 'WaitingForAdmin'] }, frozen: false, slaDueAt: { lt: new Date() }, deletedAt: null },
    });

    const refunds = await prisma.refund.aggregate({ where: { status: 'Processed' }, _sum: { amount: true }, _count: true });
    const pendingApprovals = await prisma.refund.count({ where: { status: 'Pending' } });

    res.json({
      total,
      byStatus: Object.fromEntries(DISPUTE_STATUSES.map((s, i) => [s, counts[i]])),
      escalations,
      pendingSla,
      totalRefunded: refunds._sum.amount || 0,
      refundCount: refunds._count,
      pendingApprovals,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Average resolution time and case load per Accounts Officer.
router.post('/admin/disputes/staff-performance', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const officers = await prisma.user.findMany({ where: { role: 'Accounts Office' }, select: { id: true, fullName: true, email: true } });
    const performance = await Promise.all(officers.map(async (o) => {
      const [assigned, resolvedCases] = await Promise.all([
        prisma.dispute.count({ where: { assignedToId: o.id, deletedAt: null } }),
        prisma.dispute.findMany({ where: { assignedToId: o.id, status: { in: ['Resolved', 'Rejected', 'Refunded'] }, resolvedAt: { not: null }, deletedAt: null }, select: { createdAt: true, resolvedAt: true } }),
      ]);
      const avgResolutionHours = resolvedCases.length
        ? resolvedCases.reduce((sum, d) => sum + (d.resolvedAt!.getTime() - d.createdAt.getTime()), 0) / resolvedCases.length / (1000 * 60 * 60)
        : 0;
      return { id: o.id, name: o.fullName || o.email, assigned, resolved: resolvedCases.length, avgResolutionHours: Math.round(avgResolutionHours * 10) / 10 };
    }));
    res.json({ performance });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Fraud detection — transparent, rule-based signals (repeat disputers, repeat shops, repeat
// rejections), not a black-box model. Every number here is directly re-derivable from the same
// tables an Admin can already browse via Case Oversight.
router.post('/admin/disputes/fraud-signals', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const repeatedDisputersRaw = await prisma.dispute.groupBy({
      by: ['raisedById'], where: { deletedAt: null }, _count: { raisedById: true },
      having: { raisedById: { _count: { gte: 3 } } }, orderBy: { _count: { raisedById: 'desc' } }, take: 15,
    });
    const disputerUsers = await prisma.user.findMany({ where: { id: { in: repeatedDisputersRaw.map(r => r.raisedById) } }, select: { id: true, fullName: true, studentId: true, flagged: true } });
    const repeatedDisputers = repeatedDisputersRaw.map(r => {
      const u = disputerUsers.find(x => x.id === r.raisedById);
      return { userId: r.raisedById, name: u?.fullName || 'Unknown', studentId: u?.studentId || '', flagged: u?.flagged || false, disputeCount: r._count.raisedById };
    });

    const shopTxns = await prisma.dispute.findMany({
      where: { deletedAt: null, transaction: { shopId: { not: null } } },
      select: { transaction: { select: { shopId: true } } },
    });
    const shopCounts = new Map<string, number>();
    for (const d of shopTxns) { const sid = d.transaction?.shopId; if (sid) shopCounts.set(sid, (shopCounts.get(sid) || 0) + 1); }
    const repeatedShopIds = [...shopCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const shops = await prisma.shop.findMany({ where: { id: { in: repeatedShopIds.map(([id]) => id) } }, select: { id: true, name: true, flagged: true, status: true } });
    const repeatedShops = repeatedShopIds.map(([id, count]) => {
      const s = shops.find(x => x.id === id);
      return { shopId: id, name: s?.name || 'Unknown', flagged: s?.flagged || false, status: s?.status || 'Unknown', disputeCount: count };
    });

    const repeatedFailures = await prisma.dispute.count({ where: { status: 'Rejected', deletedAt: null } });
    const fraudCategoryCount = await prisma.dispute.count({ where: { category: 'Fraud', deletedAt: null } });

    res.json({ repeatedDisputers, repeatedShops, repeatedFailures, fraudCategoryCount });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Case list / detail (same shape Accounts sees) ───
// scope: 'active' | 'completed' replaces exposing all 10 internal statuses to the Admin filter —
// Admin is the final-authority layer, not another processing queue, so it only needs to know
// whether a case still needs attention or is done. mineOnly scopes to cases this Admin has
// personally claimed/actioned (adminOwnerId), i.e. "My Cases". The legacy `status` param is still
// accepted for one release so any in-flight client isn't broken mid-deploy.
router.post('/admin/disputes/list', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { status, scope, mineOnly, search, limit = 25, offset = 0 } = req.body as {
      status?: string; scope?: 'active' | 'completed'; mineOnly?: boolean; search?: string; limit?: number; offset?: number;
    };
    const where: any = { deletedAt: null };
    if (scope === 'completed') where.status = { in: TERMINAL_STATUSES };
    else if (scope === 'active') where.status = { in: OPEN_STATUSES };
    else if (status && status !== 'all') where.status = status;
    if (mineOnly) where.adminOwnerId = req.user!.id;
    if (search) {
      where.OR = [
        { caseNumber: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { raisedBy: { fullName: { contains: search, mode: 'insensitive' } } },
        { raisedBy: { studentId: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: { raisedBy: { select: { fullName: true, studentId: true } }, assignedTo: { select: { fullName: true } }, transaction: { select: { reference: true, amount: true, type: true } } },
      }),
      prisma.dispute.count({ where }),
    ]);
    res.json({
      disputes: disputes.map(d => ({
        id: d.id, caseNumber: d.caseNumber, category: d.category, status: d.status, priority: d.priority,
        slaDueAt: d.slaDueAt, frozen: d.frozen, createdAt: d.createdAt,
        studentName: d.raisedBy?.fullName || 'Unknown', studentId: d.raisedBy?.studentId || '',
        assignedToName: d.assignedTo?.fullName || null,
        transaction: d.transaction ? { reference: d.transaction.reference, amount: d.transaction.amount, type: d.transaction.type } : null,
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/disputes/detail', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { disputeId } = req.body as { disputeId: string };
    const detail = await assembleDisputeDetail(disputeId);
    if (!detail) return res.status(404).json({ message: 'Dispute not found.' });
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Assign / reassign an Accounts Officer to a case ───
router.post('/admin/disputes/assign-officer', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, assignedToId, note } = req.body as { disputeId: string; assignedToId: string; note?: string };
    const officer = await prisma.user.findFirst({ where: { id: assignedToId, role: 'Accounts Office' } });
    if (!officer) return res.status(404).json({ message: 'Accounts officer not found.' });

    await prisma.dispute.update({ where: { id: disputeId }, data: { assignedToId } });
    await prisma.disputeAssignment.create({ data: { disputeId, assignedToId, assignedById: req.user!.id, note: note ? `[Admin] ${note}` : '[Admin override]' } });
    await recordTimeline(disputeId, 'assigned', req.user!.id, `Admin assigned to ${officer.fullName || officer.email}${note ? ` — ${note}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Assigned (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `Assigned to ${officer.fullName}`, ipAddress: req.ip } });
    await notify({ disputeId, recipientId: assignedToId, type: 'assigned', title: 'Case assigned to you by Admin', body: 'An Admin assigned you a dispute case.' });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Override Decision — Admin can force any status transition, always with a mandatory,
// audited reason. Still funnels through changeDisputeStatus so history/timeline stay consistent. ───
router.post('/admin/disputes/override', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, status, reason } = req.body as { disputeId: string; status: DisputeStatus; reason: string };
    if (!DISPUTE_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status.' });
    if (!reason?.trim()) return res.status(400).json({ message: 'A reason is required for an override.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return res.status(404).json({ message: 'Dispute not found.' });

    await changeDisputeStatus(disputeId, status, req.user!.id, `Admin override: ${reason.trim()}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Status Overridden (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `${dispute.status} -> ${status}: ${reason.trim()}`, ipAddress: req.ip } });
    await notify({ disputeId, recipientId: dispute.raisedById, type: 'override', title: `Case updated — ${dispute.caseNumber}`, body: `An administrator updated your case status.` });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── List active shops (for Admin's own Forward-to-Shop picker) ───
router.post('/admin/disputes/shops', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const shops = await prisma.shop.findMany({ where: { status: 'Active' }, select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } });
    res.json({ shops });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Forward to Shop / Library — Admin's own routing action, mirroring Accounts' forward. Admin
// can't forward to itself; forwardedByRole is set to 'Admin Office' so that when Shop/Library
// completes review, the case returns to WaitingForAdmin (not Accounts' Investigating queue). ───
router.post('/admin/disputes/forward', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, to, shopId, note } = req.body as { disputeId: string; to: 'Shop' | 'Library'; shopId?: string; note?: string };
    if (to !== 'Shop' && to !== 'Library') return res.status(400).json({ message: 'Admin can only forward to Shop or Library.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (!canTransition(dispute.status as DisputeStatus, 'Admin Office', 'forward')) {
      return res.status(400).json({ message: 'This case cannot be forwarded from its current status.' });
    }

    let targetShopId: string | null = null;
    let targetShopName: string | null = null;
    let targetShopOwnerId: string | null = null;
    if (to === 'Shop') {
      const activeShopCount = await prisma.shop.count({ where: { status: 'Active' } });
      let shop;
      if (activeShopCount > 1) {
        if (!shopId) return res.status(400).json({ message: 'Select which shop to forward this case to.' });
        shop = await prisma.shop.findUnique({ where: { id: shopId } });
      } else {
        shop = shopId ? await prisma.shop.findUnique({ where: { id: shopId } }) : await prisma.shop.findFirst({ where: { status: 'Active' } });
      }
      if (!shop || shop.status !== 'Active') return res.status(400).json({ message: 'That shop is not active.' });
      targetShopId = shop.id;
      targetShopName = shop.name;
      targetShopOwnerId = shop.ownerId;
    }

    const targetStatus: DisputeStatus = to === 'Shop' ? 'WaitingForShop' : 'WaitingForLibrary';
    const targetRole = to === 'Shop' ? 'Shop Staff' : 'Library';
    const destinationLabel = to === 'Shop' && targetShopName ? `Shop (${targetShopName})` : to;

    await prisma.dispute.update({
      where: { id: disputeId },
      data: { forwardedShopId: targetShopId, forwardedByRole: 'Admin Office', forwardedById: req.user!.id, adminOwnerId: dispute.adminOwnerId ?? req.user!.id },
    });
    await changeDisputeStatus(disputeId, targetStatus, req.user!.id, `Forwarded to ${destinationLabel} by Admin${note ? `: ${note}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Forwarded (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `Forwarded to ${destinationLabel}`, ipAddress: req.ip } });

    if (to === 'Shop' && targetShopOwnerId) {
      await notify({ disputeId, recipientId: targetShopOwnerId, type: 'forwarded', title: `Case forwarded to ${targetShopName}`, body: note || `A dispute case was forwarded to ${targetShopName} for input.` });
    } else {
      await notifyRole(targetRole, { disputeId, type: 'forwarded', title: `Case forwarded to ${to}`, body: note || `A dispute case was forwarded to ${to} for input.` });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Direct Refund — Admin is the final authority, so a single Admin both initiates and
// "approves" its own refund (the RefundApproval row still records that self-approval, kept the
// same shape as the two-step Accounts→Admin path so audit trails aren't distinguishable in
// structure). Unbounded — no forced second Admin sign-off, even above the normal ৳20,000
// threshold that gates Accounts-initiated refunds, since Admin is already the approval authority
// that threshold exists to reach. notes is mandatory precisely because this collapses dual
// control into one actor. ───
router.post('/admin/disputes/refund', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, method, amountType, amount: partialAmount, notes } = req.body as {
      disputeId: string; method: RefundMethod; amountType: 'Full' | 'Partial'; amount?: number; notes?: string;
    };
    if (!REFUND_METHODS.includes(method)) return res.status(400).json({ message: 'Invalid refund method.' });
    if (!notes?.trim()) return res.status(400).json({ message: 'A note explaining the refund decision is required.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: true } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (!canTransition(dispute.status as DisputeStatus, 'Admin Office', 'refund')) {
      return res.status(400).json({ message: 'This case cannot be refunded from its current status.' });
    }

    const existingActive = await prisma.refund.findFirst({ where: { disputeId, status: { in: ['Pending', 'Approved', 'Processed'] } } });
    if (existingActive) return res.status(409).json({ message: 'A refund has already been initiated for this case.' });

    const fullAmount = dispute.transaction.amount;
    const amount = amountType === 'Full' ? fullAmount : Number(partialAmount);
    if (!amount || amount <= 0 || amount > fullAmount) return res.status(400).json({ message: 'Invalid refund amount.' });

    const refund = await prisma.refund.create({
      data: { disputeId, transactionId: dispute.transactionId, method, amountType, amount, status: 'Pending', initiatedById: req.user!.id, notes: notes.trim() },
    });
    await prisma.refundApproval.create({ data: { refundId: refund.id, approverId: req.user!.id, decision: 'Approved', notes: notes.trim() } });
    await prisma.dispute.update({ where: { id: disputeId }, data: { adminOwnerId: dispute.adminOwnerId ?? req.user!.id } });
    await recordTimeline(disputeId, 'refund_initiated', req.user!.id, `${amountType} refund of ৳${amount.toLocaleString()} processed directly by Admin via ${method}: ${notes.trim()}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Refund Processed Directly (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `${method} ${amountType} ৳${amount} — ${notes.trim()}`, ipAddress: req.ip } });

    const result = await finalizeRefund({
      refund: { id: refund.id, method, amount, disputeId }, transactionId: dispute.transactionId,
      recipientUserId: dispute.transaction.userId, processedById: req.user!.id, notes: notes.trim(), ipAddress: req.ip, caseNumber: dispute.caseNumber,
    });
    if (!result.ok) return res.status(400).json({ message: result.message });

    res.json({ success: true, refundId: refund.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Direct Reject — mandatory internal note explaining the decision; the student only sees a
// generic notice (the reasoning stays staff-internal), consistent with this being Admin's final
// word rather than a back-and-forth conversation. ───
router.post('/admin/disputes/reject', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, reason } = req.body as { disputeId: string; reason: string };
    if (!reason?.trim()) return res.status(400).json({ message: 'A reason is required.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (!canTransition(dispute.status as DisputeStatus, 'Admin Office', 'reject')) {
      return res.status(400).json({ message: 'This case cannot be rejected from its current status.' });
    }

    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: reason.trim(), isInternal: true } });
    await prisma.dispute.update({ where: { id: disputeId }, data: { adminOwnerId: dispute.adminOwnerId ?? req.user!.id } });
    await changeDisputeStatus(disputeId, 'Rejected', req.user!.id, `Admin reject: ${reason.trim()}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Rejected (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: reason.trim(), ipAddress: req.ip } });
    await notify({
      disputeId, recipientId: dispute.raisedById, type: 'rejected', title: `Case reviewed — ${dispute.caseNumber}`,
      body: 'Your case has been reviewed and closed. Contact the Accounts Office for details.',
      emailSubject: `Update on your dispute ${dispute.caseNumber} — Smart Campus`,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Approve / Reject a high-value (>= threshold) refund ───
router.post('/admin/disputes/refund/approve', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { refundId, notes } = req.body as { refundId: string; notes?: string };
    const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { dispute: { include: { transaction: true } } } });
    if (!refund) return res.status(404).json({ message: 'Refund not found.' });
    if (refund.status !== 'Pending') return res.status(400).json({ message: 'Only a pending refund can be approved.' });

    await prisma.refundApproval.create({ data: { refundId, approverId: req.user!.id, decision: 'Approved', notes } });
    await prisma.dispute.update({ where: { id: refund.disputeId }, data: { adminOwnerId: refund.dispute.adminOwnerId ?? req.user!.id } });
    await prisma.auditLog.create({ data: { action: 'Dispute Refund Approved (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: refund.disputeId, details: `Approved ৳${refund.amount} refund`, ipAddress: req.ip } });

    const result = await finalizeRefund({
      refund: { id: refund.id, method: refund.method as RefundMethod, amount: refund.amount, disputeId: refund.disputeId },
      transactionId: refund.transactionId, recipientUserId: refund.dispute.transaction.userId, processedById: req.user!.id,
      notes, ipAddress: req.ip, caseNumber: refund.dispute.caseNumber,
    });
    if (!result.ok) return res.status(400).json({ message: result.message });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/disputes/refund/reject', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { refundId, reason } = req.body as { refundId: string; reason: string };
    const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { dispute: true } });
    if (!refund) return res.status(404).json({ message: 'Refund not found.' });
    if (refund.status !== 'Pending') return res.status(400).json({ message: 'Only a pending refund can be rejected.' });

    await prisma.refundApproval.create({ data: { refundId, approverId: req.user!.id, decision: 'Rejected', notes: reason } });
    await prisma.refund.update({ where: { id: refundId }, data: { status: 'Rejected', notes: reason } });
    await prisma.dispute.update({ where: { id: refund.disputeId }, data: { adminOwnerId: refund.dispute.adminOwnerId ?? req.user!.id } });
    await recordTimeline(refund.disputeId, 'refund_rejected', req.user!.id, `High-value refund rejected by Admin${reason ? `: ${reason}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Refund Rejected (Admin)', actorId: req.user!.id, entityType: 'Dispute', entityId: refund.disputeId, details: reason, ipAddress: req.ip } });
    await notify({
      disputeId: refund.disputeId, recipientId: refund.dispute.raisedById, type: 'refund_rejected', title: `Refund rejected — ${refund.dispute.caseNumber}`,
      body: reason || 'Your refund request was reviewed and rejected.', emailSubject: `Refund update for ${refund.dispute.caseNumber} — Smart Campus`,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Freeze Wallet / Lock Account / Flag User / Flag Merchant ───
router.post('/admin/disputes/freeze-wallet', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { userId, freeze, disputeId } = req.body as { userId: string; freeze: boolean; disputeId?: string };
    const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found.' });
    await prisma.wallet.update({ where: { id: wallet.id }, data: { frozen: freeze } });
    await prisma.auditLog.create({ data: { action: freeze ? 'Wallet Frozen (Admin)' : 'Wallet Unfrozen (Admin)', actorId: req.user!.id, entityType: 'Wallet', entityId: wallet.id, ipAddress: req.ip } });
    if (disputeId) await recordTimeline(disputeId, freeze ? 'wallet_frozen' : 'wallet_unfrozen', req.user!.id, `Admin ${freeze ? 'froze' : 'unfroze'} the student's wallet`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/disputes/lock-account', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { userId, lock, disputeId } = req.body as { userId: string; lock: boolean; disputeId?: string };
    await prisma.user.update({ where: { id: userId }, data: { status: lock ? 'Locked' : 'Active' } });
    await prisma.auditLog.create({ data: { action: lock ? 'Account Locked (Admin)' : 'Account Unlocked (Admin)', actorId: req.user!.id, entityType: 'User', entityId: userId, ipAddress: req.ip } });
    if (disputeId) await recordTimeline(disputeId, lock ? 'account_locked' : 'account_unlocked', req.user!.id, `Admin ${lock ? 'locked' : 'unlocked'} the student's account`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/disputes/flag-user', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { userId, flag, reason, disputeId } = req.body as { userId: string; flag: boolean; reason?: string; disputeId?: string };
    await prisma.user.update({ where: { id: userId }, data: { flagged: flag, flagReason: flag ? reason : null } });
    await prisma.auditLog.create({ data: { action: flag ? 'User Flagged (Admin)' : 'User Unflagged (Admin)', actorId: req.user!.id, entityType: 'User', entityId: userId, details: reason, ipAddress: req.ip } });
    if (disputeId) await recordTimeline(disputeId, flag ? 'user_flagged' : 'user_unflagged', req.user!.id, `Admin ${flag ? 'flagged' : 'unflagged'} the student${reason ? `: ${reason}` : ''}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/disputes/flag-merchant', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { shopId, flag, disputeId } = req.body as { shopId: string; flag: boolean; disputeId?: string };
    await prisma.shop.update({ where: { id: shopId }, data: { flagged: flag } });
    await prisma.auditLog.create({ data: { action: flag ? 'Merchant Flagged (Admin)' : 'Merchant Unflagged (Admin)', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, ipAddress: req.ip } });
    if (disputeId) await recordTimeline(disputeId, flag ? 'merchant_flagged' : 'merchant_unflagged', req.user!.id, `Admin ${flag ? 'flagged' : 'unflagged'} the merchant`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Reports ───
router.post('/admin/disputes/report', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { format, status, fromDate, toDate } = req.body as { format: 'csv' | 'excel' | 'pdf'; status?: string; fromDate?: string; toDate?: string };
    const url = await generateDisputeReportFile(format, status, fromDate, toDate);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
