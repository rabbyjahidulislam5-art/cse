import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import prisma from '../../lib/prisma';
import { authMiddleware, AuthRequest } from '../../lib/auth';
import { generateCaseNumber } from '../../lib/disputes/caseNumber';
import { computeSlaDueAt } from '../../lib/disputes/slaClock';
import { notifyRole, notify } from '../../lib/disputes/notify';
import {
  DISPUTE_CATEGORIES, DisputeCategory, MIN_DESCRIPTION_LENGTH,
  disputeUpload, saveDisputeAttachment, disputeAttachmentUrl,
  recordTimeline, changeDisputeStatus, assembleTransactionDetail, userOwnsTransaction,
  generateDisputeSummaryPdf,
} from './shared';

const router = express.Router();

// Same per-user-or-IP keying convention as paymentInitLimiter in index.ts.
const disputeActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.user?.id || ipKeyGenerator(req.ip || 'unknown'),
  message: { message: 'Too many dispute actions. Please wait a moment and try again.' },
});

function serializeAttachment(a: { id: string; disputeId: string; originalName: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: Date; storedName: string; messageId: string | null }) {
  return {
    id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes,
    scanStatus: a.scanStatus, createdAt: a.createdAt, messageId: a.messageId,
    url: disputeAttachmentUrl(a.disputeId, a.storedName),
  };
}

