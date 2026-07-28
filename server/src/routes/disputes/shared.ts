import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import prisma from '../../lib/prisma';
import { authMiddleware, AuthRequest } from '../../lib/auth';
import { validateAttachment, sanitizeFilename, sha256Hex, scanFile, MAX_ATTACHMENT_BYTES } from '../../lib/disputes/fileValidation';
import { processWalletRefund, recordManualAdjustment } from '../../lib/disputes/refundLedger';
import { notify } from '../../lib/disputes/notify';
import { emitToDisputeRoom } from '../../lib/disputes/realtimeBus';

// ─── Shared vocabulary (TS union types, matching this schema's existing convention of plain
// String status columns validated in application code rather than native Prisma enums) ───

export const DISPUTE_CATEGORIES = [
  'Wrong Receiver', 'Wrong Amount', 'Duplicate Payment', 'Merchant Issue',
  'Service Not Received', 'Failed Service', 'Payment Success But Not Reflected',
  'Accidental Payment', 'Fraud', 'Other',
] as const;
export type DisputeCategory = typeof DISPUTE_CATEGORIES[number];

export const DISPUTE_STATUSES = [
  'Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary',
  'WaitingForAdmin', 'Resolved', 'Rejected', 'Refunded', 'Closed',
] as const;
export type DisputeStatus = typeof DISPUTE_STATUSES[number];

export const REFUND_METHODS = ['WalletCredit', 'OriginalPayment', 'ManualAdjustment'] as const;
export type RefundMethod = typeof REFUND_METHODS[number];

export const MIN_DESCRIPTION_LENGTH = 30;

// Same per-user-or-IP keying convention as paymentInitLimiter/disputeActionLimiter — shared by
// every staff role's write-side dispute action (reply, status changes, refund actions), so none
// of the four route files (accounts/admin/library/shop) needs its own copy.
export const staffDisputeActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.user?.id || ipKeyGenerator(req.ip || 'unknown'),
  message: { message: 'Too many actions in a short time. Please wait a moment and try again.' },
});

export const OPEN_STATUSES: DisputeStatus[] = ['Open', 'Investigating', 'WaitingForStudent', 'WaitingForShop', 'WaitingForLibrary', 'WaitingForAdmin'];
export const TERMINAL_STATUSES: DisputeStatus[] = ['Resolved', 'Rejected', 'Refunded', 'Closed'];

// Refunds at or above this amount need Admin sign-off before money moves — mirrors the PIN/OTP
// tiered-authorization threshold already used for outbound payments platform-wide.
export const REFUND_APPROVAL_THRESHOLD = 20000;

// ─── Attachments ───
// Memory storage (not the existing disk-storage `upload` instance in index.ts) because the raw
// buffer is needed for magic-byte sniffing and hashing before deciding where — or whether — to
// write it to disk.
export const disputeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } });

const DISPUTE_UPLOAD_DIR = path.join(__dirname, '../../../uploads/disputes');

