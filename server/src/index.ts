import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from './lib/prisma';
import { authMiddleware, generateToken, AuthRequest } from './lib/auth';
import { sendEmail } from './lib/email';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
// Auth is Bearer-token only (JWT in the Authorization header) — no cookies are ever set or read,
// so `credentials: true` here was inconsistent with an open `origin: '*'` (browsers reject that
// combination for credentialed requests). Since no request ever uses `credentials: 'include'`,
// this was harmless in practice, but corrected for a technically-valid CORS configuration.
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Helper: hash PIN
async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(pin + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── AUTH ROUTES ───

// Send OTP for student registration
router.post('/auth/register-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const lowerEmail = email.toLowerCase().trim();
    if (!lowerEmail.endsWith('@std.ewubd.edu')) {
      return res.status(400).json({ message: 'Registration is restricted to @std.ewubd.edu email addresses only.' });
    }

    const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing) return res.status(400).json({ message: 'An account with this email already exists.' });

    // Extract studentId from email prefix if applicable (e.g. 2023-2-60-053)
    const emailPrefix = lowerEmail.split('@')[0];
    const studentIdMatch = emailPrefix.match(/^\d{4}-\d-\d{2}-\d{3}$/) ? emailPrefix : undefined;
    if (studentIdMatch) {
      const existingSid = await prisma.user.findUnique({ where: { studentId: studentIdMatch } });
      if (existingSid) return res.status(400).json({ message: `Student ID ${studentIdMatch} is already registered.` });
    }

    // Invalidate existing active OTPs for this email
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Registration OTPs aren't linked to a User yet (the account doesn't exist until signup completes)
    const otp = await prisma.otpCode.create({
      data: {
        code,
        purpose: `Register:${lowerEmail}`,
        status: 'Active',
        attempts: 0,
        expiresAt,
      },
    });

    try {
      await sendEmail(lowerEmail, 'Verification Code — Smart Campus EWU', [
        { type: 'text', content: `<strong>Welcome to Smart Campus!</strong>\n\nYour registration verification code is:\n\n<strong style="font-size: 28px; letter-spacing: 8px; color: #f59e0b;">${code}</strong>\n\nThis code is valid for 5 minutes.\nIf you did not request this code, please ignore this email.` },
        { type: 'divider' },
        { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
      ]);
    } catch (emailErr: any) {
      // Don't leave a dangling OTP the student never received
      await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
      return res.status(502).json({ message: `Could not send the verification email: ${emailErr.message} Please check the server's email configuration.` });
    }

    res.json({ success: true, message: 'OTP sent to your EWU email (valid for 5 minutes)', otpId: otp.id, studentId: studentIdMatch });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Final Registration after OTP verification
router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone, department, batch, studentId, otpCode, otpId } = req.body;
    if (!email || !password || !fullName || !otpCode || !otpId) {
      return res.status(400).json({ message: 'All required fields and OTP code are mandatory.' });
    }

    const lowerEmail = email.toLowerCase().trim();
    if (!lowerEmail.endsWith('@std.ewubd.edu')) {
      return res.status(400).json({ message: 'Registration is restricted to @std.ewubd.edu email addresses only.' });
    }

    // Verify OTP
    const otp = await prisma.otpCode.findUnique({ where: { id: otpId } });
    if (!otp || otp.purpose !== `Register:${lowerEmail}` || otp.status !== 'Active') {
      return res.status(400).json({ message: 'Invalid or expired OTP. Please request a new code.' });
    }
    if (otp.expiresAt && new Date(otp.expiresAt) < new Date()) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Expired' } });
      return res.status(400).json({ message: 'OTP has expired. Please request a new code.' });
    }
    if (otp.code !== otpCode) {
      const attempts = (otp.attempts || 0) + 1;
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts } });
      return res.status(400).json({ message: `Incorrect OTP code. ${5 - attempts} attempts remaining.` });
    }

    // Mark OTP as used
    await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Used' } });

    // Check duplicate email / studentId again
    const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing) return res.status(400).json({ message: 'Email already registered.' });

    const computedStudentId = studentId || lowerEmail.split('@')[0];
    if (computedStudentId) {
      const existingSid = await prisma.user.findUnique({ where: { studentId: computedStudentId } });
      if (existingSid) return res.status(400).json({ message: `Student ID ${computedStudentId} already registered.` });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: lowerEmail,
        password: hashed,
        fullName: fullName.trim(),
        studentId: computedStudentId,
        department: department || 'CSE',
        batch: batch || '2023',
        phone: phone || '',
        role: 'Student',
        status: 'Active',
      },
    });

    // Create Initial Wallet
    const wallet = await prisma.wallet.create({
      data: {
        walletId: `W-${user.id.slice(0, 8)}`,
        ownerId: user.id,
        balance: 0,
        dailyTransferLimit: 10000,
        dailyTransferred: 0,
      },
    });

    // Send Welcome Email
    try {
      await sendEmail(lowerEmail, 'Welcome to Smart Campus! — EWU Digital Wallet', [
        { type: 'text', content: `<strong>Dear ${user.fullName},</strong>\n\nYour Smart Campus student account has been created successfully!\n\n<strong>Student ID:</strong> ${computedStudentId}\n<strong>Email:</strong> ${lowerEmail}\n<strong>Wallet ID:</strong> ${wallet.walletId}\n\nYou can now log in, pay campus shops, transfer money to classmates, and clear university fees online.` },
        { type: 'divider' },
        { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
      ]);
    } catch { /* best-effort */ }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        studentId: user.studentId,
        department: user.department,
        batch: user.batch,
        phone: user.phone,
        status: user.status,
        pinSet: false,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Login by Email OR Student ID — the second field accepts EITHER the account Password OR the 4-digit Wallet PIN
router.post('/auth/login', async (req, res) => {
  try {
    const { emailOrStudentId, password } = req.body;
    const identifier = req.body.email || req.body.emailOrStudentId;
    if (!identifier || !password) return res.status(400).json({ message: 'Email/Student ID and Password or Wallet PIN are required' });

    const trimmed = identifier.trim();
    let user = await prisma.user.findUnique({ where: { email: trimmed.toLowerCase() } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { studentId: trimmed } });
    }

    if (!user) return res.status(401).json({ message: 'Invalid Password or Wallet PIN.' });

    if (user.status === 'Suspended') {
      return res.status(403).json({ message: 'Account is suspended. Please contact the Admin Office.' });
    }

    let authenticated = user.password ? await bcrypt.compare(password, user.password) : false;

    if (!authenticated && user.pinSet && user.pinHash && /^\d{4}$/.test(password)) {
      if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) {
        const mins = Math.ceil((new Date(user.pinLockedUntil).getTime() - Date.now()) / 60000);
        return res.status(429).json({ message: `Too many attempts. Try again in ${mins} minutes.` });
      }
      const pinHash = await hashPin(password, user.pinSalt || '');
      if (pinHash === user.pinHash) {
        authenticated = true;
        if (user.pinAttempts) await prisma.user.update({ where: { id: user.id }, data: { pinAttempts: 0 } });
      } else {
        const attempts = (user.pinAttempts || 0) + 1;
        const updates: any = { pinAttempts: attempts };
        if (attempts >= 5) updates.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    }

    if (!authenticated) return res.status(401).json({ message: 'Invalid Password or Wallet PIN.' });

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        studentId: user.studentId,
        department: user.department,
        batch: user.batch,
        phone: user.phone,
        status: user.status,
        pinSet: user.pinSet || false,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Google Sign-Up / Sign-In — restricted to verified @std.ewubd.edu Google accounts.
// Finds an existing account by verified email first (never creates a duplicate); creates one only if none exists.
router.post('/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Missing Google credential.' });
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ message: 'Google Sign-In is not configured on the server yet.' });
    }

    const { OAuth2Client } = await import('google-auth-library');
    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ message: 'Invalid or expired Google sign-in. Please try again.' });
    }

    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ message: 'Your Google email could not be verified.' });
    }

    const lowerEmail = payload.email.toLowerCase().trim();
    if (!lowerEmail.endsWith('@std.ewubd.edu')) {
      return res.status(403).json({ message: 'Google Sign-Up is restricted to @std.ewubd.edu student accounts only.' });
    }

    let user = await prisma.user.findUnique({ where: { email: lowerEmail } });

    if (!user) {
      const emailPrefix = lowerEmail.split('@')[0];
      const studentIdMatch = emailPrefix.match(/^\d{4}-\d-\d{2}-\d{3}$/) ? emailPrefix : undefined;
      if (studentIdMatch) {
        const existingSid = await prisma.user.findUnique({ where: { studentId: studentIdMatch } });
        if (existingSid) return res.status(400).json({ message: `Student ID ${studentIdMatch} is already registered.` });
      }

      user = await prisma.user.create({
        data: {
          email: lowerEmail,
          fullName: payload.name || emailPrefix,
          studentId: studentIdMatch,
          role: 'Student',
          status: 'Active',
          authProvider: 'google',
          googleId: payload.sub,
          profilePicture: payload.picture || undefined,
        },
      });

      await prisma.wallet.create({
        data: { walletId: `W-${user.id.slice(0, 8)}`, ownerId: user.id, balance: 0, dailyTransferLimit: 10000, dailyTransferred: 0 },
      });

      try {
        await sendEmail(lowerEmail, 'Welcome to Smart Campus! — EWU Digital Wallet', [
          { type: 'text', content: `<strong>Dear ${user.fullName},</strong>\n\nYour Smart Campus student account has been created via Google Sign-Up!\n\n<strong>Email:</strong> ${lowerEmail}` },
          { type: 'divider' },
          { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
        ]);
      } catch { /* best-effort */ }
    } else {
      if (user.status === 'Suspended') {
        return res.status(403).json({ message: 'Account is suspended. Please contact the Admin Office.' });
      }
      if (!user.googleId) {
        user = await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub } });
      }
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        studentId: user.studentId,
        department: user.department,
        batch: user.batch,
        phone: user.phone,
        status: user.status,
        pinSet: user.pinSet || false,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot Password — Request OTP
