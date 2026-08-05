import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { matchStudent } from './studentMatcher.js';

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

// Date.parse('2027-02-31') doesn't return NaN — it silently rolls over to March 3rd — so a
// plain isNaN(Date.parse(...)) check misses calendar-invalid dates like Feb 31. Round-trip
// through UTC components instead: an invalid day/month combination won't reproduce itself.
function isValidCalendarDate(value: string): boolean {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!isoMatch) return !isNaN(Date.parse(value));
  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  if (month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ExcelJS parses a date-formatted spreadsheet cell as a native JS Date object, not a string —
// interpolating that directly via a bare String() produces a verbose, unreadable
// "Sun Aug 30 2026 00:00:00 GMT+0000 ..." instead of a plain date, and that garbled text then
// flows into FeeInvoice/SemesterFee/notification text untouched (Date.parse() still accepts it,
// so validation never flags it). Format Date cells as YYYY-MM-DD, matching this codebase's own
// due-date convention (e.g. `${academicYear}-08-30`).
function formatDueDateCell(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  return s || undefined;
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
  fileStudentIdsSeen: Set<string>,
  context?: { department: string; program: string; semester: string; academicYear: string }
): ValidationResult {
  const errors: string[] = [];

  const studentId = (row.studentId || '').trim();
  const email = (row.email || '').trim().toLowerCase();
  const department = (row.department || '').trim();
  const amount = Number(row.amount);

  if (!studentId) {
    errors.push('Student ID is required');
  }

  // Student ID is matched case/whitespace-insensitively (primary), falling back to email when
  // absent/unmatched — see studentMatcher.ts. A row whose normalized ID matches more than one
  // account is flagged 'ambiguous' rather than silently resolved.
  const matchResult = matchStudent({ studentId, email: row.email }, existingStudents);
  const student = matchResult.matched ? matchResult.user : undefined;
  if (matchResult.matched === false && matchResult.reason === 'ambiguous') {
    errors.push('Ambiguous student match — multiple accounts found');
  } else if (!student) {
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

  // Cross-check the row's own metadata against what the Accounts Officer selected in Step 1,
  // so a file carrying the wrong semester/program/year can never silently pass as Valid.
  if (context) {
    const program = (row.program || '').trim();
    const semester = (row.semester || '').trim();
    const academicYear = (row.academicYear || '').trim();

    if (department && department.toLowerCase() !== context.department.trim().toLowerCase() && !errors.includes('Department mismatch')) {
      errors.push('Department mismatch');
    }
    if (program && program.toLowerCase() !== context.program.trim().toLowerCase()) {
      errors.push('Program mismatch');
    }
    if (semester && semester.toLowerCase() !== context.semester.trim().toLowerCase()) {
      errors.push('Semester mismatch');
    }
    if (academicYear && academicYear !== context.academicYear.trim()) {
      errors.push('Academic year mismatch');
    }
  }

  if (row.dueDate && !isValidCalendarDate(row.dueDate)) {
    errors.push('Invalid due date');
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
  userRole: 'Maker' | 'Checker' | 'Approver' | 'Accounts Office' | 'Admin' | 'Admin Office',
  batchStatus: string,
  action: 'SUBMIT_FOR_REVIEW' | 'VERIFY_BATCH' | 'APPROVE_BATCH' | 'REJECT_BATCH' | 'EXECUTE_PUSH'
): { allowed: boolean; reason?: string } {
  // Admin and Accounts Office with full access fallbacks. The real caller (routes/fees.ts) always
  // passes the actual User.role string, which is 'Admin Office' (never the bare 'Admin' this
  // check originally only recognized) — without this, an Admin Office staff member could reach
  // this endpoint (route-gated to allow both 'Accounts Office' and 'Admin Office') and successfully
  // SUBMIT_FOR_REVIEW, only to be silently 403'd on APPROVE_BATCH/REJECT_BATCH.
  if (userRole === 'Admin' || userRole === 'Admin Office') return { allowed: true };

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
    if (batchStatus === 'Rejected') {
      return { allowed: false, reason: 'Rejected batch cannot be pushed' };
    }
    if (batchStatus === 'Pushed' || batchStatus === 'Completed') {
      return { allowed: false, reason: 'Batch has already been pushed' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Invalid action or role permission' };
}

// Checked before parseImportRows so a malformed/misnamed header produces a specific error
// message instead of parseImportRows silently dropping every row (studentIdIdx === -1 makes
// `!r[studentIdIdx]` true for every row) and the caller seeing a generic "no data found".
export function findMissingRequiredColumns(rows: any[][]): string[] {
  if (!rows || rows.length === 0) return ['Student ID', 'Amount'];
  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const missing: string[] = [];
  if (!header.some(h => h.includes('student id') || h === 'studentid' || h === 'id')) missing.push('Student ID');
  if (!header.some(h => h.includes('amount') || h.includes('tuition'))) missing.push('Amount');
  return missing;
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
      // Keeps a leading minus sign so a negative input is actually parsed as negative and
      // rejected by the "Amount must be positive" check below — the old [^0-9.] strip silently
      // discarded the sign first, turning e.g. "-500" into 500 and letting it through as valid.
      amount: amountIdx >= 0 ? parseFloat(String(r[amountIdx] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
      dueDate: dueDateIdx >= 0 ? formatDueDateCell(r[dueDateIdx]) : undefined,
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