export async function saveDisputeAttachment(opts: {
  disputeId: string; uploadedById: string; messageId?: string; originalName: string; buffer: Buffer;
}) {
  const validation = validateAttachment(opts.originalName, opts.buffer);
  if (!validation.ok) {
    const err: any = new Error(validation.reason || 'Invalid file.');
    err.statusCode = 400;
    throw err;
  }

  const dir = path.join(DISPUTE_UPLOAD_DIR, opts.disputeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sanitizeFilename(opts.originalName)}`;
  fs.writeFileSync(path.join(dir, storedName), opts.buffer);

  const scanStatus = await scanFile(opts.buffer, validation.mimeType!);

  return prisma.disputeAttachment.create({
    data: {
      disputeId: opts.disputeId, messageId: opts.messageId, uploadedById: opts.uploadedById,
      originalName: opts.originalName, storedName, mimeType: validation.mimeType!,
      sizeBytes: opts.buffer.length, sha256: sha256Hex(opts.buffer), scanStatus,
      scannedAt: scanStatus !== 'pending' ? new Date() : null,
    },
  });
}

export function disputeAttachmentUrl(disputeId: string, storedName: string): string {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  return `${backendUrl}/uploads/disputes/${disputeId}/${storedName}`;
}

// ─── Timeline / status-history helpers, reused by every role's route file ───

export async function recordTimeline(disputeId: string, eventType: string, actorId: string | null, summary: string, metadata?: Record<string, unknown>) {
  const row = await prisma.disputeTimeline.create({
    data: { disputeId, eventType, actorId: actorId || undefined, summary, metadataJson: metadata ? JSON.stringify(metadata) : undefined },
  });
  // Live push to anyone with this case's detail page open (student or staff) — independent of the
  // per-recipient DisputeNotification bell, which only fires for whoever notify() explicitly targets.
  emitToDisputeRoom(disputeId, 'dispute:timeline', { id: row.id, eventType: row.eventType, summary: row.summary, createdAt: row.createdAt });
  return row;
}

// Atomically updates Dispute.status, writes the immutable DisputeStatusHistory row, and appends a
// DisputeTimeline entry — every status transition in the system should go through this rather than
// a bare `dispute.update()`, so the audit trail can never drift out of sync with the live status.
export async function changeDisputeStatus(disputeId: string, toStatus: DisputeStatus, changedById: string, reason?: string) {
  return prisma.$transaction(async (txClient) => {
    const dispute = await txClient.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new Error('DISPUTE_NOT_FOUND');
    const fromStatus = dispute.status;

    // No-op transitions (e.g. a second staff reply while already WaitingForStudent) shouldn't
    // pollute the status-history/timeline with a same-to-same entry.
    if (fromStatus === toStatus) return dispute;

    const extra: Record<string, unknown> = {};
    if (toStatus === 'Resolved' || toStatus === 'Refunded') extra.resolvedAt = new Date();
    if (toStatus === 'Closed') extra.closedAt = new Date();

    const updated = await txClient.dispute.update({ where: { id: disputeId }, data: { status: toStatus, ...extra } });
    await txClient.disputeStatusHistory.create({ data: { disputeId, fromStatus, toStatus, changedById, reason } });
    await txClient.disputeTimeline.create({
      data: { disputeId, eventType: 'status_change', actorId: changedById, summary: `Status changed from ${fromStatus} to ${toStatus}${reason ? `: ${reason}` : ''}` },
    });

    return updated;
  });
}

// ─── Transaction detail assembly — the data behind the expandable payment card, shared by every
// role's view of a transaction (fields not relevant to a given role are simply not sent by that
// role's route, not filtered here — this function assembles everything that exists). ───

interface CounterpartInfo {
  kind: 'user' | 'shop' | 'self';
  id: string;
  name: string;
  role?: string | null;
  department?: string | null;
  category?: string;
}

export async function assembleTransactionDetail(transactionId: string, opts: { includeRawCallbacks?: boolean } = {}) {
  const tx = await prisma.transaction.findFirst({
    where: { OR: [{ id: transactionId }, { reference: transactionId }] },
    include: {
      user: true,
      shop: true,
      receiver: true,
      callbacks: { orderBy: { createdAt: 'desc' } },
      disputes: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!tx) return null;

  let sender: CounterpartInfo | null = tx.user
    ? { kind: 'user', id: tx.user.id, name: tx.user.fullName || tx.user.email, role: tx.user.role, department: tx.user.department }
    : null;
  let receiver: CounterpartInfo | null = null;

  if (tx.shop) {
    receiver = { kind: 'shop', id: tx.shop.id, name: tx.shop.name, category: tx.shop.category };
  } else if (tx.receiver) {
    receiver = {
      kind: 'user', id: tx.receiver.id, name: tx.receiver.fullName || tx.receiver.email,
      role: tx.receiverRoleSnapshot || tx.receiver.role, department: tx.receiverDepartmentSnapshot || tx.receiver.department,
    };
  } else if (tx.type === 'Transfer Sent') {
    const sibling = await prisma.transaction.findFirst({ where: { reference: `${tx.reference}-R` }, include: { user: true } });
    if (sibling?.user) {
      receiver = { kind: 'user', id: sibling.user.id, name: sibling.user.fullName || sibling.user.email, role: sibling.user.role, department: sibling.user.department };
    }
  } else if (tx.type === 'Transfer Received' && tx.reference.endsWith('-R')) {
    const originalRef = tx.reference.slice(0, -2);
    const original = await prisma.transaction.findFirst({ where: { reference: originalRef }, include: { user: true } });
    if (original?.user) {
      sender = { kind: 'user', id: original.user.id, name: original.user.fullName || original.user.email, role: original.user.role, department: original.user.department };
    }
    receiver = tx.user ? { kind: 'self', id: tx.user.id, name: tx.user.fullName || tx.user.email } : null;
  }

  const successfulCallback = tx.callbacks.find(c => c.verified && (c.sslStatus === 'VALID' || c.sslStatus === 'VALIDATED'));

  return {
    transaction: {
      id: tx.id, reference: tx.reference, type: tx.type, direction: tx.direction, amount: tx.amount,
      serviceCharge: tx.serviceCharge, status: tx.status, description: tx.description,
      paymentMethod: tx.paymentMethod, purpose: tx.purpose, createdAt: tx.createdAt, updatedAt: tx.updatedAt,
      balanceBefore: tx.balanceBefore, balanceAfter: tx.balanceAfter,
      ipAddress: tx.ipAddress, deviceInfo: tx.deviceInfo,
      ownerUserId: tx.userId, receiverUserId: tx.receiverId,
    },
    sender,
    receiver,
    gateway: tx.gateway ? {
      provider: tx.gateway,
      tranId: tx.reference,
      bankTranId: tx.bankTxnId,
      validationId: tx.gatewayTxnId,
      confirmedVia: successfulCallback?.source || null,
      callbacks: opts.includeRawCallbacks
        ? tx.callbacks.map(c => ({ id: c.id, source: c.source, sslStatus: c.sslStatus, verified: c.verified, rawPayload: c.rawPayload, createdAt: c.createdAt }))
        : tx.callbacks.map(c => ({ id: c.id, source: c.source, sslStatus: c.sslStatus, verified: c.verified, createdAt: c.createdAt })),
    } : null,
    dispute: tx.disputes[0] ? { id: tx.disputes[0].id, caseNumber: tx.disputes[0].caseNumber, status: tx.disputes[0].status } : null,
  };
}

// ─── Risk scoring — a simple, transparent heuristic (not a black box), computed live from a
// student's own dispute history. No ML model, no external service — just weighted signals that
// are easy to audit and explain to a human reviewer. Shared by every staff role's case detail. ───
export async function computeRiskScore(studentId: string) {
  const [total, rejected, fraudCategory, recentCount, user] = await Promise.all([
    prisma.dispute.count({ where: { raisedById: studentId, deletedAt: null } }),
    prisma.dispute.count({ where: { raisedById: studentId, status: 'Rejected', deletedAt: null } }),
    prisma.dispute.count({ where: { raisedById: studentId, category: 'Fraud', deletedAt: null } }),
    prisma.dispute.count({ where: { raisedById: studentId, createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, deletedAt: null } }),
    prisma.user.findUnique({ where: { id: studentId }, select: { flagged: true } }),
  ]);
  let score = 0;
  const factors: string[] = [];
  if (total > 0) {
    const rejectRate = rejected / total;
    if (rejectRate > 0.5 && total >= 2) { score += 40; factors.push(`${Math.round(rejectRate * 100)}% of past cases rejected`); }
  }
  if (recentCount >= 3) { score += 25; factors.push(`${recentCount} cases raised in the last 90 days`); }
  if (fraudCategory > 0) { score += 15; factors.push(`${fraudCategory} fraud-category case(s)`); }
  if (user?.flagged) { score += 20; factors.push('Account flagged by Admin'); }
  return { score: Math.min(100, score), factors, totalCases: total, rejectedCases: rejected };
}

// Full staff-facing case detail: payment info, SSLCommerz/gateway logs, student profile, previous
// cases, risk score, related transactions, audit log. Shared by every staff role (Accounts, Admin,
// Library, Shop) so the four route files don't each re-implement this ~60-line assembly.
export async function assembleDisputeDetail(disputeId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      raisedBy: true,
      assignedTo: { select: { fullName: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { fullName: true, role: true } }, attachments: true } },
      attachments: { where: { messageId: null } },
      timeline: { orderBy: { createdAt: 'asc' } },
      statusHistory: { orderBy: { createdAt: 'asc' }, include: { changedBy: { select: { fullName: true } } } },
      refunds: { orderBy: { createdAt: 'desc' }, include: { approvals: true } },
      assignments: { orderBy: { createdAt: 'asc' }, include: { assignedTo: { select: { fullName: true } }, assignedBy: { select: { fullName: true } } } },
    },
  });
  if (!dispute || dispute.deletedAt) return null;

  const [transactionDetail, previousCases, relatedTransactions, risk, auditLogs] = await Promise.all([
    assembleTransactionDetail(dispute.transactionId, { includeRawCallbacks: true }),
    prisma.dispute.findMany({ where: { raisedById: dispute.raisedById, id: { not: dispute.id }, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, caseNumber: true, category: true, status: true, createdAt: true } }),
    prisma.transaction.findMany({ where: { userId: dispute.raisedById }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, reference: true, type: true, amount: true, status: true, createdAt: true } }),
    computeRiskScore(dispute.raisedById),
    prisma.auditLog.findMany({ where: { entityType: 'Dispute', entityId: dispute.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  return {
    dispute: {
      id: dispute.id, caseNumber: dispute.caseNumber, category: dispute.category, description: dispute.description,
      status: dispute.status, priority: dispute.priority, riskScore: dispute.riskScore, slaDueAt: dispute.slaDueAt,
      frozen: dispute.frozen, frozenAt: dispute.frozenAt, assignedToName: dispute.assignedTo?.fullName || null,
      assignedToId: dispute.assignedToId, createdAt: dispute.createdAt, resolvedAt: dispute.resolvedAt, closedAt: dispute.closedAt,
      mergedIntoId: dispute.mergedIntoId, splitFromId: dispute.splitFromId,
    },
    student: {
      id: dispute.raisedBy.id, fullName: dispute.raisedBy.fullName, email: dispute.raisedBy.email,
      studentId: dispute.raisedBy.studentId, department: dispute.raisedBy.department, batch: dispute.raisedBy.batch,
      status: dispute.raisedBy.status, flagged: dispute.raisedBy.flagged, flagReason: dispute.raisedBy.flagReason,
    },
    transaction: transactionDetail,
    messages: dispute.messages.map(m => ({
      id: m.id, body: m.body, isInternal: m.isInternal, authorName: m.author.fullName || 'Unknown', authorRole: m.author.role, createdAt: m.createdAt,
      attachments: m.attachments.map(a => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, scanStatus: a.scanStatus })),
    })),
    attachments: dispute.attachments.map(a => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, scanStatus: a.scanStatus, createdAt: a.createdAt })),
    timeline: dispute.timeline.map(t => ({ id: t.id, eventType: t.eventType, summary: t.summary, createdAt: t.createdAt })),
    statusHistory: dispute.statusHistory.map(s => ({ id: s.id, fromStatus: s.fromStatus, toStatus: s.toStatus, reason: s.reason, changedByName: s.changedBy.fullName, createdAt: s.createdAt })),
    refunds: dispute.refunds.map(r => ({ id: r.id, method: r.method, amountType: r.amountType, amount: r.amount, status: r.status, reversalTransactionId: r.reversalTransactionId, notes: r.notes, createdAt: r.createdAt, processedAt: r.processedAt, approvals: r.approvals })),
    assignments: dispute.assignments.map(a => ({ id: a.id, assignedToName: a.assignedTo.fullName, assignedByName: a.assignedBy.fullName, note: a.note, createdAt: a.createdAt })),
    auditLogs: auditLogs.map(a => ({ id: a.id, action: a.action, details: a.details, ipAddress: a.ipAddress, createdAt: a.createdAt })),
    previousCases, relatedTransactions, risk,
  };
}

// Returns true if the given user is the payer or the receiver of the transaction (or, for the two
// legs of a P2P transfer, the counterpart via the shared reference) — the ownership check every
// student-facing dispute route needs before showing/creating anything for a transaction.
export async function userOwnsTransaction(userId: string, tx: { id: string; userId: string; receiverId: string | null; reference: string; type: string }): Promise<boolean> {
  if (tx.userId === userId || tx.receiverId === userId) return true;
  if (tx.type === 'Transfer Sent') {
    const sibling = await prisma.transaction.findFirst({ where: { reference: `${tx.reference}-R` } });
    if (sibling?.userId === userId) return true;
  }
  if (tx.type === 'Transfer Received' && tx.reference.endsWith('-R')) {
    const original = await prisma.transaction.findFirst({ where: { reference: tx.reference.slice(0, -2) } });
    if (original?.userId === userId) return true;
  }
  return false;
}

// ─── Dispute Summary PDF — same generate-once-and-cache pattern as generateReceiptPdf() in
// index.ts, reusing the already-installed `pdfkit` dependency. ───
const DISPUTE_PDF_DIR = path.join(__dirname, '../../../uploads/dispute-pdfs');

export async function generateDisputeSummaryPdf(dispute: {
  id: string; caseNumber: string; category: string; status: string; description: string; createdAt: Date; resolvedAt: Date | null;
  raisedBy: { fullName: string | null; studentId: string | null } | null;
  transaction: { reference: string; amount: number; type: string; createdAt: Date } | null;
}): Promise<string> {
  if (!fs.existsSync(DISPUTE_PDF_DIR)) fs.mkdirSync(DISPUTE_PDF_DIR, { recursive: true });
  const filePath = path.join(DISPUTE_PDF_DIR, `${dispute.caseNumber}.pdf`);
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

  if (!fs.existsSync(filePath)) {
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(18).font('Helvetica-Bold').text('Smart Campus — Dispute Case Summary', { align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('Financial Dispute & Case Management System', { align: 'center' });
      doc.moveDown(1.5).fillColor('#000');

      const rows: [string, string][] = [
        ['Case Number', dispute.caseNumber],
        ['Category', dispute.category],
        ['Status', dispute.status],
        ['Raised By', `${dispute.raisedBy?.fullName || 'Student'} (${dispute.raisedBy?.studentId || 'N/A'})`],
        ['Transaction Reference', dispute.transaction?.reference || 'N/A'],
        ['Transaction Type', dispute.transaction?.type || 'N/A'],
        ['Transaction Amount', dispute.transaction ? `৳${dispute.transaction.amount.toLocaleString()}` : 'N/A'],
        ['Case Opened', dispute.createdAt.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })],
        ['Case Resolved', dispute.resolvedAt ? dispute.resolvedAt.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }) : 'Not yet resolved'],
      ];
      for (const [label, value] of rows) {
        doc.font('Helvetica-Bold').text(label, { continued: true, width: 220 });
        doc.font('Helvetica').text(`  ${value}`);
        doc.moveDown(0.5);
      }

      doc.moveDown(1).font('Helvetica-Bold').text('Description');
      doc.font('Helvetica').text(dispute.description, { width: 495 });

      doc.moveDown(2).fontSize(8).fillColor('#999').text('This is a system-generated case summary. For the full conversation and audit timeline, sign in to Smart Campus.', { align: 'center' });

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  return `${backendUrl}/uploads/dispute-pdfs/${dispute.caseNumber}.pdf`;
}

// ─── Reports — CSV (zero-dependency), Excel (exceljs), PDF (pdfkit, same cached-file pattern as
// generateReceiptPdf in index.ts). Shared by Accounts and Admin so both "Generate Report" actions
// produce identical, consistently-formatted exports. ───
const REPORT_DIR = path.join(__dirname, '../../../uploads/dispute-reports');

async function fetchReportRows(status?: string, fromDate?: string, toDate?: string) {
  const where: any = { deletedAt: null };
  if (status && status !== 'all') where.status = status;
  if (fromDate || toDate) where.createdAt = { ...(fromDate ? { gte: new Date(fromDate) } : {}), ...(toDate ? { lte: new Date(toDate) } : {}) };
  return prisma.dispute.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 2000,
    include: { raisedBy: { select: { fullName: true, studentId: true } }, transaction: { select: { reference: true, amount: true, type: true } }, refunds: { select: { amount: true, status: true } } },
  });
}

export async function generateDisputeReportFile(format: 'csv' | 'excel' | 'pdf', status?: string, fromDate?: string, toDate?: string): Promise<string> {
  const rows = await fetchReportRows(status, fromDate, toDate);
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  const filename = `dispute-report-${Date.now()}`;

  if (format === 'csv') {
    const header = ['Case Number', 'Category', 'Status', 'Student', 'Student ID', 'Transaction Ref', 'Amount', 'Refunded', 'Created At'];
    const escape = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(escape).join(',')];
    for (const d of rows) {
      const refunded = d.refunds.filter(r => r.status === 'Processed').reduce((s, r) => s + r.amount, 0);
      lines.push([d.caseNumber, d.category, d.status, d.raisedBy?.fullName || '', d.raisedBy?.studentId || '', d.transaction?.reference || '', d.transaction?.amount ?? '', refunded, d.createdAt.toISOString()].map(escape).join(','));
    }
    const filePath = path.join(REPORT_DIR, `${filename}.csv`);
    fs.writeFileSync(filePath, lines.join('\n'));
    return `${backendUrl}/uploads/dispute-reports/${filename}.csv`;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Disputes');
    sheet.columns = [
      { header: 'Case Number', key: 'caseNumber', width: 20 }, { header: 'Category', key: 'category', width: 24 },
      { header: 'Status', key: 'status', width: 16 }, { header: 'Student', key: 'student', width: 22 },
      { header: 'Student ID', key: 'studentId', width: 16 }, { header: 'Transaction Ref', key: 'ref', width: 20 },
      { header: 'Amount', key: 'amount', width: 14 }, { header: 'Refunded', key: 'refunded', width: 14 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const d of rows) {
      const refunded = d.refunds.filter(r => r.status === 'Processed').reduce((s, r) => s + r.amount, 0);
      sheet.addRow({ caseNumber: d.caseNumber, category: d.category, status: d.status, student: d.raisedBy?.fullName || '', studentId: d.raisedBy?.studentId || '', ref: d.transaction?.reference || '', amount: d.transaction?.amount ?? '', refunded, createdAt: d.createdAt.toISOString() });
    }
    const filePath = path.join(REPORT_DIR, `${filename}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return `${backendUrl}/uploads/dispute-reports/${filename}.xlsx`;
  }

  // PDF — a simple tabular summary report.
  const filePath = path.join(REPORT_DIR, `${filename}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(16).font('Helvetica-Bold').text('Smart Campus — Dispute Report', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })} — ${rows.length} case(s)`, { align: 'center' });
    doc.moveDown(1).fillColor('#000');
    const colX = [40, 160, 320, 400, 490, 580, 680, 760];
    const headers = ['Case #', 'Category', 'Status', 'Student', 'Ref', 'Amount', 'Refunded', 'Date'];
    doc.font('Helvetica-Bold').fontSize(8);
    headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 820) - colX[i], continued: false }));
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(7.5);
    for (const d of rows) {
      const refunded = d.refunds.filter(r => r.status === 'Processed').reduce((s, r) => s + r.amount, 0);
      const y = doc.y;
      const vals = [d.caseNumber, d.category.slice(0, 20), d.status, (d.raisedBy?.fullName || '').slice(0, 14), d.transaction?.reference || '', String(d.transaction?.amount ?? ''), String(refunded), d.createdAt.toLocaleDateString()];
      vals.forEach((v, i) => doc.text(v, colX[i], y, { width: (colX[i + 1] || 820) - colX[i] }));
      doc.moveDown(0.4);
      if (doc.y > 520) doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
    }
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return `${backendUrl}/uploads/dispute-reports/${filename}.pdf`;
}

