import prisma from './prisma';
import { notifyUser } from './notify';

// Outstanding-Due Reminder / Auto-Deduction / Late-Fine automation — covers PayLaterDue (Shop),
// AdminFine, and LibraryFine only. SemesterFee is deliberately excluded: it already has its own
// tested isFinanciallyRestricted()/Unified Settlement Sweep system (see settlement.ts), and running
// a second independent overdue-automation over it would risk conflicting with that working code.
//
// All three covered types measure their 7/10-day windows from `createdAt` uniformly — PayLaterDue
// has no due date at all (a prior session deliberately made it a lifetime due), so `createdAt` is
// the one anchor every type actually has.
//
// Like every other top-level settlement orchestrator in this codebase (getOutstandingDues,
// isFinanciallyRestricted in settlement.ts), these functions use the shared `prisma` singleton
// directly rather than accepting an injectable client — they are cron entry points, never called
// from inside another caller's $transaction. Unit tests mock the whole module via
// `vi.mock('../lib/prisma.js', ...)`, the same pattern settlement.test.ts already uses.

export type DueSource = 'payLater' | 'admin' | 'library';

const LATE_FEE_AMOUNT = 25;
const REMINDER_DAYS = 7;
const DEDUCTION_DAYS = 10;
// One extra day of grace after the day-10 deduct-or-notify check before a late fee can land — so a
// student who just received the "insufficient balance, pay immediately" notice on day 10 isn't
// charged a late fee in that same run. Matches the spec's phrasing: deduct-or-notify happens "at
// 10 days"; the late fine applies only if the balance "still remains unpaid AFTER 10 days".
const LATE_FEE_GRACE_DAYS = DEDUCTION_DAYS + 1;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function sourceLabel(source: DueSource): string {
  if (source === 'payLater') return 'Shop Due';
  if (source === 'admin') return 'Administrative Fine';
  return 'Library Fine';
}

function entityType(source: DueSource): string {
  if (source === 'payLater') return 'PayLaterDue';
  if (source === 'admin') return 'AdminFine';
  return 'LibraryFine';
}

interface DueRow {
  id: string;
  studentId: string;
  amount: number;
  reference?: string | null;
  paymentReference?: string | null;
}

// ─── STEP A — Day 7: first reminder ───

export async function sendDay7Reminders(): Promise<{ sent: number }> {
  let sent = 0;
  const cutoff = daysAgo(REMINDER_DAYS);
  const baseWhere = { status: 'Pending', firstReminderSentAt: null, createdAt: { lte: cutoff } };

  const rows: Array<{ source: DueSource; row: DueRow }> = [
    ...(await prisma.payLaterDue.findMany({ where: baseWhere })).map(row => ({ source: 'payLater' as const, row })),
    ...(await prisma.adminFine.findMany({ where: baseWhere })).map(row => ({ source: 'admin' as const, row })),
    ...(await prisma.libraryFine.findMany({ where: baseWhere })).map(row => ({ source: 'library' as const, row })),
  ];

  for (const { source, row } of rows) {
    // Stamp-then-notify, guarded on the same null check the read used — if a concurrent run (or a
    // retry after a crash) already claimed this row, the guarded update touches zero rows and this
    // iteration is skipped, so the reminder is never sent twice for the same due item.
    const updated = await claimStamp(source, row.id, 'firstReminderSentAt');
    if (!updated) continue;

    const label = sourceLabel(source);
    await notifyUser({
      recipientId: row.studentId, category: 'payment', type: 'due.reminder_7day',
      title: `Payment Reminder — Outstanding ${label}`,
      body: `You have an outstanding ${label.toLowerCase()} of ৳${row.amount.toLocaleString()} that has been unpaid for 7 days. Please pay soon — after 10 days we will attempt to deduct it automatically from your wallet, and a ৳${LATE_FEE_AMOUNT} late fee may apply if it remains unpaid.`,
      link: '/student/dues',
      emailSubject: `Payment Reminder — ৳${row.amount.toLocaleString()} Outstanding — Smart Campus`,
    });
    sent++;
  }

  return { sent };
}

async function claimStamp(source: DueSource, id: string, field: 'firstReminderSentAt' | 'insufficientFundsNoticeAt'): Promise<boolean> {
  const where = { id, [field]: null };
  const data = { [field]: new Date() };
  if (source === 'payLater') return (await prisma.payLaterDue.updateMany({ where, data })).count === 1;
  if (source === 'admin') return (await prisma.adminFine.updateMany({ where, data })).count === 1;
  return (await prisma.libraryFine.updateMany({ where, data })).count === 1;
}

// ─── STEP B — Day 10: attempt auto-deduction, else notify insufficient funds ───

