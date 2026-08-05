import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same mocking convention as settlement.test.ts — a fake Prisma-shaped object via vi.mock, since
// these functions call the module-level prisma singleton directly (they're top-level cron entry
// points, never nested inside another caller's $transaction).
const prismaMock = {
  payLaterDue: { findMany: vi.fn(), updateMany: vi.fn() },
  adminFine: { findMany: vi.fn(), updateMany: vi.fn() },
  libraryFine: { findMany: vi.fn(), updateMany: vi.fn() },
  wallet: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  transaction: { create: vi.fn() },
  ledgerEntry: { findFirst: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => Promise<void>) => cb(prismaMock)),
};

vi.mock('../lib/prisma.js', () => ({ default: prismaMock }));

const notifyUserMock = vi.fn();
vi.mock('../lib/notify.js', () => ({ notifyUser: (...args: unknown[]) => notifyUserMock(...args) }));

const { sendDay7Reminders, runDay10DeductionPass, applyLateFeesForStillUnpaid, runDailyDueAutomation } =
  await import('../lib/reminderAutoDeduct.js');

function due(overrides: Partial<{ id: string; studentId: string; amount: number; reference: string | null; paymentReference: string | null }> = {}) {
  return { id: 'due-1', studentId: 'student-1', amount: 500, reference: null, paymentReference: null, ...overrides };
}

