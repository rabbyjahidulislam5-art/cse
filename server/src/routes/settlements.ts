import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth';
import { sendEmail } from '../lib/email';
import { notifyUser } from '../lib/notify';
import {
  createSettlementRequest,
  transitionSettlementStatus,
  completeSettlement,
  getSettlementTimeline,
  getShopPendingBalance,
  SettlementStatus,
} from '../lib/settlementWorkflow';

const router = Router();

const requireShopStaff = requireRole('Shop Staff');
const requireAdmin = requireRole('Admin Office');
const requireAccounts = requireRole('Accounts Office');
const requireAccountsOrAdmin = requireRole('Accounts Office', 'Admin Office');

// ─── SHOP SETTLEMENT ROUTES ───

router.post('/shop/settlement/request', authMiddleware, requireShopStaff, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const shop = await prisma.shop.findFirst({ where: { ownerId: userId } });
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account.' });

    const {
      requestedAmount,
      bankAccountName,
      bankAccountNumber,
      bankName,
      bankBranch,
      bankRoutingNumber,
      notes,
    } = req.body;

    const amount = Number(requestedAmount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Enter a valid settlement amount.' });
    }

    // Save bank info to shop if provided so future requests auto-fill
    if (bankAccountNumber || bankName) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          bankAccountName: bankAccountName || shop.bankAccountName,
          bankAccountNumber: bankAccountNumber || shop.bankAccountNumber,
          bankName: bankName || shop.bankName,
          bankBranch: bankBranch || shop.bankBranch,
          bankRoutingNumber: bankRoutingNumber || shop.bankRoutingNumber,
        },
      });
    }

    const request = await createSettlementRequest({
      shopId: shop.id,
      requestedById: userId,
      requestedAmount: amount,
      bankAccountName: bankAccountName || shop.bankAccountName || undefined,
      bankAccountNumber: bankAccountNumber || shop.bankAccountNumber || undefined,
      bankName: bankName || shop.bankName || undefined,
      bankBranch: bankBranch || shop.bankBranch || undefined,
      bankRoutingNumber: bankRoutingNumber || shop.bankRoutingNumber || undefined,
      notes,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'Settlement request submitted successfully', request });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to create settlement request' });
  }
});

