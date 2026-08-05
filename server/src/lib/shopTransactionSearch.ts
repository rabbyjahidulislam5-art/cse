// Pure Prisma where-clause builder for the Shop "Completed (Settled) Payments" filtered search —
// factored out of the route so the filter-combination logic is directly unit-testable, matching
// the pattern established elsewhere this session (settlement.ts, reminderAutoDeduct.ts).

export interface ShopTransactionSearchFilters {
  studentId?: string;
  studentName?: string;
  dateFrom?: string;
  dateTo?: string;
  transactionId?: string;
}

export function buildShopTransactionSearchWhere(shopId: string, filters: ShopTransactionSearchFilters): any {
  const where: any = { shopId, status: 'Success' };

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
  }

  if (filters.transactionId) {
    where.OR = [
      { reference: { contains: filters.transactionId, mode: 'insensitive' } },
      { id: { equals: filters.transactionId } },
    ];
  }

  if (filters.studentId) where.user = { ...(where.user || {}), studentId: { contains: filters.studentId, mode: 'insensitive' } };
  if (filters.studentName) where.user = { ...(where.user || {}), fullName: { contains: filters.studentName, mode: 'insensitive' } };

  return where;
}
