import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify, notifyRole } from '../../lib/disputes/notify';
import { extendSlaByFreezeDuration } from '../../lib/disputes/slaClock';
import {
  DisputeStatus, RefundMethod, REFUND_METHODS, OPEN_STATUSES, TERMINAL_STATUSES, REFUND_APPROVAL_THRESHOLD,
  disputeUpload, saveDisputeAttachment, recordTimeline, changeDisputeStatus, assembleDisputeDetail,
  finalizeRefund, generateDisputeReportFile, staffDisputeActionLimiter,
} from './shared';

const router = express.Router();
const requireAccounts = requireRole('Accounts Office');

// ─── Dashboard stats (Kanban counts + SLA + refund KPIs) ───
router.post('/accounts/disputes/stats', authMiddleware, requireAccounts, async (_req: AuthRequest, res) => {
  try {
    const statuses: DisputeStatus[] = ['Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary', 'WaitingForAdmin', 'Resolved', 'Rejected', 'Refunded'];
    const counts = await Promise.all(statuses.map(s => prisma.dispute.count({ where: { status: s, deletedAt: null } })));

    const resolvedCases = await prisma.dispute.findMany({
      where: { status: { in: ['Resolved', 'Rejected', 'Refunded'] }, resolvedAt: { not: null }, deletedAt: null },
      select: { createdAt: true, resolvedAt: true },
      take: 500, orderBy: { resolvedAt: 'desc' },
    });
    const avgResolutionHours = resolvedCases.length
      ? resolvedCases.reduce((sum, d) => sum + (d.resolvedAt!.getTime() - d.createdAt.getTime()), 0) / resolvedCases.length / (1000 * 60 * 60)
      : 0;

    const overdue = await prisma.dispute.count({ where: { status: { in: OPEN_STATUSES }, frozen: false, slaDueAt: { lt: new Date() }, deletedAt: null } });
    const refunds = await prisma.refund.aggregate({ where: { status: 'Processed' }, _sum: { amount: true }, _count: true });

    res.json({
      byStatus: Object.fromEntries(statuses.map((s, i) => [s, counts[i]])),
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      slaOverdue: overdue,
      totalRefunded: refunds._sum.amount || 0,
      refundCount: refunds._count,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Case list ───
router.post('/accounts/disputes/list', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const { status, assignedToMe, search, limit = 25, offset = 0 } = req.body as { status?: string; assignedToMe?: boolean; search?: string; limit?: number; offset?: number };
    const where: any = { deletedAt: null };
    if (status && status !== 'all') where.status = status;
    if (assignedToMe) where.assignedToId = req.user!.id;
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
        include: {
          raisedBy: { select: { fullName: true, studentId: true } },
          assignedTo: { select: { fullName: true } },
          transaction: { select: { reference: true, amount: true, type: true } },
        },
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

// ─── Case detail — full payment info, SSLCommerz info, gateway logs, student profile, previous
// cases, risk score, related transactions. ───
router.post('/accounts/disputes/detail', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const { disputeId } = req.body as { disputeId: string };
    const detail = await assembleDisputeDetail(disputeId);
    if (!detail) return res.status(404).json({ message: 'Dispute not found.' });
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Assign case ───
router.post('/accounts/disputes/assign', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, assignedToId, note } = req.body as { disputeId: string; assignedToId: string; note?: string };
    const officer = await prisma.user.findFirst({ where: { id: assignedToId, role: 'Accounts Office' } });
    if (!officer) return res.status(404).json({ message: 'Accounts officer not found.' });

    await prisma.dispute.update({ where: { id: disputeId }, data: { assignedToId } });
    await prisma.disputeAssignment.create({ data: { disputeId, assignedToId, assignedById: req.user!.id, note } });
    await recordTimeline(disputeId, 'assigned', req.user!.id, `Assigned to ${officer.fullName || officer.email}${note ? ` — ${note}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Assigned', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `Assigned to ${officer.fullName}`, ipAddress: req.ip } });
    await notify({ disputeId, recipientId: assignedToId, type: 'assigned', title: 'Case assigned to you', body: `You've been assigned a dispute case.` });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Reply / internal note (isInternal flag distinguishes the two) ───
router.post('/accounts/disputes/reply', authMiddleware, requireAccounts, staffDisputeActionLimiter, disputeUpload.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const { disputeId, body, isInternal } = req.body as { disputeId: string; body: string; isInternal?: string };
    if (!disputeId || !body?.trim()) return res.status(400).json({ message: 'A message body is required.' });
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });

    const internal = isInternal === 'true';
    const message = await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: body.trim(), isInternal: internal } });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    for (const file of files) {
      try { await saveDisputeAttachment({ disputeId, uploadedById: req.user!.id, messageId: message.id, originalName: file.originalname, buffer: file.buffer }); } catch { /* skip bad file */ }
    }

    await recordTimeline(disputeId, internal ? 'internal_note' : 'message', req.user!.id, internal ? 'Internal note added' : `${req.user!.fullName || 'Accounts Office'} replied`);

    if (!internal) {
      if (dispute.status === 'WaitingForAdmin' || OPEN_STATUSES.includes(dispute.status as DisputeStatus)) {
        // A reply to the student naturally puts the ball back in their court, unless the case is
        // already in a role-specific waiting state that this reply doesn't resolve.
        if (dispute.status !== 'WaitingForShop' && dispute.status !== 'WaitingForLibrary') {
          await changeDisputeStatus(disputeId, 'WaitingForStudent', req.user!.id, 'Accounts Office replied');
        }
      }
      await notify({
        disputeId, recipientId: dispute.raisedById, type: 'reply', title: `Update on ${dispute.caseNumber}`,
        body: `The Accounts Office replied on your case ${dispute.caseNumber}.`, emailSubject: `Update on your dispute ${dispute.caseNumber} — Smart Campus`,
      });
    }

    res.json({ success: true, messageId: message.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Request Documents — a templated message + status change, nothing structurally new ───
router.post('/accounts/disputes/request-documents', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, details } = req.body as { disputeId: string; details: string };
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });

    const body = `Please provide additional documents/proof: ${details}`;
    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body, isInternal: false } });
    await changeDisputeStatus(disputeId, 'WaitingForStudent', req.user!.id, 'Documents requested');
    await recordTimeline(disputeId, 'documents_requested', req.user!.id, `Documents requested: ${details}`);
    await notify({
      disputeId, recipientId: dispute.raisedById, type: 'documents_requested', title: `Documents requested — ${dispute.caseNumber}`,
      body, emailSubject: `Action needed on your dispute ${dispute.caseNumber} — Smart Campus`,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Freeze Review / Unfreeze — pauses/resumes the SLA clock ───
router.post('/accounts/disputes/freeze', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, reason } = req.body as { disputeId: string; reason?: string };
    await prisma.dispute.update({ where: { id: disputeId }, data: { frozen: true, frozenAt: new Date() } });
    await recordTimeline(disputeId, 'frozen', req.user!.id, `Case frozen for deeper review${reason ? `: ${reason}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Frozen', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: reason, ipAddress: req.ip } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/disputes/unfreeze', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId } = req.body as { disputeId: string };
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return res.status(404).json({ message: 'Dispute not found.' });
    const newSlaDueAt = extendSlaByFreezeDuration(dispute.slaDueAt, dispute.frozenAt);
    await prisma.dispute.update({ where: { id: disputeId }, data: { frozen: false, frozenAt: null, slaDueAt: newSlaDueAt || undefined } });
    await recordTimeline(disputeId, 'unfrozen', req.user!.id, 'Case unfrozen — SLA clock resumed');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Forward to Shop / Library / Admin queue ───
router.post('/accounts/disputes/forward', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, to, note } = req.body as { disputeId: string; to: 'Shop' | 'Library' | 'Admin'; note?: string };
    const targetStatus: DisputeStatus = to === 'Shop' ? 'WaitingForShop' : to === 'Library' ? 'WaitingForLibrary' : 'WaitingForAdmin';
    const targetRole = to === 'Shop' ? 'Shop Staff' : to === 'Library' ? 'Library' : 'Admin Office';

    await changeDisputeStatus(disputeId, targetStatus, req.user!.id, `Forwarded to ${to}${note ? `: ${note}` : ''}`);
    await notifyRole(targetRole, { disputeId, type: 'forwarded', title: `Case forwarded to ${to}`, body: note || `A dispute case was forwarded to ${to} for input.` });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Escalate — raises priority and hands to Admin Office ───
router.post('/accounts/disputes/escalate', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, reason } = req.body as { disputeId: string; reason?: string };
    await prisma.dispute.update({ where: { id: disputeId }, data: { priority: 'High' } });
    await changeDisputeStatus(disputeId, 'WaitingForAdmin', req.user!.id, `Escalated${reason ? `: ${reason}` : ''}`);
    await notifyRole('Admin Office', { disputeId, type: 'escalated', title: 'Case escalated', body: reason || 'A dispute case was escalated for Admin attention.' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Resolve (no refund) / Reject ───
router.post('/accounts/disputes/resolve', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, resolutionNote } = req.body as { disputeId: string; resolutionNote: string };
    if (!resolutionNote?.trim()) return res.status(400).json({ message: 'A resolution note is required.' });
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return res.status(404).json({ message: 'Dispute not found.' });

    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: resolutionNote.trim(), isInternal: false } });
    await changeDisputeStatus(disputeId, 'Resolved', req.user!.id, resolutionNote.trim());
    await notify({ disputeId, recipientId: dispute.raisedById, type: 'resolved', title: `Case resolved — ${dispute.caseNumber}`, body: resolutionNote.trim(), emailSubject: `Your dispute ${dispute.caseNumber} has been resolved — Smart Campus` });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/disputes/reject', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, reason } = req.body as { disputeId: string; reason: string };
    if (!reason?.trim()) return res.status(400).json({ message: 'A rejection reason is required.' });
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return res.status(404).json({ message: 'Dispute not found.' });

    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: reason.trim(), isInternal: false } });
    await changeDisputeStatus(disputeId, 'Rejected', req.user!.id, reason.trim());
    await notify({ disputeId, recipientId: dispute.raisedById, type: 'rejected', title: `Case rejected — ${dispute.caseNumber}`, body: reason.trim(), emailSubject: `Update on your dispute ${dispute.caseNumber} — Smart Campus` });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Refund — Initiate. Full or Partial, Wallet Credit / Original Payment / Manual Adjustment.