router.post('/auth/forgot-password/otp', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ message: 'Email or Student ID is required' });

    const trimmed = identifier.trim();
    let user = await prisma.user.findUnique({ where: { email: trimmed.toLowerCase() } });
    if (!user) user = await prisma.user.findUnique({ where: { studentId: trimmed } });

    if (!user || !user.email) return res.status(404).json({ message: 'No account found with this Email or Student ID.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const otp = await prisma.otpCode.create({
      data: {
        code,
        userId: user.id,
        purpose: 'PasswordReset',
        status: 'Active',
        attempts: 0,
        expiresAt,
      },
    });

    try {
      await sendEmail(user.email, 'Password Reset OTP — Smart Campus', [
        { type: 'text', content: `<strong>Hi ${user.fullName || 'Student'},</strong>\n\nYou requested a password reset. Your verification code is:\n\n<strong style="font-size: 28px; letter-spacing: 8px; color: #f59e0b;">${code}</strong>\n\nThis code expires in 5 minutes.` },
        { type: 'divider' },
        { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
      ]);
    } catch (emailErr: any) {
      await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
      return res.status(502).json({ message: `Could not send the reset email: ${emailErr.message} Please check the server's email configuration.` });
    }

    res.json({ success: true, message: `OTP sent to your email (${user.email})`, otpId: otp.id, email: user.email });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot Password — Reset Password
router.post('/auth/forgot-password/reset', async (req, res) => {
  try {
    const { otpId, code, newPassword } = req.body;
    if (!otpId || !code || !newPassword) return res.status(400).json({ message: 'All fields are required' });

    const otp = await prisma.otpCode.findUnique({ where: { id: otpId }, include: { user: true } });
    if (!otp || otp.purpose !== 'PasswordReset' || otp.status !== 'Active') {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }
    if (otp.expiresAt && new Date(otp.expiresAt) < new Date()) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Expired' } });
      return res.status(400).json({ message: 'OTP code has expired.' });
    }
    if (otp.code !== code) {
      const attempts = (otp.attempts || 0) + 1;
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts } });
      return res.status(400).json({ message: `Incorrect OTP. ${5 - attempts} attempts remaining.` });
    }

    if (!otp.userId) return res.status(400).json({ message: 'Invalid or expired OTP.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: otp.userId }, data: { password: hashed } });
    await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Used' } });

    res.json({ success: true, message: 'Password updated successfully. You can now sign in with your new password.' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── FILE UPLOAD ───
router.post('/upload', authMiddleware, upload.single('file'), (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file provided' });
  const baseUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;
  res.json({ url: `${baseUrl}/uploads/${req.file.filename}` });
});

// ─── STUDENT DASHBOARD ───
router.post('/student/dashboard', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    await prisma.user.update({ where: { id: userId }, data: { lastLogin: new Date() } });

    if (!req.user!.role) {
      await prisma.user.update({ where: { id: userId }, data: { role: 'Student', status: 'Active' } });
    }

    const userRecord = await prisma.user.findUnique({ where: { id: userId } });

    let wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { walletId: `W-${userId.slice(0, 8)}`, ownerId: userId, balance: 0, dailyTransferLimit: 10000, dailyTransferred: 0 },
      });
    }

    const txns = await prisma.transaction.findMany({ where: { userId }, take: 5, orderBy: { createdAt: 'desc' } });

    res.json({
      user: {
        id: userId,
        fullName: req.user!.fullName || '',
        email: req.user!.email || '',
        studentId: req.user!.studentId || '',
        department: req.user!.department || '',
        batch: req.user!.batch || '',
        phone: userRecord?.phone || req.user!.phone || '',
        status: req.user!.status || 'Active',
        pinSet: req.user!.pinSet || false,
        profilePicture: userRecord?.profilePicture || '',
        emergencyContact: userRecord?.emergencyContact || '',
        address: userRecord?.address || '',
        bloodGroup: userRecord?.bloodGroup || '',
        gender: userRecord?.gender || '',
        dateOfBirth: userRecord?.dateOfBirth || '',
        bio: userRecord?.bio || '',
      },
      wallet: { id: wallet.id, balance: wallet.balance || 0 },
      recentTransactions: txns.map(t => ({
        id: t.id, reference: t.reference || '', type: t.type || '',
        direction: t.direction || '', amount: t.amount || 0,
        status: t.status || '', description: t.description || '',
        paymentMethod: t.paymentMethod || '', gateway: t.gateway || '',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SHOPS ───
router.post('/shops', async (req, res) => {
  try {
    const { category } = req.body;
    const where: any = { status: 'Active' };
    if (category && category !== 'all') {
      const catMap: Record<string, string> = { food_beverage: 'Food & Beverage', stationery: 'Stationery', printing: 'Printing', other: 'Other' };
      where.category = catMap[category] || category;
    }
    const records = await prisma.shop.findMany({ where, take: 50 });
    res.json({
      shops: records.map(s => ({
        id: s.id, name: s.name || '', category: s.category || '', rating: s.rating || 0,
        status: s.status || '', location: s.location || '', logoUrl: s.logoUrl || '',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shops/detail', async (req, res) => {
  try {
    const { shopId } = req.body;
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) return res.status(404).json({ message: 'Shop not found' });
    res.json({
      shop: {
        id: shop.id, name: shop.name, category: shop.category, rating: shop.rating,
        status: shop.status, location: shop.location || '', logoUrl: shop.logoUrl || '',
        qrToken: shop.qrToken || '', merchantId: shop.merchantId || '',
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SHOP PAY ───
router.post('/shops/pay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { shopId, shopName, amount, mode, description } = req.body;
    const ref = `SHP-${Date.now().toString(36).toUpperCase()}`;

    if (mode === 'now') {
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
      if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
      if ((wallet.balance || 0) < amount) return res.status(400).json({ message: 'Insufficient balance' });

      const newBalance = (wallet.balance || 0) - amount;
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });

      const tx = await prisma.transaction.create({
        data: {
          reference: ref, userId, type: 'Shop Payment', direction: 'Debit',
          amount, status: 'Success', shopId, gateway: 'Wallet',
          description: description || shopName,
        },
      });

      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user?.email) {
          await sendEmail(user.email, `Shop Payment — ৳${amount} — Smart Campus`, [
            { type: 'text', content: `<strong>Hi ${user.fullName || 'Student'},</strong>\n\nShop payment completed.\n\n<strong>Shop:</strong> ${shopName}\n<strong>Amount:</strong> ৳${amount.toLocaleString()}\n<strong>Reference:</strong> ${ref}\n<strong>Date:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })}` },
            { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus — Your University Wallet' },
          ]);
        }
      } catch { /* best-effort */ }

      res.json({ success: true, newBalance, transactionId: tx.id });
    } else {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const due = await prisma.payLaterDue.create({
        data: { reference: ref, studentId: userId, shopId, amount, status: 'Pending', dueDate: dueDate.toISOString().split('T')[0], description: description || shopName },
      });

      const tx = await prisma.transaction.create({
        data: {
          reference: ref, userId, type: 'Shop Payment', direction: 'Debit',
          amount, status: 'Pending', shopId, gateway: 'Wallet',
          description: `[Pay Later] ${description || shopName}`,
        },
      });

      res.json({ success: true, transactionId: tx.id, dueId: due.id });
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── QR VALIDATE ───
router.post('/shops/validate-qr', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { qrData } = req.body;
    let parsed: any;
    try { parsed = JSON.parse(qrData); } catch { parsed = { token: qrData }; }

    const token = parsed.token || parsed.qrToken || qrData;
    const shop = await prisma.shop.findFirst({ where: { qrToken: token, status: 'Active' } });
    if (!shop) return res.json({ valid: false, shop: null });

    res.json({
      valid: true,
      shop: { id: shop.id, name: shop.name, category: shop.category, location: shop.location || '', logoUrl: shop.logoUrl || '', merchantId: shop.merchantId || '' },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DUES ───
router.post('/dues', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [sem, lib, adm, pl] = await Promise.all([
      prisma.semesterFee.findMany({ where: { studentId: userId }, take: 100 }),
      prisma.libraryFine.findMany({ where: { studentId: userId }, take: 100 }),
      prisma.adminFine.findMany({ where: { studentId: userId }, take: 100 }),
      prisma.payLaterDue.findMany({ where: { studentId: userId }, take: 100 }),
    ]);
    res.json({
      semester: sem.map(r => ({ id: r.id, source: 'semester', label: r.label || '', amount: r.amount || 0, status: (r.status || 'Pending').toLowerCase(), dueDate: r.dueDate || '' })),
      library: lib.map(r => ({ id: r.id, source: 'library', label: r.label || '', amount: r.amount || 0, status: (r.status || 'Pending').toLowerCase(), dueDate: r.dueDate || '' })),
      admin: adm.map(r => ({ id: r.id, source: 'admin', label: r.reason || '', amount: r.amount || 0, status: (r.status || 'Pending').toLowerCase(), dueDate: r.incidentDate || '' })),
      payLater: pl.map(r => ({ id: r.id, source: 'payLater', label: r.description || r.reference || '', amount: r.amount || 0, status: (r.status || 'Pending').toLowerCase(), dueDate: r.dueDate || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/dues/pay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { items } = req.body;
    const totalAmount = items.reduce((s: number, i: any) => s + i.amount, 0);

    const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if ((wallet.balance || 0) < totalAmount) return res.status(400).json({ message: 'Insufficient balance' });

    const newBalance = (wallet.balance || 0) - totalAmount;
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });

    for (const item of items) {
      const ref = `PAY-${Date.now().toString(36).toUpperCase()}-${item.id.slice(0, 4)}`;
      const typeMap: Record<string, string> = { semester: 'Fee Payment', library: 'Fine Payment', admin: 'Fine Payment', payLater: 'Shop Payment' };

      await prisma.transaction.create({
        data: { reference: ref, userId, type: typeMap[item.source] || 'Fee Payment', direction: 'Debit', amount: item.amount, status: 'Success', gateway: 'Wallet', description: item.label },
      });

      if (item.source === 'semester') await prisma.semesterFee.update({ where: { id: item.id }, data: { status: 'Paid', reference: ref } });
      else if (item.source === 'library') await prisma.libraryFine.update({ where: { id: item.id }, data: { status: 'Paid', reference: ref } });
      else if (item.source === 'admin') await prisma.adminFine.update({ where: { id: item.id }, data: { status: 'Paid', reference: ref } });
      else if (item.source === 'payLater') await prisma.payLaterDue.update({ where: { id: item.id }, data: { status: 'Paid', paymentReference: ref } });
    }

    res.json({ success: true, newBalance, paidCount: items.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DISPUTE FINE ───
router.post('/fines/dispute', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fineId, source, reason } = req.body;
    if (source === 'admin') await prisma.adminFine.update({ where: { id: fineId }, data: { status: 'Disputed' } });
    else if (source === 'library') await prisma.libraryFine.update({ where: { id: fineId }, data: { status: 'Disputed' } });
    await prisma.auditLog.create({ data: { action: 'Fine Disputed', actorId: req.user!.id, entityType: 'Fine', entityId: fineId, details: reason } });
    res.json({ success: true, message: 'Dispute submitted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── TRANSACTIONS ───
router.post('/transactions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { type, direction, limit = 50, offset = 0 } = req.body;
    const where: any = { userId };
    if (type && type !== 'all') where.type = type;
    if (direction && direction !== 'all') where.direction = direction;

    const [records, total] = await Promise.all([
      prisma.transaction.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      transactions: records.map(t => ({
        id: t.id, reference: t.reference, type: t.type, direction: t.direction,
        amount: t.amount, status: t.status, description: t.description || '',
        paymentMethod: t.paymentMethod || '', gateway: t.gateway || '',
        createdAt: t.createdAt.toISOString(),
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── NOTIFICATIONS ───
router.post('/notifications', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const txns = await prisma.transaction.findMany({ where: { userId }, take: 30, orderBy: { createdAt: 'desc' } });
    const dues = await prisma.semesterFee.findMany({ where: { studentId: userId, status: 'Pending' }, take: 5 });
    const libFines = await prisma.libraryFine.findMany({ where: { studentId: userId, status: 'Pending' }, take: 5 });

    const notifications: any[] = [];
    txns.forEach(t => {
      const icon = t.direction === 'Credit' ? '💰' : t.type === 'Shop Payment' ? '🛍️' : '📤';
      notifications.push({
        id: t.id, type: t.type, title: t.type, message: t.description || '',
        amount: t.amount, status: t.status, date: t.createdAt.toISOString(), icon,
      });
    });
    dues.forEach(d => notifications.push({ id: d.id, type: 'Fee Due', title: 'Semester Fee', message: d.label || '', amount: d.amount, status: 'Pending', date: d.dueDate || '', icon: '🎓' }));
    libFines.forEach(f => notifications.push({ id: f.id, type: 'Library Fine', title: 'Library Fine', message: f.label || '', amount: f.amount, status: 'Pending', date: f.dueDate || '', icon: '📚' }));

    res.json({ notifications: notifications.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── RECEIPT ───
router.post('/receipt', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { transactionId } = req.body;
    const tx = await prisma.transaction.findUnique({ where: { id: transactionId }, include: { user: true, shop: true } });
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    res.json({
      id: tx.id, reference: tx.reference, type: tx.type, direction: tx.direction,
      amount: tx.amount, status: tx.status, description: tx.description,
      paymentMethod: tx.paymentMethod, gateway: tx.gateway,
      gatewayTxnId: tx.gatewayTxnId, bankTxnId: tx.bankTxnId,
      createdAt: tx.createdAt.toISOString(),
      userName: tx.user?.fullName || '', userEmail: tx.user?.email || '',
      studentId: tx.user?.studentId || '', shopName: tx.shop?.name || '',
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── TRANSFER ───
router.post('/transfer', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const senderId = req.user!.id;
    const { recipientIdentifier, amount, note } = req.body;

    let recipient = await prisma.user.findUnique({ where: { email: recipientIdentifier } });
    if (!recipient) recipient = await prisma.user.findUnique({ where: { studentId: recipientIdentifier } });
    if (!recipient) return res.status(404).json({ message: 'Recipient not found.' });
    if (recipient.id === senderId) return res.status(400).json({ message: 'Cannot transfer to yourself' });
    if (recipient.status === 'Suspended') return res.status(403).json({ message: 'Recipient account is suspended' });

    const senderWallet = await prisma.wallet.findFirst({ where: { ownerId: senderId } });
    if (!senderWallet) return res.status(404).json({ message: 'Sender wallet not found' });
    if ((senderWallet.balance || 0) < amount) return res.status(400).json({ message: 'Insufficient balance' });

    const today = new Date().toISOString().split('T')[0];
    let dailyTransferred = senderWallet.dailyTransferred || 0;
    if (senderWallet.lastTransferDate !== today) dailyTransferred = 0;
    const limit = senderWallet.dailyTransferLimit || 10000;
    if (dailyTransferred + amount > limit) return res.status(429).json({ message: `Daily transfer limit ৳${limit} exceeded.` });

    let recipientWallet = await prisma.wallet.findFirst({ where: { ownerId: recipient.id } });
    if (!recipientWallet) {
      recipientWallet = await prisma.wallet.create({ data: { walletId: `W-${recipient.id.slice(0, 8)}`, ownerId: recipient.id, balance: 0 } });
    }

    const ref = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const senderNewBalance = (senderWallet.balance || 0) - amount;
    const recipientNewBalance = (recipientWallet.balance || 0) + amount;

    await prisma.wallet.update({ where: { id: senderWallet.id }, data: { balance: senderNewBalance, dailyTransferred: dailyTransferred + amount, lastTransferDate: today } });
    await prisma.wallet.update({ where: { id: recipientWallet.id }, data: { balance: recipientNewBalance } });

    const sendTx = await prisma.transaction.create({
      data: { reference: ref, userId: senderId, type: 'Transfer Sent', direction: 'Debit', amount, status: 'Success', gateway: 'Wallet', description: `Transfer to ${recipient.fullName || recipient.email}${note ? ` — ${note}` : ''}` },
    });
    await prisma.transaction.create({
      data: { reference: `${ref}-R`, userId: recipient.id, type: 'Transfer Received', direction: 'Credit', amount, status: 'Success', gateway: 'Wallet', description: `Transfer from ${req.user!.fullName || 'sender'}${note ? ` — ${note}` : ''}` },
    });

    await prisma.auditLog.create({ data: { action: 'Wallet Transfer', actorId: senderId, entityType: 'Wallet', entityId: senderWallet.id, details: `Sent ৳${amount} to ${recipient.fullName || recipient.email} (${ref})` } });

    try {
      const sender = await prisma.user.findUnique({ where: { id: senderId } });
      if (sender?.email) {
        await sendEmail(sender.email, `Transfer Sent — ৳${amount} — Smart Campus`, [
          { type: 'text', content: `<strong>Hi ${sender.fullName},</strong>\n\nYou sent ৳${amount.toLocaleString()} to ${recipient.fullName || recipient.email}.\n\n<strong>Reference:</strong> ${ref}\n<strong>New Balance:</strong> ৳${senderNewBalance.toLocaleString()}` },
          { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus' },
        ]);
      }
      if (recipient.email) {
        await sendEmail(recipient.email, `Transfer Received — ৳${amount} — Smart Campus`, [
          { type: 'text', content: `<strong>Hi ${recipient.fullName},</strong>\n\nYou received ৳${amount.toLocaleString()} from ${sender?.fullName || 'a student'}.\n\n<strong>Reference:</strong> ${ref}\n<strong>New Balance:</strong> ৳${recipientNewBalance.toLocaleString()}` },
          { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus' },
        ]);
      }
    } catch { /* best-effort */ }

    res.json({ success: true, newBalance: senderNewBalance, transactionId: sendTx.id, recipientName: recipient.fullName || recipient.email || 'Unknown' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── WITHDRAWAL ───
router.post('/withdrawal/request', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { amount, method, accountDetails } = req.body;
    const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    if ((wallet.balance || 0) < amount) return res.status(400).json({ message: 'Insufficient balance' });

    const ref = `WDR-${Date.now().toString(36).toUpperCase()}`;
    const newBalance = (wallet.balance || 0) - amount;
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });

    const tx = await prisma.transaction.create({
      data: { reference: ref, userId, type: 'Withdrawal', direction: 'Debit', amount, status: 'Pending', gateway: method, description: `Withdrawal to ${method}: ${accountDetails}` },
    });

    res.json({ success: true, message: 'Withdrawal request submitted', transactionId: tx.id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PIN ───
router.post('/pin/set', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { pin, currentPin } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.pinSet && user.pinHash) {
      if (!currentPin) return res.status(400).json({ message: 'Current PIN required' });
      if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) return res.status(429).json({ message: 'PIN locked. Try again later.' });
      const currentHash = await hashPin(currentPin, user.pinSalt || '');
      if (currentHash !== user.pinHash) {
        const attempts = (user.pinAttempts || 0) + 1;
        const updates: any = { pinAttempts: attempts };
        if (attempts >= 5) updates.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        await prisma.user.update({ where: { id: userId }, data: updates });
        return res.status(401).json({ message: `Incorrect current PIN. ${5 - attempts} attempts remaining.` });
      }
    }

    const salt = crypto.randomUUID();
    const hash = await hashPin(pin, salt);
    await prisma.user.update({ where: { id: userId }, data: { pinHash: hash, pinSalt: salt, pinSet: true, pinAttempts: 0, pinLockedUntil: null } });
    await prisma.auditLog.create({ data: { action: user.pinSet ? 'PIN Changed' : 'PIN Set', actorId: userId, entityType: 'User', entityId: userId, details: user.pinSet ? 'Wallet PIN changed' : 'Wallet PIN set for first time' } });

    res.json({ success: true, message: user.pinSet ? 'PIN changed successfully' : 'PIN set successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/pin/verify', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { pin } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.pinSet || !user.pinHash) return res.status(400).json({ message: 'PIN not set.' });

    if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(user.pinLockedUntil).getTime() - Date.now()) / 60000);
      return res.status(429).json({ message: `PIN locked. Try again in ${mins} minutes.` });
    }

    const hash = await hashPin(pin, user.pinSalt || '');
    if (hash !== user.pinHash) {
      const attempts = (user.pinAttempts || 0) + 1;
      const updates: any = { pinAttempts: attempts };
      if (attempts >= 5) updates.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.user.update({ where: { id: userId }, data: updates });
      return res.json({ valid: false, message: `Incorrect PIN. ${Math.max(0, 5 - attempts)} attempts remaining.` });
    }

    await prisma.user.update({ where: { id: userId }, data: { pinAttempts: 0 } });
    res.json({ valid: true, message: 'PIN verified' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── OTP ───
router.post('/otp/send', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { purpose } = req.body;

    const activeOtps = await prisma.otpCode.findMany({ where: { userId, status: 'Active' }, take: 10 });
    if (activeOtps.length >= 5) return res.status(429).json({ message: 'Too many active OTPs.' });

    for (const old of activeOtps.filter(o => o.purpose === purpose)) {
      await prisma.otpCode.update({ where: { id: old.id }, data: { status: 'Expired' } });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const otp = await prisma.otpCode.create({ data: { code, userId, purpose, status: 'Active', attempts: 0, expiresAt } });
    await prisma.auditLog.create({ data: { action: 'OTP Generated', actorId: userId, entityType: 'OTP', entityId: otp.id, details: `Purpose: ${purpose}` } });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) return res.status(400).json({ message: 'No email on file for this account.' });

    try {
      await sendEmail(user.email, 'Your OTP Code — Smart Campus', [
        { type: 'text', content: `<strong>Hi ${user.fullName || 'Student'},</strong>\n\nYour verification code is:\n\n<strong style="font-size: 24px; letter-spacing: 8px;">${code}</strong>\n\nThis code expires in 5 minutes.\n<strong>Purpose:</strong> ${purpose}` },
        { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus — Your University Wallet' },
      ]);
    } catch (emailErr: any) {
      await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
      return res.status(502).json({ message: `Could not send the verification email: ${emailErr.message} Please check the server's email configuration.` });
    }

    res.json({ success: true, message: `OTP sent to your email for ${purpose} (valid for 5 minutes)`, otpId: otp.id, expiresAt: expiresAt.toISOString() });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/otp/verify', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { otpId, code } = req.body;
    const otp = await prisma.otpCode.findUnique({ where: { id: otpId } });
    if (!otp) return res.status(404).json({ message: 'OTP not found' });
    if (otp.status !== 'Active') return res.json({ valid: false, message: 'OTP already used or expired' });

    if (otp.expiresAt && new Date(otp.expiresAt) < new Date()) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Expired' } });
      return res.json({ valid: false, message: 'OTP expired. Please request a new one.' });
    }

    const attempts = (otp.attempts || 0) + 1;
    if (attempts > 5) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Expired' } });
      return res.json({ valid: false, message: 'Too many attempts. OTP invalidated.' });
    }

    if (otp.code !== code) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts } });
      return res.json({ valid: false, message: `Incorrect OTP. ${5 - attempts} attempts remaining.` });
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { status: 'Used', attempts } });
    res.json({ valid: true, message: 'OTP verified successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PROFILE ───
router.post('/profile/update', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { phone, emergencyContact, address, bloodGroup, gender, dateOfBirth, bio, profilePicture, studentId, department, batch } = req.body;
    const data: any = {};
    if (phone !== undefined) data.phone = phone;
    if (emergencyContact !== undefined) data.emergencyContact = emergencyContact;
    if (address !== undefined) data.address = address;
    if (bloodGroup !== undefined) data.bloodGroup = bloodGroup;
    if (gender !== undefined) data.gender = gender;
    if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth;
    if (bio !== undefined) data.bio = bio;
    if (profilePicture !== undefined) data.profilePicture = profilePicture;
    if (studentId !== undefined) data.studentId = studentId;
    if (department !== undefined) data.department = department;
    if (batch !== undefined) data.batch = batch;

    await prisma.user.update({ where: { id: userId }, data });
    res.json({ success: true, message: 'Profile updated' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SSL PAYMENT ───
router.post('/payment/init', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { amount, purpose, itemId, itemLabel } = req.body;
    const ref = `SSL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const pendingTxns = await prisma.transaction.findMany({ where: { userId, status: 'Pending', gateway: 'SSLCommerz' }, take: 5 });
    if (pendingTxns.length >= 3) return res.status(429).json({ message: 'Too many pending payments.' });

    const typeMap: Record<string, string> = { topup: 'Top Up', semester_fee: 'Fee Payment', library_fine: 'Fine Payment', admin_fine: 'Fine Payment', shop_payment: 'Shop Payment', pay_later: 'Shop Payment' };
    const tx = await prisma.transaction.create({
      data: { reference: ref, userId, type: typeMap[purpose] || 'Top Up', direction: purpose === 'topup' ? 'Credit' : 'Debit', amount, status: 'Pending', gateway: 'SSLCommerz', idempotencyKey: `${userId}-${purpose}-${Date.now()}`, description: itemLabel || `Online ${purpose}`, paymentMethod: 'Online' },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
    const SSLCOMMERZ_URL = isLive ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php' : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const formData = new URLSearchParams({
      store_id: process.env.SSLCOMMERZ_STORE_ID || '',
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
      total_amount: amount.toString(), currency: 'BDT', tran_id: ref,
      success_url: `${appUrl}/student/payment-result?status=success&ref=${ref}`,
      fail_url: `${appUrl}/student/payment-result?status=failed&ref=${ref}`,
      cancel_url: `${appUrl}/student/payment-result?status=cancelled&ref=${ref}`,
      ipn_url: `${appUrl}/student/payment-result?status=success&ref=${ref}`,
      cus_name: user?.fullName || 'Student',
      cus_email: user?.email || req.user!.email,
      cus_phone: user?.phone || '01700000000',
      cus_add1: 'University Campus', cus_city: 'Dhaka', cus_country: 'Bangladesh',
      shipping_method: 'NO', product_name: itemLabel || 'Wallet Top Up',
      product_category: purpose === 'topup' ? 'Wallet' : 'Payment', product_profile: 'general',
      value_a: userId, value_b: purpose, value_c: itemId || '', value_d: tx.id,
    });

    const response = await fetch(SSLCOMMERZ_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() });
    const data = await response.json() as Record<string, unknown>;

    if (data.status !== 'SUCCESS') {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Failed' } });
      const reason = (data.failedreason as string) || '';
      let userMessage = reason || 'Payment gateway unavailable.';
      if (reason.toLowerCase().includes('store credential')) userMessage = 'Payment gateway configuration error. Contact admin.';
      return res.status(400).json({ message: userMessage });
    }

    await prisma.transaction.update({ where: { id: tx.id }, data: { gatewayTxnId: data.sessionkey as string } });
    await prisma.auditLog.create({ data: { action: 'SSLCommerz Payment Initiated', actorId: userId, entityType: 'Transaction', entityId: tx.id, details: `Amount: ৳${amount}, Purpose: ${purpose}, Ref: ${ref}` } });

    res.json({ gatewayUrl: data.GatewayPageURL as string, transactionRef: ref, sessionKey: data.sessionkey as string });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/payment/validate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { transactionRef, purpose, itemId } = req.body;
    const tx = await prisma.transaction.findFirst({ where: { reference: transactionRef } });
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    if (tx.status === 'Success') {
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
      return res.json({ status: 'valid', newBalance: wallet?.balance || 0, message: 'Payment already confirmed' });
    }
    if (tx.status === 'Failed' || tx.status === 'Cancelled') return res.json({ status: 'failed', message: `Payment ${tx.status?.toLowerCase()}` });

    const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
    const VALIDATION_URL = isLive ? 'https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php' : 'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php';

    const params = new URLSearchParams({ store_id: process.env.SSLCOMMERZ_STORE_ID || '', store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '', merchanttran_id: transactionRef, v: '1', format: 'json' });
    const response = await fetch(`${VALIDATION_URL}?${params.toString()}`);
    const data = await response.json() as Record<string, unknown>;
    const element = Array.isArray(data.element) ? data.element[0] : data;
    const sslStatus = (element?.status as string)?.toUpperCase();
    const validId = element?.val_id as string;
    const bankTranId = element?.bank_tran_id as string;
    const amount = parseFloat(element?.amount as string) || tx.amount || 0;

    if (sslStatus === 'VALID' || sslStatus === 'VALIDATED') {
      if (Math.abs(amount - (tx.amount || 0)) > 1) {
        await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Failed' } });
        return res.status(400).json({ message: 'Payment amount mismatch.' });
      }

      const cardType = (element?.card_type as string) || '';
      const payMethod = cardType.includes('bkash') ? 'bKash' : cardType.includes('nagad') ? 'Nagad' : cardType.includes('rocket') ? 'Rocket' : cardType.includes('visa') || cardType.includes('master') ? 'Card' : 'Online';
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Success', gatewayTxnId: validId, bankTxnId: bankTranId, paymentMethod: payMethod } });

      let wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
      if (!wallet) wallet = await prisma.wallet.create({ data: { walletId: `W-${userId.slice(0, 8)}`, ownerId: userId, balance: 0 } });

      let newBalance = wallet.balance || 0;
      if (purpose === 'topup') {
        newBalance = newBalance + amount;
        await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
      }

      if (itemId) {
        if (purpose === 'semester_fee') await prisma.semesterFee.update({ where: { id: itemId }, data: { status: 'Paid', reference: transactionRef } });
        else if (purpose === 'library_fine') await prisma.libraryFine.update({ where: { id: itemId }, data: { status: 'Paid', reference: transactionRef } });
        else if (purpose === 'admin_fine') await prisma.adminFine.update({ where: { id: itemId }, data: { status: 'Paid', reference: transactionRef } });
        else if (purpose === 'pay_later') await prisma.payLaterDue.update({ where: { id: itemId }, data: { status: 'Paid', paymentReference: transactionRef } });
      }

      return res.json({ status: 'valid', newBalance, message: purpose === 'topup' ? `৳${amount} added to wallet` : 'Payment successful' });
    }

    if (sslStatus === 'FAILED' || sslStatus === 'CANCELLED') {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: sslStatus === 'FAILED' ? 'Failed' : 'Cancelled' } });
      return res.json({ status: 'failed', message: `Payment ${sslStatus.toLowerCase()}` });
    }

    res.json({ status: 'pending', message: 'Payment is still being processed' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN ROUTES ───
router.post('/admin/overview', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [totalStudents, totalShops, totalTransactions, recentLogs] = await Promise.all([
      prisma.user.count({ where: { role: 'Student' } }),
      prisma.shop.count(),
      prisma.transaction.count(),
      prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: 'desc' }, include: { actor: true } }),
    ]);
    const txSum = await prisma.transaction.aggregate({ _sum: { amount: true }, where: { status: 'Success', direction: 'Credit' } });
    const pendingFines = await prisma.adminFine.count({ where: { status: 'Pending' } });

    res.json({
      totalStudents, totalShops, totalTransactions, totalRevenue: txSum._sum.amount || 0, pendingFines,
      recentActivity: recentLogs.map(l => ({ id: l.id, action: l.action, actor: l.actorId || '', actorName: l.actor?.fullName || '', entityType: l.entityType || '', details: l.details || '', createdAt: l.createdAt.toISOString() })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/seed', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const existingShops = await prisma.shop.findMany({ take: 1 });
    if (existingShops.length > 0) return res.json({ success: false, message: 'Database already has data. Seed skipped.' });

    const shopNames = ['Campus Café', 'BookNest Stationery', 'PrintHub', 'Green Bites', 'TechZone', 'Coffee Corner', 'Pen & Paper', 'Quick Print', 'Fresh Eats', 'Campus Mart'];
    const shopCats = ['Food & Beverage', 'Stationery', 'Printing', 'Other'];

    for (let i = 0; i < shopNames.length; i++) {
      await prisma.shop.create({
        data: {
          name: shopNames[i], category: shopCats[i % shopCats.length],
          rating: Math.round((3 + Math.random() * 2) * 10) / 10, status: 'Active',
          qrToken: `QR-${crypto.randomBytes(6).toString('hex')}`,
          merchantId: `MERCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          location: `Building ${String.fromCharCode(65 + (i % 5))}, Floor ${(i % 3) + 1}`,
        },
      });
    }
    await prisma.auditLog.create({ data: { action: 'System Seeded', actorId: req.user!.id, entityType: 'System', details: 'Demo data seeded' } });
    res.json({ success: true, message: 'Seeded: 10 shops created' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/shops', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const shops = await prisma.shop.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
    res.json({
      shops: shops.map(s => ({
        id: s.id, name: s.name, category: s.category, rating: s.rating,
        status: s.status, location: s.location || '', logoUrl: s.logoUrl || '',
        merchantId: s.merchantId || '', qrToken: s.qrToken || '',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/shops/manage', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { action, shopId, ...data } = req.body;
    if (action === 'create') {
      const shop = await prisma.shop.create({ data: { ...data, qrToken: `QR-${crypto.randomBytes(6).toString('hex')}`, merchantId: `MERCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}` } });
      return res.json({ success: true, message: 'Shop created', shopId: shop.id });
    }
    if (action === 'update') {
      await prisma.shop.update({ where: { id: shopId }, data });
      return res.json({ success: true, message: 'Shop updated' });
    }
    if (action === 'delete' || action === 'deactivate') {
      await prisma.shop.update({ where: { id: shopId }, data: { status: 'Inactive' } });
      return res.json({ success: true, message: 'Shop deactivated' });
    }
    res.status(400).json({ message: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/audit-logs', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { limit = 50, offset = 0, action, entityType } = req.body;
    const where: any = {};
    if (action) where.action = { contains: action };
    if (entityType) where.entityType = entityType;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' }, include: { actor: true } }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      logs: logs.map(l => ({
        id: l.id, action: l.action, actor: l.actorId || '', actorName: l.actor?.fullName || '',
        entityType: l.entityType || '', entityId: l.entityId || '', details: l.details || '',
        ipAddress: l.ipAddress || '', createdAt: l.createdAt.toISOString(),
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/staff', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { search } = req.body;
    let staff = await prisma.user.findMany({ where: { role: { not: 'Student' } }, take: 500 });
    let result = staff.map(u => ({ id: u.id, fullName: u.fullName || '', email: u.email, role: u.role || '', phone: u.phone || '', status: u.status || 'Active', department: u.department || '' }));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s: any) => s.fullName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.role.toLowerCase().includes(q));
    }
    res.json({ staff: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/staff/manage', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { action, userId, ...data } = req.body;
    if (action === 'create') {
      const hashed = await bcrypt.hash(data.password || 'changeme123', 10);
      await prisma.user.create({ data: { email: data.email, password: hashed, fullName: data.fullName, role: data.role, department: data.department, phone: data.phone, status: 'Active' } });
      return res.json({ success: true, message: 'Staff account created' });
    }
    if (action === 'update') {
      await prisma.user.update({ where: { id: userId }, data });
      return res.json({ success: true, message: 'Staff updated' });
    }
    if (action === 'suspend') {
      await prisma.user.update({ where: { id: userId }, data: { status: 'Suspended' } });
      return res.json({ success: true, message: 'Staff suspended' });
    }
    if (action === 'activate') {
      await prisma.user.update({ where: { id: userId }, data: { status: 'Active' } });
      return res.json({ success: true, message: 'Staff activated' });
    }
    res.status(400).json({ message: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/search-students', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query } = req.body;
    if (!query || query.length < 2) return res.json({ students: [] });
    const students = await prisma.user.findMany({
      where: {
        role: 'Student',
        OR: [
          { fullName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { studentId: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });
    res.json({
      students: students.map(s => ({
        id: s.id, fullName: s.fullName || '', email: s.email, studentId: s.studentId || '',
        department: s.department || '', batch: s.batch || '', status: s.status || 'Active',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/fines/assign', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { studentId, reason, amount, incidentDate } = req.body;
    const ref = `AF-${Date.now().toString(36).toUpperCase()}`;
    const fine = await prisma.adminFine.create({ data: { reason, studentId, amount, incidentDate: incidentDate || new Date().toISOString().split('T')[0], status: 'Pending', reference: ref } });
    await prisma.auditLog.create({ data: { action: 'Admin Fine Assigned', actorId: req.user!.id, entityType: 'AdminFine', entityId: fine.id, details: `Fine of ৳${amount}: ${reason}` } });
    res.json({ success: true, fineId: fine.id, message: 'Fine assigned successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/waivers', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const disputed = await prisma.adminFine.findMany({ where: { status: 'Disputed' }, include: { student: true } });
    const libDisputed = await prisma.libraryFine.findMany({ where: { status: 'Disputed' }, include: { student: true } });

    const waivers = [
      ...disputed.map(f => ({ id: f.id, type: 'admin', label: f.reason || '', amount: f.amount, studentName: f.student?.fullName || '', studentEmail: f.student?.email || '', status: f.status, reason: f.reason || '', createdAt: f.createdAt.toISOString() })),
      ...libDisputed.map(f => ({ id: f.id, type: 'library', label: f.label || '', amount: f.amount, studentName: f.student?.fullName || '', studentEmail: f.student?.email || '', status: f.status, reason: f.label || '', createdAt: f.createdAt.toISOString() })),
    ];
    res.json({ waivers });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/waivers/update', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { waiverId, type, action } = req.body;
    const newStatus = action === 'approve' ? 'Waived' : action === 'reject' ? 'Pending' : 'Pending';
    if (type === 'admin') await prisma.adminFine.update({ where: { id: waiverId }, data: { status: newStatus } });
    else await prisma.libraryFine.update({ where: { id: waiverId }, data: { status: newStatus } });
    res.json({ success: true, message: `Waiver ${action}d` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── LIBRARY ROUTES ───
router.post('/library/overview', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [total, pending, paid] = await Promise.all([
      prisma.libraryFine.count(),
      prisma.libraryFine.count({ where: { status: 'Pending' } }),
      prisma.libraryFine.count({ where: { status: 'Paid' } }),
    ]);
    const [totalAmt, pendingAmt, paidAmt] = await Promise.all([
      prisma.libraryFine.aggregate({ _sum: { amount: true } }),
      prisma.libraryFine.aggregate({ _sum: { amount: true }, where: { status: 'Pending' } }),
      prisma.libraryFine.aggregate({ _sum: { amount: true }, where: { status: 'Paid' } }),
    ]);
    const recent = await prisma.libraryFine.findMany({ take: 10, orderBy: { createdAt: 'desc' }, include: { student: true } });

    res.json({
      totalFines: total, pendingFines: pending, paidFines: paid,
      totalAmount: totalAmt._sum.amount || 0, pendingAmount: pendingAmt._sum.amount || 0, paidAmount: paidAmt._sum.amount || 0,
      recentFines: recent.map(f => ({ id: f.id, label: f.label || '', studentName: f.student?.fullName || '', fineType: f.fineType || '', amount: f.amount, status: f.status, dueDate: f.dueDate || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/student-lookup', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { identifier } = req.body;
    let student = await prisma.user.findUnique({ where: { email: identifier } });
    if (!student) student = await prisma.user.findUnique({ where: { studentId: identifier } });
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const fines = await prisma.libraryFine.findMany({ where: { studentId: student.id } });
    res.json({
      student: { id: student.id, fullName: student.fullName || '', email: student.email, studentId: student.studentId || '', department: student.department || '', batch: student.batch || '' },
      fines: fines.map(f => ({ id: f.id, label: f.label || '', fineType: f.fineType || '', amount: f.amount, status: f.status, dueDate: f.dueDate || '', reference: f.reference || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/fines/assign', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { studentId, fineType, amount, dueDate, label } = req.body;
    const ref = `LIB-${Date.now().toString(36).toUpperCase()}`;
    const fine = await prisma.libraryFine.create({ data: { label: label || `${fineType} Fine`, studentId, fineType, amount, dueDate, status: 'Pending', reference: ref } });
    await prisma.auditLog.create({ data: { action: 'Library Fine Assigned', actorId: req.user!.id, entityType: 'LibraryFine', entityId: fine.id, details: `${fineType} fine of ৳${amount}` } });
    res.json({ success: true, fineId: fine.id, message: 'Library fine assigned' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/fines/waive', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fineId, reason } = req.body;
    await prisma.libraryFine.update({ where: { id: fineId }, data: { status: 'Waived' } });
    await prisma.auditLog.create({ data: { action: 'Library Fine Waived', actorId: req.user!.id, entityType: 'LibraryFine', entityId: fineId, details: reason || 'Fine waived' } });
    res.json({ success: true, message: 'Fine waived' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/clearance', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const students = await prisma.user.findMany({ where: { role: 'Student' }, take: 100 });
    const result = [];
    for (const s of students) {
      const fines = await prisma.libraryFine.findMany({ where: { studentId: s.id, status: 'Pending' } });
      const totalAmount = fines.reduce((sum, f) => sum + f.amount, 0);
      result.push({
        id: s.id, fullName: s.fullName || '', studentId: s.studentId || '', department: s.department || '',
        hasPendingFines: fines.length > 0, totalPending: fines.length, totalAmount,
      });
    }
    res.json({ students: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ACCOUNTS ROUTES ───
router.post('/accounts/overview', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [totalAgg, collectedAgg, pendingAgg] = await Promise.all([
      prisma.semesterFee.aggregate({ _sum: { amount: true } }),
      prisma.semesterFee.aggregate({ _sum: { amount: true }, where: { status: 'Paid' } }),
      prisma.semesterFee.aggregate({ _sum: { amount: true }, where: { status: 'Pending' } }),
    ]);
    const total = totalAgg._sum.amount || 0;
    const collected = collectedAgg._sum.amount || 0;
    const pending = pendingAgg._sum.amount || 0;

    const recent = await prisma.semesterFee.findMany({ where: { status: 'Paid' }, take: 10, orderBy: { updatedAt: 'desc' }, include: { student: true } });
    res.json({
      totalFees: total, totalCollected: collected, totalPending: pending,
      collectionRate: total > 0 ? Math.round((collected / total) * 100) : 0,
      recentPayments: recent.map(r => ({ id: r.id, studentName: r.student?.fullName || '', amount: r.amount, status: r.status, date: r.updatedAt.toISOString() })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/fee-push', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { label, amount, dueDate, department, batch } = req.body;
    const where: any = { role: 'Student' };
    if (department) where.department = department;
    if (batch) where.batch = batch;
    const students = await prisma.user.findMany({ where });

    let count = 0;
    for (const s of students) {
      await prisma.semesterFee.create({
        data: { label, studentId: s.id, amount, dueDate, status: 'Pending', reference: `SF-${Date.now().toString(36).toUpperCase()}-${count}` },
      });
      count++;
    }
    res.json({ success: true, message: `Fee pushed to ${count} students`, count });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/fee-adjust', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { feeId, newAmount, newStatus, reason } = req.body;
    const data: any = {};
    if (newAmount !== undefined) data.amount = newAmount;
    if (newStatus) data.status = newStatus;
    await prisma.semesterFee.update({ where: { id: feeId }, data });
    await prisma.auditLog.create({ data: { action: 'Semester Fee Adjusted', actorId: req.user!.id, entityType: 'SemesterFee', entityId: feeId, details: reason || 'Fee adjusted' } });
    res.json({ success: true, message: 'Fee adjusted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/analytics', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const students = await prisma.user.findMany({ where: { role: 'Student' } });
    const fees = await prisma.semesterFee.findMany({ include: { student: true } });

    const deptMap: Record<string, { total: number; paid: number; pending: number }> = {};
    fees.forEach(f => {
      const dept = f.student?.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { total: 0, paid: 0, pending: 0 };
      deptMap[dept].total += f.amount;
      if (f.status === 'Paid') deptMap[dept].paid += f.amount;
      else deptMap[dept].pending += f.amount;
    });

    const total = fees.reduce((s, f) => s + f.amount, 0);
    const collected = fees.filter(f => f.status === 'Paid').reduce((s, f) => s + f.amount, 0);

    res.json({
      byDepartment: Object.entries(deptMap).map(([department, data]) => ({ department, ...data })),
      byStatus: [
        { status: 'Paid', count: fees.filter(f => f.status === 'Paid').length, amount: collected },
        { status: 'Pending', count: fees.filter(f => f.status === 'Pending').length, amount: total - collected },
      ],
      timeline: [],
      totalStudents: students.length, totalFees: total, collected,
      collectionRate: total > 0 ? Math.round((collected / total) * 100) : 0,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/withdrawals', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const txns = await prisma.transaction.findMany({ where: { type: 'Withdrawal' }, take: 100, orderBy: { createdAt: 'desc' }, include: { user: true } });
    res.json({
      withdrawals: txns.map(t => ({
        id: t.id, reference: t.reference, studentName: t.user?.fullName || '', studentEmail: t.user?.email || '',
        amount: t.amount, method: t.gateway || '', accountDetails: t.description || '',
        status: t.status, createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/withdrawals/process', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { transactionId, action } = req.body;
    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    if (action === 'approve') {
      await prisma.transaction.update({ where: { id: transactionId }, data: { status: 'Success' } });
    } else {
      await prisma.transaction.update({ where: { id: transactionId }, data: { status: 'Cancelled' } });
      // Refund to wallet
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: tx.userId } });
      if (wallet) await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: wallet.balance + tx.amount } });
    }
    res.json({ success: true, message: `Withdrawal ${action}d` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SHOP DASHBOARD ROUTES ───
router.post('/shop/dashboard', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // Find shop where the user is associated (by matching merchantId or just get the first shop for shop staff)
    const shop = await prisma.shop.findFirst({ where: { status: 'Active' } });
    if (!shop) return res.status(404).json({ message: 'No shop found' });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayTxns, weekTxns, monthTxns, recentTxns, payLater] = await Promise.all([
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: todayStart } } }),
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: weekStart } } }),
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: monthStart } } }),
      prisma.transaction.findMany({ where: { shopId: shop.id }, take: 20, orderBy: { createdAt: 'desc' } }),
      prisma.payLaterDue.findMany({ where: { shopId: shop.id, status: 'Pending' }, include: { student: true } }),
    ]);

    res.json({
      shop: { id: shop.id, name: shop.name, category: shop.category, rating: shop.rating, status: shop.status, location: shop.location || '', logoUrl: shop.logoUrl || '', merchantId: shop.merchantId || '', qrToken: shop.qrToken || '', qrSignature: shop.qrSignature || '' },
      todayRevenue: todayTxns.reduce((s, t) => s + t.amount, 0), todayTransactions: todayTxns.length,
      weekRevenue: weekTxns.reduce((s, t) => s + t.amount, 0), monthRevenue: monthTxns.reduce((s, t) => s + t.amount, 0),
      recentTransactions: recentTxns.map(t => ({ id: t.id, reference: t.reference, amount: t.amount, status: t.status, description: t.description || '', paymentMethod: t.paymentMethod || '', createdAt: t.createdAt.toISOString() })),
      pendingPayLater: payLater.map(p => ({ id: p.id, reference: p.reference || '', amount: p.amount, status: p.status, studentName: p.student?.fullName || '', dueDate: p.dueDate || '', description: p.description || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shop/regenerate-qr', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const shop = await prisma.shop.findFirst({ where: { status: 'Active' } });
    if (!shop) return res.status(404).json({ message: 'Shop not found' });

    const newToken = `QR-${crypto.randomBytes(8).toString('hex')}`;
    await prisma.shop.update({ where: { id: shop.id }, data: { qrToken: newToken } });
    res.json({ success: true, qrToken: newToken, message: 'QR regenerated' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DEPRECATED ───
router.post('/wallet/add-money', authMiddleware, async (_req: AuthRequest, res) => {
  res.status(400).json({ message: 'Direct deposits are disabled. Use SSLCommerz.' });
});

// Health check
router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Start server
app.use('/api', router);
app.use('/', router);

// Fallback JSON 404 handler (ensures HTML is NEVER returned)
app.use((_req, res) => {
  res.status(404).json({ message: 'API endpoint not found. Please check endpoint URL.' });
});

app.listen(PORT, () => {
  console.log(`🎓 Smart Campus API running on port ${PORT}`);
});