export async function runDay10DeductionPass(): Promise<{ deducted: number; insufficientNoticed: number }> {
  let deducted = 0;
  let insufficientNoticed = 0;
  const cutoff = daysAgo(DEDUCTION_DAYS);
  const baseWhere = {
    status: 'Pending', firstReminderSentAt: { not: null },
    autoDeductedAt: null, insufficientFundsNoticeAt: null, createdAt: { lte: cutoff },
  };

  const rows: Array<{ source: DueSource; row: DueRow }> = [
    ...(await prisma.payLaterDue.findMany({ where: baseWhere })).map(row => ({ source: 'payLater' as const, row })),
    ...(await prisma.adminFine.findMany({ where: baseWhere })).map(row => ({ source: 'admin' as const, row })),
    ...(await prisma.libraryFine.findMany({ where: baseWhere })).map(row => ({ source: 'library' as const, row })),
  ];

  for (const { source, row } of rows) {
    const label = sourceLabel(source);
    const wallet = await prisma.wallet.findFirst({ where: { ownerId: row.studentId } });

    if (wallet && wallet.balance >= row.amount) {
      const txReference = `AUTODED-${Date.now()}-${row.id.slice(0, 8)}`;
      try {
        await prisma.$transaction(async (tx) => {
          // Resolve the due item Pending -> Paid FIRST, guarded on status:'Pending' — if it lost
          // the race (settled a moment earlier via any other channel), this touches zero rows and
          // throws, rolling back the whole transaction before the wallet is ever touched. Exact
          // ordering rationale as settlement.ts's markItemPaid().
          let updated;
          if (source === 'payLater') {
            updated = await tx.payLaterDue.updateMany({ where: { id: row.id, status: 'Pending' }, data: { status: 'Paid', autoDeductedAt: new Date(), paymentReference: txReference } });
          } else if (source === 'admin') {
            updated = await tx.adminFine.updateMany({ where: { id: row.id, status: 'Pending' }, data: { status: 'Paid', autoDeductedAt: new Date(), reference: txReference } });
          } else {
            updated = await tx.libraryFine.updateMany({ where: { id: row.id, status: 'Pending' }, data: { status: 'Paid', autoDeductedAt: new Date(), reference: txReference } });
          }
          if (updated.count !== 1) throw new Error('AUTO_DEDUCT_CONFLICT');

          const freshWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
          const balanceBefore = freshWallet?.balance ?? wallet.balance;
          await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: row.amount } } });

          await tx.transaction.create({
            data: {
              reference: txReference, userId: row.studentId, type: 'Auto Deduction', direction: 'Debit',
              amount: row.amount, status: 'Success', purpose: 'auto_debt_deduction',
              description: `Auto-deducted overdue ${label} (10 days unpaid)`,
              balanceBefore, balanceAfter: balanceBefore - row.amount,
            },
          });

          const lastLedger = await tx.ledgerEntry.findFirst({ where: { studentId: row.studentId }, orderBy: { createdAt: 'desc' } });
          const previousBalance = lastLedger ? lastLedger.balanceAfter : 0;
          await tx.ledgerEntry.create({
            data: {
              entryNumber: `LED-CR-${Date.now()}-${row.id.slice(0, 6)}`, studentId: row.studentId, type: 'CREDIT_PAYMENT',
              creditAmount: row.amount, balanceAfter: Math.max(0, previousBalance - row.amount),
              reference: txReference, description: `Auto-deducted overdue ${label} (10 days unpaid)`,
            },
          });

          await tx.auditLog.create({
            data: {
              action: 'Auto-Deducted Overdue Due', actorId: null, entityType: entityType(source), entityId: row.id,
              details: `Auto-deducted ৳${row.amount.toLocaleString()} from wallet for overdue ${label} after 10 days unpaid. Reference: ${txReference}.`,
            },
          });
        });

        await notifyUser({
          recipientId: row.studentId, category: 'payment', type: 'due.auto_deducted',
          title: 'Overdue Payment Auto-Deducted',
          body: `Your overdue ${label} of ৳${row.amount.toLocaleString()} was automatically deducted from your wallet after remaining unpaid for 10 days. Reference: ${txReference}.`,
          link: '/student/transactions',
          emailSubject: `Auto-Deduction — ৳${row.amount.toLocaleString()} — Smart Campus`,
        });
        deducted++;
      } catch {
        // Lost a settlement race, or a transient DB error — leave the row exactly as it was; it
        // will either no longer match (already Paid) or be retried correctly on the next run.
      }
    } else {
      const noticed = await claimStamp(source, row.id, 'insufficientFundsNoticeAt');
      if (!noticed) continue;

      await notifyUser({
        recipientId: row.studentId, category: 'payment', type: 'due.insufficient_funds',
        title: 'Auto-Deduction Failed — Insufficient Balance',
        body: `We tried to automatically settle your overdue ${label} of ৳${row.amount.toLocaleString()}, but your wallet balance is insufficient. Please pay immediately — a ৳${LATE_FEE_AMOUNT} late fee will apply if this remains unpaid.`,
        link: '/student/dues',
        emailSubject: `Action Required — Insufficient Balance for ৳${row.amount.toLocaleString()} Due — Smart Campus`,
      });
      insufficientNoticed++;
    }
  }

  return { deducted, insufficientNoticed };
}