describe('reminderAutoDeduct — Outstanding Due Reminder / Auto-Deduction / Late-Fine automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.payLaterDue.findMany.mockResolvedValue([]);
    prismaMock.adminFine.findMany.mockResolvedValue([]);
    prismaMock.libraryFine.findMany.mockResolvedValue([]);
    prismaMock.payLaterDue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.adminFine.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.libraryFine.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ledgerEntry.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<void>) => cb(prismaMock));
  });

  describe('Step A — sendDay7Reminders', () => {
    it('stamps firstReminderSentAt and notifies the student once per eligible due', async () => {
      prismaMock.libraryFine.findMany.mockResolvedValue([due({ id: 'lib-1' })]);

      const result = await sendDay7Reminders();

      expect(result.sent).toBe(1);
      expect(prismaMock.libraryFine.updateMany).toHaveBeenCalledWith({
        where: { id: 'lib-1', firstReminderSentAt: null },
        data: { firstReminderSentAt: expect.any(Date) },
      });
      expect(notifyUserMock).toHaveBeenCalledTimes(1);
      expect(notifyUserMock.mock.calls[0][0]).toMatchObject({ recipientId: 'student-1', type: 'due.reminder_7day' });
    });

    it('is idempotent — skips notifying when the guarded update loses the race (already claimed)', async () => {
      prismaMock.adminFine.findMany.mockResolvedValue([due({ id: 'adm-1' })]);
      prismaMock.adminFine.updateMany.mockResolvedValue({ count: 0 }); // another run already claimed it

      const result = await sendDay7Reminders();

      expect(result.sent).toBe(0);
      expect(notifyUserMock).not.toHaveBeenCalled();
    });

    it('sums reminders across all three covered sources (PayLaterDue, AdminFine, LibraryFine)', async () => {
      prismaMock.payLaterDue.findMany.mockResolvedValue([due({ id: 'p1' })]);
      prismaMock.adminFine.findMany.mockResolvedValue([due({ id: 'a1' })]);
      prismaMock.libraryFine.findMany.mockResolvedValue([due({ id: 'l1' })]);

      const result = await sendDay7Reminders();

      expect(result.sent).toBe(3);
      expect(notifyUserMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Step B — runDay10DeductionPass', () => {
    it('auto-deducts from a sufficiently-funded wallet: marks Paid, debits wallet, records Transaction/LedgerEntry/AuditLog, notifies', async () => {
      prismaMock.payLaterDue.findMany.mockResolvedValue([due({ id: 'pl-1', amount: 300 })]);
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', balance: 1000 });
      prismaMock.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', balance: 1000 });

      const result = await runDay10DeductionPass();

      expect(result.deducted).toBe(1);
      expect(result.insufficientNoticed).toBe(0);
      expect(prismaMock.payLaterDue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pl-1', status: 'Pending' }, data: expect.objectContaining({ status: 'Paid' }) })
      );
      expect(prismaMock.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balance: { decrement: 300 } } });
      expect(prismaMock.transaction.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({ purpose: 'auto_debt_deduction', direction: 'Debit', amount: 300, status: 'Success' });
      expect(prismaMock.ledgerEntry.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.ledgerEntry.create.mock.calls[0][0].data).toMatchObject({ type: 'CREDIT_PAYMENT', creditAmount: 300 });
      expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(notifyUserMock).toHaveBeenCalledTimes(1);
      expect(notifyUserMock.mock.calls[0][0]).toMatchObject({ type: 'due.auto_deducted' });
    });

    it('notifies insufficient funds and leaves the due Pending when the wallet balance is too low', async () => {
      prismaMock.adminFine.findMany.mockResolvedValue([due({ id: 'adm-2', amount: 5000 })]);
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-2', balance: 100 });

      const result = await runDay10DeductionPass();

      expect(result.deducted).toBe(0);
      expect(result.insufficientNoticed).toBe(1);
      expect(prismaMock.adminFine.updateMany).toHaveBeenCalledWith({
        where: { id: 'adm-2', insufficientFundsNoticeAt: null },
        data: { insufficientFundsNoticeAt: expect.any(Date) },
      });
      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
      expect(notifyUserMock).toHaveBeenCalledTimes(1);
      expect(notifyUserMock.mock.calls[0][0]).toMatchObject({ type: 'due.insufficient_funds' });
    });

    it('treats a missing wallet the same as insufficient balance', async () => {
      prismaMock.libraryFine.findMany.mockResolvedValue([due({ id: 'lib-2', amount: 200 })]);
      prismaMock.wallet.findFirst.mockResolvedValue(null);

      const result = await runDay10DeductionPass();

      expect(result.deducted).toBe(0);
      expect(result.insufficientNoticed).toBe(1);
    });

    it('rolls back and skips notifying when the due was already resolved by a concurrent path (conflict)', async () => {
      prismaMock.payLaterDue.findMany.mockResolvedValue([due({ id: 'pl-3', amount: 300 })]);
      prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-3', balance: 1000 });
      prismaMock.payLaterDue.updateMany.mockResolvedValue({ count: 0 }); // lost the race — already Paid elsewhere

      const result = await runDay10DeductionPass();

      expect(result.deducted).toBe(0);
      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
      expect(notifyUserMock).not.toHaveBeenCalled();
    });
  });

  describe('Step C — applyLateFeesForStillUnpaid', () => {
    it('increments the amount by 25, stamps lateFeeAppliedAt, writes a DEBIT_DUE ledger entry, and notifies', async () => {
      prismaMock.libraryFine.findMany.mockResolvedValue([due({ id: 'lib-3', amount: 500, reference: 'LIB-XYZ' })]);

      const result = await applyLateFeesForStillUnpaid();

      expect(result.lateFeesApplied).toBe(1);
      expect(prismaMock.libraryFine.updateMany).toHaveBeenCalledWith({
        where: { id: 'lib-3', status: 'Pending', lateFeeAppliedAt: null },
        data: { amount: { increment: 25 }, lateFeeAppliedAt: expect.any(Date) },
      });
      expect(prismaMock.ledgerEntry.create.mock.calls[0][0].data).toMatchObject({ type: 'DEBIT_DUE', debitAmount: 25, reference: 'LIB-XYZ' });
      expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(notifyUserMock.mock.calls[0][0]).toMatchObject({ type: 'due.late_fee_applied' });
    });

    it('is idempotent — applies at most once per due item even if picked up again', async () => {
      prismaMock.adminFine.findMany.mockResolvedValue([due({ id: 'adm-3' })]);
      prismaMock.adminFine.updateMany.mockResolvedValue({ count: 0 }); // lateFeeAppliedAt already set by a prior run

      const result = await applyLateFeesForStillUnpaid();

      expect(result.lateFeesApplied).toBe(0);
      expect(notifyUserMock).not.toHaveBeenCalled();
    });
  });

  describe('runDailyDueAutomation — orchestration', () => {
    it('runs all three steps in order and aggregates their counts', async () => {
      prismaMock.libraryFine.findMany
        .mockResolvedValueOnce([due({ id: 'lib-4' })]) // Step A picks this up
        .mockResolvedValueOnce([]) // Step B — not yet reminder-eligible in this mock, none returned
        .mockResolvedValueOnce([]); // Step C

      const result = await runDailyDueAutomation();

      expect(result).toEqual({ remindersSent: 1, deducted: 0, insufficientNoticed: 0, lateFeesApplied: 0 });
    });

    it('returns all-zero counts when nothing is eligible', async () => {
      const result = await runDailyDueAutomation();
      expect(result).toEqual({ remindersSent: 0, deducted: 0, insufficientNoticed: 0, lateFeesApplied: 0 });
    });
  });
});
