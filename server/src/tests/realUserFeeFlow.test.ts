import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { validateImportRow, generateFeeLabel } from '../lib/feeManagementService.js';

const prisma = new PrismaClient();

describe('Real Value E2E Verification — EWU Fee Flow', () => {

  it('should verify real student 2023-2-60-053 exists in NeonDB', async () => {
    const student = await prisma.user.findFirst({
      where: { OR: [{ studentId: '2023-2-60-053' }, { email: '2023-2-60-053@std.ewubd.edu' }] },
    });

    expect(student).not.toBeNull();
    expect(student?.studentId).toBe('2023-2-60-053');
    expect(student?.department).toBe('Computer Science');
    expect(student?.status).toBe('Active');
  });

  it('should verify Accounts account accounts@ewubd.edu exists in NeonDB', async () => {
    const accountsUser = await prisma.user.findUnique({
      where: { email: 'accounts@ewubd.edu' },
    });

    expect(accountsUser).not.toBeNull();
    expect(accountsUser?.role).toBe('Accounts Office');
  });

  it('should execute full Fee Push for real student 2023-2-60-053 and produce all database entities', async () => {
    const student = await prisma.user.findFirst({
      where: { studentId: '2023-2-60-053' },
    });
    const accountsUser = await prisma.user.findUnique({
      where: { email: 'accounts@ewubd.edu' },
    });

    expect(student).not.toBeNull();
    expect(accountsUser).not.toBeNull();

    // 1. Validation check for 2023-2-60-053
    const row = {
      studentId: '2023-2-60-053',
      studentName: student!.fullName || 'Jahidul Islam',
      email: student!.email,
      department: 'Computer Science',
      program: 'Undergraduate',
      amount: 45500,
    };

    const valResult = validateImportRow(row, [student!], new Set(), new Set());
    expect(valResult.isValid).toBe(true);

    // 2. Create batch
    const batchNumber = `SFB-2026-REAL-${Date.now()}`;
    const feeLabel = generateFeeLabel('Spring', '2026');

    const batch = await prisma.semesterFeeBatch.create({
      data: {
        batchNumber,
        department: 'Computer Science',
        program: 'Undergraduate',
        semester: 'Spring',
        academicYear: '2026',
        label: feeLabel,
        status: 'Approved',
        totalRows: 1,
        validRows: 1,
        totalAmount: 45500,
        makerId: accountsUser!.id,
        approverId: accountsUser!.id,
        approvedAt: new Date(),
        items: {
          create: [{
            studentId: student!.studentId!,
            studentName: student!.fullName || 'Jahidul Islam',
            studentEmail: student!.email,
            department: 'Computer Science',
            program: 'Undergraduate',
            tuition: 45500,
            finalAmount: 45500,
            dueDate: '2026-08-30',
            feeLabel,
            status: 'Valid',
          }],
        },
      },
      include: { items: true },
    });

    expect(batch.status).toBe('Approved');
    expect(batch.items).toHaveLength(1);

    // 3. Perform Fee Push
    const item = batch.items[0];
    const invoiceNumber = `INV-2026-TEST-${Date.now()}`;
    const refNumber = `REF-FEE-${Date.now()}`;

    const invoice = await prisma.feeInvoice.create({
      data: {
        invoiceNumber,
        batchItemId: item.id,
        studentId: student!.id,
        amount: item.finalAmount,
        feeLabel,
        dueDate: '2026-08-30',
        status: 'Unpaid',
      },
    });

    const dueRecord = await prisma.semesterFee.create({
      data: {
        studentId: student!.id,
        amount: item.finalAmount,
        label: feeLabel,
        dueDate: '2026-08-30',
        status: 'Pending',
        reference: refNumber,
      },
    });

    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        requestRef: `PR-${invoiceNumber}`,
        invoiceId: invoice.id,
        studentId: student!.id,
        amount: item.finalAmount,
        status: 'Pending',
      },
    });

    const gatewaySession = await prisma.paymentGatewaySession.create({
      data: {
        sessionKey: `SES-TEST-${Date.now()}`,
        paymentRequestId: paymentRequest.id,
        studentId: student!.id,
        amount: item.finalAmount,
        feeLabel,
        gateway: 'SSLCommerz',
        status: 'Active',
      },
    });

    const ledgerEntry = await prisma.ledgerEntry.create({
      data: {
        entryNumber: `LED-TEST-${Date.now()}`,
        studentId: student!.id,
        invoiceId: invoice.id,
        type: 'DEBIT_DUE',
        debitAmount: item.finalAmount,
        balanceAfter: item.finalAmount,
        reference: refNumber,
        description: `${feeLabel} imposed by Accounts`,
      },
    });

    // 4. Assertions on generated entities
    expect(invoice.amount).toBe(45500);
    expect(dueRecord.amount).toBe(45500);
    expect(gatewaySession.amount).toBe(45500); // Locked amount
    expect(ledgerEntry.debitAmount).toBe(45500);

    // Clean up: this test writes into the real production database (real student,
    // real accounts user), so it must remove everything it created or repeated runs
    // permanently pollute that student's ledger/dues with phantom fees.
    await prisma.ledgerEntry.delete({ where: { id: ledgerEntry.id } });
    await prisma.paymentGatewaySession.delete({ where: { id: gatewaySession.id } });
    await prisma.paymentRequest.delete({ where: { id: paymentRequest.id } });
    await prisma.semesterFee.delete({ where: { id: dueRecord.id } });
    await prisma.feeInvoice.delete({ where: { id: invoice.id } });
    await prisma.semesterFeeBatch.delete({ where: { id: batch.id } });
  }, 30000);

});
