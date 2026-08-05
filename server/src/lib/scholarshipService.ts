import ExcelJS from 'exceljs';
import prisma from './prisma';
import { matchStudent, matchStudentInDb, normalizeStudentId, MatchableUser } from './studentMatcher';

// Scholarship Push — Excel upload -> validate -> push, modeled on Fee Push's wizard
// (feeManagementService.ts / routes/fees.ts) but simpler: no Maker/Checker/Approver chain (the
// spec describes a direct Admin Office upload-and-credit flow, not a multi-stage approval one),
// and it credits the student's Wallet directly rather than only creating a due.

export interface ScholarshipImportRowData {
  studentId: string;
  studentName?: string;
  studentEmail?: string;
  amount: number;
  remark?: string;
}

export interface ScholarshipValidationResult {
  isValid: boolean;
  errors: string[];
}

type ScholarshipStudentCandidate = MatchableUser & { fullName: string | null; status: string };

// Checked before parseScholarshipRows for the same reason findMissingRequiredColumns exists in
// feeManagementService.ts — a malformed header would otherwise silently drop every row instead of
// surfacing a specific error.
export function findMissingScholarshipColumns(rows: any[][]): string[] {
  if (!rows || rows.length === 0) return ['Student ID', 'Amount'];
  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const missing: string[] = [];
  if (!header.some(h => h.includes('student id') || h === 'studentid' || h === 'id')) missing.push('Student ID');
  if (!header.some(h => h.includes('amount') || h.includes('scholarship'))) missing.push('Amount');
  return missing;
}

export function parseScholarshipRows(rows: any[][]): ScholarshipImportRowData[] {
  if (!rows || rows.length < 2) return [];

  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const studentIdIdx = header.findIndex(h => h.includes('student id') || h === 'studentid' || h === 'id');
  const nameIdx = header.findIndex(h => h.includes('name'));
  const emailIdx = header.findIndex(h => h.includes('email'));
  const amountIdx = header.findIndex(h => h.includes('amount') || h.includes('scholarship'));
  const remarkIdx = header.findIndex(h => h.includes('remark') || h.includes('note'));

  const result: ScholarshipImportRowData[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0 || !r[studentIdIdx]) continue;

    result.push({
      studentId: String(r[studentIdIdx] || '').trim(),
      studentName: nameIdx >= 0 ? String(r[nameIdx] || '').trim() : '',
      studentEmail: emailIdx >= 0 ? String(r[emailIdx] || '').trim() : '',
      // Keeps a leading minus sign so a negative input is actually parsed as negative and
      // rejected by the "Amount must be positive" check — the old [^0-9.] strip silently
      // discarded the sign first, turning e.g. "-100" into 100 and letting it through as valid.
      amount: amountIdx >= 0 ? parseFloat(String(r[amountIdx] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
      remark: remarkIdx >= 0 ? String(r[remarkIdx] || '').trim() : undefined,
    });
  }

  return result;
}

export function validateScholarshipRow(
  row: ScholarshipImportRowData,
  existingStudents: ScholarshipStudentCandidate[],
  fileStudentIdsSeen: Set<string>
): ScholarshipValidationResult {
  const errors: string[] = [];
  const studentId = (row.studentId || '').trim();

  if (!studentId) errors.push('Student ID is required');

  // Same shared, normalization-tolerant matcher Fee Push uses (studentId primary, email
  // fallback) — see studentMatcher.ts.
  const matchResult = matchStudent({ studentId, email: row.studentEmail }, existingStudents);
  if (matchResult.matched === false && matchResult.reason === 'ambiguous') {
    errors.push('Ambiguous student match — multiple accounts found');
  } else if (!matchResult.matched) {
    errors.push('Student ID does not exist');
  } else if (matchResult.user.status !== 'Active') {
    errors.push('Student account is inactive or locked');
  }

  const amount = Number(row.amount);
  if (isNaN(amount) || amount <= 0) errors.push('Amount must be positive');

  const normId = normalizeStudentId(studentId);
  if (normId) {
    if (fileStudentIdsSeen.has(normId)) errors.push('Duplicate student entry in file');
    else fileStudentIdsSeen.add(normId);
  }

  return { isValid: errors.length === 0, errors };
}

export async function generateScholarshipTemplateBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Scholarship Push Template');

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 20 },
    { header: 'Student Name', key: 'studentName', width: 24 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Remark', key: 'remark', width: 30 },
  ];

  sheet.addRow({
    studentId: 'STU-2026-001', studentName: 'Jahidul Islam',
    email: 'stu-2026-001@std.ewubd.edu', amount: 10000, remark: 'Merit Scholarship — Fall 2026',
  });

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface ScholarshipPushResult {
  pushedCount: number;
  batchNumber: string;
  skippedReasons: string[];
  // Collected during the transaction, notified after it commits by the caller — notifyUser()
  // always uses the top-level prisma singleton internally and can't participate in a txClient's
  // transaction, so notification dispatch is deliberately left to the route (an HTTP-layer
  // concern), keeping this function's own responsibility limited to the money-movement.
  pushedNotifications: Array<{ studentId: string; amount: number; reference: string }>;
}

