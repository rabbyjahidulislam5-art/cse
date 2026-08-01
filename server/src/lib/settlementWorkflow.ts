import prisma from './prisma';
import type { Prisma, PrismaClient } from '@prisma/client';
import { notifyUser, notifyRole } from './notify';

// ── Enterprise Shop Settlement Workflow Engine ──
//
// Production-grade settlement lifecycle:
//   PendingReview → UnderVerification → Approved → ProcessingPayment → Paid
//   (with rejection and failure branches at each applicable stage)
//
// Every status transition is immutably recorded in SettlementStatusHistory.
// No status may be skipped, no record may be modified after creation.

export type SettlementStatus =
  | 'PendingReview'
  | 'UnderVerification'
  | 'Approved'
  | 'Rejected'
  | 'ProcessingPayment'
  | 'Paid'
  | 'Failed';

// Allowed transitions — any transition not listed here is structurally rejected.
const ALLOWED_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  PendingReview:      ['UnderVerification', 'Rejected'],
  UnderVerification:  ['Approved', 'Rejected'],
  Approved:           ['ProcessingPayment'],
  Rejected:           [],  // terminal
  ProcessingPayment:  ['Paid', 'Failed'],
  Paid:               [],  // terminal
  Failed:             ['ProcessingPayment'],  // controlled retry
};

export function isValidTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// Atomic settlement reference generator — same pattern as DSP-2026-XXXXXX for disputes.
export async function generateSettlementReference(): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await prisma.sequenceCounter.upsert({
    where: { id: 'settlement-reference' },
    update: { value: { increment: 1 } },
    create: { id: 'settlement-reference', value: 1 },
  });
  return `STL-${year}-${String(counter.value).padStart(6, '0')}`;
}

export interface CreateSettlementRequestInput {
  shopId: string;
  requestedById: string;
  requestedAmount: number;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankRoutingNumber?: string;
  notes?: string;
  ipAddress?: string;
  deviceInfo?: string;
}

/**
 * Validates that the requested amount doesn't exceed the shop's actual pending balance.
 */
export async function getShopPendingBalance(shopId: string): Promise<number> {
  const [revenueAgg, settledAgg] = await Promise.all([
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { shopId, status: 'Success' } }),
    prisma.settlement.aggregate({ _sum: { amount: true }, where: { shopId } }),
  ]);
  const totalReceived = revenueAgg._sum.amount || 0;
  const totalSettled = settledAgg._sum.amount || 0;
  return Math.max(0, totalReceived - totalSettled);
}

/**
 * Gets the total amount currently locked in non-terminal settlement requests
 * (PendingReview, UnderVerification, Approved, ProcessingPayment).
 */
async function getLockedSettlementAmount(shopId: string, excludeRequestId?: string): Promise<number> {
  const where: any = {
    shopId,
    status: { in: ['PendingReview', 'UnderVerification', 'Approved', 'ProcessingPayment'] },
  };
  if (excludeRequestId) where.id = { not: excludeRequestId };
  const agg = await prisma.settlementRequest.aggregate({ _sum: { requestedAmount: true }, where });
  return agg._sum.requestedAmount || 0;
}

/**
 * Creates a new settlement request with full validation.
 */
