import prisma from './prisma';
import { getOutstandingDues, isFinanciallyRestricted } from './settlement';

// Accounts Office's unified per-student financial profile — a new, purely additive composing
// function layered on top of the existing settlement.ts building blocks. Deliberately does NOT
// modify getOutstandingDues()'s return shape (other callers already depend on it as-is); this just
// calls it alongside a few more read-only queries and assembles one consolidated view.

const DEFAULT_TX_PAGE_SIZE = 20;
const HISTORY_TAKE = 100;

export async function getStudentFinancialProfile(studentDbId: string, opts: { txPage?: number; txPageSize?: number } = {}) {
  const txPage = Math.max(Number(opts.txPage) || 1, 1);
  const txPageSize = Math.min(Math.max(Number(opts.txPageSize) || DEFAULT_TX_PAGE_SIZE, 1), 100);

  const [
    user, wallet, outstanding, restriction,
    transactions, transactionsTotal,
    paidSemesterFees, paidLibraryFines, paidAdminFines, paidPayLaterDues,
    scholarshipCredits,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentDbId } }),
    prisma.wallet.findFirst({ where: { ownerId: studentDbId } }),
    getOutstandingDues(studentDbId),
    isFinanciallyRestricted(studentDbId),
    prisma.transaction.findMany({
      where: { userId: studentDbId }, orderBy: { createdAt: 'desc' },
      take: txPageSize, skip: (txPage - 1) * txPageSize,
    }),
    prisma.transaction.count({ where: { userId: studentDbId } }),
    prisma.semesterFee.findMany({ where: { studentId: studentDbId, status: { not: 'Pending' } }, orderBy: { updatedAt: 'desc' }, take: HISTORY_TAKE }),
    prisma.libraryFine.findMany({ where: { studentId: studentDbId, status: { not: 'Pending' } }, orderBy: { updatedAt: 'desc' }, take: HISTORY_TAKE }),
    prisma.adminFine.findMany({ where: { studentId: studentDbId, status: { not: 'Pending' } }, orderBy: { updatedAt: 'desc' }, take: HISTORY_TAKE }),
    prisma.payLaterDue.findMany({ where: { studentId: studentDbId, status: { not: 'Pending' } }, orderBy: { updatedAt: 'desc' }, take: HISTORY_TAKE, include: { shop: true } }),
    // Scholarship Push credits a student's wallet via a Transaction with this purpose (see
    // scholarshipService.ts) — surfaced here as its own section per the spec's explicit
    // "scholarship credits" requirement, without needing a dedicated Scholarship model of its own.
    prisma.transaction.findMany({ where: { userId: studentDbId, purpose: 'scholarship_credit' }, orderBy: { createdAt: 'desc' }, take: HISTORY_TAKE }),
  ]);

  if (!user) return { found: false as const };

  return {
    found: true as const,
    student: {
      id: user.id, fullName: user.fullName || '', studentId: user.studentId || '', email: user.email,
      department: user.department || '', batch: user.batch || '', status: user.status,
    },
    walletBalance: wallet?.balance ?? 0,
    outstanding: {
      items: outstanding.items.map(i => ({ id: i.id, source: i.source, amount: i.amount, label: i.label })),
      total: outstanding.total,
      breakdown: outstanding.breakdown,
    },
    restriction: { restricted: restriction.restricted, reason: restriction.reason },
    transactions: {
      rows: transactions.map(t => ({
        id: t.id, reference: t.reference, type: t.type, direction: t.direction, amount: t.amount,
        status: t.status, purpose: t.purpose || '', description: t.description || '',
        paymentMethod: t.paymentMethod || '', gateway: t.gateway || '',
        balanceBefore: t.balanceBefore, balanceAfter: t.balanceAfter, createdAt: t.createdAt.toISOString(),
      })),
      total: transactionsTotal, page: txPage, pageSize: txPageSize,
    },
    history: {
      semesterFee: paidSemesterFees.map(f => ({ id: f.id, label: f.label || 'Semester Fee', amount: f.amount, status: f.status, reference: f.reference || '', updatedAt: f.updatedAt.toISOString() })),
      libraryFine: paidLibraryFines.map(f => ({ id: f.id, label: f.label || f.fineType || 'Library Fine', amount: f.amount, status: f.status, reference: f.reference || '', updatedAt: f.updatedAt.toISOString() })),
      adminFine: paidAdminFines.map(f => ({ id: f.id, label: f.reason || 'Administrative Fine', amount: f.amount, status: f.status, reference: f.reference || '', updatedAt: f.updatedAt.toISOString() })),
      payLaterDue: paidPayLaterDues.map(p => ({ id: p.id, label: p.description || `Pay Later — ${p.shop?.name || 'Shop'}`, amount: p.amount, status: p.status, reference: p.paymentReference || '', updatedAt: p.updatedAt.toISOString() })),
    },
    scholarshipCredits: scholarshipCredits.map(t => ({
      id: t.id, reference: t.reference, amount: t.amount, description: t.description || '', createdAt: t.createdAt.toISOString(),
    })),
  };
}