// ─── Role-agnostic notification bell endpoints — always keyed by req.user.id, so one router
// serves the student, accounts, admin, shop, and library layouts alike. ───
export const disputeNotificationsRouter = express.Router();

disputeNotificationsRouter.post('/disputes/notifications', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [items, unreadCount] = await Promise.all([
      prisma.disputeNotification.findMany({ where: { recipientId: userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.disputeNotification.count({ where: { recipientId: userId, readAt: null } }),
    ]);
    res.json({ notifications: items, unreadCount });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

disputeNotificationsRouter.post('/disputes/notifications/mark-read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { notificationId, disputeId } = req.body as { notificationId?: string; disputeId?: string };
    const where: any = { recipientId: userId, readAt: null };
    if (notificationId) where.id = notificationId;
    if (disputeId) where.disputeId = disputeId;
    await prisma.disputeNotification.updateMany({ where, data: { readAt: new Date() } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Refund finalization — dispatches to the right ledger function (wallet vs. manual), then
// moves the case to Refunded and notifies the payer. Shared by Accounts' below-threshold
// auto-process path and Admin's approve-then-process path, so both funnel through one place. ───
export async function finalizeRefund(opts: {
  refund: { id: string; method: RefundMethod; amount: number; disputeId: string };
  transactionId: string; recipientUserId: string; processedById: string; notes?: string; ipAddress?: string; caseNumber: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (opts.refund.method === 'WalletCredit') {
      await processWalletRefund({
        refundId: opts.refund.id, transactionId: opts.transactionId, disputeId: opts.refund.disputeId,
        recipientUserId: opts.recipientUserId, amount: opts.refund.amount, processedById: opts.processedById, ipAddress: opts.ipAddress,
      });
    } else {
      await recordManualAdjustment({
        refundId: opts.refund.id, transactionId: opts.transactionId, disputeId: opts.refund.disputeId,
        amount: opts.refund.amount, processedById: opts.processedById, notes: opts.notes, ipAddress: opts.ipAddress,
      });
    }
  } catch (e: any) {
    await prisma.refund.update({ where: { id: opts.refund.id }, data: { status: 'Rejected', notes: `Auto-failed: ${e.message}` } });
    return { ok: false, message: e.message === 'WALLET_NOT_FOUND' ? 'Payer has no wallet on file.' : 'Refund could not be processed.' };
  }

  await changeDisputeStatus(opts.refund.disputeId, 'Refunded', opts.processedById, `Refunded ৳${opts.refund.amount.toLocaleString()} (${opts.refund.method})`);
  await notify({
    disputeId: opts.refund.disputeId, recipientId: opts.recipientUserId, type: 'refund_processed', title: `Refund processed — ${opts.caseNumber}`,
    body: `Your ৳${opts.refund.amount.toLocaleString()} refund for case ${opts.caseNumber} has been processed.`,
    emailSubject: `Refund processed for ${opts.caseNumber} — Smart Campus`,
  });
  return { ok: true };
}

// Backs the "Pending Cases" / "Unread Replies" top-nav badges for every role.
disputeNotificationsRouter.post('/disputes/badge-counts', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;
    const unreadReplies = await prisma.disputeNotification.count({ where: { recipientId: userId, readAt: null } });

    let pendingCases = 0;
    if (role === 'Accounts Office') {
      pendingCases = await prisma.dispute.count({ where: { status: { in: ['Open', 'Investigating', 'WaitingForStudent'] }, deletedAt: null } });
    } else if (role === 'Shop Staff') {
      pendingCases = await prisma.dispute.count({ where: { status: 'WaitingForShop', deletedAt: null } });
    } else if (role === 'Library') {
      pendingCases = await prisma.dispute.count({ where: { status: 'WaitingForLibrary', deletedAt: null } });
    } else if (role === 'Admin Office') {
      pendingCases = await prisma.dispute.count({ where: { status: 'WaitingForAdmin', deletedAt: null } });
    }

    res.json({ unreadReplies, pendingCases });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