export async function createSettlementRequest(input: CreateSettlementRequestInput) {
  const { shopId, requestedById, requestedAmount, notes, ipAddress, deviceInfo } = input;

  if (!requestedAmount || requestedAmount <= 0) {
    throw new Error('Settlement amount must be greater than zero.');
  }

  // Validate against actual pending balance
  const pendingBalance = await getShopPendingBalance(shopId);
  const lockedAmount = await getLockedSettlementAmount(shopId);
  const availableBalance = Math.max(0, pendingBalance - lockedAmount);

  if (requestedAmount > availableBalance + 0.01) { // small float tolerance
    throw new Error(
      `Requested amount ৳${requestedAmount.toLocaleString()} exceeds available balance ৳${availableBalance.toLocaleString()}.` +
      (lockedAmount > 0 ? ` (৳${lockedAmount.toLocaleString()} is locked in pending requests)` : '')
    );
  }

  // Idempotency key: shopId + rounded amount + date (prevents duplicate submissions within same day)
  const today = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `${shopId}:${Math.round(requestedAmount * 100)}:${today}`;

  // Check for existing non-terminal request with same idempotency key
  const existing = await prisma.settlementRequest.findUnique({ where: { idempotencyKey } });
  if (existing && !['Rejected', 'Paid', 'Failed'].includes(existing.status)) {
    throw new Error('A settlement request for this amount is already pending. Please wait for it to be processed.');
  }

  // If there's a completed/rejected one with same key, make a new unique key
  const finalKey = existing ? `${idempotencyKey}:${Date.now()}` : idempotencyKey;

  const reference = await generateSettlementReference();

  // Snapshot bank info from Shop if not provided
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error('Shop not found.');

  const request = await prisma.settlementRequest.create({
    data: {
      reference,
      shopId,
      requestedById,
      requestedAmount,
      bankAccountName: input.bankAccountName || shop.bankAccountName || null,
      bankAccountNumber: input.bankAccountNumber || shop.bankAccountNumber || null,
      bankName: input.bankName || shop.bankName || null,
      bankBranch: input.bankBranch || shop.bankBranch || null,
      bankRoutingNumber: input.bankRoutingNumber || shop.bankRoutingNumber || null,
      notes: notes || null,
      status: 'PendingReview',
      idempotencyKey: finalKey,
    },
  });

  // Record the initial status in the history
  await prisma.settlementStatusHistory.create({
    data: {
      settlementRequestId: request.id,
      fromStatus: 'Created',
      toStatus: 'PendingReview',
      changedById: requestedById,
      reason: 'Settlement request submitted by shop owner.',
      ipAddress: ipAddress || null,
      deviceInfo: deviceInfo || null,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'settlement.request.created',
      actorId: requestedById,
      entityType: 'SettlementRequest',
      entityId: request.id,
      details: `Settlement request ${reference} for ৳${requestedAmount.toLocaleString()} submitted for shop "${shop.name}".`,
      ipAddress: ipAddress || null,
    },
  });

  // Notify Admin Office
  void notifyRole('Admin Office', {
    category: 'settlement',
    type: 'settlement.request.new',
    title: 'New Settlement Request',
    body: `${shop.name} has requested a settlement of ৳${requestedAmount.toLocaleString()}. Reference: ${reference}.`,
    link: '/admin/shops',
    emailSubject: `New Settlement Request — ${reference} — ৳${requestedAmount.toLocaleString()}`,
  });

  return request;
}

export interface TransitionInput {
  requestId: string;
  newStatus: SettlementStatus;
  actorId: string;
  reason?: string;
  adminRemarks?: string;
  ipAddress?: string;
  deviceInfo?: string;
}

/**
 * Transitions a settlement request to a new status with full validation,
 * audit trail, and notifications.
 */
