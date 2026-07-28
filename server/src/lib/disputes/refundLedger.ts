import prisma from '../prisma';

interface ProcessWalletRefundInput {
  refundId: string;
  transactionId: string;
  disputeId: string;
  /** Whose wallet gets credited — the original payer on the disputed transaction. */
  recipientUserId: string;
  amount: number;
  processedById: string;
  ipAddress?: string;
}

interface ProcessWalletRefundResult {
  reversalTransactionId: string;
  newBalance: number;
}

// The only atomic wallet-mutation pattern proven in this codebase (mirrors /semester-fees/pay's
// wallet branch in index.ts): a guarded `updateMany` inside `$transaction`, so a refund can never
// be double-applied even if two staff members process it at the same moment, and the reversal
// Transaction + Refund status + AuditLog land atomically with the balance change. Never bypasses
// the ledger — refunding always creates a real, visible Transaction row, never a silent balance edit.
export async function processWalletRefund(input: ProcessWalletRefundInput): Promise<ProcessWalletRefundResult> {
  const { refundId, transactionId, disputeId, recipientUserId, amount, processedById, ipAddress } = input;

  return prisma.$transaction(async (txClient) => {
    const wallet = await txClient.wallet.findFirst({ where: { ownerId: recipientUserId } });
    if (!wallet) throw new Error('WALLET_NOT_FOUND');

    const balanceBefore = wallet.balance || 0;
    const updated = await txClient.wallet.updateMany({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
    });
    if (updated.count === 0) throw new Error('WALLET_UPDATE_FAILED');

    const freshWallet = await txClient.wallet.findUnique({ where: { id: wallet.id } });
    const balanceAfter = freshWallet?.balance ?? balanceBefore + amount;

    const reversalRef = `RFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const reversalTx = await txClient.transaction.create({
      data: {
        reference: reversalRef,
        userId: recipientUserId,
        type: 'Dispute Refund',
        direction: 'Credit',
        amount,
        status: 'Success',
        gateway: 'Wallet',
        paymentMethod: 'Wallet',
        description: `Refund for disputed transaction ${transactionId}`,
        balanceBefore,
        balanceAfter,
        ipAddress,
      },
    });

    await txClient.refund.update({
      where: { id: refundId },
      data: { status: 'Processed', reversalTransactionId: reversalTx.id, processedAt: new Date() },
    });

    await txClient.auditLog.create({
      data: {
        action: 'Dispute Refund Processed (Wallet Credit)',
        actorId: processedById,
        entityType: 'Dispute',
        entityId: disputeId,
        details: `Refunded ৳${amount} to wallet for transaction ${transactionId} (refund ${refundId})`,
        ipAddress,
      },
    });

    return { reversalTransactionId: reversalTx.id, newBalance: balanceAfter };
  });
}

interface RecordManualAdjustmentInput {
  refundId: string;
  transactionId: string;
  disputeId: string;
  amount: number;
  processedById: string;
  notes?: string;
  ipAddress?: string;
}

// "Manual Adjustment" / "Refund to Original Payment" refunds don't move wallet money at all (e.g.
// an off-platform bank reversal, or a gateway-side refund handled outside this app) — they still
// get a Refund row (status Processed) and an AuditLog entry, so nothing resolves silently; there's
// just no wallet-side Transaction reversal to create.
export async function recordManualAdjustment(input: RecordManualAdjustmentInput): Promise<void> {
  const { refundId, transactionId, disputeId, amount, processedById, notes, ipAddress } = input;
  await prisma.$transaction(async (txClient) => {
    await txClient.refund.update({
      where: { id: refundId },
      data: { status: 'Processed', processedAt: new Date(), notes },
    });
    await txClient.auditLog.create({
      data: {
        action: 'Dispute Refund Processed (Manual Adjustment)',
        actorId: processedById,
        entityType: 'Dispute',
        entityId: disputeId,
        details: `Manual adjustment of ৳${amount} recorded for transaction ${transactionId} (refund ${refundId})${notes ? ` — ${notes}` : ''}`,
        ipAddress,
      },
    });
  });
}
