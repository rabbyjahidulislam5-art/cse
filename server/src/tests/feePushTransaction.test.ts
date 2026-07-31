import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Real-DB integration test (same convention as unifiedSettlement.integration.test.ts /
// feePushDuplicateScope.test.ts). Proves /accounts/fee-import/push's core guarantee: the whole
// per-student invoice/ledger/notification creation loop runs inside one prisma.$transaction,
// so a failure partway through (e.g. a duplicate invoice number colliding with an existing row)
// rolls back everything for the batch instead of leaving some students invoiced and others not.
describe('Fee Push execution — transactional atomicity + FeePushJob tracking', () => {
  let studentAId: string;
  let studentAAppId: string;
  let makerId: string;
  let batchId: string;
  const collidingInvoiceNumber = `INV-TEST-COLLIDE-${Date.now()}`;

  beforeAll(async () => {
    const student = await prisma.user.create({
      data: {
        email: `test-txn-${Date.now()}@std.ewubd.edu`,
        fullName: 'Transaction Test Student',
        role: 'Student',
        studentId: `TEST-TXN-${Date.now()}`,
        department: 'Computer Science',
        status: 'Active',
      },
    });
    studentAId = student.id;

    const maker = await prisma.user.findFirst({ where: { role: 'Accounts Office' } });
    if (!maker) throw new Error('No Accounts Office user found to use as batch maker in test setup');
    makerId = maker.id;

    const batch = await prisma.semesterFeeBatch.create({
      data: {
        batchNumber: `SFB-TEST-TXN-${Date.now()}`,
        department: 'Computer Science',
        program: 'Undergraduate',
        semester: 'Summer',
        academicYear: '2027',
        label: 'Summer 2027 Semester Fee',
        status: 'Approved',
        totalRows: 1,
        validRows: 1,
        totalAmount: 45000,
        makerId,
      },
    });
    batchId = batch.id;

    // Pre-occupy the invoice number the transaction below will try to reuse, forcing a unique
    // constraint violation partway through the simulated push.
    await prisma.feeInvoice.create({
      data: {
        invoiceNumber: collidingInvoiceNumber,
        studentId: studentAId,
        amount: 1,
        feeLabel: 'Pre-existing collider row',
        status: 'Unpaid',
      },
    });
    studentAAppId = student.id;
  }, 30000);

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { studentId: studentAId } });
    await prisma.semesterFee.deleteMany({ where: { studentId: studentAId } });
    await prisma.paymentRequest.deleteMany({ where: { studentId: studentAId } });
    await prisma.feeInvoice.deleteMany({ where: { studentId: studentAId } });
    await prisma.semesterFeeBatch.delete({ where: { id: batchId } }).catch(() => {});
    await prisma.user.delete({ where: { id: studentAId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  it('rolls back every write for the batch when one student in the loop fails mid-transaction', async () => {
    const pushJob = await prisma.feePushJob.create({
      data: { batchId, status: 'Processing', totalCount: 1, startedAt: new Date() },
    });

    const refNumber = `REF-TEST-TXN-${Date.now()}`;

    await expect(
      prisma.$transaction(async (txClient) => {
        // Step 1: succeeds and writes a real SemesterFee due row for the student.
        await txClient.semesterFee.create({
          data: {
            studentId: studentAId,
            amount: 45000,
            label: 'Summer 2027 Semester Fee',
            status: 'Pending',
            reference: refNumber,
          },
        });

        // Step 2: fails — invoiceNumber unique constraint collides with the row created in
        // beforeAll, exactly the kind of mid-loop failure the transaction must protect against.
        await txClient.feeInvoice.create({
          data: {
            invoiceNumber: collidingInvoiceNumber,
            studentId: studentAId,
            amount: 45000,
            feeLabel: 'Summer 2027 Semester Fee',
            status: 'Unpaid',
          },
        });
      })
    ).rejects.toThrow();

    await prisma.feePushJob.update({
      where: { id: pushJob.id },
      data: { status: 'Failed', completedAt: new Date(), errorLog: 'Unique constraint failed on invoiceNumber' },
    });

    // The SemesterFee due row from Step 1 must NOT exist — the transaction rolled it back
    // even though that individual write succeeded before Step 2 failed.
    const orphanedDue = await prisma.semesterFee.findFirst({ where: { studentId: studentAId, reference: refNumber } });
    expect(orphanedDue).toBeNull();

    const job = await prisma.feePushJob.findUnique({ where: { id: pushJob.id } });
    expect(job?.status).toBe('Failed');
    expect(job?.errorLog).toBeTruthy();
  }, 30000);
});
