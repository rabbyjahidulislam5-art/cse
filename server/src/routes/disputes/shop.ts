import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify } from '../../lib/disputes/notify';
import { disputeUpload, saveDisputeAttachment, recordTimeline, changeDisputeStatus, assembleDisputeDetail, staffDisputeActionLimiter } from './shared';

const router = express.Router();
const requireShopStaff = requireRole('Shop Staff');

// Mirrors the existing shop-identification shortcut already used by /shop/dashboard in index.ts
// (this platform doesn't yet model a staff-to-shop link — every Shop Staff account manages the
// single active shop). Not something this module should change; it's an existing pattern.
async function currentShop() {
  return prisma.shop.findFirst({ where: { status: 'Active' } });
}

router.post('/shop/disputes/list', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
  try {
    const shop = await currentShop();
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });
    const { status, limit = 25, offset = 0 } = req.body as { status?: string; limit?: number; offset?: number };
    const where: any = { deletedAt: null, transaction: { shopId: shop.id } };
    if (status && status !== 'all') where.status = status;

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

router.post('/shop/disputes/detail', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
  try {
    const shop = await currentShop();
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });
    const { disputeId } = req.body as { disputeId: string };

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: { select: { shopId: true } } } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.transaction.shopId !== shop.id) return res.status(403).json({ message: 'This case does not belong to your shop.' });

    const detail = await assembleDisputeDetail(disputeId);
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Shop can reply and upload proof (invoice, photo, CCTV image, receipt) — same attachment
// pipeline as every other role, real-content validation included. Internal notes supported via
// the isInternal flag. There is no delete endpoint anywhere in this module — messages are
// immutable once posted, satisfying "Cannot delete messages" structurally, not by convention.
router.post('/shop/disputes/reply', authMiddleware, requireShopStaff, staffDisputeActionLimiter, disputeUpload.array('files', 5), async (req: AuthRequest, res) => {
  try {
    const shop = await currentShop();
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });
    const { disputeId, body, isInternal } = req.body as { disputeId: string; body: string; isInternal?: string };
    if (!disputeId || !body?.trim()) return res.status(400).json({ message: 'A message body is required.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: { select: { shopId: true } } } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.transaction.shopId !== shop.id) return res.status(403).json({ message: 'This case does not belong to your shop.' });

    const internal = isInternal === 'true';
    const message = await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: body.trim(), isInternal: internal } });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    for (const file of files) {
      try { await saveDisputeAttachment({ disputeId, uploadedById: req.user!.id, messageId: message.id, originalName: file.originalname, buffer: file.buffer }); } catch { /* skip bad file */ }
    }

    await recordTimeline(disputeId, internal ? 'internal_note' : 'message', req.user!.id, internal ? 'Shop added an internal note' : `${shop.name} replied`);

    if (!internal) {
      if (dispute.status === 'WaitingForShop') {
        await changeDisputeStatus(disputeId, 'Investigating', req.user!.id, 'Shop replied');
      }
      await notify({
        disputeId, recipientId: dispute.raisedById, type: 'reply', title: `Update on ${dispute.caseNumber}`,
        body: `${shop.name} replied on your case ${dispute.caseNumber}.`, emailSubject: `Update on your dispute ${dispute.caseNumber} — Smart Campus`,
      });
    }

    res.json({ success: true, messageId: message.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
