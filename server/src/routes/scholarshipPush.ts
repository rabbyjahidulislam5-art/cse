import { Router, Response } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth.js';
import {
  parseScholarshipRows, validateScholarshipRow, findMissingScholarshipColumns,
  generateScholarshipTemplateBuffer, executeScholarshipBatchPush, ScholarshipImportRowData,
} from '../lib/scholarshipService.js';
import { notifyUser } from '../lib/notify.js';
import prisma from '../lib/prisma.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Accounts Office pushes scholarships to students — same role gate as Fee Push
// (requireAccounts in routes/fees.ts), which lives under the same Accounts dashboard.
const requireAccounts = requireRole('Accounts Office', 'Admin Office');
router.use('/accounts/scholarship-push', authMiddleware, requireAccounts);

function getAuthUser(req: AuthRequest) {
  return req.user!;
}

// ─── TEMPLATE DOWNLOAD ───

router.get('/accounts/scholarship-push/template', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const buffer = await generateScholarshipTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="scholarship_push_template.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate template' });
  }
});

// ─── STEP 1: VALIDATE UPLOAD ───

router.post('/accounts/scholarship-push/validate', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let parsedRows: ScholarshipImportRowData[] = [];

    if (req.file) {
      const buffer = req.file.buffer;
      let raw: any[][] = [];
      if (req.file.originalname.endsWith('.csv')) {
        const text = buffer.toString('utf-8');
        raw = text.split('\n').map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        sheet.eachRow((row) => {
          raw.push((row.values as any[]).slice(1));
        });
      }

      const missingColumns = findMissingScholarshipColumns(raw);
      if (missingColumns.length > 0) {
        res.status(400).json({ error: `Missing required column(s): ${missingColumns.join(', ')}` });
        return;
      }
      parsedRows = parseScholarshipRows(raw);
    } else if (req.body.rows && Array.isArray(req.body.rows)) {
      parsedRows = req.body.rows;
    }

    if (parsedRows.length === 0) {
      res.status(400).json({ error: 'No valid data rows found in uploaded file' });
      return;
    }

    const existingStudents = await prisma.user.findMany({
      where: { role: 'Student' },
      select: { id: true, studentId: true, fullName: true, email: true, status: true },
    });

    const fileStudentIdsSeen = new Set<string>();
    let validCount = 0;
    let invalidCount = 0;
    let totalAmount = 0;
    const warnings: string[] = [];

    const validatedItems = parsedRows.map((row) => {
      const valRes = validateScholarshipRow(row, existingStudents, fileStudentIdsSeen);
      let status = 'Valid';
      if (!valRes.isValid) {
        status = valRes.errors.some(e => e.includes('Duplicate')) ? 'Duplicate' : 'Invalid';
        invalidCount++;
        warnings.push(`Student [${row.studentId || 'N/A'}]: ${valRes.errors.join(', ')}`);
      } else {
        validCount++;
        totalAmount += row.amount;
      }

      return { ...row, status, validationErrors: valRes.errors };
    });

    try {
      await prisma.auditLog.create({
        data: {
          action: 'SCHOLARSHIP_IMPORT_VALIDATED',
          actorId: getAuthUser(req).id,
          entityType: 'ScholarshipPushValidation',
          details: `Validated ${parsedRows.length} row(s): ${validCount} valid, ${invalidCount} invalid.`,
          ipAddress: req.ip,
        },
      });
    } catch { /* non-blocking */ }

    res.status(200).json({
      summary: {
        totalRows: parsedRows.length, validRows: validCount, invalidRows: invalidCount,
        totalAmount, warnings, canImport: invalidCount === 0,
      },
      items: validatedItems,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Validation failed' });
  }
});

// ─── STEP 2: SUBMIT BATCH ───

router.post('/accounts/scholarship-push/submit', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = getAuthUser(req);
    const { label, items = [] } = req.body;

    const batchNumber = `SPB-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    let validCount = 0;
    let invalidCount = 0;
    let totalAmount = 0;

    items.forEach((it: any) => {
      if (it.status === 'Valid') { validCount++; totalAmount += Number(it.amount) || 0; }
      else invalidCount++;
    });

    const batch = await prisma.scholarshipPushBatch.create({
      data: {
        batchNumber, label: label || null, status: 'Draft',
        totalRows: items.length, validRows: validCount, invalidRows: invalidCount, totalAmount,
        uploadedById: user.id,
        items: {
          create: items.map((it: any) => ({
            studentId: it.studentId,
            studentName: it.studentName || 'Student',
            studentEmail: it.studentEmail || '',
            amount: Number(it.amount) || 0,
            remark: it.remark || '',
            status: it.status || 'Valid',
            validationErrorsJson: it.validationErrors ? JSON.stringify(it.validationErrors) : null,
          })),
        },
      },
      include: { items: true },
    });

    await prisma.auditLog.create({
      data: {
        action: 'SCHOLARSHIP_BATCH_CREATED', actorId: user.id,
        entityType: 'ScholarshipPushBatch', entityId: batch.id,
        details: `Created scholarship batch ${batch.batchNumber} with ${validCount} valid row(s) totaling ৳${totalAmount.toLocaleString()}.`,
      },
    });

    res.status(200).json({ success: true, message: 'Batch created', batch });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to submit batch' });
  }
});

// ─── STEP 3: EXECUTE PUSH ───

router.post('/accounts/scholarship-push/push', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = getAuthUser(req);
    const { batchId } = req.body;

    const result = await executeScholarshipBatchPush(batchId, user.id);

    // Every pushed student is notified in-app + email — spec explicitly requires both channels
    // for Scholarship Push (unlike Fee Push, which sends no email today).
    for (const n of result.pushedNotifications) {
      void notifyUser({
        recipientId: n.studentId, category: 'wallet', type: 'scholarship.credited',
        title: 'Scholarship Credited', body: `A scholarship of ৳${n.amount.toLocaleString()} has been credited to your Campus Wallet. Reference: ${n.reference}.`,
        link: '/student/ledger',
        emailSubject: `Scholarship Credited — ৳${n.amount.toLocaleString()} — Smart Campus`,
      });
    }

    res.status(200).json({
      success: true, message: `Successfully credited scholarships for ${result.pushedCount} students.`,
      pushedCount: result.pushedCount, batchNumber: result.batchNumber, skippedReasons: result.skippedReasons,
    });
  } catch (err: any) {
    if (err.message === 'Batch not found') { res.status(404).json({ error: err.message }); return; }
    if (err.message?.includes('already been pushed')) { res.status(400).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message || 'Scholarship push failed' });
  }
});

export default router;
