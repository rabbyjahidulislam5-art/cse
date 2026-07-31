import prisma from './prisma';
import type { Prisma, PrismaClient } from '@prisma/client';

// Unified Outstanding Due Settlement — shared logic used by every settlement path (SSLCommerz
// IPN confirm, wallet-direct semester-fee payment, and Accounts Office offline bank recording),
// so all three can never drift into three different definitions of "what's owed" or "how a due
// gets marked paid".

export type PayItemSource = 'semester' | 'library' | 'admin' | 'payLater' | 'shop' | 'wallet';

export interface PayItem {
  id: string;
  source: PayItemSource;
  amount: number;
  label: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

// Thrown when a per-item conditional update touches zero rows — the item was no longer Pending
// by the time this settlement reached it (paid by a concurrent request, waived, cancelled, etc).
// Callers catch this by name to return a clean 409 instead of a generic 500.
export class SettlementConflictError extends Error {
  constructor(source: string, id: string) {
    super(`SETTLEMENT_CONFLICT:${source}:${id}`);
    this.name = 'SettlementConflictError';
  }
}

// Per-source status flip + one CREDIT_PAYMENT LedgerEntry, run inside the caller's $transaction
// (db = the txClient). Every branch previously ended in `.catch(() => {})`, which silently
// swallowed failures instead of letting them abort the surrounding $transaction — meaning one bad
// update could leave a "unified" settlement half-applied while the rest of the batch still
// committed. Nothing here catches errors anymore; a thrown error is what makes the whole
// settlement roll back atomically, per the enterprise-banking requirement that either every
// ledger receives its money or nothing changes.
//
// Each due-row update is a conditional `updateMany` guarded on `status: 'Pending'`, not a plain
// `update` by id — this is the concurrency guard: if two settlements race for the same due (e.g.
// a student pays a library fine individually in one tab while a semester-fee bundle in another
// tab is settling the same fine), only the first to actually flip the row wins; the second sees
// zero rows affected and throws, aborting its whole transaction instead of double-crediting.
export async function markItemPaid(item: PayItem, reference: string, userId: string | undefined, db: Db = prisma): Promise<void> {
  if (item.source === 'semester') {
    const updated = await db.semesterFee.updateMany({ where: { id: item.id, status: 'Pending' }, data: { status: 'Paid', reference } });
    if (updated.count !== 1) throw new SettlementConflictError('semester', item.id);
    await db.feeInvoice.updateMany({ where: { OR: [{ id: item.id }, { batchItemId: item.id }] }, data: { status: 'Paid' } });
  } else if (item.source === 'library') {
    const updated = await db.libraryFine.updateMany({ where: { id: item.id, status: 'Pending' }, data: { status: 'Paid', reference } });
    if (updated.count !== 1) throw new SettlementConflictError('library', item.id);
  } else if (item.source === 'admin') {
    const updated = await db.adminFine.updateMany({ where: { id: item.id, status: 'Pending' }, data: { status: 'Paid', reference } });
    if (updated.count !== 1) throw new SettlementConflictError('admin', item.id);
  } else if (item.source === 'payLater') {
    const updated = await db.payLaterDue.updateMany({ where: { id: item.id, status: 'Pending' }, data: { status: 'Paid', paymentReference: reference } });
    if (updated.count !== 1) throw new SettlementConflictError('payLater', item.id);
  }

  if (!userId) return;
  const studentUser = await db.user.findUnique({ where: { id: userId } });
  if (!studentUser) return;

  const lastLedger = await db.ledgerEntry.findFirst({
    where: { studentId: studentUser.id },
    orderBy: { createdAt: 'desc' },
  });
  const previousBalance = lastLedger ? lastLedger.balanceAfter : 0;
  const newBalance = Math.max(0, previousBalance - (item.amount || 0));

  await db.ledgerEntry.create({
    data: {
      entryNumber: `LED-CR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      studentId: studentUser.id,
      type: 'CREDIT_PAYMENT',
      creditAmount: Number(item.amount) || 0,
      balanceAfter: newBalance,
      reference,
      description: `${item.label || 'Fee Payment'} by Student (${studentUser.fullName || studentUser.studentId})`,
    },
  });
}

export interface OutstandingDuesResult {
  items: PayItem[];
  total: number;
  breakdown: { semester: number; library: number; admin: number; payLater: number };
}

// The single source of truth for "what does this student currently owe, right now" — the same
// 4-source shape /dues already returns, filtered to Pending only. Reused by semester-fee
// bundling, the restriction check's outstanding total, and Accounts Office's offline settlement,
// so they can never disagree with each other or with what the student sees on /student/dues.
export async function getOutstandingDues(studentId: string): Promise<OutstandingDuesResult> {
  const [sem, lib, adm, pl] = await Promise.all([
    prisma.semesterFee.findMany({ where: { studentId, status: 'Pending' }, take: 200 }),
    prisma.libraryFine.findMany({ where: { studentId, status: 'Pending' }, take: 200 }),
    prisma.adminFine.findMany({ where: { studentId, status: 'Pending' }, take: 200 }),
    prisma.payLaterDue.findMany({ where: { studentId, status: 'Pending' }, take: 200, include: { shop: true } }),
  ]);

  const items: PayItem[] = [
    ...sem.map(r => ({ id: r.id, source: 'semester' as const, amount: r.amount || 0, label: r.label || 'Semester Fee' })),
    ...lib.map(r => ({ id: r.id, source: 'library' as const, amount: r.amount || 0, label: r.label || `${r.fineType || 'Library'} Fine` })),
    ...adm.map(r => ({ id: r.id, source: 'admin' as const, amount: r.amount || 0, label: r.reason || 'Administrative Fine' })),
    ...pl.map(r => ({ id: r.id, source: 'payLater' as const, amount: r.amount || 0, label: r.description || `Pay Later — ${r.shop?.name || 'Shop'}` })),
  ];

  const breakdown = {
    semester: sem.reduce((s, r) => s + (r.amount || 0), 0),
    library: lib.reduce((s, r) => s + (r.amount || 0), 0),
    admin: adm.reduce((s, r) => s + (r.amount || 0), 0),
    payLater: pl.reduce((s, r) => s + (r.amount || 0), 0),
  };

  return { items, total: items.reduce((s, i) => s + i.amount, 0), breakdown };
}

// dueDate is a free-text String? column (CSV-imported for semester fees, never format-enforced —
// see server/src/lib/feeManagementService.ts's raw `String(cell).trim()` import). A lexicographic
// string compare would silently misfire on any non-ISO value a staff CSV upload might contain, so
// this parses with Date and treats anything unparseable as "no enforceable due date" rather than
// risking a wrongful restriction on garbage input.
function parseDueDate(dueDate: string | null | undefined): Date | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  return isNaN(d.getTime()) ? null : d;
}

export interface RestrictionStatus {
  restricted: boolean;
  reason: string | null;
  overdueFees: { id: string; label: string; amount: number; dueDate: string }[];
}

// Derived live, never persisted — a student is restricted exactly while they have a Semester Fee
// still Pending past the due date Accounts Office set for it. The instant that fee is marked Paid
// (via any settlement path — online or Accounts Office's offline bank recording), this returns
// false again on the next check, with no separate "reactivate account" step to remember.
export async function isFinanciallyRestricted(studentId: string): Promise<RestrictionStatus> {
  const pending = await prisma.semesterFee.findMany({ where: { studentId, status: 'Pending' }, take: 100 });
  const now = Date.now();
  const overdue = pending.filter(f => {
    const d = parseDueDate(f.dueDate);
    return d !== null && d.getTime() < now;
  });

  if (overdue.length === 0) return { restricted: false, reason: null, overdueFees: [] };

  return {
    restricted: true,
    reason: `${overdue.length} overdue Semester Fee ${overdue.length === 1 ? 'invoice is' : 'invoices are'} past the due date set by Accounts Office. Outstanding financial obligations must be cleared before full account access is restored.`,
    overdueFees: overdue.map(f => ({ id: f.id, label: f.label || 'Semester Fee', amount: f.amount || 0, dueDate: f.dueDate || '' })),
  };
}