// The actual push-execution transaction, factored out of the route so it's directly unit/
// integration-testable (mirrors settlement.ts's markItemPaid/getOutstandingDues pattern) rather
// than only reachable by re-implementing the same steps inside a test.
export async function executeScholarshipBatchPush(batchId: string, actorUserId: string): Promise<ScholarshipPushResult> {
  const batch = await prisma.scholarshipPushBatch.findUnique({
    where: { id: batchId },
    include: { items: { where: { status: 'Valid' } } },
  });
  if (!batch) throw new Error('Batch not found');
  if (batch.status === 'Pushed') throw new Error('Batch has already been pushed.');
  if (batch.status === 'Pushing') throw new Error('This batch is already being pushed by another request.');

  // Atomically claim the batch before starting the expensive per-item transaction below — the
  // same race Fee Push hit live during QA testing (two near-simultaneous push requests both
  // reading the same pre-push status and both starting their own $transaction against the same
  // rows). Guarded on the exact status just read so only one concurrent caller can win the claim;
  // the existing catch block below already sets 'Failed' on any error, so a failed push is never
  // left stuck at 'Pushing'.
  const claim = await prisma.scholarshipPushBatch.updateMany({
    where: { id: batchId, status: batch.status },
    data: { status: 'Pushing' },
  });
  if (claim.count === 0) throw new Error('This batch is already being pushed by another request.');

  const skippedReasons: string[] = [];
  const pushedNotifications: Array<{ studentId: string; amount: number; reference: string }> = [];

  try {
    // Explicit generous timeout — this transaction loops every item in the batch (multiple
    // sequential round-trips each) over Neon's serverless connection, which has real cold-start
    // latency; the same { timeout, maxWait } this codebase already uses for its other multi-step
    // production transactions (server/src/index.ts's SSLCommerz confirm and settlement processing).
    // Bumped from 30s to 60s alongside Fee Push's identical constant, after live QA testing found
    // a full 20-item Fee Push batch (the same batch-loop shape) could exceed 30s on its own.
    const pushedCount = await prisma.$transaction(async (txClient) => {
      let count = 0;
      for (const item of batch.items) {
        const matchResult = await matchStudentInDb({ studentId: item.studentId, email: item.studentEmail }, txClient);

        if (!matchResult.matched) {
          const reason = matchResult.reason === 'ambiguous'
            ? 'Ambiguous match — multiple accounts matched this row'
            : 'Student record not found';
          skippedReasons.push(`${item.studentId}: ${reason}`);
          await txClient.scholarshipPushItem.update({
            where: { id: item.id },
            data: { status: 'Error', validationErrorsJson: JSON.stringify([reason]) },
          });
          continue;
        }

        const studentUser = matchResult.user;
        const txReference = `SCH-${Date.now()}-${count + 1}`;

        // Wallet-credit pattern reused verbatim from confirmSslPayment()'s wallet_topup branch
        // (server/src/index.ts) — Scholarship Push actually deposits money, unlike Fee Push.
        const wallet = await txClient.wallet.findFirst({ where: { ownerId: studentUser.id } });
        const balanceBefore = wallet?.balance || 0;
        if (wallet) {
          await txClient.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: item.amount } } });
        } else {
          await txClient.wallet.create({ data: { walletId: `W-${studentUser.id.slice(0, 8)}`, ownerId: studentUser.id, balance: item.amount } });
        }

        await txClient.transaction.create({
          data: {
            reference: txReference, userId: studentUser.id, type: 'Scholarship Credit', direction: 'Credit',
            amount: item.amount, status: 'Success', gateway: 'Scholarship', purpose: 'scholarship_credit',
            description: item.remark || 'Scholarship Credit',
            balanceBefore, balanceAfter: balanceBefore + item.amount,
          },
        });

        await txClient.auditLog.create({
          data: {
            action: 'Scholarship Credited', actorId: actorUserId, entityType: 'ScholarshipPushItem', entityId: item.id,
            details: `Credited ৳${item.amount.toLocaleString()} scholarship to student (batch ${batch.batchNumber}). Reference: ${txReference}.`,
          },
        });

        await txClient.scholarshipPushItem.update({
          where: { id: item.id },
          data: { status: 'Pushed', matchedUserId: studentUser.id, transactionReference: txReference },
        });

        pushedNotifications.push({ studentId: studentUser.id, amount: item.amount, reference: txReference });
        count++;
      }

      await txClient.scholarshipPushBatch.update({
        where: { id: batchId },
        data: { status: 'Pushed', pushedAt: new Date() },
      });

      return count;
    }, { timeout: 60000, maxWait: 15000 });

    await prisma.auditLog.create({
      data: {
        action: 'SCHOLARSHIP_BATCH_PUSHED', actorId: actorUserId,
        entityType: 'ScholarshipPushBatch', entityId: batchId,
        details: `Pushed scholarship batch ${batch.batchNumber}: ${pushedCount} student(s) credited.${skippedReasons.length ? ` Skipped: ${skippedReasons.join('; ')}` : ''}`,
      },
    });

    return { pushedCount, batchNumber: batch.batchNumber, skippedReasons, pushedNotifications };
  } catch (pushErr: any) {
    await prisma.scholarshipPushBatch.update({ where: { id: batchId }, data: { status: 'Failed' } }).catch(() => {});
    try {
      await prisma.auditLog.create({
        data: {
          action: 'SCHOLARSHIP_BATCH_PUSH_FAILED', actorId: actorUserId,
          entityType: 'ScholarshipPushBatch', entityId: batchId,
          details: `Scholarship push failed for batch ${batch.batchNumber}: ${pushErr.message || 'Unknown error'}`,
        },
      });
    } catch { /* non-blocking */ }
    throw pushErr;
  }
}
