import { describe, it, expect } from 'vitest';
import { buildShopTransactionSearchWhere } from '../lib/shopTransactionSearch.js';

describe('shopTransactionSearch — buildShopTransactionSearchWhere', () => {
  it('always scopes to the shop and Success status only, with no filters applied', () => {
    const where = buildShopTransactionSearchWhere('shop-1', {});
    expect(where).toEqual({ shopId: 'shop-1', status: 'Success' });
  });

  it('applies a date range filter', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.createdAt.lte).toEqual(new Date('2026-01-31'));
  });

  it('applies only a lower date bound when dateTo is omitted', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { dateFrom: '2026-01-01' });
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.createdAt.lte).toBeUndefined();
  });

  it('filters by Transaction ID / reference (case-insensitive contains, or exact id match)', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { transactionId: 'TXN-123' });
    expect(where.OR).toEqual([
      { reference: { contains: 'TXN-123', mode: 'insensitive' } },
      { id: { equals: 'TXN-123' } },
    ]);
  });

  it('filters by student ID (fuzzy, via the linked user)', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { studentId: 'STU-2026' });
    expect(where.user).toEqual({ studentId: { contains: 'STU-2026', mode: 'insensitive' } });
  });

  it('filters by student name (fuzzy, via the linked user)', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { studentName: 'Karim' });
    expect(where.user).toEqual({ fullName: { contains: 'Karim', mode: 'insensitive' } });
  });

  it('combines student ID and student name filters on the same user relation', () => {
    const where = buildShopTransactionSearchWhere('shop-1', { studentId: 'STU-2026-001', studentName: 'Karim' });
    expect(where.user).toEqual({
      studentId: { contains: 'STU-2026-001', mode: 'insensitive' },
      fullName: { contains: 'Karim', mode: 'insensitive' },
    });
  });

  it('combines every filter simultaneously', () => {
    const where = buildShopTransactionSearchWhere('shop-1', {
      studentId: 'STU-1', studentName: 'Karim', dateFrom: '2026-01-01', dateTo: '2026-01-31', transactionId: 'TXN-1',
    });
    expect(where.shopId).toBe('shop-1');
    expect(where.status).toBe('Success');
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.OR).toHaveLength(2);
    expect(where.user).toEqual({
      studentId: { contains: 'STU-1', mode: 'insensitive' },
      fullName: { contains: 'Karim', mode: 'insensitive' },
    });
  });
});