export async function transitionSettlementStatus(input: TransitionInput) {
  const { requestId, newStatus, actorId, reason, adminRemarks, ipAddress, deviceInfo } = input;

  const request = await prisma.settlementRequest.findUnique({
    where: { id: requestId },
    include: { shop: true, requestedBy: true },
  });

  if (!request) throw new Error('Settlement request not found.');

  const currentStatus = request.status as SettlementStatus;
  if (!isValidTransition(currentStatus, newStatus)) {
    throw new Error(`Cannot transition from "${currentStatus}" to "${newStatus}". This transition is not allowed.`);
  }

  // Build the update data based on the target status
  const updateData: any = { status: newStatus };

  if (newStatus === 'UnderVerification' || newStatus === 'Approved' || newStatus === 'Rejected') {
    updateData.adminReviewedById = actorId;
    updateData.adminReviewedAt = new Date();
    if (adminRemarks) updateData.adminRemarks = adminRemarks;
  }

  if (newStatus === 'ProcessingPayment') {
    updateData.accountsProcessedById = actorId;
    updateData.accountsProcessedAt = new Date();
  }

  if (newStatus === 'Rejected' || newStatus === 'Failed') {
    updateData.failureReason = reason || adminRemarks || null;
  }

  // Atomic update
  const updated = await prisma.settlementRequest.update({
    where: { id: requestId },
    data: updateData,
  });

  // Record status history (immutable)
  await prisma.settlementStatusHistory.create({
    data: {
      settlementRequestId: requestId,
      fromStatus: currentStatus,
      toStatus: newStatus,
      changedById: actorId,
      reason: reason || adminRemarks || null,
      ipAddress: ipAddress || null,
      deviceInfo: deviceInfo || null,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: `settlement.status.${newStatus.toLowerCase()}`,
      actorId,
      entityType: 'SettlementRequest',
      entityId: requestId,
      details: `Settlement ${request.reference} transitioned from ${currentStatus} to ${newStatus}.${reason ? ` Reason: ${reason}` : ''}`,
      ipAddress: ipAddress || null,
    },
  });

  // Notifications based on transition
  await sendTransitionNotifications(request, currentStatus, newStatus, reason || adminRemarks);

  return updated;
}

async function sendTransitionNotifications(
  request: any,
  fromStatus: string,
  toStatus: string,
  reason?: string | null,
) {
  const shopName = request.shop?.name || 'Shop';
  const amount = `৳${request.requestedAmount.toLocaleString()}`;
  const ref = request.reference;

  // Notify shop owner on every transition
  if (request.requestedById) {
    let title = '';
    let body = '';
    let link = '/shop/settlements';

    switch (toStatus) {
      case 'UnderVerification':
        title = 'Settlement Under Review';
        body = `Your settlement request ${ref} for ${amount} is now under verification by the Admin Office.`;
        break;
      case 'Approved':
        title = 'Settlement Approved';
        body = `Your settlement request ${ref} for ${amount} has been approved and forwarded to the Accounts Office for payment processing.`;
        break;
      case 'Rejected':
        title = 'Settlement Rejected';
        body = `Your settlement request ${ref} for ${amount} has been rejected.${reason ? ` Reason: ${reason}` : ''}`;
        break;
      case 'ProcessingPayment':
        title = 'Settlement Payment Processing';
        body = `Payment for your settlement request ${ref} (${amount}) is now being processed by the Accounts Office.`;
        break;
      case 'Paid':
        title = 'Settlement Paid ✓';
        body = `Your settlement of ${amount} (${ref}) has been successfully paid and credited to your wallet.`;
        break;
      case 'Failed':
        title = 'Settlement Payment Failed';
        body = `Payment for settlement ${ref} (${amount}) has failed.${reason ? ` Reason: ${reason}` : ''} The Accounts Office may retry.`;
        break;
    }

    if (title) {
      void notifyUser({
        recipientId: request.requestedById,
        category: 'settlement',
        type: `settlement.${toStatus.toLowerCase()}`,
        title,
        body,
        link,
        emailSubject: `${title} — ${ref} — Smart Campus`,
      });
    }
  }

  // Notify Accounts Office when approved (ready for payment)
  if (toStatus === 'Approved') {
    void notifyRole('Accounts Office', {
      category: 'settlement',
      type: 'settlement.approved.ready',
      title: 'Settlement Ready for Payment',
      body: `Settlement ${ref} for ${shopName} (${amount}) has been approved by Admin and is ready for payment processing.`,
      link: '/accounts/settlements',
      emailSubject: `Settlement Ready — ${ref} — ${amount}`,
    });
  }

  // Notify Admin when payment completes or fails
  if (toStatus === 'Paid' || toStatus === 'Failed') {
    void notifyRole('Admin Office', {
      category: 'settlement',
      type: `settlement.${toStatus.toLowerCase()}`,
      title: toStatus === 'Paid' ? 'Settlement Payment Complete' : 'Settlement Payment Failed',
      body: toStatus === 'Paid'
        ? `Settlement ${ref} for ${shopName} (${amount}) has been successfully paid.`
        : `Settlement ${ref} for ${shopName} (${amount}) payment failed.${reason ? ` Reason: ${reason}` : ''}`,
      link: '/admin/shops',
    });
  }
}