// ─── Transaction detail — the data behind the expandable payment card ───
router.post('/disputes/transaction-detail', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { transactionId } = req.body as { transactionId: string };
    if (!transactionId) return res.status(400).json({ message: 'transactionId is required.' });

    const tx = await prisma.transaction.findFirst({ where: { OR: [{ id: transactionId }, { reference: transactionId }] } });
    if (!tx) return res.status(404).json({ message: 'Transaction not found.' });
    if (!(await userOwnsTransaction(userId, tx))) return res.status(403).json({ message: 'You do not have access to this transaction.' });

    const detail = await assembleTransactionDetail(tx.id);
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Raise a dispute — Step 3 (Review/Submit) of the wizard. Category + description + up to 5
// files arrive in one multipart request, so a Dispute row (and its required disputeId FK on every
// attachment) only ever exists once the case is actually being submitted — no orphaned drafts. ───
router.post('/disputes/create', authMiddleware, disputeActionLimiter, disputeUpload.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { transactionId, category, description } = req.body as { transactionId: string; category: string; description: string };

    if (!DISPUTE_CATEGORIES.includes(category as DisputeCategory)) {
      return res.status(400).json({ message: 'Please select a valid dispute category.' });
    }
    if (!description || description.trim().length < MIN_DESCRIPTION_LENGTH) {
      return res.status(400).json({ message: `Please describe the issue in at least ${MIN_DESCRIPTION_LENGTH} characters.` });
    }

    const tx = await prisma.transaction.findFirst({ where: { OR: [{ id: transactionId }, { reference: transactionId }] } });
    if (!tx) return res.status(404).json({ message: 'Transaction not found.' });
    if (tx.status !== 'Success') return res.status(400).json({ message: 'Only completed payments can be disputed.' });
    if (!(await userOwnsTransaction(userId, tx))) return res.status(403).json({ message: 'You can only dispute your own transactions.' });

    const existing = await prisma.dispute.findFirst({ where: { transactionId: tx.id, status: { notIn: ['Rejected', 'Closed'] } } });
    if (existing) {
      return res.status(409).json({ message: `A dispute is already open for this transaction (${existing.caseNumber}).`, caseNumber: existing.caseNumber });
    }

    const caseNumber = await generateCaseNumber();
    const slaDueAt = computeSlaDueAt();

    const dispute = await prisma.dispute.create({
      data: { caseNumber, transactionId: tx.id, raisedById: userId, category, description: description.trim(), status: 'Open', slaDueAt },
    });

    await recordTimeline(dispute.id, 'created', userId, `Case ${caseNumber} opened — ${category}`);
    await prisma.auditLog.create({
      data: { action: 'Dispute Raised', actorId: userId, entityType: 'Dispute', entityId: dispute.id, details: `${caseNumber} — ${category} — Transaction ${tx.reference}`, ipAddress: req.ip },
    });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const skippedFiles: { name: string; reason: string }[] = [];
    for (const file of files) {
      try {
        await saveDisputeAttachment({ disputeId: dispute.id, uploadedById: userId, originalName: file.originalname, buffer: file.buffer });
      } catch (e: any) {
        skippedFiles.push({ name: file.originalname, reason: e.message || 'Invalid file' });
      }
    }
    if (files.length) {
      await recordTimeline(dispute.id, 'attachment_uploaded', userId, `${files.length - skippedFiles.length} of ${files.length} file(s) attached`);
    }

    await notifyRole('Accounts Office', {
      disputeId: dispute.id, type: 'case_opened', title: `New dispute: ${caseNumber}`,
      body: `${req.user!.fullName || req.user!.email} raised a "${category}" dispute on transaction ${tx.reference} (৳${tx.amount.toLocaleString()}).`,
    });

    res.json({ success: true, caseNumber: dispute.caseNumber, disputeId: dispute.id, status: dispute.status, skippedFiles });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// ─── List my disputes ───
router.post('/disputes/my', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { status, limit = 20, offset = 0 } = req.body as { status?: string; limit?: number; offset?: number };
    const where: any = { raisedById: userId, deletedAt: null };
    if (status && status !== 'all') where.status = status;

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: { transaction: { select: { reference: true, amount: true, type: true } } },
      }),
      prisma.dispute.count({ where }),
    ]);

    res.json({
      disputes: disputes.map(d => ({
        id: d.id, caseNumber: d.caseNumber, category: d.category, status: d.status,
        createdAt: d.createdAt, slaDueAt: d.slaDueAt, resolvedAt: d.resolvedAt,
        transaction: d.transaction ? { reference: d.transaction.reference, amount: d.transaction.amount, type: d.transaction.type } : null,
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Case detail: transaction + messages (own view never sees isInternal notes) + attachments +
// timeline + status history + refunds. Also clears the unread badge for this case. ───
router.post('/disputes/detail', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { disputeId } = req.body as { disputeId: string };
    if (!disputeId) return res.status(400).json({ message: 'disputeId is required.' });

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        messages: { where: { isInternal: false }, orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, fullName: true, role: true } }, attachments: true } },
        attachments: { where: { messageId: null } },
        timeline: { orderBy: { createdAt: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
        assignedTo: { select: { fullName: true } },
      },
    });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.raisedById !== userId) return res.status(403).json({ message: 'You do not have access to this case.' });

    const transactionDetail = await assembleTransactionDetail(dispute.transactionId);

    await prisma.disputeNotification.updateMany({ where: { disputeId, recipientId: userId, readAt: null }, data: { readAt: new Date() } });

    res.json({
      dispute: {
        id: dispute.id, caseNumber: dispute.caseNumber, category: dispute.category, description: dispute.description,
        status: dispute.status, priority: dispute.priority, slaDueAt: dispute.slaDueAt, frozen: dispute.frozen,
        assignedToName: dispute.assignedTo?.fullName || null, createdAt: dispute.createdAt, resolvedAt: dispute.resolvedAt, closedAt: dispute.closedAt,
      },
      transaction: transactionDetail,
      messages: dispute.messages.map(m => ({
        id: m.id, body: m.body, authorName: m.author.fullName || 'Unknown', authorRole: m.author.role, createdAt: m.createdAt,
        attachments: m.attachments.map(serializeAttachment),
      })),
      attachments: dispute.attachments.map(serializeAttachment),
      timeline: dispute.timeline.map(t => ({ id: t.id, eventType: t.eventType, summary: t.summary, createdAt: t.createdAt })),
      statusHistory: dispute.statusHistory.map(s => ({ id: s.id, fromStatus: s.fromStatus, toStatus: s.toStatus, reason: s.reason, createdAt: s.createdAt })),
      refunds: dispute.refunds.map(r => ({ id: r.id, method: r.method, amountType: r.amountType, amount: r.amount, status: r.status, processedAt: r.processedAt, createdAt: r.createdAt })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Reply (student side) — flips WaitingForStudent back into the assigned officer's queue. ───
router.post('/disputes/reply', authMiddleware, disputeActionLimiter, disputeUpload.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { disputeId, body } = req.body as { disputeId: string; body: string };
    if (!disputeId || !body || !body.trim()) return res.status(400).json({ message: 'A reply message is required.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.raisedById !== userId) return res.status(403).json({ message: 'You do not have access to this case.' });
    if (['Resolved', 'Rejected', 'Refunded', 'Closed'].includes(dispute.status)) {
      return res.status(400).json({ message: 'This case is closed and no longer accepts replies.' });
    }

    const message = await prisma.disputeMessage.create({ data: { disputeId, authorId: userId, body: body.trim(), isInternal: false } });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    for (const file of files) {
      try {
        await saveDisputeAttachment({ disputeId, uploadedById: userId, messageId: message.id, originalName: file.originalname, buffer: file.buffer });
      } catch { /* individual bad file is skipped, doesn't fail the reply */ }
    }

    await recordTimeline(disputeId, 'message', userId, `${req.user!.fullName || 'Student'} replied`);

    if (dispute.status === 'WaitingForStudent') {
      await changeDisputeStatus(disputeId, 'Investigating', userId, 'Student replied');
    }

    if (dispute.assignedToId) {
      await notify({
        disputeId, recipientId: dispute.assignedToId, type: 'reply', title: `New reply on ${dispute.caseNumber}`,
        body: `${req.user!.fullName || 'The student'} replied on case ${dispute.caseNumber}.`,
      });
    } else {
      await notifyRole('Accounts Office', {
        disputeId, type: 'reply', title: `New reply on ${dispute.caseNumber}`,
        body: `${req.user!.fullName || 'The student'} replied on unassigned case ${dispute.caseNumber}.`,
      });
    }

    res.json({ success: true, messageId: message.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Student closes their own case (e.g. issue resolved outside the workflow, or raised in error) ───
router.post('/disputes/close', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { disputeId, reason } = req.body as { disputeId: string; reason?: string };
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.raisedById !== userId) return res.status(403).json({ message: 'You do not have access to this case.' });
    if (['Resolved', 'Rejected', 'Refunded', 'Closed'].includes(dispute.status)) {
      return res.status(400).json({ message: 'This case is already closed.' });
    }

    await changeDisputeStatus(disputeId, 'Closed', userId, reason || 'Closed by student');
    await prisma.auditLog.create({ data: { action: 'Dispute Closed by Student', actorId: userId, entityType: 'Dispute', entityId: disputeId, details: reason, ipAddress: req.ip } });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Download Dispute PDF ───
router.post('/disputes/pdf', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { disputeId } = req.body as { disputeId: string };
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { raisedBy: { select: { fullName: true, studentId: true } }, transaction: { select: { reference: true, amount: true, type: true, createdAt: true } } },
    });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.raisedById !== userId) return res.status(403).json({ message: 'You do not have access to this case.' });

    const url = await generateDisputeSummaryPdf(dispute);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
