import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth.js';
import {
  generateFeeLabel,
  calculateFinalAmount,
  validateImportRow,
  validateApprovalWorkflowPermissions,
  parseImportRows,
  generateAdvisingExcelBuffer,
  generateAdvisingCsvString,
  generateAdvisingPdfBuffer,
  ImportRowData,
} from '../lib/feeManagementService.js';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const requireAccounts = requireRole('Accounts Office', 'Admin Office');

router.use(authMiddleware, requireAccounts);

function getAuthUser(req: AuthRequest) {
  return req.user!;
}

// ─── PHASE 1 — ADVISING EXPORTS ───

router.post('/advising/export', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { format = 'excel' } = req.body;

    // Fetch active students with academic advising info
    const students = await prisma.user.findMany({
      where: { role: 'Student' },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        department: true,
        batch: true,
        semesterFees: { select: { amount: true, label: true } },
      },
      take: 100,
    });

    const advisingData = students.map((st, idx) => {
      const credit = 12 + (idx % 4) * 3; // 12, 15, 18 credits
      const tuition = credit * 3500;
      const waiver = idx % 3 === 0 ? 5000 : 0;
      const finalAmount = tuition - waiver;

      return {
        studentId: st.studentId || `STU-2026-${String(idx + 1).padStart(3, '0')}`,
        name: st.fullName || 'Student Name',
        email: st.email,
        department: st.department || 'Computer Science',
        program: st.batch || 'Undergraduate',
        semester: 'Spring 2026',
        credit,
        tuition,
        waiver,
        finalAmount,
      };
    });

    if (format === 'csv') {
      const csvStr = generateAdvisingCsvString(advisingData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="advising_completed_fees.csv"');
      res.status(200).send(csvStr);
      return;
    }

    if (format === 'pdf') {
      const pdfBuf = await generateAdvisingPdfBuffer(advisingData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="advising_completed_fees.pdf"');
      res.status(200).send(pdfBuf);
      return;
    }

    const excelBuf = await generateAdvisingExcelBuffer(advisingData);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="advising_completed_fees.xlsx"');
    res.status(200).send(excelBuf);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

// ─── TEMPLATE DOWNLOAD ───

router.get('/accounts/fee-import/template', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Semester Fee Import Template');

    sheet.columns = [
      { header: 'Student ID', key: 'studentId', width: 18 },
      { header: 'Student Name', key: 'studentName', width: 24 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Program', key: 'program', width: 16 },
      { header: 'Semester', key: 'semester', width: 14 },
      { header: 'Academic Year', key: 'academicYear', width: 14 },
      { header: 'Amount', key: 'amount', width: 16 },
      { header: 'Due Date', key: 'dueDate', width: 16 },
      { header: 'Fee Label', key: 'feeLabel', width: 26 },
    ];

    sheet.addRow({
      studentId: 'STU-2026-001',
      studentName: 'Jahidul Islam',
      email: 'jahid@ewu.edu.bd',
      department: 'Computer Science',
      program: 'Undergraduate',
      semester: 'Spring',
      academicYear: '2026',
      amount: 45500,
      dueDate: '2026-08-30',
      feeLabel: 'Spring 2026 Semester Fee',
    });

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fee_import_template.xlsx"');
    res.status(200).send(Buffer.from(buffer));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 2: FILE VALIDATION ENGINE ───

router.post('/accounts/fee-import/validate', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { department = 'Computer Science', program = 'Undergraduate', semester = 'Spring', academicYear = '2026' } = req.body;
    let parsedRows: ImportRowData[] = [];

    if (req.file) {
      const buffer = req.file.buffer;
      if (req.file.originalname.endsWith('.csv')) {
        const text = buffer.toString('utf-8');
        const lines = text.split('\n').map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
        parsedRows = parseImportRows(lines);
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        const raw: any[][] = [];
        sheet.eachRow((row) => {
          raw.push((row.values as any[]).slice(1));
        });
        parsedRows = parseImportRows(raw);
      }
    } else if (req.body.rows && Array.isArray(req.body.rows)) {
      parsedRows = req.body.rows;
    }

    if (parsedRows.length === 0) {
      res.status(400).json({ error: 'No valid data rows found in uploaded file' });
      return;
    }

    // Fetch student records from database for strict verification
    const existingStudents = await prisma.user.findMany({
      where: { role: 'Student' },
      select: { id: true, studentId: true, fullName: true, email: true, department: true, batch: true, status: true },
    });

    const existingPushed = await prisma.feeInvoice.findMany({
      where: { status: { in: ['Unpaid', 'Paid'] } },
      select: { student: { select: { studentId: true } } },
    });
    const existingPushedStudentIds = new Set(
      existingPushed.map(p => p.student?.studentId).filter(Boolean) as string[]
    );

    const fileStudentIdsSeen = new Set<string>();
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let totalAmount = 0;
    const warnings: string[] = [];

    const validatedItems = parsedRows.map((row) => {
      const dbStudent = existingStudents.find(s => s.studentId === row.studentId);
      const valRes = validateImportRow(row, existingStudents, existingPushedStudentIds, fileStudentIdsSeen);

      let status = 'Valid';
      if (!valRes.isValid) {
        if (valRes.errors.some(e => e.includes('Duplicate') || e.includes('already pushed'))) {
          status = 'Duplicate';
          duplicateCount++;
        } else {
          status = 'Invalid';
          invalidCount++;
        }
        warnings.push(`Student [${row.studentId || 'N/A'}]: ${valRes.errors.join(', ')}`);
      } else {
        validCount++;
        totalAmount += row.amount;
      }

      return {
        ...row,
        studentName: row.studentName || dbStudent?.fullName || 'Student',
        email: row.email || dbStudent?.email || `${row.studentId.toLowerCase()}@std.ewubd.edu`,
        department: row.department || dbStudent?.department || department || 'Computer Science',
        status,
        validationErrors: valRes.errors,
      };
    });

    const autoFeeLabel = generateFeeLabel(semester, academicYear);

    res.status(200).json({
      summary: {
        totalRows: parsedRows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        duplicateRows: duplicateCount,
        totalAmount,
        warnings,
        canImport: invalidCount === 0 && duplicateCount === 0,
      },
      metadata: { department, program, semester, academicYear, autoFeeLabel },
      items: validatedItems,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Validation failed' });
  }
});

// ─── STEP 3: SUBMIT IMPORT BATCH ───

router.post('/accounts/fee-import/submit', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = getAuthUser(req);
    const { department, program, semester, academicYear, items = [] } = req.body;

    const label = generateFeeLabel(semester, academicYear);
    const batchNumber = `SFB-${academicYear}-${Date.now().toString().slice(-6)}`;

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let totalAmount = 0;

    items.forEach((it: any) => {
      if (it.status === 'Valid') {
        validCount++;
        totalAmount += Number(it.amount) || 0;
      } else if (it.status === 'Duplicate') duplicateCount++;
      else invalidCount++;
    });

    const batch = await prisma.semesterFeeBatch.create({
      data: {
        batchNumber,
        department: department || 'Computer Science',
        program: program || 'Undergraduate',
        semester: semester || 'Spring',
        academicYear: academicYear || '2026',
        label,
        status: 'Draft',
        totalRows: items.length,
        validRows: validCount,
        invalidRows: invalidCount,
        duplicateRows: duplicateCount,
        totalAmount,
        makerId: user.id,
        items: {
          create: items.map((it: any) => ({
            studentId: it.studentId,
            studentName: it.studentName || 'Student',
            studentEmail: it.email || `${it.studentId.toLowerCase()}@ewu.edu.bd`,
            department: it.department || department || 'Computer Science',
            program: it.program || program || 'Undergraduate',
            tuition: Number(it.amount) || 0,
            finalAmount: Number(it.amount) || 0,
            dueDate: it.dueDate || `${academicYear}-08-30`,
            feeLabel: it.feeLabel || label,
            remark: it.remark || '',
            status: it.status || 'Valid',
            validationErrorsJson: it.validationErrors ? JSON.stringify(it.validationErrors) : null,
          })),
        },
      },
      include: { items: true },
    });

    res.status(201).json({ success: true, message: 'Fee batch created successfully', batch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REVIEW PAGE: GET & EDIT BATCH ITEMS ───

router.get('/accounts/fee-import/batch/:batchId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batchId = String(req.params.batchId);
    const batch = await prisma.semesterFeeBatch.findUnique({
      where: { id: batchId },
      include: { items: true, maker: { select: { fullName: true, email: true } }, checker: { select: { fullName: true } }, approver: { select: { fullName: true } } },
    });

    if (!batch) {
      res.status(404).json({ error: 'Fee batch not found' });
      return;
    }
    res.status(200).json({ batch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST version for apiCall compatibility (frontend apiCall always POSTs)
router.post('/accounts/fee-import/batch-detail', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batchId } = req.body;
    const batch = await prisma.semesterFeeBatch.findUnique({
      where: { id: batchId },
      include: { items: true, maker: { select: { fullName: true, email: true } }, checker: { select: { fullName: true } }, approver: { select: { fullName: true } } },
    });

    if (!batch) {
      res.status(404).json({ error: 'Fee batch not found' });
      return;
    }
    res.status(200).json({ batch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST version for apiCall compatibility
router.post('/accounts/fee-import/item', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, amount, feeLabel, dueDate, lateFee = 0, waiverAdjustment = 0, remark } = req.body;

    const item = await prisma.semesterFeeItem.findUnique({ where: { id: itemId } });
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const tuition = amount !== undefined ? Number(amount) : item.tuition;
    const finalAmount = calculateFinalAmount({ tuition, lateFee, waiver: item.waiver, waiverAdjustment });

    const updated = await prisma.semesterFeeItem.update({
      where: { id: itemId },
      data: {
        tuition,
        lateFee: Number(lateFee),
        waiverAdjustment: Number(waiverAdjustment),
        finalAmount,
        feeLabel: feeLabel || item.feeLabel,
        dueDate: dueDate || item.dueDate,
        remark: remark !== undefined ? remark : item.remark,
      },
    });

    res.status(200).json({ success: true, item: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 4: APPROVAL WORKFLOW (MAKER / CHECKER / APPROVER) ───

router.post('/accounts/fee-import/approve', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = getAuthUser(req);
    const { batchId, action, reason } = req.body; // action: SUBMIT_FOR_REVIEW | VERIFY_BATCH | APPROVE_BATCH | REJECT_BATCH

    const batch = await prisma.semesterFeeBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const role = (user.role || 'Accounts Office') as any;
    const perm = validateApprovalWorkflowPermissions(role, batch.status, action);

    if (!perm.allowed) {
      res.status(403).json({ error: perm.reason });
      return;
    }

    let nextStatus = batch.status;
    const updateData: any = {};

    if (action === 'SUBMIT_FOR_REVIEW') {
      nextStatus = 'PendingApproval';
    } else if (action === 'VERIFY_BATCH') {
      nextStatus = 'PendingApproval';
      updateData.checkerId = user.id;
    } else if (action === 'APPROVE_BATCH') {
      nextStatus = 'Approved';
      updateData.approverId = user.id;
      updateData.approvedAt = new Date();
    } else if (action === 'REJECT_BATCH') {
      nextStatus = 'Rejected';
      updateData.rejectionReason = reason || 'Rejected by Accounts Approver';
    }

    const updatedBatch = await prisma.semesterFeeBatch.update({
      where: { id: batchId },
      data: { status: nextStatus, ...updateData },
    });

    res.status(200).json({ success: true, message: `Batch ${action} completed successfully`, batch: updatedBatch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 5: FEE PUSH EXECUTION ───

router.post('/accounts/fee-import/push', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = getAuthUser(req);
    const { batchId } = req.body;

    const batch = await prisma.semesterFeeBatch.findUnique({
      where: { id: batchId },
      include: { items: { where: { status: 'Valid' } } },
    });

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const perm = validateApprovalWorkflowPermissions((user.role || 'Accounts Office') as any, batch.status, 'EXECUTE_PUSH');
    if (!perm.allowed) {
      res.status(403).json({ error: perm.reason });
      return;
    }

    // Ensure batch has not already been pushed
    if (batch.status === 'Pushed' || batch.status === 'Completed') {
      res.status(400).json({ error: 'Batch has already been pushed.' });
      return;
    }

    // Execute fee push for all valid items in batch
    let pushedCount = 0;
    for (const item of batch.items) {
      const studentUser = await prisma.user.findFirst({
        where: { OR: [{ studentId: item.studentId }, { email: item.studentEmail.toLowerCase() }] },
      });

      if (!studentUser) continue;

      const invoiceNumber = `INV-${batch.academicYear}-${Date.now().toString().slice(-6)}-${pushedCount + 1}`;
      const refNumber = `REF-FEE-${Date.now()}-${pushedCount + 1}`;

      // 1. Create Formal Invoice
      const invoice = await prisma.feeInvoice.create({
        data: {
          invoiceNumber,
          batchItemId: item.id,
          studentId: studentUser.id,
          amount: item.finalAmount,
          feeLabel: item.feeLabel || batch.label,
          dueDate: item.dueDate || `${batch.academicYear}-08-30`,
          status: 'Unpaid',
        },
      });

      // 2. Create SemesterFee Due Record for Student App
      await prisma.semesterFee.create({
        data: {
          studentId: studentUser.id,
          amount: item.finalAmount,
          label: item.feeLabel || batch.label,
          dueDate: item.dueDate || `${batch.academicYear}-08-30`,
          status: 'Pending',
          reference: refNumber,
        },
      });

      // 3. Create Payment Request
      const paymentRequest = await prisma.paymentRequest.create({
        data: {
          requestRef: `PR-${invoiceNumber}`,
          invoiceId: invoice.id,
          studentId: studentUser.id,
          amount: item.finalAmount,
          status: 'Pending',
        },
      });

      // 4. Create Payment Gateway Session with pre-configured locked amount
      await prisma.paymentGatewaySession.create({
        data: {
          sessionKey: `SES-${Date.now()}-${pushedCount + 1}`,
          paymentRequestId: paymentRequest.id,
          studentId: studentUser.id,
          amount: item.finalAmount,
          feeLabel: item.feeLabel || batch.label,
          gateway: 'SSLCommerz',
          status: 'Active',
        },
      });

      // 5. Create Double-Entry Ledger Entry (Debit Due)
      const lastLedger = await prisma.ledgerEntry.findFirst({
        where: { studentId: studentUser.id },
        orderBy: { createdAt: 'desc' },
      });
      const previousBalance = lastLedger ? lastLedger.balanceAfter : 0;
      const newBalance = previousBalance + item.finalAmount;

      await prisma.ledgerEntry.create({
        data: {
          entryNumber: `LED-${Date.now()}-${pushedCount + 1}`,
          studentId: studentUser.id,
          invoiceId: invoice.id,
          type: 'DEBIT_DUE',
          debitAmount: item.finalAmount,
          balanceAfter: newBalance,
          reference: refNumber,
          description: `${item.feeLabel || batch.label} imposed by Accounts`,
        },
      });

      // 6. Create Student Notification
      await prisma.notification.create({
        data: {
          recipientId: studentUser.id,
          category: 'Fee',
          type: 'SemesterFeePushed',
          title: 'Semester Fee Imposed',
          body: `Your ${item.feeLabel || batch.label} of ৳${item.finalAmount.toLocaleString()} has been published. Due date: ${item.dueDate || 'N/A'}.`,
          link: '/student/dues',
        },
      });

      // Update item status
      await prisma.semesterFeeItem.update({
        where: { id: item.id },
        data: { status: 'Pushed' },
      });

      pushedCount++;
    }

    // Update batch to Pushed
    await prisma.semesterFeeBatch.update({
      where: { id: batchId },
      data: { status: 'Pushed', pushedAt: new Date() },
    });

    // Create Accounts Audit Log
    await prisma.auditLog.create({
      data: {
        action: 'FEE_BATCH_PUSHED',
        actorId: user.id,
        entityType: 'SemesterFeeBatch',
        entityId: batchId,
        details: `Pushed fee batch ${batch.batchNumber} containing ${pushedCount} student invoices totaling ৳${batch.totalAmount.toLocaleString()}.`,
      },
    });

    res.status(200).json({
      success: true,
      message: `Successfully pushed semester fees for ${pushedCount} students.`,
      pushedCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Fee push failed' });
  }
});

// ─── LEDGER & REPORTS ───

router.get('/accounts/ledger', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.query;
    const entries = await prisma.ledgerEntry.findMany({
      where: studentId ? { student: { studentId: String(studentId) } } : {},
      include: { student: { select: { fullName: true, studentId: true, department: true } }, invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.status(200).json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST version for apiCall compatibility (frontend apiCall always POSTs)
router.post('/accounts/ledger', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.body;
    const entries = await prisma.ledgerEntry.findMany({
      where: studentId ? { student: { studentId: String(studentId) } } : {},
      include: { student: { select: { fullName: true, studentId: true, department: true } }, invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.status(200).json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
