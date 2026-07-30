import express from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../../lib/auth';
import { notify, notifyRole } from '../../lib/disputes/notify';
import { disputeUpload, saveDisputeAttachment, recordTimeline, changeDisputeStatus, assembleDisputeDetail, staffDisputeActionLimiter, returnOwnerStatus } from './shared';

const router = express.Router();
const requireShopStaff = requireRole('Shop Staff');

// Resolves the shop this staff account actually owns — Shop.ownerId is the real staff-to-shop
// link (already used correctly by /shop/dashboard in index.ts). Each Shop Staff account manages
// exactly the one shop it's linked to, not "whichever shop happens to be Active" — that hack
// broke down as soon as more than one shop existed.
async function currentShop(ownerId: string) {
  return prisma.shop.findFirst({ where: { ownerId } });
}

// A case "belongs" to this shop if it was explicitly forwarded to it (forwardedShopId) or, for
// legacy cases predating that column, if the underlying transaction's shopId matches.
function shopWhereClause(shopId: string) {
  return { OR: [{ forwardedShopId: shopId }, { transaction: { shopId } }] };
}

router.post('/shop/disputes/list', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
  try {
    const shop = await currentShop(req.user!.id);
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account. Contact the Admin Office.' });
    const { status, limit = 25, offset = 0 } = req.body as { status?: string; limit?: number; offset?: number };
    const where: any = { deletedAt: null, ...shopWhereClause(shop.id) };
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
    const shop = await currentShop(req.user!.id);
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account. Contact the Admin Office.' });
    const { disputeId } = req.body as { disputeId: string };

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: { select: { shopId: true } } } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.forwardedShopId !== shop.id && dispute.transaction.shopId !== shop.id) return res.status(403).json({ message: 'This case does not belong to your shop.' });

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
    const shop = await currentShop(req.user!.id);
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account. Contact the Admin Office.' });
    const { disputeId, body, isInternal } = req.body as { disputeId: string; body: string; isInternal?: string };
    if (!disputeId || !body?.trim()) return res.status(400).json({ message: 'A message body is required.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: { select: { shopId: true } } } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.forwardedShopId !== shop.id && dispute.transaction.shopId !== shop.id) return res.status(403).json({ message: 'This case does not belong to your shop.' });

    const internal = isInternal === 'true';
    const message = await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body: body.trim(), isInternal: internal } });

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    for (const file of files) {
      try { await saveDisputeAttachment({ disputeId, uploadedById: req.user!.id, messageId: message.id, originalName: file.originalname, buffer: file.buffer }); } catch { /* skip bad file */ }
    }

    await recordTimeline(disputeId, internal ? 'internal_note' : 'message', req.user!.id, internal ? 'Shop added an internal note' : `${shop.name} replied`);

    if (!internal) {
      if (dispute.status === 'WaitingForShop') {
        await changeDisputeStatus(disputeId, returnOwnerStatus(dispute.forwardedByRole), req.user!.id, 'Shop replied');
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

// Approve / Reject / Waive — mirrors Library's recommendation flow. Shop doesn't process refunds
// directly (only Accounts/Admin move money); this records the shop's verification finding and
// hands the case back to whoever forwarded it (Accounts or Admin).
router.post('/shop/disputes/recommend', authMiddleware, requireShopStaff, staffDisputeActionLimiter, async (req: AuthRequest, res) => {
  try {
    const shop = await currentShop(req.user!.id);
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account. Contact the Admin Office.' });
    const { disputeId, decision, note } = req.body as { disputeId: string; decision: 'Approve' | 'Reject' | 'Waive'; note?: string };
    if (!['Approve', 'Reject', 'Waive'].includes(decision)) return res.status(400).json({ message: 'Invalid decision.' });

    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { transaction: { select: { shopId: true } } } });
    if (!dispute || dispute.deletedAt) return res.status(404).json({ message: 'Dispute not found.' });
    if (dispute.forwardedShopId !== shop.id && dispute.transaction.shopId !== shop.id) return res.status(403).json({ message: 'This case does not belong to your shop.' });
    if (dispute.status !== 'WaitingForShop') return res.status(400).json({ message: 'This case is not currently waiting on your shop.' });

    const label = decision === 'Approve' ? 'Shop confirms the issue — refund recommended'
      : decision === 'Reject' ? 'Shop disputes the claim — transaction was fulfilled'
      : 'Shop offers a goodwill resolution (refund recommended)';
    const body = `${label}${note ? ` — ${note}` : ''}`;

    await prisma.disputeMessage.create({ data: { disputeId, authorId: req.user!.id, body, isInternal: true } });
    await recordTimeline(disputeId, 'shop_recommendation', req.user!.id, body);
    const backTo = returnOwnerStatus(dispute.forwardedByRole);
    await changeDisputeStatus(disputeId, backTo, req.user!.id, `Shop recommendation: ${decision}`);
    await prisma.auditLog.create({ data: { action: 'Shop Recommendation', actorId: req.user!.id, entityType: 'Dispute', entityId: disputeId, details: body, ipAddress: req.ip } });

    if (dispute.forwardedById) {
      await notify({ disputeId, recipientId: dispute.forwardedById, type: 'shop_recommendation', title: `Shop recommendation on ${dispute.caseNumber}`, body });
    } else if (dispute.assignedToId) {
      await notify({ disputeId, recipientId: dispute.assignedToId, type: 'shop_recommendation', title: `Shop recommendation on ${dispute.caseNumber}`, body });
    } else {
      await notifyRole(dispute.forwardedByRole || 'Accounts Office', { disputeId, type: 'shop_recommendation', title: `Shop recommendation on ${dispute.caseNumber}`, body });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
