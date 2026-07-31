import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOutstandingDues, isFinanciallyRestricted, markItemPaid, SettlementConflictError } from '../lib/settlement.js';

const prisma = new PrismaClient();

// Real-DB integration test against the shared Neon instance (this project has no separate dev
// database — same pattern as feePushIntegration.test.ts / realUserFeeFlow.test.ts). Uses a
// dedicated, disposable test student + shop created fresh here and fully deleted afterward,
// rather than the real seeded demo student — this exercises the exact same settlement.ts code
// path a real payment does, without risking any residue on a real account's ledger/balance.
describe('Unified Outstanding Due Settlement — real DB integration', () => {
  let studentId: string;
  let shopId: string;
  const createdDueIds: { semesterFee: string[]; libraryFine: string[]; adminFine: string[]; payLaterDue: string[] } = {
    semesterFee: [], libraryFine: [], adminFine: [], payLaterDue: [],
  };

  beforeAll(async () => {
    // Neon's serverless connection has real cold-start latency (documented in this project's own
    // prior sessions) — the default vitest hook/test timeout is too tight for it.
    const student = await prisma.user.create({
      data: {
        email: `test-settlement-${Date.now()}@std.ewubd.edu`,
        fullName: 'Settlement Test Student',
        role: 'Student',
        studentId: `TEST-SETTLE-${Date.now()}`,
      },
    });
    studentId = student.id;

    const shop = await prisma.shop.create({
      data: { name: 'Settlement Test Shop', category: 'Test', status: 'Active' },
    });
    shopId = shop.id;
  }, 30000);

  afterAll(async () => {
    // Explicit, ordered cleanup — this test writes real rows into the shared Neon DB, so it must
    // remove everything it created (mirrors realUserFeeFlow.test.ts's convention).
    await prisma.ledgerEntry.deleteMany({ where: { studentId } });
    await prisma.semesterFee.deleteMany({ where: { studentId } });
    await prisma.libraryFine.deleteMany({ where: { studentId } });
    await prisma.adminFine.deleteMany({ where: { studentId } });
    await prisma.payLaterDue.deleteMany({ where: { studentId } });
    await prisma.shop.delete({ where: { id: shopId } }).catch(() => {});
    await prisma.user.delete({ where: { id: studentId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  it('aggregates a Pending overdue semester fee, library fine, admin fine, and pay-later due into one consolidated total', async () => {
    const overdueDate = '2020-01-01';
    const [sem, lib, adm, pl] = await Promise.all([
      prisma.semesterFee.create({ data: { studentId, amount: 45500, label: 'Spring 2026 Semester Fee', dueDate: overdueDate, status: 'Pending' } }),
      prisma.libraryFine.create({ data: { studentId, amount: 500, fineType: 'Overdue Book', status: 'Pending' } }),
      prisma.adminFine.create({ data: { studentId, amount: 1200, reason: 'Test Misconduct Fine', status: 'Pending' } }),
      prisma.payLaterDue.create({ data: { studentId, shopId, amount: 800, description: 'Test Shop Purchase', status: 'Pending' } }),
    ]);
    createdDueIds.semesterFee.push(sem.id);
    createdDueIds.libraryFine.push(lib.id);
    createdDueIds.adminFine.push(adm.id);
    createdDueIds.payLaterDue.push(pl.id);

    const outstanding = await getOutstandingDues(studentId);
    expect(outstanding.items).toHaveLength(4);
    expect(outstanding.total).toBe(45500 + 500 + 1200 + 800);
    expect(outstanding.breakdown).toEqual({ semester: 45500, library: 500, admin: 1200, payLater: 800 });
  }, 30000);

  it('reports the student as financially restricted while the semester fee is Pending and overdue', async () => {
    const status = await isFinanciallyRestricted(studentId);
    expect(status.restricted).toBe(true);
    expect(status.overdueFees).toHaveLength(1);
    expect(status.overdueFees[0].amount).toBe(45500);
  }, 30000);

  it('settles every outstanding due atomically in one $transaction, writes one ledger entry per item, and lifts the restriction with no separate reactivation step', async () => {
    const outstanding = await getOutstandingDues(studentId);
    expect(outstanding.items.length).toBeGreaterThan(0);
    const ref = `TEST-SETTLE-REF-${Date.now()}`;

    await prisma.$transaction(async (txClient) => {
      for (const item of outstanding.items) await markItemPaid(item, ref, studentId, txClient);
    }, { timeout: 30000, maxWait: 15000 });

    const [sem, lib, adm, pl, ledgerEntries] = await Promise.all([
      prisma.semesterFee.findUnique({ where: { id: createdDueIds.semesterFee[0] } }),
      prisma.libraryFine.findUnique({ where: { id: createdDueIds.libraryFine[0] } }),
      prisma.adminFine.findUnique({ where: { id: createdDueIds.adminFine[0] } }),
      prisma.payLaterDue.findUnique({ where: { id: createdDueIds.payLaterDue[0] } }),
      prisma.ledgerEntry.findMany({ where: { studentId, reference: ref } }),
    ]);

    expect(sem?.status).toBe('Paid');
    expect(lib?.status).toBe('Paid');
    expect(adm?.status).toBe('Paid');
    expect(pl?.status).toBe('Paid');
    expect(sem?.reference).toBe(ref);
    expect(ledgerEntries).toHaveLength(4);
    expect(ledgerEntries.every(l => l.type === 'CREDIT_PAYMENT')).toBe(true);

    // Unified Outstanding Due Settlement, end to end: nothing left owing, and the restriction —
    // derived live, never a stored flag — is already gone on the very next check.
    const outstandingAfter = await getOutstandingDues(studentId);
    expect(outstandingAfter.items).toHaveLength(0);
    expect(outstandingAfter.total).toBe(0);

    const statusAfter = await isFinanciallyRestricted(studentId);
    expect(statusAfter.restricted).toBe(false);
  }, 30000);

  it('rejects a re-settlement attempt on an already-Paid due (concurrency guard) and rolls back the whole batch rather than partially applying it', async () => {
    // The semester fee from the previous test is now Paid — attempting to settle it again in a
    // fresh batch (simulating a second, racing settlement request) must fail the whole
    // transaction, not silently re-credit it or half-apply.
    const alreadyPaidItem = { id: createdDueIds.semesterFee[0], source: 'semester' as const, amount: 45500, label: 'Spring 2026 Semester Fee' };
    const freshFineItem = createdDueIds.adminFine[0];

    // Re-open a fresh Pending admin fine to prove the OTHER item in the same batch also rolls
    // back, not just the conflicting one — real atomicity, not "skip the bad one and continue".
    await prisma.adminFine.update({ where: { id: freshFineItem }, data: { status: 'Pending' } });

    await expect(
      prisma.$transaction(async (txClient) => {
        await markItemPaid({ id: freshFineItem, source: 'admin', amount: 1200, label: 'Test Misconduct Fine' }, 'TEST-CONFLICT-REF', studentId, txClient);
        await markItemPaid(alreadyPaidItem, 'TEST-CONFLICT-REF', studentId, txClient);
      })
    ).rejects.toThrow(SettlementConflictError);

    // Rolled back — the admin fine settled earlier IN THE SAME BATCH must not have stuck either.
    const adminFineAfterRollback = await prisma.adminFine.findUnique({ where: { id: freshFineItem } });
    expect(adminFineAfterRollback?.status).toBe('Pending');

    // Restore to Paid so afterAll's cleanup semantics stay consistent (harmless either way since
    // the row is deleted regardless, but keeps intermediate state legible if this test is ever
    // run with --inspect / debugged manually).
    await prisma.adminFine.update({ where: { id: freshFineItem }, data: { status: 'Paid' } });
  }, 30000);
});
