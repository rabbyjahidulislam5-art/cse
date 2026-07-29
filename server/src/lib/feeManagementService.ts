import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const prisma = new PrismaClient();

export interface ImportRowData {
  studentId: string;
  studentName: string;
  email: string;
  department: string;
  program: string;
  semester?: string;
  academicYear?: string;
  credit?: number;
  tuition?: number;
  waiver?: number;
  waiverAdjustment?: number;
  lateFee?: number;
  amount: number;
  dueDate?: string;
  feeLabel?: string;
  remark?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function generateFeeLabel(semester: string, academicYear: string): string {
  const cleanSemester = (semester || 'Spring').trim();
  const cleanYear = (academicYear || '2026').trim();
  return `${cleanSemester} ${cleanYear} Semester Fee`;
}

export function calculateFinalAmount(input: {
  tuition: number;
  lateFee?: number;
  waiver?: number;
  waiverAdjustment?: number;
}): number {
  const tuition = Number(input.tuition) || 0;
  const lateFee = Number(input.lateFee) || 0;
  const waiver = Number(input.waiver) || 0;
  const waiverAdjustment = Number(input.waiverAdjustment) || 0;
  const total = tuition + lateFee - waiver - waiverAdjustment;
  return Math.max(0, total);
}

export function validateImportRow(
  row: ImportRowData,
  existingStudents: Array<{
    id: string;
    studentId: string | null;
    fullName: string | null;
    email: string;
    department: string | null;
    batch: string | null;
    status: string;
  }>,
  existingPushedStudentIds: Set<string>,
  fileStudentIdsSeen: Set<string>
): ValidationResult {
  const errors: string[] = [];

  const studentId = (row.studentId || '').trim();
  const email = (row.email || '').trim().toLowerCase();
  const department = (row.department || '').trim();
  const amount = Number(row.amount);

  if (!studentId) {
    errors.push('Student ID is required');
  }

  const student = existingStudents.find(s => s.studentId === studentId);
  if (!student) {
    errors.push('Student ID does not exist');
  } else {
    if (student.status !== 'Active') {
      errors.push('Student account is inactive or locked');
    }
    if (email && student.email.toLowerCase() !== email) {
      errors.push('Email mismatch');
    }
    if (department && student.department && student.department.toLowerCase() !== department.toLowerCase()) {
      errors.push('Department mismatch');
    }
  }

  if (isNaN(amount) || amount <= 0) {
    errors.push('Amount must be positive');
  }

  if (existingPushedStudentIds.has(studentId)) {
    errors.push('Fee already pushed for this student');
  }

  if (fileStudentIdsSeen.has(studentId)) {
    errors.push('Duplicate student entry in file');
  } else if (studentId) {
    fileStudentIdsSeen.add(studentId);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateApprovalWorkflowPermissions(
  userRole: 'Maker' | 'Checker' | 'Approver' | 'Accounts Office' | 'Admin',
  batchStatus: string,
  action: 'SUBMIT_FOR_REVIEW' | 'VERIFY_BATCH' | 'APPROVE_BATCH' | 'REJECT_BATCH' | 'EXECUTE_PUSH'
): { allowed: boolean; reason?: string } {
  // Admin and Accounts Office with full access fallbacks
  if (userRole === 'Admin') return { allowed: true };

  if (action === 'SUBMIT_FOR_REVIEW') {
    if (batchStatus !== 'Draft' && batchStatus !== 'Validated') {
      return { allowed: false, reason: 'Batch can only be submitted from Draft or Validated state' };
    }
    return { allowed: true };
  }

  if (action === 'VERIFY_BATCH') {
    if (userRole === 'Maker') {
      return { allowed: false, reason: 'Maker cannot verify their own batch; Checker required' };
    }
    return { allowed: true };
  }

  if (action === 'APPROVE_BATCH' || action === 'REJECT_BATCH') {
    if (userRole === 'Maker') {
      return { allowed: false, reason: 'Only Approver can approve fee push' };
    }
    if (userRole !== 'Approver' && userRole !== 'Accounts Office') {
      return { allowed: false, reason: 'Only Approver role can approve or reject fee push batches' };
    }
    return { allowed: true };
  }

  if (action === 'EXECUTE_PUSH') {
    if (batchStatus !== 'Approved') {
      return { allowed: false, reason: 'Batch must be Approved before Fee Push' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Invalid action or role permission' };
}

export function parseImportRows(rows: any[][]): ImportRowData[] {
  if (!rows || rows.length < 2) return [];

  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const studentIdIdx = header.findIndex(h => h.includes('student id') || h === 'studentid' || h === 'id');
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email'));
  const deptIdx = header.findIndex(h => h.includes('department') || h === 'dept');
  const progIdx = header.findIndex(h => h.includes('program'));
  const semIdx = header.findIndex(h => h.includes('semester'));
  const yearIdx = header.findIndex(h => h.includes('year'));
  const amountIdx = header.findIndex(h => h.includes('amount') || h.includes('tuition'));
  const dueDateIdx = header.findIndex(h => h.includes('due date') || h.includes('duedate'));
  const labelIdx = header.findIndex(h => h.includes('label'));

  const result: ImportRowData[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0 || !r[studentIdIdx]) continue;

    result.push({
      studentId: String(r[studentIdIdx] || '').trim(),
      studentName: nameIdx >= 0 ? String(r[nameIdx] || '').trim() : '',
      email: emailIdx >= 0 ? String(r[emailIdx] || '').trim() : '',
      department: deptIdx >= 0 ? String(r[deptIdx] || '').trim() : '',
      program: progIdx >= 0 ? String(r[progIdx] || '').trim() : 'Undergraduate',
      semester: semIdx >= 0 ? String(r[semIdx] || '').trim() : 'Spring',
      academicYear: yearIdx >= 0 ? String(r[yearIdx] || '').trim() : '2026',
      amount: amountIdx >= 0 ? parseFloat(String(r[amountIdx] || '0').replace(/[^0-9.]/g, '')) || 0 : 0,
      dueDate: dueDateIdx >= 0 ? String(r[dueDateIdx] || '').trim() : undefined,
      feeLabel: labelIdx >= 0 ? String(r[labelIdx] || '').trim() : undefined,
    });
  }

  return result;
}

// ─── ADVISING EXPORT GENERATORS ───

export async function generateAdvisingExcelBuffer(studentsData: Array<{
  studentId: string;
  name: string;
  email: string;
  department: string;
  program: string;
  semester: string;
  credit: number;
  tuition: number;
  waiver: number;
  finalAmount: number;
}>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Advising Completed Fees');

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 18 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Program', key: 'program', width: 16 },
    { header: 'Semester', key: 'semester', width: 14 },
    { header: 'Credit', key: 'credit', width: 10 },
    { header: 'Tuition', key: 'tuition', width: 14 },
    { header: 'Waiver', key: 'waiver', width: 14 },
    { header: 'Final Amount', key: 'finalAmount', width: 16 },
  ];

  studentsData.forEach(st => sheet.addRow(st));

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1E293B' },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function generateAdvisingCsvString(studentsData: Array<{
  studentId: string;
  name: string;
  email: string;
  department: string;
  program: string;
  semester: string;
  credit: number;
  tuition: number;
  waiver: number;
  finalAmount: number;
}>): string {
  const headers = ['Student ID', 'Name', 'Email', 'Department', 'Program', 'Semester', 'Credit', 'Tuition', 'Waiver', 'Final Amount'];
  const rows = studentsData.map(s => [
    `"${s.studentId}"`,
    `"${s.name}"`,
    `"${s.email}"`,
    `"${s.department}"`,
    `"${s.program}"`,
    `"${s.semester}"`,
    s.credit,
    s.tuition,
    s.waiver,
    s.finalAmount,
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

export async function generateAdvisingPdfBuffer(studentsData: Array<{
  studentId: string;
  name: string;
  email: string;
  department: string;
  program: string;
  semester: string;
  credit: number;
  tuition: number;
  waiver: number;
  finalAmount: number;
}>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const buffers: Buffer[] = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(18).text('East West University — Advising Completed Fee Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Generated Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
      doc.moveDown();

      studentsData.forEach((st, idx) => {
        doc.fontSize(10).text(
          `${idx + 1}. [${st.studentId}] ${st.name} | ${st.department} (${st.program}) | Credit: ${st.credit} | Tuition: ৳${st.tuition} | Waiver: ৳${st.waiver} | Final Amount: ৳${st.finalAmount}`
        );
        doc.moveDown(0.3);
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
