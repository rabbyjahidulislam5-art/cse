import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify } from '../../lib/disputes/notify';
import {
  DisputeStatus, DISPUTE_STATUSES, RefundMethod, REFUND_METHODS, TERMINAL_STATUSES,
  recordTimeline, changeDisputeStatus, assembleDisputeDetail, finalizeRefund, generateDisputeReportFile,
  staffDisputeActionLimiter,
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
router.post('/admin/disputes/list', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { status, search, limit = 25, offset = 0 } = req.body as { status?: string; search?: string; limit?: number; offset?: number };
    const where: any = { deletedAt: null };
    if (status && status !== 'all') where.status = status;
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

// ─── Approve / Reject a high-value (>= threshold) refund ───
router.post('/admin/disputes/refund/approve', authMiddleware, requireAdmin, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { refundId, notes } = req.body as { refundId: string; notes?: string };
    const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { dispute: { include: { transaction: true } } } });
    if (!refund) return res.status(404).json({ message: 'Refund not found.' });
    if (refund.status !== 'Pending') return res.status(400).json({ message: 'Only a pending refund can be approved.' });

    await prisma.refundApproval.create({ data: { refundId, approverId: req.user!.id, decision: 'Approved', notes } });
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
