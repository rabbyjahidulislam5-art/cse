import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { executeScholarshipBatchPush } from '../lib/scholarshipService.js';

const prisma = new PrismaClient();

// Real-DB integration test against the shared Neon instance (same pattern as
// unifiedSettlement.integration.test.ts / feePushIntegration-style tests — no separate dev
// database exists in this project). Exercises the ACTUAL executeScholarshipBatchPush() function
// the route calls (not a re-implementation copy), against a disposable test student.
describe('Scholarship Push — real DB integration', () => {
  let matchedStudentId: string;
  let unmatchedRowStudentIdText: string;
  let adminUserId: string;
  let batchId: string;
  let matchedItemId: string;
  let unmatchedItemId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const [student, admin] = await Promise.all([
      prisma.user.create({
        data: { email: `test-scholarship-${suffix}@std.ewubd.edu`, fullName: 'Scholarship Test Student', role: 'Student', studentId: `TEST-SCH-${suffix}` },
      }),
      prisma.user.findFirst({ where: { role: 'Admin Office' } }),
    ]);
    matchedStudentId = student.id;
    unmatchedRowStudentIdText = `NO-SUCH-STUDENT-${suffix}`;
    adminUserId = admin?.id || student.id; // falls back to the test student id if no seeded Admin Office account exists

    const batch = await prisma.scholarshipPushBatch.create({
      data: {
        batchNumber: `SPB-TEST-${suffix}`, label: 'Integration Test Batch', status: 'Draft',
        totalRows: 2, validRows: 2, invalidRows: 0, totalAmount: 15000,
        uploadedById: adminUserId,
        items: {
          create: [
            { studentId: student.studentId!, studentName: student.fullName, studentEmail: student.email, amount: 10000, remark: 'Merit Scholarship', status: 'Valid' },
            { studentId: unmatchedRowStudentIdText, studentName: 'Nobody', studentEmail: 'nobody@std.ewubd.edu', amount: 5000, remark: 'Unmatched row', status: 'Valid' },
          ],
        },
      },
      include: { items: true },
    });
    batchId = batch.id;
    matchedItemId = batch.items.find(i => i.studentId === student.studentId)!.id;
    unmatchedItemId = batch.items.find(i => i.studentId === unmatchedRowStudentIdText)!.id;
  }, 30000);

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { recipientId: matchedStudentId } });
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ['ScholarshipPushItem', 'ScholarshipPushBatch'] }, entityId: { in: [batchId, matchedItemId, unmatchedItemId] } } });
    await prisma.transaction.deleteMany({ where: { userId: matchedStudentId, purpose: 'scholarship_credit' } });
    await prisma.wallet.deleteMany({ where: { ownerId: matchedStudentId } });
    await prisma.scholarshipPushBatch.delete({ where: { id: batchId } }).catch(() => {});
    await prisma.user.delete({ where: { id: matchedStudentId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  it('credits the matched student wallet, records a Transaction/AuditLog, marks the item Pushed, and skips the unmatched row without aborting the batch', async () => {
    const result = await executeScholarshipBatchPush(batchId, adminUserId);

    expect(result.pushedCount).toBe(1);
    expect(result.skippedReasons).toHaveLength(1);
    expect(result.skippedReasons[0]).toContain(unmatchedRowStudentIdText);
    expect(result.pushedNotifications).toHaveLength(1);
    expect(result.pushedNotifications[0]).toMatchObject({ studentId: matchedStudentId, amount: 10000 });

    const wallet = await prisma.wallet.findFirst({ where: { ownerId: matchedStudentId } });
    expect(wallet?.balance).toBe(10000);

    const transaction = await prisma.transaction.findFirst({ where: { userId: matchedStudentId, purpose: 'scholarship_credit' } });
    expect(transaction).not.toBeNull();
    expect(transaction?.amount).toBe(10000);
    expect(transaction?.direction).toBe('Credit');
    expect(transaction?.status).toBe('Success');
    expect(transaction?.balanceBefore).toBe(0);
    expect(transaction?.balanceAfter).toBe(10000);

    const auditLog = await prisma.auditLog.findFirst({ where: { entityType: 'ScholarshipPushItem', entityId: matchedItemId, action: 'Scholarship Credited' } });
    expect(auditLog).not.toBeNull();

    const [matchedItem, unmatchedItem, batch] = await Promise.all([
      prisma.scholarshipPushItem.findUnique({ where: { id: matchedItemId } }),
      prisma.scholarshipPushItem.findUnique({ where: { id: unmatchedItemId } }),
      prisma.scholarshipPushBatch.findUnique({ where: { id: batchId } }),
    ]);
    expect(matchedItem?.status).toBe('Pushed');
    expect(matchedItem?.matchedUserId).toBe(matchedStudentId);
    expect(unmatchedItem?.status).toBe('Error');
    expect(batch?.status).toBe('Pushed');
  }, 30000);

  it('rejects a second push attempt on an already-Pushed batch', async () => {
    await expect(executeScholarshipBatchPush(batchId, adminUserId)).rejects.toThrow('already been pushed');
  }, 30000);

  it('rejects a push for a non-existent batch', async () => {
    await expect(executeScholarshipBatchPush('non-existent-batch-id', adminUserId)).rejects.toThrow('Batch not found');
  }, 30000);
});