/**
 * Completes a settlement: creates the legacy Settlement record, credits the shop wallet,
 * records the ledger entry, and transitions to Paid.
 */
export async function completeSettlement(
  requestId: string,
  actorId: string,
  paymentReference: string,
  sslcommerzTranId?: string,
  ipAddress?: string,
) {
  const request = await prisma.settlementRequest.findUnique({
    where: { id: requestId },
    include: { shop: true },
  });

  if (!request) throw new Error('Settlement request not found.');
  if (request.status !== 'ProcessingPayment') {
    throw new Error(`Settlement is in "${request.status}" status, expected "ProcessingPayment".`);
  }

  // Atomic transaction: create Settlement record + credit wallet + update status
  await prisma.$transaction(async (tx) => {
    // 1. Create the legacy Settlement bookkeeping record
    await tx.settlement.create({
      data: {
        shopId: request.shopId,
        amount: request.requestedAmount,
        notes: `Settlement via workflow — ${request.reference}`,
        settledBy: actorId,
        settlementRequestId: request.id,
      },
    });

    // 2. Credit the shop owner's wallet
    if (request.shop?.ownerId) {
      let wallet = await tx.wallet.findFirst({ where: { ownerId: request.shop.ownerId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            walletId: `W-${request.shop.ownerId.slice(0, 8)}`,
            ownerId: request.shop.ownerId,
            balance: 0,
            dailyTransferLimit: 10000,
            dailyTransferred: 0,
          },
        });
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + request.requestedAmount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter },
      });

      // 3. Create a Transaction record for the wallet credit
      const txnRef = `STL-CR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await tx.transaction.create({
        data: {
          reference: txnRef,
          userId: request.shop.ownerId,
          type: 'Settlement Credit',
          direction: 'Credit',
          amount: request.requestedAmount,
          status: 'Success',
          gateway: 'Settlement',
          description: `Settlement payment — ${request.reference}`,
          purpose: 'settlement',
          balanceBefore,
          balanceAfter,
        },
      });

      // 4. Update the settlement request with payment details
      await tx.settlementRequest.update({
        where: { id: requestId },
        data: {
          status: 'Paid',
          paymentReference,
          sslcommerzTranId: sslcommerzTranId || null,
          walletTxnId: txnRef,
          paidAt: new Date(),
        },
      });
    } else {
      // No shop owner — still mark as paid
      await tx.settlementRequest.update({
        where: { id: requestId },
        data: {
          status: 'Paid',
          paymentReference,
          sslcommerzTranId: sslcommerzTranId || null,
          paidAt: new Date(),
        },
      });
    }
  });

  // Record status history + notifications (outside the transaction — best-effort)
  await prisma.settlementStatusHistory.create({
    data: {
      settlementRequestId: requestId,
      fromStatus: 'ProcessingPayment',
      toStatus: 'Paid',
      changedById: actorId,
      reason: `Payment verified. Reference: ${paymentReference}`,
      ipAddress: ipAddress || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'settlement.paid',
      actorId,
      entityType: 'SettlementRequest',
      entityId: requestId,
      details: `Settlement ${request.reference} paid ৳${request.requestedAmount.toLocaleString()} to shop "${request.shop?.name}". Payment ref: ${paymentReference}.`,
      ipAddress: ipAddress || null,
    },
  });

  // Notifications
  const updated = await prisma.settlementRequest.findUnique({
    where: { id: requestId },
    include: { shop: true, requestedBy: true },
  });
  if (updated) {
    await sendTransitionNotifications(updated, 'ProcessingPayment', 'Paid');
  }

  return updated;
}

/**
 * Gets the full settlement timeline for display.
 */
export async function getSettlementTimeline(requestId: string) {
  return prisma.settlementStatusHistory.findMany({
    where: { settlementRequestId: requestId },
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, fullName: true, email: true, role: true } } },
  });
}
