import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../lib/prisma';
import {
  generateSettlementReference,
  isValidTransition,
  createSettlementRequest,
  transitionSettlementStatus,
  completeSettlement,
  getShopPendingBalance,
} from '../lib/settlementWorkflow';

describe('Settlement Workflow Engine Unit & Integration Tests', () => {
  let testShopId: string;
  let testUserId: string;
  let adminUserId: string;
  let accountsUserId: string;

  beforeAll(async () => {
    // Create test user and shop
    const user = await prisma.user.create({
      data: {
        email: `settle-test-${Date.now()}@std.ewubd.edu`,
        fullName: 'Test Shop Owner',
        role: 'Shop Staff',
        status: 'Active',
      },
    });
    testUserId = user.id;

    const admin = await prisma.user.create({
      data: {
        email: `settle-admin-${Date.now()}@ewubd.edu`,
        fullName: 'Test Admin',
        role: 'Admin Office',
        status: 'Active',
      },
    });
    adminUserId = admin.id;

    const accounts = await prisma.user.create({
      data: {
        email: `settle-accounts-${Date.now()}@ewubd.edu`,
        fullName: 'Test Accounts Officer',
        role: 'Accounts Office',
        status: 'Active',
      },
    });
    accountsUserId = accounts.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Test Settlement Shop ${Date.now()}`,
        category: 'Food',
        ownerId: testUserId,
        status: 'Active',
        bankAccountName: 'Test Owner',
        bankAccountNumber: '1234567890',
        bankName: 'Dutch Bangla Bank',
      },
    });
    testShopId = shop.id;

    // Create a mock completed transaction for revenue
    await prisma.transaction.create({
      data: {
        reference: `TXN-SETTLE-${Date.now()}`,
        userId: testUserId,
        shopId: testShopId,
        type: 'Shop Payment',
        direction: 'Credit',
        amount: 5000,
        status: 'Success',
      },
    });
  });

  afterAll(async () => {
    try {
      const userIds = [testUserId, adminUserId, accountsUserId];
      await prisma.notification.deleteMany({ where: { category: 'settlement' } }).catch(() => {});
      await prisma.settlementStatusHistory.deleteMany({ where: { changedById: { in: userIds } } }).catch(() => {});
      await prisma.settlementRequest.deleteMany({ where: { shopId: testShopId } }).catch(() => {});
      await prisma.settlement.deleteMany({ where: { shopId: testShopId } }).catch(() => {});
      await prisma.transaction.deleteMany({ where: { OR: [{ shopId: testShopId }, { userId: { in: userIds } }] } }).catch(() => {});
      await prisma.wallet.deleteMany({ where: { ownerId: { in: userIds } } }).catch(() => {});
      await prisma.shop.deleteMany({ where: { id: testShopId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    } catch {
      // Best-effort test teardown
    }
  });

  it('validates status transitions correctly', () => {
    expect(isValidTransition('PendingReview', 'UnderVerification')).toBe(true);
    expect(isValidTransition('PendingReview', 'Approved')).toBe(false);
    expect(isValidTransition('UnderVerification', 'Approved')).toBe(true);
    expect(isValidTransition('Approved', 'ProcessingPayment')).toBe(true);
    expect(isValidTransition('ProcessingPayment', 'Paid')).toBe(true);
    expect(isValidTransition('Paid', 'PendingReview')).toBe(false);
  });

  it('generates unique atomic settlement references', async () => {
    const ref1 = await generateSettlementReference();
    const ref2 = await generateSettlementReference();
    expect(ref1).toMatch(/^STL-\d{4}-\d{6}$/);
    expect(ref2).toMatch(/^STL-\d{4}-\d{6}$/);
    expect(ref1).not.toBe(ref2);
  });

  it('calculates shop pending balance correctly', async () => {
    const balance = await getShopPendingBalance(testShopId);
    expect(balance).toBe(5000);
  });

  it('creates settlement request when amount is valid', async () => {
    const request = await createSettlementRequest({
      shopId: testShopId,
      requestedById: testUserId,
      requestedAmount: 2000,
      notes: 'Test payout request',
    });

    expect(request.id).toBeDefined();
    expect(request.reference).toMatch(/^STL-/);
    expect(request.requestedAmount).toBe(2000);
    expect(request.status).toBe('PendingReview');
    expect(request.bankName).toBe('Dutch Bangla Bank');
  });

  it('rejects settlement request if amount exceeds pending balance', async () => {
    await expect(
      createSettlementRequest({
        shopId: testShopId,
        requestedById: testUserId,
        requestedAmount: 10000, // exceeds available balance
      })
    ).rejects.toThrow(/exceeds available balance/);
  });

  it('executes full settlement lifecycle: Request → UnderVerification → Approved → ProcessingPayment → Paid', async () => {
    const req = await createSettlementRequest({
      shopId: testShopId,
      requestedById: testUserId,
      requestedAmount: 1500,
    });

    // 1. Admin puts under verification
    const verified = await transitionSettlementStatus({
      requestId: req.id,
      newStatus: 'UnderVerification',
      actorId: adminUserId,
      reason: 'Verifying bank details',
    });
    expect(verified.status).toBe('UnderVerification');

    // 2. Admin approves
    const approved = await transitionSettlementStatus({
      requestId: req.id,
      newStatus: 'Approved',
      actorId: adminUserId,
      adminRemarks: 'Approved for payout',
    });
    expect(approved.status).toBe('Approved');

    // 3. Accounts starts processing
    const processing = await transitionSettlementStatus({
      requestId: req.id,
      newStatus: 'ProcessingPayment',
      actorId: accountsUserId,
    });
    expect(processing.status).toBe('ProcessingPayment');

    // 4. Accounts completes payout
    const paid = await completeSettlement(
      req.id,
      accountsUserId,
      'SSL-PAYOUT-TEST-001',
      'SSL-TRAN-TEST-001',
    );
    expect(paid?.status).toBe('Paid');
    expect(paid?.paidAt).toBeDefined();
  }, 25000);
});