// ─── STEP C — Day 11+: late fee for anything still unpaid ───

export async function applyLateFeesForStillUnpaid(): Promise<{ lateFeesApplied: number }> {
  let lateFeesApplied = 0;
  const cutoff = daysAgo(LATE_FEE_GRACE_DAYS);
  // status:'Pending' + lateFeeAppliedAt:null is a sufficient idempotency gate on its own — a row
  // that was successfully auto-deducted is already 'Paid' and won't match this query at all.
  const baseWhere = { status: 'Pending', createdAt: { lte: cutoff }, lateFeeAppliedAt: null };

  const rows: Array<{ source: DueSource; row: DueRow }> = [
    ...(await prisma.payLaterDue.findMany({ where: baseWhere })).map(row => ({ source: 'payLater' as const, row })),
    ...(await prisma.adminFine.findMany({ where: baseWhere })).map(row => ({ source: 'admin' as const, row })),
    ...(await prisma.libraryFine.findMany({ where: baseWhere })).map(row => ({ source: 'library' as const, row })),
  ];

  for (const { source, row } of rows) {
    const label = sourceLabel(source);
    const reference = row.reference || row.paymentReference || undefined;
    try {
      await prisma.$transaction(async (tx) => {
        let updated;
        if (source === 'payLater') {
          updated = await tx.payLaterDue.updateMany({ where: { id: row.id, status: 'Pending', lateFeeAppliedAt: null }, data: { amount: { increment: LATE_FEE_AMOUNT }, lateFeeAppliedAt: new Date() } });
        } else if (source === 'admin') {
          updated = await tx.adminFine.updateMany({ where: { id: row.id, status: 'Pending', lateFeeAppliedAt: null }, data: { amount: { increment: LATE_FEE_AMOUNT }, lateFeeAppliedAt: new Date() } });
        } else {
          updated = await tx.libraryFine.updateMany({ where: { id: row.id, status: 'Pending', lateFeeAppliedAt: null }, data: { amount: { increment: LATE_FEE_AMOUNT }, lateFeeAppliedAt: new Date() } });
        }
        if (updated.count !== 1) throw new Error('LATE_FEE_CONFLICT');

        const lastLedger = await tx.ledgerEntry.findFirst({ where: { studentId: row.studentId }, orderBy: { createdAt: 'desc' } });
        const previousBalance = lastLedger ? lastLedger.balanceAfter : 0;
        await tx.ledgerEntry.create({
          data: {
            entryNumber: `LED-DR-${Date.now()}-${row.id.slice(0, 6)}`, studentId: row.studentId, type: 'DEBIT_DUE',
            debitAmount: LATE_FEE_AMOUNT, balanceAfter: previousBalance + LATE_FEE_AMOUNT,
            reference, description: `Late fee (৳${LATE_FEE_AMOUNT}) — overdue ${label}, unpaid 10+ days`,
          },
        });

        await tx.auditLog.create({
          data: {
            action: 'Late Fee Applied', actorId: null, entityType: entityType(source), entityId: row.id,
            details: `Applied ৳${LATE_FEE_AMOUNT} late fee to overdue ${label} (unpaid 10+ days). New amount: ৳${(row.amount + LATE_FEE_AMOUNT).toLocaleString()}.`,
          },
        });
      });

      await notifyUser({
        recipientId: row.studentId, category: 'payment', type: 'due.late_fee_applied',
        title: 'Late Fee Applied',
        body: `A ৳${LATE_FEE_AMOUNT} late fee has been added to your overdue ${label}, which is now ৳${(row.amount + LATE_FEE_AMOUNT).toLocaleString()} total. Please pay as soon as possible.`,
        link: '/student/dues',
        emailSubject: `Late Fee Applied — ৳${LATE_FEE_AMOUNT} — Smart Campus`,
      });
      lateFeesApplied++;
    } catch {
      // Conflict or transient error — the row is retried on the next run if still eligible.
    }
  }

  return { lateFeesApplied };
}

// ─── Orchestrator — the cron entry point, runs the 3 steps in this literal order ───

export async function runDailyDueAutomation(): Promise<{
  remindersSent: number; deducted: number; insufficientNoticed: number; lateFeesApplied: number;
}> {
  const { sent: remindersSent } = await sendDay7Reminders();
  const { deducted, insufficientNoticed } = await runDay10DeductionPass();
  const { lateFeesApplied } = await applyLateFeesForStillUnpaid();
  return { remindersSent, deducted, insufficientNoticed, lateFeesApplied };
}
