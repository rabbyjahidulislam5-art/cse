import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { validateImportRow } from '../lib/feeManagementService.js';

const prisma = new PrismaClient();

// Real-DB integration test against the shared Neon instance (same convention as
// unifiedSettlement.integration.test.ts / realUserFeeFlow.test.ts — this project has no
// separate dev database). Proves the fix for the bug where a student who already received
// one semester's fee could never receive fees for any later semester: the "already pushed"
// check in /accounts/fee-import/validate must be scoped to department+program+semester+year
// via FeeInvoice -> SemesterFeeItem -> SemesterFeeBatch, not a bare status filter.
describe('Fee Push duplicate check — scoped to department/program/semester/academicYear', () => {
  let studentId: string;
  let studentDbId: string;
  let makerId: string;
  let batchAId: string;

  const contextA = { department: 'Computer Science', program: 'Undergraduate', semester: 'Summer', academicYear: '2027' };
  const contextB = { department: 'Computer Science', program: 'Undergraduate', semester: 'Fall', academicYear: '2027' };

  beforeAll(async () => {
    studentId = `TEST-DUPSCOPE-${Date.now()}`;
    const student = await prisma.user.create({
      data: {
        email: `test-dupscope-${Date.now()}@std.ewubd.edu`,
        fullName: 'Duplicate Scope Test Student',
        role: 'Student',
        studentId,
        department: contextA.department,
        status: 'Active',
      },
    });
    studentDbId = student.id;

    const maker = await prisma.user.findFirst({ where: { role: 'Accounts Office' } });
    if (!maker) throw new Error('No Accounts Office user found to use as batch maker in test setup');
    makerId = maker.id;

    // Simulate a fee already pushed for contextA (Summer 2027) via a real batch + item + invoice,
    // exactly like /accounts/fee-import/push produces.
    const batchA = await prisma.semesterFeeBatch.create({
      data: {
        batchNumber: `SFB-TEST-DUPSCOPE-${Date.now()}`,
        department: contextA.department,
        program: contextA.program,
        semester: contextA.semester,
        academicYear: contextA.academicYear,
        label: 'Summer 2027 Semester Fee',
        status: 'Pushed',
        totalRows: 1,
        validRows: 1,
        totalAmount: 45000,
        makerId,
        items: {
          create: [{
            studentId,
            studentName: 'Duplicate Scope Test Student',
            studentEmail: student.email,
            department: contextA.department,
            program: contextA.program,
            tuition: 45000,
            finalAmount: 45000,
            dueDate: '2027-09-15',
            feeLabel: 'Summer 2027 Semester Fee',
            status: 'Pushed',
          }],
        },
      },
      include: { items: true },
    });
    batchAId = batchA.id;

    await prisma.feeInvoice.create({
      data: {
        invoiceNumber: `INV-TEST-DUPSCOPE-${Date.now()}`,
        batchItemId: batchA.items[0].id,
        studentId: studentDbId,
        amount: 45000,
        feeLabel: 'Summer 2027 Semester Fee',
        dueDate: '2027-09-15',
        status: 'Unpaid',
      },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.feeInvoice.deleteMany({ where: { studentId: studentDbId } });
    await prisma.semesterFeeBatch.delete({ where: { id: batchAId } }).catch(() => {});
    await prisma.user.delete({ where: { id: studentDbId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  async function scopedPushedStudentIds(ctx: typeof contextA) {
    const existingPushed = await prisma.feeInvoice.findMany({
      where: {
        status: { in: ['Unpaid', 'Paid'] },
        batchItem: { batch: { department: ctx.department, program: ctx.program, semester: ctx.semester, academicYear: ctx.academicYear } },
      },
      select: { student: { select: { studentId: true } } },
    });
    return new Set(existingPushed.map(p => p.student?.studentId).filter(Boolean) as string[]);
  }

  it('flags the student as Duplicate when re-validating for the SAME context the fee was pushed under', async () => {
    const pushedIds = await scopedPushedStudentIds(contextA);
    expect(pushedIds.has(studentId)).toBe(true);

    const row = { studentId, studentName: 'Duplicate Scope Test Student', email: '', department: contextA.department, program: contextA.program, semester: contextA.semester, academicYear: contextA.academicYear, amount: 45000 };
    const existingStudents = [{ id: studentDbId, studentId, fullName: 'Duplicate Scope Test Student', email: `x@std.ewubd.edu`, department: contextA.department, batch: null, status: 'Active' }];
    const result = validateImportRow(row, existingStudents, pushedIds, new Set(), contextA);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Fee already pushed for this student');
  }, 30000);

  it('does NOT flag the student as Duplicate when validating for a DIFFERENT semester/year', async () => {
    const pushedIds = await scopedPushedStudentIds(contextB);
    expect(pushedIds.has(studentId)).toBe(false);

    const row = { studentId, studentName: 'Duplicate Scope Test Student', email: '', department: contextB.department, program: contextB.program, semester: contextB.semester, academicYear: contextB.academicYear, amount: 45000 };
    const existingStudents = [{ id: studentDbId, studentId, fullName: 'Duplicate Scope Test Student', email: `x@std.ewubd.edu`, department: contextB.department, batch: null, status: 'Active' }];
    const result = validateImportRow(row, existingStudents, pushedIds, new Set(), contextB);

    expect(result.isValid).toBe(true);
    expect(result.errors).not.toContain('Fee already pushed for this student');
  }, 30000);
});
