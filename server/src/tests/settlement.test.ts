import { describe, it, expect, vi, beforeEach } from 'vitest';

// getOutstandingDues/isFinanciallyRestricted call the module-level prisma singleton directly
// (not dependency-injected, unlike markItemPaid) — mocked here the same way other lib tests in
// this repo mock a fake Prisma-shaped object, just via vi.mock instead of a constructor param.
const prismaMock = {
  semesterFee: { findMany: vi.fn(), updateMany: vi.fn() },
  libraryFine: { findMany: vi.fn(), updateMany: vi.fn() },
  adminFine: { findMany: vi.fn(), updateMany: vi.fn() },
  payLaterDue: { findMany: vi.fn(), updateMany: vi.fn() },
};

vi.mock('../lib/prisma.js', () => ({ default: prismaMock }));

const { getOutstandingDues, isFinanciallyRestricted, markItemPaid, SettlementConflictError } = await import('../lib/settlement.js');

function fee(overrides: Partial<{ id: string; amount: number; status: string; dueDate: string | null; label: string }> = {}) {
  return { id: 'fee-1', amount: 1000, status: 'Pending', dueDate: null, label: 'Test Fee', ...overrides };
}

describe('settlement.ts — Unified Outstanding Due Settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.semesterFee.findMany.mockResolvedValue([]);
    prismaMock.libraryFine.findMany.mockResolvedValue([]);
    prismaMock.adminFine.findMany.mockResolvedValue([]);
    prismaMock.payLaterDue.findMany.mockResolvedValue([]);
  });

  describe('getOutstandingDues', () => {
    it('combines all four due sources into one item list and total', async () => {
      prismaMock.semesterFee.findMany.mockResolvedValue([fee({ id: 's1', amount: 45500, label: 'Spring 2026' })]);
      prismaMock.libraryFine.findMany.mockResolvedValue([{ id: 'l1', amount: 500, fineType: 'Overdue', label: null }]);
      prismaMock.adminFine.findMany.mockResolvedValue([{ id: 'a1', amount: 1200, reason: 'Misconduct' }]);
      prismaMock.payLaterDue.findMany.mockResolvedValue([{ id: 'p1', amount: 800, description: 'Cafe purchase', shop: { name: 'Cafe' } }]);

      const result = await getOutstandingDues('student-1');

      expect(result.items).toHaveLength(4);
      expect(result.total).toBe(45500 + 500 + 1200 + 800);
      expect(result.breakdown).toEqual({ semester: 45500, library: 500, admin: 1200, payLater: 800 });
      expect(result.items.map(i => i.source).sort()).toEqual(['admin', 'library', 'payLater', 'semester']);
    });

    it('returns zero total when nothing is outstanding', async () => {
      const result = await getOutstandingDues('student-1');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('only queries Pending rows — never includes already-settled dues', async () => {
      await getOutstandingDues('student-1');
      expect(prismaMock.semesterFee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 'student-1', status: 'Pending' } }));
      expect(prismaMock.libraryFine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 'student-1', status: 'Pending' } }));
    });
  });

  describe('isFinanciallyRestricted', () => {
    it('is false when there are no pending semester fees at all', async () => {
      const result = await isFinanciallyRestricted('student-1');
      expect(result.restricted).toBe(false);
      expect(result.overdueFees).toHaveLength(0);
    });

    it('is false when a pending semester fee has no due date set (no enforceable deadline)', async () => {
      prismaMock.semesterFee.findMany.mockResolvedValue([fee({ dueDate: null })]);
      const result = await isFinanciallyRestricted('student-1');
      expect(result.restricted).toBe(false);
    });

    it('is false when a pending semester fee due date is in the future', async () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      prismaMock.semesterFee.findMany.mockResolvedValue([fee({ dueDate: future })]);
      const result = await isFinanciallyRestricted('student-1');
      expect(result.restricted).toBe(false);
    });

    it('is true when a pending semester fee due date is in the past', async () => {
      prismaMock.semesterFee.findMany.mockResolvedValue([fee({ id: 'overdue-1', amount: 45500, dueDate: '2020-01-01' })]);
      const result = await isFinanciallyRestricted('student-1');
      expect(result.restricted).toBe(true);
      expect(result.overdueFees).toHaveLength(1);
      expect(result.overdueFees[0].id).toBe('overdue-1');
      expect(result.reason).toBeTruthy();
    });

    it('treats an unparseable free-text due date as non-enforceable rather than wrongly restricting', async () => {
      // SemesterFeeItem.dueDate is raw CSV free text — a garbage value must never restrict a
      // student by accident.
      prismaMock.semesterFee.findMany.mockResolvedValue([fee({ dueDate: 'not-a-real-date' })]);
      const result = await isFinanciallyRestricted('student-1');
      expect(result.restricted).toBe(false);
    });

    it('ignores fees that are not Pending (queries Pending only)', async () => {
      await isFinanciallyRestricted('student-1');
      expect(prismaMock.semesterFee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 'student-1', status: 'Pending' } }));
    });
  });

  describe('markItemPaid — atomicity and concurrency guard', () => {
    function fakeTx(overrides: Record<string, any> = {}) {
      return {
        semesterFee: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.semesterFee },
        libraryFine: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.libraryFine },
        adminFine: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.adminFine },
        payLaterDue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.payLaterDue },
        feeInvoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'student-1', fullName: 'Test Student', studentId: 'T-1' }) },
        ledgerEntry: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
      };
    }

    it('flips the correct source row to Paid and writes one CREDIT_PAYMENT ledger entry', async () => {
      const tx = fakeTx();
      await markItemPaid({ id: 's1', source: 'semester', amount: 45500, label: 'Spring 2026' }, 'REF-1', 'student-1', tx as any);

      expect(tx.semesterFee.updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'Pending' }, data: { status: 'Paid', reference: 'REF-1' } });
      expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);
      const ledgerData = tx.ledgerEntry.create.mock.calls[0][0].data;
      expect(ledgerData.type).toBe('CREDIT_PAYMENT');
      expect(ledgerData.creditAmount).toBe(45500);
      expect(ledgerData.reference).toBe('REF-1');
    });

    it('throws SettlementConflictError instead of silently no-op-ing when the row is no longer Pending (regression test for the old .catch(()=>{}) swallow bug)', async () => {
      const tx = fakeTx({ libraryFine: { updateMany: vi.fn().mockResolvedValue({ count: 0 } as any) } });
      await expect(
        markItemPaid({ id: 'l1', source: 'library', amount: 500, label: 'Overdue Fine' }, 'REF-2', 'student-1', tx as any)
      ).rejects.toThrow(SettlementConflictError);

      // The conflicting item must never reach the ledger write — a half-applied settlement is
      // exactly what the atomicity fix exists to prevent.
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('chains balanceAfter off the previous ledger entry when settling multiple items in one batch', async () => {
      const tx = fakeTx();
      tx.ledgerEntry.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ balanceAfter: 45500 });

      await markItemPaid({ id: 's1', source: 'semester', amount: 45500, label: 'Spring 2026' }, 'REF-3', 'student-1', tx as any);
      await markItemPaid({ id: 'l1', source: 'library', amount: 500, label: 'Overdue Fine' }, 'REF-3', 'student-1', tx as any);

      const secondCallData = tx.ledgerEntry.create.mock.calls[1][0].data;
      expect(secondCallData.balanceAfter).toBe(45000); // 45500 - 500
    });

    it('does nothing to any due row for a shop/wallet item (no matching source branch), but still writes the ledger entry', async () => {
      const tx = fakeTx();
      await markItemPaid({ id: 'shop-1', source: 'shop', amount: 300, label: 'Cafe' }, 'REF-4', 'student-1', tx as any);

      expect(tx.semesterFee.updateMany).not.toHaveBeenCalled();
      expect(tx.libraryFine.updateMany).not.toHaveBeenCalled();
      expect(tx.adminFine.updateMany).not.toHaveBeenCalled();
      expect(tx.payLaterDue.updateMany).not.toHaveBeenCalled();
      expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);
    });
  });
});
