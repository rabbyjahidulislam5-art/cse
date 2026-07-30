import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify, notifyRole } from '../../lib/disputes/notify';
import { disputeUpload, saveDisputeAttachment, recordTimeline, changeDisputeStatus, assembleDisputeDetail, staffDisputeActionLimiter, returnOwnerStatus } from './shared';

const router = express.Router();
const requireLibrary = requireRole('Library');

// Library must only ever see cases that were actually forwarded to them — not every dispute in
// the system. A case "belongs" to Library if it's currently WaitingForLibrary, or was at some
// point (so Library can still review/reply to their own past recommendation after Accounts moves
// it on to Investigating). Unlike Shop (whose scope is a permanent property of the transaction's
// shopId), Library's involvement is a status-history fact, so it's checked that way.
async function libraryCanAccess(disputeId: string): Promise<boolean> {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, select: { status: true } });
  if (!dispute) return false;
  if (dispute.status === 'WaitingForLibrary') return true;
  const everForwarded = await prisma.disputeStatusHistory.findFirst({ where: { disputeId, toStatus: 'WaitingForLibrary' } });
  return !!everForwarded;
}

// Library doesn't have direct refund authority in this system — only Accounts/Admin actually move
// money (the same authorization hierarchy every other payment path in the app already uses).
// "Approve / Reject / Waive" here means Library records its finding and hands the case back to
// Accounts with a clear recommendation, never bypassing reconciliation.
router.post('/library/disputes/list', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { limit = 25, offset = 0 } = req.body as { limit?: number; offset?: number };
    const where = { status: 'WaitingForLibrary', deletedAt: null } as const;
    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: { raisedBy: { select: { fullName: true, studentId: true } }, transaction: { select: { reference: true, amount: true, type: true } } },
      }),
      prisma.dispute.count({ where }),
    ]);
    res.json({
      disputes: disputes.map(d => ({
        id: d.id, caseNumber: d.caseNumber, category: d.category, status: d.status, createdAt: d.createdAt,
        studentName: d.raisedBy?.fullName || 'Unknown', studentId: d.raisedBy?.studentId || '',
        transaction: d.transaction ? { reference: d.transaction.reference, amount: d.transaction.amount, type: d.transaction.type } : null,
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/disputes/detail', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { disputeId } = req.body as { disputeId: string };
    if (!(await libraryCanAccess(disputeId))) return res.status(403).json({ message: 'This case was never forwarded to Library.' });
    const detail = await assembleDisputeDetail(disputeId);
    if (!detail) return res.status(404).json({ message: 'Dispute not found.' });
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/disputes/reply', authMiddleware, requireLibrary, staffDisputeActionLimiter, disputeUpload.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const { disputeId, body, isInternal } = req.body as { disputeId: string; body: string; isInternal?: string };
    if (!disputeId || !body?.trim()) return res.status(400).json({ message: 'A message body is required.' });
    if (!(await libraryCanAccess(disputeId))) return res.status(403).json({ message: 'This case was never forwarded to Library.' });
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });

    const internal = isInternal === 'true';
    const message = await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: body.trim(), isInternal: internal } });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    for (const file of files) {
      try { await saveDisputeAttachment({ disputeId, uploadedById: req.user!.id, messageId: message.id, originalName: file.originalname, buffer: file.buffer }); } catch { /* skip bad file */ }
    }

    await recordTimeline(disputeId, internal ? 'internal_note' : 'message', req.user!.id, internal ? 'Library added an internal note' : 'Library replied');
    if (!internal) {
      await notify({
        disputeId, recipientId: dispute.raisedById, type: 'reply', title: `Update on ${dispute.caseNumber}`,
        body: `The Library replied on your case ${dispute.caseNumber}.`, emailSubject: `Update on your dispute ${dispute.caseNumber} — Smart Campus`,
      });
    }

    res.json({ success: true, messageId: message.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Approve / Reject / Waive — records the recommendation as a message + timeline entry, then
// forwards the case back to Accounts (status -> Investigating) to actually action a refund.
router.post('/library/disputes/recommend', authMiddleware, requireLibrary, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const { disputeId, decision, note } = req.body as { disputeId: string; decision: 'Approve' | 'Reject' | 'Waive'; note?: string };
    if (!['Approve', 'Reject', 'Waive'].includes(decision)) return res.status(400).json({ message: 'Invalid decision.' });
    if (!(await libraryCanAccess(disputeId))) return res.status(403).json({ message: 'This case was never forwarded to Library.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });

    const label = decision === 'Approve' ? 'Library recommends: Approve / refund this fine'
      : decision === 'Reject' ? 'Library recommends: Reject — fine stands'
      : 'Library recommends: Waive the fine (refund recommended)';
    const body = `${label}${note ? ` — ${note}` : ''}`;

    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body, isInternal: true } });
    await recordTimeline(disputeId, 'library_recommendation', req.user!.id, body);
    // Return to whoever actually forwarded the case (Accounts vs Admin), not a hardcoded queue.
    const backTo = returnOwnerStatus(dispute.forwardedByRole);
    await changeDisputeStatus(disputeId, backTo, req.user!.id, `Library recommendation: ${decision}`);
    await prisma.auditLog.create({ data: { action: 'Library Recommendation', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: body, ipAddress: req.ip } });

    if (dispute.forwardedById) {
      await notify({ disputeId, recipientId: dispute.forwardedById, type: 'library_recommendation', title: `Library recommendation on ${dispute.caseNumber}`, body });
    } else if (dispute.assignedToId) {
      await notify({ disputeId, recipientId: dispute.assignedToId, type: 'library_recommendation', title: `Library recommendation on ${dispute.caseNumber}`, body });
    } else {
      await notifyRole(dispute.forwardedByRole || 'Accounts Office', { disputeId, type: 'library_recommendation', title: `Library recommendation on ${dispute.caseNumber}`, body });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