router.post('/shop/settlement/list', authMiddleware, requireShopStaff, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const shop = await prisma.shop.findFirst({ where: { ownerId: userId } });
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account.' });

    const { status } = req.body;
    const where: any = { shopId: shop.id };
    if (status && status !== 'all') where.status = status;

    const [requests, pendingBalance, counts] = await Promise.all([
      prisma.settlementRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          adminReviewedBy: { select: { fullName: true } },
          accountsProcessedBy: { select: { fullName: true } },
        },
      }),
      getShopPendingBalance(shop.id),
      prisma.settlementRequest.groupBy({
        by: ['status'],
        where: { shopId: shop.id },
        _count: { _all: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {
      PendingReview: 0, UnderVerification: 0, Approved: 0, Rejected: 0,
      ProcessingPayment: 0, Paid: 0, Failed: 0,
    };
    counts.forEach(c => { statusCounts[c.status] = c._count._all; });

    res.json({
      requests: requests.map(r => ({
        id: r.id,
        reference: r.reference,
        requestedAmount: r.requestedAmount,
        status: r.status,
        notes: r.notes || '',
        adminRemarks: r.adminRemarks || '',
        failureReason: r.failureReason || '',
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        bankName: r.bankName || '',
        bankAccountNumber: r.bankAccountNumber || '',
        adminReviewer: r.adminReviewedBy?.fullName || null,
        accountsProcessor: r.accountsProcessedBy?.fullName || null,
      })),
      pendingBalance,
      statusCounts,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shop/settlement/detail', authMiddleware, requireShopStaff, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ message: 'Request ID is required.' });

    const request = await prisma.settlementRequest.findUnique({
      where: { id: requestId },
      include: {
        shop: true,
        adminReviewedBy: { select: { id: true, fullName: true, email: true } },
        accountsProcessedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!request) return res.status(404).json({ message: 'Settlement request not found.' });

    const timeline = await getSettlementTimeline(requestId);

    res.json({ request, timeline });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shop/bank-info/update', authMiddleware, requireShopStaff, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const shop = await prisma.shop.findFirst({ where: { ownerId: userId } });
    if (!shop) return res.status(404).json({ message: 'No shop is linked to this account.' });

    const { bankAccountName, bankAccountNumber, bankName, bankBranch, bankRoutingNumber } = req.body;

    const updated = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        bankAccountName: bankAccountName || null,
        bankAccountNumber: bankAccountNumber || null,
        bankName: bankName || null,
        bankBranch: bankBranch || null,
        bankRoutingNumber: bankRoutingNumber || null,
      },
    });

    res.json({ success: true, message: 'Bank account information updated', shop: updated });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN SETTLEMENT APPROVAL ROUTES ───

router.post('/admin/settlement-requests', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.body;
    const where: any = {};
    if (status && status !== 'all') where.status = status;

    let requests = await prisma.settlementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        shop: { select: { id: true, name: true, category: true, merchantId: true, logoUrl: true } },
        requestedBy: { select: { id: true, fullName: true, email: true, phone: true } },
        adminReviewedBy: { select: { fullName: true } },
        accountsProcessedBy: { select: { fullName: true } },
      },
    });

    if (search) {
      const q = search.toLowerCase();
      requests = requests.filter(r =>
        r.reference.toLowerCase().includes(q) ||
        r.shop.name.toLowerCase().includes(q) ||
        (r.requestedBy?.fullName || '').toLowerCase().includes(q)
      );
    }

    const counts = await prisma.settlementRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const statusCounts: Record<string, number> = {
      PendingReview: 0, UnderVerification: 0, Approved: 0, Rejected: 0,
      ProcessingPayment: 0, Paid: 0, Failed: 0,
    };
    counts.forEach(c => { statusCounts[c.status] = c._count._all; });

    res.json({
      requests: requests.map(r => ({
        id: r.id,
        reference: r.reference,
        requestedAmount: r.requestedAmount,
        status: r.status,
        notes: r.notes || '',
        adminRemarks: r.adminRemarks || '',
        failureReason: r.failureReason || '',
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        bankAccountName: r.bankAccountName || '',
        bankAccountNumber: r.bankAccountNumber || '',
        bankName: r.bankName || '',
        bankBranch: r.bankBranch || '',
        bankRoutingNumber: r.bankRoutingNumber || '',
        shop: r.shop,
        requestedBy: r.requestedBy,
        adminReviewer: r.adminReviewedBy?.fullName || null,
        accountsProcessor: r.accountsProcessedBy?.fullName || null,
      })),
      statusCounts,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/settlement-requests/review', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, action, remarks } = req.body;
    if (!requestId || !action) {
      return res.status(400).json({ message: 'Request ID and action are required.' });
    }

    let newStatus: SettlementStatus;
    if (action === 'under_verification') newStatus = 'UnderVerification';
    else if (action === 'approve') newStatus = 'Approved';
    else if (action === 'reject') newStatus = 'Rejected';
    else return res.status(400).json({ message: 'Invalid action.' });

    const updated = await transitionSettlementStatus({
      requestId,
      newStatus,
      actorId: req.user!.id,
      adminRemarks: remarks,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
    });

    const actionText = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'placed under verification';
    res.json({ success: true, message: `Settlement request ${actionText}`, request: updated });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to process settlement review' });
  }
});

router.post('/admin/settlement-requests/detail', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ message: 'Request ID is required.' });

    const request = await prisma.settlementRequest.findUnique({
      where: { id: requestId },
      include: {
        shop: true,
        requestedBy: true,
        adminReviewedBy: { select: { id: true, fullName: true, email: true } },
        accountsProcessedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!request) return res.status(404).json({ message: 'Settlement request not found.' });

    const [timeline, previousSettlements] = await Promise.all([
      getSettlementTimeline(requestId),
      prisma.settlement.findMany({
        where: { shopId: request.shopId },
        orderBy: { settledAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({ request, timeline, previousSettlements });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ACCOUNTS OFFICE SETTLEMENT PROCESSING ROUTES ───

router.post('/accounts/settlements', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.body;
    const where: any = {};
    if (status && status !== 'all') {
      where.status = status;
    } else {
      // Default queue for Accounts: Approved, ProcessingPayment, Paid, Failed
      where.status = { in: ['Approved', 'ProcessingPayment', 'Paid', 'Failed'] };
    }

    let requests = await prisma.settlementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        shop: { select: { id: true, name: true, category: true, merchantId: true, logoUrl: true } },
        requestedBy: { select: { id: true, fullName: true, email: true, phone: true } },
        adminReviewedBy: { select: { fullName: true } },
        accountsProcessedBy: { select: { fullName: true } },
      },
    });

    if (search) {
      const q = search.toLowerCase();
      requests = requests.filter(r =>
        r.reference.toLowerCase().includes(q) ||
        r.shop.name.toLowerCase().includes(q) ||
        (r.requestedBy?.fullName || '').toLowerCase().includes(q)
      );
    }

    const counts = await prisma.settlementRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const statusCounts: Record<string, number> = {
      Approved: 0, ProcessingPayment: 0, Paid: 0, Failed: 0,
    };
    counts.forEach(c => { statusCounts[c.status] = c._count._all; });

    res.json({
      requests: requests.map(r => ({
        id: r.id,
        reference: r.reference,
        requestedAmount: r.requestedAmount,
        status: r.status,
        notes: r.notes || '',
        adminRemarks: r.adminRemarks || '',
        failureReason: r.failureReason || '',
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        bankAccountName: r.bankAccountName || '',
        bankAccountNumber: r.bankAccountNumber || '',
        bankName: r.bankName || '',
        bankBranch: r.bankBranch || '',
        bankRoutingNumber: r.bankRoutingNumber || '',
        shop: r.shop,
        requestedBy: r.requestedBy,
        adminReviewer: r.adminReviewedBy?.fullName || null,
        accountsProcessor: r.accountsProcessedBy?.fullName || null,
      })),
      statusCounts,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/settlements/detail', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ message: 'Request ID is required.' });

    const request = await prisma.settlementRequest.findUnique({
      where: { id: requestId },
      include: {
        shop: true,
        requestedBy: true,
        adminReviewedBy: { select: { id: true, fullName: true, email: true } },
        accountsProcessedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!request) return res.status(404).json({ message: 'Settlement request not found.' });

    const [timeline, previousSettlements] = await Promise.all([
      getSettlementTimeline(requestId),
      prisma.settlement.findMany({
        where: { shopId: request.shopId },
        orderBy: { settledAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({ request, timeline, previousSettlements });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// OTP verification for settlement execution
router.post('/accounts/settlements/process-otp', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.email) return res.status(404).json({ message: 'User account not found.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const otp = await prisma.otpCode.create({
      data: {
        code,
        userId: user.id,
        purpose: 'accounts_settlement',
        status: 'Active',
        attempts: 0,
        expiresAt,
      },
    });

    try {
      await sendEmail(user.email, 'Settlement Authorization OTP — Smart Campus Accounts', [
        {
          type: 'text',
          content: `<strong>Hi ${user.fullName || 'Accounts Officer'},</strong>\n\nYou are authorizing a Shop Settlement payout. Your 6-digit verification code is:\n\n<strong style="font-size: 28px; letter-spacing: 8px; color: #3b82f6;">${code}</strong>\n\nThis code is valid for 5 minutes. Do not share this code.`,
        },
        { type: 'divider' },
        { type: 'text', content: '🎓 East West University — Accounts Office Security' },
      ]);
    } catch (err: any) {
      await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
      return res.status(502).json({ message: `Could not send verification email: ${err.message}` });
    }

    res.json({ success: true, message: 'OTP sent to your email.', otpId: otp.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/settlements/verify-otp', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const { otpId, code } = req.body;
    if (!otpId || !code) return res.status(400).json({ message: 'OTP details are required.' });

    const otp = await prisma.otpCode.findUnique({ where: { id: otpId } });
    if (!otp || otp.userId !== req.user!.id || otp.purpose !== 'accounts_settlement' || otp.status !== 'Active') {
      return res.status(400).json({ message: 'Invalid or expired OTP code.' });
    }
    if (otp.expiresAt && new Date(otp.expiresAt) < new Date()) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Expired' } });
      return res.status(400).json({ message: 'OTP has expired. Please request a new code.' });
    }
    if (otp.code !== code) {
      const attempts = (otp.attempts || 0) + 1;
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts } });
      return res.status(400).json({ message: `Incorrect OTP code. ${5 - attempts} attempts remaining.` });
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Used' } });

    res.json({ success: true, message: 'OTP verified successfully.' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Complete settlement execution (after OTP verification)
router.post('/accounts/settlements/execute-payment', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, otpVerified, referenceNotes } = req.body;
    if (!requestId) return res.status(400).json({ message: 'Request ID is required.' });

    const request = await prisma.settlementRequest.findUnique({ where: { id: requestId } });
    if (!request) return res.status(404).json({ message: 'Settlement request not found.' });

    if (request.status !== 'Approved' && request.status !== 'Failed' && request.status !== 'ProcessingPayment') {
      return res.status(400).json({ message: `Settlement request is in "${request.status}" status and cannot be paid.` });
    }

    // Step 1: Transition to ProcessingPayment if currently Approved/Failed
    if (request.status !== 'ProcessingPayment') {
      await transitionSettlementStatus({
        requestId,
        newStatus: 'ProcessingPayment',
        actorId: req.user!.id,
        reason: 'Accounts Office initiated payment processing.',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
      });
    }

    // Step 2: Generate payment reference and complete settlement
    const paymentRef = `SSL-SETTLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sslcommerzTranId = `SSL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const paidRequest = await completeSettlement(
      requestId,
      req.user!.id,
      paymentRef,
      sslcommerzTranId,
      req.ip,
    );

    res.json({
      success: true,
      message: 'Settlement payment completed successfully. Wallet credited.',
      request: paidRequest,
      paymentReference: paymentRef,
      sslcommerzTranId,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Settlement payment failed' });
  }
});

// ─── ACCOUNTS OFFICE PROFILE ROUTES ───

router.post('/accounts/profile', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    let wallet = await prisma.wallet.findFirst({ where: { ownerId: user.id } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { walletId: `W-${user.id.slice(0, 8)}`, ownerId: user.id, balance: 0, dailyTransferLimit: 10000, dailyTransferred: 0 },
      });
    }

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName || '',
        email: user.email,
        phone: user.phone || '',
        department: user.department || 'Accounts Office',
        role: user.role || 'Accounts Office',
        employeeId: user.employeeId || `ACC-${user.id.slice(0, 6).toUpperCase()}`,
        designation: user.designation || 'Accounts Officer',
        joiningDate: user.joiningDate || user.createdAt.toISOString().slice(0, 10),
        status: user.status || 'Active',
        profilePicture: user.profilePicture || '',
        bio: user.bio || '',
        lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
        pinSet: user.pinSet || false,
        pinLength: user.pinLength || 4,
        mustChangePassword: user.mustChangePassword || false,
        emailVerified: user.emailVerified || false,
      },
      wallet: {
        id: wallet.id,
        walletId: wallet.walletId,
        balance: wallet.balance || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/profile/update', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const { fullName, phone, bio, profilePicture, designation, employeeId } = req.body;

    const data: any = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (phone !== undefined) data.phone = phone;
    if (bio !== undefined) data.bio = bio;
    if (profilePicture !== undefined) data.profilePicture = profilePicture;
    if (designation !== undefined) data.designation = designation;
    if (employeeId !== undefined) data.employeeId = employeeId;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        action: 'accounts.profile.update',
        actorId: req.user!.id,
        entityType: 'User',
        entityId: req.user!.id,
        details: `Accounts profile updated for ${updated.email}`,
        ipAddress: req.ip,
      },
    });

    res.json({ success: true, message: 'Profile updated successfully', user: updated });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ACCOUNTS OFFICE CAMPUS WALLET ROUTES ───

router.post('/accounts/wallet', authMiddleware, requireAccounts, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    let wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { walletId: `W-${userId.slice(0, 8)}`, ownerId: userId, balance: 0, dailyTransferLimit: 10000, dailyTransferred: 0 },
      });
    }

    const txns = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({
      wallet: {
        id: wallet.id,
        walletId: wallet.walletId,
        balance: wallet.balance || 0,
        dailyTransferLimit: wallet.dailyTransferLimit,
        dailyTransferred: wallet.dailyTransferred,
        frozen: wallet.frozen,
      },
      recentTransactions: txns.map(t => ({
        id: t.id,
        reference: t.reference,
        type: t.type,
        direction: t.direction,
        amount: t.amount,
        status: t.status,
        description: t.description || '',
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
