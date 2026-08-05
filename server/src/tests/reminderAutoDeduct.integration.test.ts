import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runDailyDueAutomation } from '../lib/reminderAutoDeduct.js';

const prisma = new PrismaClient();

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Real-DB integration test against the shared Neon instance (same pattern as
// unifiedSettlement.integration.test.ts — no separate dev database exists in this project).
// Every due row is created directly with a backdated `createdAt` (Prisma allows overriding it on
// create despite the @default(now())), so the automation's real elapsed-time logic can be
// exercised without waiting on the real clock. Four disposable test students + one disposable shop
// are created fresh here and fully deleted in afterAll.
describe('reminderAutoDeduct — real DB integration', () => {
  let reminderStudentId: string;
  let deductStudentId: string;
  let insufficientStudentId: string;
  let lateFeeStudentId: string;
  let shopId: string;
  let payLaterReminderDueId: string;
  let adminDeductFineId: string;
  let libraryInsufficientFineId: string;
  let payLaterLateFeeDueId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const [reminderStudent, deductStudent, insufficientStudent, lateFeeStudent, shop] = await Promise.all([
      prisma.user.create({ data: { email: `test-reminder-${suffix}@std.ewubd.edu`, fullName: 'Reminder Test Student', role: 'Student', studentId: `TEST-REMIND-${suffix}` } }),
      prisma.user.create({ data: { email: `test-deduct-${suffix}@std.ewubd.edu`, fullName: 'Deduct Test Student', role: 'Student', studentId: `TEST-DEDUCT-${suffix}` } }),
      prisma.user.create({ data: { email: `test-insufficient-${suffix}@std.ewubd.edu`, fullName: 'Insufficient Test Student', role: 'Student', studentId: `TEST-INSUFF-${suffix}` } }),
      prisma.user.create({ data: { email: `test-latefee-${suffix}@std.ewubd.edu`, fullName: 'Late Fee Test Student', role: 'Student', studentId: `TEST-LATEFEE-${suffix}` } }),
      prisma.shop.create({ data: { name: 'Reminder Automation Test Shop', category: 'Test', status: 'Active' } }),
    ]);
    reminderStudentId = reminderStudent.id;
    deductStudentId = deductStudent.id;
    insufficientStudentId = insufficientStudent.id;
    lateFeeStudentId = lateFeeStudent.id;
    shopId = shop.id;

    await Promise.all([
      prisma.wallet.create({ data: { walletId: `W-TEST-DEDUCT-${suffix}`, ownerId: deductStudentId, balance: 10000 } }),
      prisma.wallet.create({ data: { walletId: `W-TEST-INSUFF-${suffix}`, ownerId: insufficientStudentId, balance: 0 } }),
    ]);

    // Row 1 — 8 days old, untouched: eligible for the day-7 reminder only (not yet 10 days old).
    const payLaterReminderDue = await prisma.payLaterDue.create({
      data: { studentId: reminderStudentId, shopId, amount: 300, description: 'Test Purchase — Reminder', status: 'Pending', createdAt: daysAgo(8) },
    });
    payLaterReminderDueId = payLaterReminderDue.id;

    // Row 2 — 11 days old, reminder already sent: eligible for auto-deduction (wallet has enough).
    const adminDeductFine = await prisma.adminFine.create({
      data: { studentId: deductStudentId, amount: 1500, reason: 'Test Misconduct — Deduction', status: 'Pending', createdAt: daysAgo(11), firstReminderSentAt: daysAgo(4) },
    });
    adminDeductFineId = adminDeductFine.id;

    // Row 3 — 11 days old, reminder already sent: wallet balance is 0, so this must fall to the
    // insufficient-funds notice instead of a deduction.
    const libraryInsufficientFine = await prisma.libraryFine.create({
      data: { studentId: insufficientStudentId, amount: 500, fineType: 'Overdue Book — Insufficient', status: 'Pending', createdAt: daysAgo(11), firstReminderSentAt: daysAgo(4) },
    });
    libraryInsufficientFineId = libraryInsufficientFine.id;

    // Row 4 — 12 days old, already reminded AND already given the insufficient-funds notice on an
    // earlier (simulated) run: eligible for the late fee, and must NOT be re-attempted for deduction.
    const payLaterLateFeeDue = await prisma.payLaterDue.create({
      data: { studentId: lateFeeStudentId, shopId, amount: 400, description: 'Test Purchase — Late Fee', status: 'Pending', createdAt: daysAgo(12), firstReminderSentAt: daysAgo(5), insufficientFundsNoticeAt: daysAgo(2) },
    });
    payLaterLateFeeDueId = payLaterLateFeeDue.id;
  }, 30000);

  afterAll(async () => {
    const studentIds = [reminderStudentId, deductStudentId, insufficientStudentId, lateFeeStudentId];
    // Notification rows (created by the real notifyUser() calls each step makes) hold a RESTRICT
    // FK to User — must be deleted before the students themselves, or the user delete 23001s.
    await prisma.notification.deleteMany({ where: { recipientId: { in: studentIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.transaction.deleteMany({ where: { userId: { in: studentIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [payLaterReminderDueId, adminDeductFineId, libraryInsufficientFineId, payLaterLateFeeDueId] } } });
    await prisma.payLaterDue.deleteMany({ where: { studentId: { in: [reminderStudentId, lateFeeStudentId] } } });
    await prisma.adminFine.deleteMany({ where: { studentId: deductStudentId } });
    await prisma.libraryFine.deleteMany({ where: { studentId: insufficientStudentId } });
    await prisma.wallet.deleteMany({ where: { ownerId: { in: [deductStudentId, insufficientStudentId] } } });
    await prisma.shop.delete({ where: { id: shopId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.$disconnect();
  }, 30000);

  it('runs the full daily automation once and correctly resolves all four scenarios', async () => {
    const result = await runDailyDueAutomation();
    expect(result.remindersSent).toBeGreaterThanOrEqual(1);
    expect(result.deducted).toBeGreaterThanOrEqual(1);
    expect(result.insufficientNoticed).toBeGreaterThanOrEqual(1);
    expect(result.lateFeesApplied).toBeGreaterThanOrEqual(1);

    const [payLaterReminderDue, adminDeductFine, libraryInsufficientFine, payLaterLateFeeDue] = await Promise.all([
      prisma.payLaterDue.findUnique({ where: { id: payLaterReminderDueId } }),
      prisma.adminFine.findUnique({ where: { id: adminDeductFineId } }),
      prisma.libraryFine.findUnique({ where: { id: libraryInsufficientFineId } }),
      prisma.payLaterDue.findUnique({ where: { id: payLaterLateFeeDueId } }),
    ]);

    // Row 1 — 7-day reminder fired, still Pending (only 8 days old, not yet at day 10).
    expect(payLaterReminderDue?.firstReminderSentAt).not.toBeNull();
    expect(payLaterReminderDue?.status).toBe('Pending');
    expect(payLaterReminderDue?.autoDeductedAt).toBeNull();

    // Row 2 — auto-deducted: Paid, wallet decremented, Transaction/LedgerEntry/AuditLog recorded.
    expect(adminDeductFine?.status).toBe('Paid');
    expect(adminDeductFine?.autoDeductedAt).not.toBeNull();
    const wallet = await prisma.wallet.findFirst({ where: { ownerId: deductStudentId } });
    expect(wallet?.balance).toBe(10000 - 1500);
    const deductTxn = await prisma.transaction.findFirst({ where: { userId: deductStudentId, purpose: 'auto_debt_deduction' } });
    expect(deductTxn).not.toBeNull();
    expect(deductTxn?.amount).toBe(1500);
    expect(deductTxn?.status).toBe('Success');
    const deductLedger = await prisma.ledgerEntry.findFirst({ where: { studentId: deductStudentId, type: 'CREDIT_PAYMENT' } });
    expect(deductLedger?.creditAmount).toBe(1500);
    const deductAudit = await prisma.auditLog.findFirst({ where: { entityId: adminDeductFineId, action: 'Auto-Deducted Overdue Due' } });
    expect(deductAudit).not.toBeNull();

    // Row 3 — insufficient balance: still Pending, notice stamped, wallet untouched.
    expect(libraryInsufficientFine?.status).toBe('Pending');
    expect(libraryInsufficientFine?.insufficientFundsNoticeAt).not.toBeNull();
    expect(libraryInsufficientFine?.autoDeductedAt).toBeNull();
    const insufficientWallet = await prisma.wallet.findFirst({ where: { ownerId: insufficientStudentId } });
    expect(insufficientWallet?.balance).toBe(0);

    // Row 4 — late fee applied: amount +25, lateFeeAppliedAt stamped, still Pending (never
    // re-attempted for deduction since insufficientFundsNoticeAt was already set), DEBIT_DUE ledger entry.
    expect(payLaterLateFeeDue?.amount).toBe(400 + 25);
    expect(payLaterLateFeeDue?.lateFeeAppliedAt).not.toBeNull();
    expect(payLaterLateFeeDue?.status).toBe('Pending');
    expect(payLaterLateFeeDue?.autoDeductedAt).toBeNull();
    const lateFeeLedger = await prisma.ledgerEntry.findFirst({ where: { studentId: lateFeeStudentId, type: 'DEBIT_DUE' } });
    expect(lateFeeLedger?.debitAmount).toBe(25);
  }, 60000);

  it('is idempotent — a second run over the same data does not double-fire any step', async () => {
    const result = await runDailyDueAutomation();
    expect(result).toEqual({ remindersSent: 0, deducted: 0, insufficientNoticed: 0, lateFeesApplied: 0 });

    const [wallet, payLaterLateFeeDue] = await Promise.all([
      prisma.wallet.findFirst({ where: { ownerId: deductStudentId } }),
      prisma.payLaterDue.findUnique({ where: { id: payLaterLateFeeDueId } }),
    ]);
    expect(wallet?.balance).toBe(10000 - 1500); // unchanged — not decremented a second time
    expect(payLaterLateFeeDue?.amount).toBe(400 + 25); // unchanged — not incremented a second time
  }, 30000);
});