// Amounts below the approval threshold process immediately (via the shared finalizeRefund ledger
// call); at/above it, the Refund sits Pending until an Admin approves it (see admin.ts). ───
router.post('/accounts/disputes/refund/initiate', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, method, amountType, amount: partialAmount, notes } = req.body as {
      disputeId: string; method: RefundMethod; amountType: 'Full' | 'Partial'; amount?: number; notes?: string;
    };
    if (!REFUND_METHODS.includes(method)) return res.status(400).json({ message: 'Invalid refund method.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: true } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (TERMINAL_STATUSES.includes(dispute.status as DisputeStatus)) return res.status(400).json({ message: 'This case is already closed.' });

    const existingActive = await prisma.refund.findFirst({ where: { disputeId, status: { in: ['Pending', 'Approved', 'Processed'] } } });
    if (existingActive) return res.status(409).json({ message: 'A refund has already been initiated for this case.' });

    const fullAmount = dispute.transaction.amount;
    const amount = amountType === 'Full' ? fullAmount : Number(partialAmount);
    if (!amount || amount <= 0 || amount > fullAmount) return res.status(400).json({ message: 'Invalid refund amount.' });

    const refund = await prisma.refund.create({
      data: { disputeId, transactionId: dispute.transactionId, method, amountType, amount, status: 'Pending', initiatedById: req.user!.id, notes },
    });
    await recordTimeline(disputeId, 'refund_initiated', req.user!.id, `${amountType} refund of ৳${amount.toLocaleString()} initiated via ${method}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Refund Initiated', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `${method} ${amountType} ৳${amount}`, ipAddress: req.ip } });

    if (amount >= REFUND_APPROVAL_THRESHOLD) {
      await notifyRole('Admin Office', {
        disputeId, type: 'refund_approval_needed', title: `High-value refund needs approval — ${dispute.caseNumber}`,
        body: `A ৳${amount.toLocaleString()} refund on case ${dispute.caseNumber} needs Admin approval.`,
      });
      return res.json({ success: true, refundId: refund.id, status: 'Pending', requiresAdminApproval: true });
    }

    // Below threshold — process immediately.
    const result = await finalizeRefund({
      refund: { id: refund.id, method, amount, disputeId }, transactionId: dispute.transactionId,
      recipientUserId: dispute.transaction.userId, processedById: req.user!.id, notes, ipAddress: req.ip, caseNumber: dispute.caseNumber,
    });
    if (!result.ok) return res.status(400).json({ message: result.message });

    res.json({ success: true, refundId: refund.id, status: 'Processed', requiresAdminApproval: false });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/disputes/refund/reject', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { refundId, reason } = req.body as { refundId: string; reason: string };
    const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { dispute: true } });
    if (!refund) return res.status(404).json({ message: 'Refund not found.' });
    if (refund.status !== 'Pending') return res.status(400).json({ message: 'Only a pending refund can be rejected.' });

    await prisma.refund.update({ where: { id: refundId }, data: { status: 'Rejected', notes: reason } });
    await recordTimeline(refund.disputeId, 'refund_rejected', req.user!.id, `Refund request rejected${reason ? `: ${reason}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Refund Rejected', actorId: req.user!.id, entityType: 'Dispute', entityId: refund.disputeId, details: reason, ipAddress: req.ip } });
    await notify({
      disputeId: refund.disputeId, recipientId: refund.dispute.raisedById, type: 'refund_rejected', title: `Refund rejected — ${refund.dispute.caseNumber}`,
      body: reason || 'Your refund request was reviewed and rejected.', emailSubject: `Refund update for ${refund.dispute.caseNumber} — Smart Campus`,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Merge / Split — non-destructive (decision #10 in the plan): merge closes the source case
// and points it at the target via mergedIntoId; split opens a new case pointing back via
// splitFromId. Neither moves or deletes any existing message/attachment/timeline row. ───
router.post('/accounts/disputes/merge', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { sourceDisputeId, targetDisputeId, note } = req.body as { sourceDisputeId: string; targetDisputeId: string; note?: string };
    if (sourceDisputeId === targetDisputeId) return res.status(400).json({ message: 'Cannot merge a case into itself.' });
    const target = await prisma.dispute.findUnique({ where: { id: targetDisputeId } });
    if (!target) return res.status(404).json({ message: 'Target case not found.' });

    await prisma.dispute.update({ where: { id: sourceDisputeId }, data: { mergedIntoId: targetDisputeId, status: 'Closed', closedAt: new Date() } });
    await recordTimeline(sourceDisputeId, 'merged', req.user!.id, `Merged into ${target.caseNumber}${note ? `: ${note}` : ''}`);
    await recordTimeline(targetDisputeId, 'merge_received', req.user!.id, `Absorbed case ${sourceDisputeId}${note ? `: ${note}` : ''}`);
    await prisma.auditLog.create({ data: { action: 'Disputes Merged', actorId: req.user!.id, entityType: 'Dispute', entityId: sourceDisputeId, details: `Merged into ${target.caseNumber}`, ipAddress: req.ip } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/disputes/split', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, category, description } = req.body as { disputeId: string; category: string; description: string };
    const source = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!source) return res.status(404).json({ message: 'Case not found.' });

    const { generateCaseNumber } = await import('../../lib/disputes/caseNumber');
    const { computeSlaDueAt } = await import('../../lib/disputes/slaClock');
    const caseNumber = await generateCaseNumber();
    const newDispute = await prisma.dispute.create({
      data: {
        caseNumber, transactionId: source.transactionId, raisedById: source.raisedById,
        category: category || source.category, description: description || `Split from ${source.caseNumber}: ${source.description}`,
        status: 'Open', slaDueAt: computeSlaDueAt(), splitFromId: source.id,
      },
    });
    await recordTimeline(disputeId, 'split', req.user!.id, `Split into new case ${caseNumber}`);
    await recordTimeline(newDispute.id, 'created', req.user!.id, `Split from case ${source.caseNumber}`);
    await prisma.auditLog.create({ data: { action: 'Dispute Split', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: `Split into ${caseNumber}`, ipAddress: req.ip } });

    res.json({ success: true, caseNumber, disputeId: newDispute.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Close (after Resolved/Rejected/Refunded) ───
router.post('/accounts/disputes/close', authMiddleware, requireAccounts, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId } = req.body as { disputeId: string };
    await changeDisputeStatus(disputeId, 'Closed', req.user!.id, 'Closed by Accounts Office');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Reports (CSV / Excel / PDF) ───
router.post('/accounts/disputes/report', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const { format, status, fromDate, toDate } = req.body as { format: 'csv' | 'excel' | 'pdf'; status?: string; fromDate?: string; toDate?: string };
    const url = await generateDisputeReportFile(format, status, fromDate, toDate);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── List Accounts officers (for the assign dropdown) ───
router.post('/accounts/disputes/officers', authMiddleware, requireAccounts, async (_req: AuthRequest, res) => {
  try {
    const officers = await prisma.user.findMany({ where: { role: 'Accounts Office' }, select: { id: true, fullName: true, email: true } });
    res.json({ officers });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
