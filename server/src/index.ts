import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import prisma from './lib/prisma';
import { authMiddleware, generateToken, requireRole, AuthRequest } from './lib/auth';
import { sendEmail } from './lib/email';
import { notifyUser } from './lib/notify';
import { generateTabularReport, ReportFormat } from './lib/report';
import http from 'http';
import studentDisputeRouter from './routes/disputes/student';
import accountsDisputeRouter from './routes/disputes/accounts';
import adminDisputeRouter from './routes/disputes/admin';
import libraryDisputeRouter from './routes/disputes/library';
import shopDisputeRouter from './routes/disputes/shop';
import { disputeNotificationsRouter } from './routes/disputes/shared';
import feeRouter from './routes/fees.js';
import { attachRealtime } from './lib/realtime';

// Abuse backstops for the two payment-confirmation entry points. Render's free tier runs a
// single instance, so in-memory rate limiting (express-rate-limit's default store) is sufficient
// — no Redis needed.
const paymentInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.user?.id || ipKeyGenerator(req.ip || 'unknown'),
  message: { message: 'Too many payment attempts. Please wait a moment and try again.' },
});
const paymentIpnLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});

const app = express();
const PORT = process.env.PORT || 4000;

// Render sits in front of this app as a reverse proxy — without this, req.ip reflects the proxy
// hop rather than the real client, which the Financial Dispute module relies on for IP capture on
// every transaction and audit log entry.
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
// Auth is Bearer-token only (JWT in the Authorization header) — no cookies are ever set or read,
// so `credentials: true` here was inconsistent with an open `origin: '*'` (browsers reject that
// combination for credentialed requests). Since no request ever uses `credentials: 'include'`,
// this was harmless in practice, but corrected for a technically-valid CORS configuration.
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
// SSLCommerz's IPN callback posts as application/x-www-form-urlencoded, not JSON.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const router = express.Router();

// Role gates for the four staff dashboards — see requireRole in lib/auth.ts for why this exists.
const requireAdmin = requireRole('Admin Office');
const requireLibrary = requireRole('Library');
const requireAccounts = requireRole('Accounts Office');
const requireShopStaff = requireRole('Shop Staff');

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

// How long we're willing to hold the HTTP response open waiting for the OTP email to actually
// send before responding anyway. The Gmail API (see server/src/lib/email.ts) sends over HTTPS
// and normally completes in well under a second — this budget is a safety net against a slow
// OAuth refresh or unreachable Gmail API, not something normal sends are expected to hit.
const OTP_EMAIL_RESPONSE_BUDGET_MS = 6000;

// Send OTP for student registration
router.post('/auth/register-otp', async (req, res) => {
  const timings: Record<string, number | string> = {};
  const requestStart = Date.now();
  let stepStart = requestStart;
  const mark = (label: string) => { timings[label] = Date.now() - stepStart; stepStart = Date.now(); };

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const lowerEmail = email.toLowerCase().trim();
    if (!lowerEmail.endsWith('@std.ewubd.edu')) {
      return res.status(400).json({ message: 'Registration is restricted to @std.ewubd.edu email addresses only.' });
    }
    mark('validation');

    // Extract studentId from email prefix if applicable (e.g. 2023-2-60-053)
    const emailPrefix = lowerEmail.split('@')[0];
    const studentIdMatch = emailPrefix.match(/^\d{4}-\d-\d{2}-\d{3}$/) ? emailPrefix : undefined;

    // These two lookups don't depend on each other — run them concurrently instead of in series.
    const [existing, existingSid] = await Promise.all([
      prisma.user.findUnique({ where: { email: lowerEmail } }),
      studentIdMatch ? prisma.user.findUnique({ where: { studentId: studentIdMatch } }) : Promise.resolve(null),
    ]);
    mark('database');

    if (existing) return res.status(400).json({ message: 'An account with this email already exists.' });
    if (studentIdMatch && existingSid) return res.status(400).json({ message: `Student ID ${studentIdMatch} is already registered.` });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    mark('otpGenerate');

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
    mark('otpSave');

    const emailPromise = sendEmail(lowerEmail, 'Verification Code — Smart Campus EWU', [
      { type: 'text', content: `<strong>Welcome to Smart Campus!</strong>\n\nYour registration verification code is:\n\n<strong style="font-size: 28px; letter-spacing: 8px; color: #f59e0b;">${code}</strong>\n\nThis code is valid for 5 minutes.\nIf you did not request this code, please ignore this email.` },
      { type: 'divider' },
      { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
    ]).then(
      () => ({ ok: true as const }),
      (err: any) => ({ ok: false as const, err }),
    );

    const TIMED_OUT = Symbol('timed-out');
    const result = await Promise.race([
      emailPromise,
      new Promise<typeof TIMED_OUT>(resolve => setTimeout(() => resolve(TIMED_OUT), OTP_EMAIL_RESPONSE_BUDGET_MS)),
    ]);

    if (result === TIMED_OUT) {
      // Shouldn't happen after the transporter fix — but if the network has an unusually bad
      // moment, don't make the student stare at "Sending OTP..." for it. Respond now; if the
      // send ultimately fails, delete the OTP so a stale/undelivered code can't be used, and the
      // student's "Resend Code" click gets a fresh, fully synchronous attempt with a real error.
      timings.emailSend = `>${OTP_EMAIL_RESPONSE_BUDGET_MS} (responded early, continuing in background)`;
      console.warn(`[register-otp] Email send exceeded ${OTP_EMAIL_RESPONSE_BUDGET_MS}ms budget for ${lowerEmail} — responding early`);
      emailPromise.then(r => {
        if (!r.ok) {
          console.error(`[register-otp] Background email send ultimately FAILED for ${lowerEmail}:`, r.err.message);
          prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        } else {
          console.log(`[register-otp] Background email send for ${lowerEmail} succeeded after the response was already sent.`);
        }
      });
    } else {
      mark('emailSend');
      if (!result.ok) {
        await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        timings.total = Date.now() - requestStart;
        console.log(`[register-otp] TIMINGS (failed) for ${lowerEmail}:`, timings);
        return res.status(502).json({ message: `Could not send the verification email: ${result.err.message} Please check the server's email configuration.` });
      }
    }

    timings.total = Date.now() - requestStart;
    console.log(`[register-otp] TIMINGS for ${lowerEmail}:`, timings);
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
        pinLength: 4,
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

    // Accept the account's own PIN length — legacy accounts kept their original 4-digit PIN
    // when the policy moved to 6 digits, so the server checks each user's actual pinLength.
    const expectedPinLength = user.pinLength || 4;
    const pinLengthPattern = new RegExp(`^\\d{${expectedPinLength}}$`);
    if (!authenticated && user.pinSet && user.pinHash && pinLengthPattern.test(password)) {
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
        pinLength: user.pinLength || 4,
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
        pinLength: user.pinLength || 4,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot Password — Request OTP
router.post('/auth/forgot-password/otp', async (req, res) => {
  const timings: Record<string, number | string> = {};
  const requestStart = Date.now();
  let stepStart = requestStart;
  const mark = (label: string) => { timings[label] = Date.now() - stepStart; stepStart = Date.now(); };

  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ message: 'Email or Student ID is required' });

    const trimmed = identifier.trim();
    // These two lookups don't depend on each other — run them concurrently instead of in series.
    const [byEmail, byStudentId] = await Promise.all([
      prisma.user.findUnique({ where: { email: trimmed.toLowerCase() } }),
      prisma.user.findUnique({ where: { studentId: trimmed } }),
    ]);
    const user = byEmail || byStudentId;
    mark('database');

    if (!user || !user.email) return res.status(404).json({ message: 'No account found with this Email or Student ID.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    mark('otpGenerate');

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
    mark('otpSave');

    const emailPromise = sendEmail(user.email, 'Password Reset OTP — Smart Campus', [
      { type: 'text', content: `<strong>Hi ${user.fullName || 'Student'},</strong>\n\nYou requested a password reset. Your verification code is:\n\n<strong style="font-size: 28px; letter-spacing: 8px; color: #f59e0b;">${code}</strong>\n\nThis code expires in 5 minutes.` },
      { type: 'divider' },
      { type: 'text', content: '🎓 East West University — Smart Campus Digital Wallet' },
    ]).then(
      () => ({ ok: true as const }),
      (err: any) => ({ ok: false as const, err }),
    );

    const TIMED_OUT = Symbol('timed-out');
    const result = await Promise.race([
      emailPromise,
      new Promise<typeof TIMED_OUT>(resolve => setTimeout(() => resolve(TIMED_OUT), OTP_EMAIL_RESPONSE_BUDGET_MS)),
    ]);

    if (result === TIMED_OUT) {
      timings.emailSend = `>${OTP_EMAIL_RESPONSE_BUDGET_MS} (responded early, continuing in background)`;
      console.warn(`[forgot-password/otp] Email send exceeded ${OTP_EMAIL_RESPONSE_BUDGET_MS}ms budget for ${user.email} — responding early`);
      emailPromise.then(r => {
        if (!r.ok) {
          console.error(`[forgot-password/otp] Background email send ultimately FAILED for ${user.email}:`, r.err.message);
          prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        } else {
          console.log(`[forgot-password/otp] Background email send for ${user.email} succeeded after the response was already sent.`);
        }
      });
    } else {
      mark('emailSend');
      if (!result.ok) {
        await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        timings.total = Date.now() - requestStart;
        console.log(`[forgot-password/otp] TIMINGS (failed) for ${user.email}:`, timings);
        return res.status(502).json({ message: `Could not send the reset email: ${result.err.message} Please check the server's email configuration.` });
      }
    }

    timings.total = Date.now() - requestStart;
    console.log(`[forgot-password/otp] TIMINGS for ${user.email}:`, timings);
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

    void notifyUser({
      recipientId: otp.userId, category: 'security', type: 'password.reset',
      title: 'Password Changed', body: 'Your password was just reset. If this wasn\'t you, contact support immediately.',
      link: '/student/profile',
      emailSubject: 'Security Alert: Password Changed — Smart Campus',
    });

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
        pinLength: req.user!.pinLength || 4,
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

// ─── SHOP PAY LATER ───
// Instant "Pay Now" shop payments no longer exist here — those go through
// /payment/init (purpose: 'shop_payment', see SSL PAYMENT section below). This route only
// creates a deferred due; no money moves and no gateway is involved until it's settled later.
router.post('/shops/pay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { shopId, shopName, amount, description } = req.body;
    const ref = `SHP-${Date.now().toString(36).toUpperCase()}`;

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

    void notifyUser({
      recipientId: userId, category: 'payment', type: 'shop.paylater.created',
      title: 'Pay-Later Due Created', body: `৳${amount.toLocaleString()} due at ${shopName || 'a shop'} by ${dueDate.toLocaleDateString()}.`,
      link: '/student/dues',
      emailSubject: `Pay-Later Due Created — ৳${amount} — Smart Campus`,
    });

    res.json({ success: true, transactionId: tx.id, dueId: due.id });
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
    const { studentId: targetStudentId } = req.body as { studentId?: string };
    const canOverride = targetStudentId && ['Accounts Office', 'Admin Office'].includes(req.user!.role || '');
    const userId = canOverride ? targetStudentId! : req.user!.id;
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

// ─── DISPUTE FINE ───
router.post('/fines/dispute', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fineId, source, reason } = req.body;
    if (source === 'admin') await prisma.adminFine.update({ where: { id: fineId }, data: { status: 'Disputed' } });
    else if (source === 'library') await prisma.libraryFine.update({ where: { id: fineId }, data: { status: 'Disputed' } });
    await prisma.auditLog.create({ data: { action: 'Fine Disputed', actorId: req.user!.id, entityType: 'Fine', entityId: fineId, details: reason, ipAddress: req.ip } });
    res.json({ success: true, message: 'Dispute submitted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── TRANSACTIONS ───
router.post('/transactions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { type, direction, status, gatewayOnly, limit = 50, offset = 0 } = req.body;
    const where: any = { userId };
    if (type && type !== 'all') where.type = type;
    if (direction && direction !== 'all') where.direction = direction;
    if (Array.isArray(status) && status.length) where.status = { in: status };
    else if (status && status !== 'all') where.status = status;
    // Payments Dashboard: restrict to real external gateway payments (SSLCommerz, bKash, Nagad,
    // Rocket withdrawals, etc.), excluding internal wallet-to-wallet transfers — those are tagged
    // gateway: 'Wallet' rather than null, so a plain not-null check isn't enough to exclude them.
    if (gatewayOnly) where.gateway = { not: null, notIn: ['Wallet'] };

    const [records, total] = await Promise.all([
      prisma.transaction.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.transaction.count({ where }),
    ]);

    // Payments Dashboard: per-status counts across all gateway payments (ignoring the status
    // filter itself, so tab badges stay accurate regardless of which tab is active).
    let statusCounts: Record<string, number> | undefined;
    if (gatewayOnly) {
      const { status: _ignored, ...countWhere } = where;
      const grouped = await prisma.transaction.groupBy({ by: ['status'], where: countWhere, _count: { status: true } });
      statusCounts = grouped.reduce((acc, g) => { acc[g.status] = g._count.status; return acc; }, {} as Record<string, number>);
    }

    res.json({
      transactions: records.map(t => ({
        id: t.id, reference: t.reference, type: t.type, direction: t.direction,
        amount: t.amount, status: t.status, description: t.description || '',
        paymentMethod: t.paymentMethod || '', gateway: t.gateway || '',
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      hasMore: offset + records.length < total,
      ...(statusCounts ? { statusCounts } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── NOTIFICATIONS ───
// Merges the persisted Notification table (wallet/security/payment events — see lib/notify.ts)
// with DisputeNotification (dispute-case events, already role-agnostic) into one feed per user,
// each tagged with a role-aware deep link so the bell/list can navigate straight to the source.
const ROLE_BASE_PATH: Record<string, string> = {
  Student: '/student', 'Admin Office': '/admin', Library: '/library',
  'Accounts Office': '/accounts', 'Shop Staff': '/shop',
};

router.post('/notifications', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const base = ROLE_BASE_PATH[req.user!.role || ''] || '/student';
    const { category, unreadOnly, search } = req.body as { category?: string; unreadOnly?: boolean; search?: string };

    const [general, disputes] = await Promise.all([
      prisma.notification.findMany({ where: { recipientId: userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.disputeNotification.findMany({ where: { recipientId: userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);

    let merged = [
      ...general.map(n => ({
        id: n.id, source: 'general' as const, category: n.category, type: n.type,
        title: n.title, body: n.body, link: n.link || base,
        read: !!n.readAt, createdAt: n.createdAt.toISOString(),
      })),
      ...disputes.map(n => ({
        id: n.id, source: 'dispute' as const, category: 'dispute', type: n.type,
        title: n.title, body: n.body,
        link: n.disputeId ? `${base}/disputes/detail?disputeId=${n.disputeId}` : `${base}/disputes`,
        read: !!n.readAt, createdAt: n.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const unreadCount = merged.filter(n => !n.read).length;

    if (category) merged = merged.filter(n => n.category === category);
    if (unreadOnly) merged = merged.filter(n => !n.read);
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      merged = merged.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
    }

    res.json({ notifications: merged.slice(0, 100), unreadCount });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [a, b] = await Promise.all([
      prisma.notification.count({ where: { recipientId: userId, readAt: null } }),
      prisma.disputeNotification.count({ where: { recipientId: userId, readAt: null } }),
    ]);
    res.json({ unreadCount: a + b });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/notifications/mark-read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id, source } = req.body as { id?: string; source?: 'general' | 'dispute' };
    if (id && source === 'dispute') {
      await prisma.disputeNotification.updateMany({ where: { id, recipientId: userId }, data: { readAt: new Date() } });
    } else if (id) {
      await prisma.notification.updateMany({ where: { id, recipientId: userId }, data: { readAt: new Date() } });
    } else {
      await Promise.all([
        prisma.notification.updateMany({ where: { recipientId: userId, readAt: null }, data: { readAt: new Date() } }),
        prisma.disputeNotification.updateMany({ where: { recipientId: userId, readAt: null }, data: { readAt: new Date() } }),
      ]);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── RECEIPT ───
// Generates (and caches on disk) a PDF receipt for a successful transaction. Idempotent — a
// transaction's fields never change once Success, so the file is only built once and reused.
async function generateReceiptPdf(tx: {
  id: string; reference: string; type: string; amount: number; status: string;
  paymentMethod: string | null; gateway: string | null; gatewayTxnId: string | null; bankTxnId: string | null;
  createdAt: Date; user: { fullName: string | null; studentId: string | null } | null; shop: { name: string } | null;
}): Promise<string> {
  const dir = path.join(__dirname, '../uploads/receipts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${tx.reference}.pdf`;
  const filepath = path.join(dir, filename);

  if (!fs.existsSync(filepath)) {
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).font('Helvetica-Bold').text('Smart Campus — Payment Receipt', { align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('East West University Digital Wallet', { align: 'center' });
      doc.moveDown(2);

      const rows: [string, string][] = [
        ['Receipt Number', tx.reference],
        ['Transaction ID', tx.id],
        ['SSLCommerz Transaction ID', tx.gatewayTxnId || 'N/A'],
        ['Validation ID', tx.bankTxnId || 'N/A'],
        ['Date', tx.createdAt.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' })],
        ['Time', tx.createdAt.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', timeStyle: 'short' })],
        ['Amount', `৳ ${tx.amount.toLocaleString()}`],
        ['Payment Method', tx.paymentMethod || tx.gateway || 'N/A'],
        ['Receiver', tx.shop?.name || tx.type],
        ['Student Name', tx.user?.fullName || 'N/A'],
        ['Student ID', tx.user?.studentId || 'N/A'],
        ['Status', tx.status],
      ];

      doc.fillColor('#000');
      rows.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fontSize(11).text(`${label}:`, 50, doc.y, { continued: true, width: 220 });
        doc.font('Helvetica').text(`  ${value}`);
        doc.moveDown(0.5);
      });

      doc.moveDown(2);
      doc.fontSize(9).fillColor('#999').text('This receipt was generated automatically and, where applicable, verified via SSLCommerz.', { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  const backendUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;
  return `${backendUrl}/uploads/receipts/${filename}`;
}

router.post('/receipt', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { transactionId } = req.body;
    // Accepts either the internal id or the human-readable reference — some callers (e.g. the
    // payment-result screen) only have the SSLCommerz reference on hand at that point.
    const tx = await prisma.transaction.findFirst({
      where: { OR: [{ id: transactionId }, { reference: transactionId }] },
      include: { user: true, shop: true },
    });
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    let url: string | undefined;
    if (tx.status === 'Success') {
      url = await generateReceiptPdf(tx);
    }

    res.json({
      id: tx.id, reference: tx.reference, type: tx.type, direction: tx.direction,
      amount: tx.amount, status: tx.status, description: tx.description,
      paymentMethod: tx.paymentMethod, gateway: tx.gateway,
      gatewayTxnId: tx.gatewayTxnId, bankTxnId: tx.bankTxnId,
      createdAt: tx.createdAt.toISOString(),
      userName: tx.user?.fullName || '', userEmail: tx.user?.email || '',
      studentId: tx.user?.studentId || '', shopName: tx.shop?.name || '',
      url,
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
    if (senderWallet.frozen) return res.status(403).json({ message: 'Your wallet is frozen. Contact support.' });
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

    // Financial Dispute module — additive audit-context fields (receiver/balance/ip/device),
    // captured for both legs of the transfer; no existing field or control flow changed above.
    const deviceInfo = (req.headers['user-agent'] as string | undefined)?.slice(0, 300);
    const sendTx = await prisma.transaction.create({
      data: {
        reference: ref, userId: senderId, type: 'Transfer Sent', direction: 'Debit', amount, status: 'Success', gateway: 'Wallet',
        description: `Transfer to ${recipient.fullName || recipient.email}${note ? ` — ${note}` : ''}`,
        receiverId: recipient.id, receiverRoleSnapshot: recipient.role, receiverDepartmentSnapshot: recipient.department,
        balanceBefore: senderWallet.balance || 0, balanceAfter: senderNewBalance, ipAddress: req.ip, deviceInfo,
      },
    });
    await prisma.transaction.create({
      data: {
        reference: `${ref}-R`, userId: recipient.id, type: 'Transfer Received', direction: 'Credit', amount, status: 'Success', gateway: 'Wallet',
        description: `Transfer from ${req.user!.fullName || 'sender'}${note ? ` — ${note}` : ''}`,
        balanceBefore: recipientWallet.balance || 0, balanceAfter: recipientNewBalance, ipAddress: req.ip, deviceInfo,
      },
    });

    await prisma.auditLog.create({ data: { action: 'Wallet Transfer', actorId: senderId, entityType: 'Wallet', entityId: senderWallet.id, details: `Sent ৳${amount} to ${recipient.fullName || recipient.email} (${ref})`, ipAddress: req.ip } });

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

    void notifyUser({
      recipientId: senderId, category: 'wallet', type: 'transfer.sent',
      title: 'Transfer Sent', body: `You sent ৳${amount.toLocaleString()} to ${recipient.fullName || recipient.email}.`,
      link: '/student/ledger',
    });
    void notifyUser({
      recipientId: recipient.id, category: 'wallet', type: 'transfer.received',
      title: 'Transfer Received', body: `You received ৳${amount.toLocaleString()} from ${req.user!.fullName || 'a student'}.`,
      link: '/student/ledger',
    });

    res.json({ success: true, newBalance: senderNewBalance, transactionId: sendTx.id, recipientName: recipient.fullName || recipient.email || 'Unknown' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── WITHDRAWAL ───
router.post('/wallet/withdraw', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { amount, mobileNumber, provider = 'bKash' } = req.body;

    const withdrawAmt = Number(amount);
    if (!withdrawAmt || withdrawAmt < 100) {
      return res.status(400).json({ message: 'Minimum withdrawal amount is ৳100.' });
    }
    if (withdrawAmt > 25000) {
      return res.status(400).json({ message: 'Maximum withdrawal limit per transaction is ৳25,000.' });
    }

    const cleanMobile = String(mobileNumber || '').trim();
    if (!/^01\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({ message: 'Please enter a valid 11-digit Bangladeshi mobile number starting with 01.' });
    }

    // Server-side PIN freshness requirement (5 minutes)
    const freshUser = await prisma.user.findUnique({ where: { id: userId } });
    const pinFresh = freshUser?.pinVerifiedAt && (Date.now() - new Date(freshUser.pinVerifiedAt).getTime()) < AUTH_FRESHNESS_WINDOW_MS;
    if (!pinFresh) {
      return res.status(403).json({ message: 'Please verify your PIN before initiating a withdrawal.', requiresPin: true });
    }

    const wallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
    if (wallet?.frozen) return res.status(403).json({ message: 'Your wallet is frozen. Contact support.' });
    if (!wallet || (wallet.balance || 0) < withdrawAmt) {
      return res.status(400).json({ message: 'Insufficient wallet balance.' });
    }

    const newBalance = (wallet.balance || 0) - withdrawAmt;
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });

    const ref = `WTH-${Date.now().toString(36).toUpperCase()}`;
    const tx = await prisma.transaction.create({
      data: {
        reference: ref,
        userId,
        type: 'Withdrawal',
        direction: 'Debit',
        amount: withdrawAmt,
        status: 'Pending',
        gateway: provider,
        paymentMethod: provider,
        description: `Withdrawal via ${provider} (${cleanMobile})`,
        // Financial Dispute module — additive audit-context fields.
        balanceBefore: wallet.balance || 0,
        balanceAfter: newBalance,
        ipAddress: req.ip,
        deviceInfo: (req.headers['user-agent'] as string | undefined)?.slice(0, 300),
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'Wallet Withdrawal Initiated',
        actorId: userId,
        entityType: 'Transaction',
        entityId: tx.id,
        details: `Requested ৳${withdrawAmt} to ${provider} (${cleanMobile})`,
        ipAddress: req.ip,
      },
    });

    try {
      if (req.user?.email) {
        await sendEmail(req.user.email, `Withdrawal Request Placed — ৳${withdrawAmt} — Smart Campus`, [
          { type: 'text', content: `<strong>Hi ${req.user.fullName || 'Student'},</strong>\n\nYour withdrawal request for ৳${withdrawAmt.toLocaleString()} to ${provider} (${cleanMobile}) has been submitted and is currently being processed.\n\n<strong>Reference:</strong> ${ref}\n<strong>New Balance:</strong> ৳${newBalance.toLocaleString()}` },
          { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus' },
        ]);
      }
    } catch { /* best-effort */ }

    void notifyUser({
      recipientId: userId, category: 'wallet', type: 'withdraw.requested',
      title: 'Withdrawal Requested', body: `Your withdrawal of ৳${withdrawAmt.toLocaleString()} to ${provider} (${cleanMobile}) is being processed.`,
      link: '/student/ledger',
    });

    res.json({ success: true, newBalance, transactionId: tx.id, reference: ref, message: 'Withdrawal request submitted successfully.' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PIN ───
// PIN policy is 6 digits. Existing 4-digit PINs keep working at their original length (checked
// against user.pinLength elsewhere) — but any PIN set or changed from here on must be 6 digits.
const NEW_PIN_LENGTH = 6;

router.post('/pin/set', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { pin, currentPin } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!pin || !new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(pin)) {
      return res.status(400).json({ message: `PIN must be exactly ${NEW_PIN_LENGTH} digits.` });
    }

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
    await prisma.user.update({ where: { id: userId }, data: { pinHash: hash, pinSalt: salt, pinSet: true, pinLength: NEW_PIN_LENGTH, pinAttempts: 0, pinLockedUntil: null } });
    await prisma.auditLog.create({ data: { action: user.pinSet ? 'PIN Changed' : 'PIN Set', actorId: userId, entityType: 'User', entityId: userId, details: user.pinSet ? 'Wallet PIN changed' : 'Wallet PIN set for first time', ipAddress: req.ip } });

    void notifyUser({
      recipientId: userId, category: 'security', type: user.pinSet ? 'pin.changed' : 'pin.set',
      title: user.pinSet ? 'Wallet PIN Changed' : 'Wallet PIN Set',
      body: user.pinSet ? 'Your wallet PIN was changed. If this wasn\'t you, contact support immediately.' : 'Your wallet PIN has been set.',
      link: '/student/profile',
      emailSubject: user.pinSet ? 'Security Alert: Wallet PIN Changed — Smart Campus' : 'Wallet PIN Set — Smart Campus',
    });

    res.json({ success: true, message: user.pinSet ? 'PIN changed successfully' : 'PIN set successfully', pinLength: NEW_PIN_LENGTH });
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

    const expectedPinLength = user.pinLength || 4;
    if (!pin || pin.length !== expectedPinLength) {
      return res.json({ valid: false, message: `Enter your ${expectedPinLength}-digit PIN.` });
    }

    const hash = await hashPin(pin, user.pinSalt || '');
    if (hash !== user.pinHash) {
      const attempts = (user.pinAttempts || 0) + 1;
      const updates: any = { pinAttempts: attempts };
      if (attempts >= 5) updates.pinLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.user.update({ where: { id: userId }, data: updates });
      return res.json({ valid: false, message: `Incorrect PIN. ${Math.max(0, 5 - attempts)} attempts remaining.` });
    }

    // Stamp freshness — /payment/init checks this to confirm PIN verification actually
    // happened recently for this user, rather than trusting the client's say-so.
    await prisma.user.update({ where: { id: userId }, data: { pinAttempts: 0, pinVerifiedAt: new Date() } });
    res.json({ valid: true, message: 'PIN verified' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── OTP ───
router.post('/otp/send', authMiddleware, async (req: AuthRequest, res) => {
  const timings: Record<string, number | string> = {};
  const requestStart = Date.now();
  let stepStart = requestStart;
  const mark = (label: string) => { timings[label] = Date.now() - stepStart; stepStart = Date.now(); };

  try {
    const userId = req.user!.id;
    const { purpose } = req.body;
    // authMiddleware already loaded this user's record for this request — no need to fetch it again.
    const userEmail = req.user!.email;
    const userFullName = req.user!.fullName;
    if (!userEmail) return res.status(400).json({ message: 'No email on file for this account.' });

    const activeOtps = await prisma.otpCode.findMany({ where: { userId, status: 'Active' }, take: 10 });
    if (activeOtps.length >= 5) return res.status(429).json({ message: 'Too many active OTPs.' });

    await Promise.all(
      activeOtps.filter(o => o.purpose === purpose).map(old =>
        prisma.otpCode.update({ where: { id: old.id }, data: { status: 'Expired' } })
      ),
    );
    mark('database');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    mark('otpGenerate');

    const otp = await prisma.otpCode.create({ data: { code, userId, purpose, status: 'Active', attempts: 0, expiresAt } });
    await prisma.auditLog.create({ data: { action: 'OTP Generated', actorId: userId, entityType: 'OTP', entityId: otp.id, details: `Purpose: ${purpose}`, ipAddress: req.ip } });
    mark('otpSave');

    const emailPromise = sendEmail(userEmail, 'Your OTP Code — Smart Campus', [
      { type: 'text', content: `<strong>Hi ${userFullName || 'Student'},</strong>\n\nYour verification code is:\n\n<strong style="font-size: 24px; letter-spacing: 8px;">${code}</strong>\n\nThis code expires in 5 minutes.\n<strong>Purpose:</strong> ${purpose}` },
      { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus — Your University Wallet' },
    ]).then(
      () => ({ ok: true as const }),
      (err: any) => ({ ok: false as const, err }),
    );

    const TIMED_OUT = Symbol('timed-out');
    const result = await Promise.race([
      emailPromise,
      new Promise<typeof TIMED_OUT>(resolve => setTimeout(() => resolve(TIMED_OUT), OTP_EMAIL_RESPONSE_BUDGET_MS)),
    ]);

    if (result === TIMED_OUT) {
      timings.emailSend = `>${OTP_EMAIL_RESPONSE_BUDGET_MS} (responded early, continuing in background)`;
      console.warn(`[otp/send] Email send exceeded ${OTP_EMAIL_RESPONSE_BUDGET_MS}ms budget for ${userEmail} — responding early`);
      emailPromise.then(r => {
        if (!r.ok) {
          console.error(`[otp/send] Background email send ultimately FAILED for ${userEmail}:`, r.err.message);
          prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        } else {
          console.log(`[otp/send] Background email send for ${userEmail} succeeded after the response was already sent.`);
        }
      });
    } else {
      mark('emailSend');
      if (!result.ok) {
        await prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => {});
        timings.total = Date.now() - requestStart;
        console.log(`[otp/send] TIMINGS (failed) for ${userEmail}:`, timings);
        return res.status(502).json({ message: `Could not send the verification email: ${result.err.message} Please check the server's email configuration.` });
      }
    }

    timings.total = Date.now() - requestStart;
    console.log(`[otp/send] TIMINGS for ${userEmail}:`, timings);
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

    void notifyUser({
      recipientId: userId, category: 'account', type: 'profile.updated',
      title: 'Profile Updated', body: 'Your profile information was updated.',
      link: '/student/profile',
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SSL PAYMENT ───
// Every real payment (fees, fines, shop purchases, pay-later dues, and mass/batch pay) is a
// single SSLCommerz checkout session. Confirmation NEVER happens on the client's say-so alone —
// both the real SSLCommerz IPN (server-to-server) and the browser's return-trip status check
// funnel through the same confirmSslPayment(), which always re-validates against SSLCommerz's
// own Merchant Transaction Validation API before marking anything Paid.

type SslPurpose = 'semester_fee' | 'library_fine' | 'admin_fine' | 'pay_later' | 'shop_payment' | 'mass_pay' | 'wallet_topup';
const SSL_PURPOSES: SslPurpose[] = ['semester_fee', 'library_fine', 'admin_fine', 'pay_later', 'shop_payment', 'mass_pay', 'wallet_topup'];
const SSL_TYPE_MAP: Record<SslPurpose, string> = {
  semester_fee: 'Fee Payment', library_fine: 'Fine Payment', admin_fine: 'Fine Payment',
  pay_later: 'Shop Payment', shop_payment: 'Shop Payment', mass_pay: 'Mass Payment',
  wallet_topup: 'Top Up',
};
const SSL_NOTIF_META: Record<SslPurpose, { category: string; title: string; link: string }> = {
  wallet_topup: { category: 'wallet', title: 'Wallet Top-Up Successful', link: '/student/ledger' },
  semester_fee: { category: 'payment', title: 'Semester Fee Paid', link: '/student/dues' },
  library_fine: { category: 'payment', title: 'Library Fine Paid', link: '/student/dues' },
  admin_fine: { category: 'payment', title: 'Fine Paid', link: '/student/dues' },
  pay_later: { category: 'payment', title: 'Pay-Later Due Settled', link: '/student/dues' },
  shop_payment: { category: 'payment', title: 'Shop Payment Successful', link: '/student/ledger' },
  mass_pay: { category: 'payment', title: 'Payment Successful', link: '/student/ledger' },
};

// Tiered payment authorization — enforced server-side, not just in the UI. A client that skips
// the PIN/OTP dialogs entirely still gets rejected here; this is what actually stops a request,
// not the dialogs the frontend happens to show first.
const PIN_REQUIRED_THRESHOLD = 3000;    // ৳3,000+ requires a fresh PIN verification
const OTP_REQUIRED_THRESHOLD = 20000;   // ৳20,000+ additionally requires a fresh OTP
const AUTH_FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // both proofs expire after 5 minutes

// A Pending SSLCommerz transaction whose checkout was genuinely abandoned (tab closed, network
// drop, browser crash) never receives a FAILED/CANCELLED verdict from SSLCommerz — nothing else
// in this codebase ever expires it. Without this window, the 3-pending-transaction anti-abuse
// guard below would permanently lock a student out of every payment method after 3 abandoned
// attempts, with no self-service recovery. Anything older than this is presumed abandoned and
// excluded from the count; it stays in the ledger as-is (still visible, still resolvable via the
// validator if SSLCommerz ever does respond) — this only unblocks new payment attempts.
const PENDING_TXN_ABANDON_WINDOW_MS = 30 * 60 * 1000;

interface PayItem { id: string; source: 'semester' | 'library' | 'admin' | 'payLater' | 'shop' | 'wallet'; amount: number; label: string }

async function markItemPaid(item: PayItem, reference: string) {
  if (item.source === 'semester') await prisma.semesterFee.update({ where: { id: item.id }, data: { status: 'Paid', reference } }).catch(() => {});
  else if (item.source === 'library') await prisma.libraryFine.update({ where: { id: item.id }, data: { status: 'Paid', reference } }).catch(() => {});
  else if (item.source === 'admin') await prisma.adminFine.update({ where: { id: item.id }, data: { status: 'Paid', reference } }).catch(() => {});
  else if (item.source === 'payLater') await prisma.payLaterDue.update({ where: { id: item.id }, data: { status: 'Paid', paymentReference: reference } }).catch(() => {});
  // source === 'shop': no separate due row to update — the Transaction row itself is the payment record.
}

function sslValidationUrl() {
  const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
  return isLive ? 'https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php' : 'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php';
}

// The single source of truth for "did this payment actually succeed". Called by both the real
// IPN webhook and the browser's post-redirect status check — never by client-supplied status alone.
async function confirmSslPayment(reference: string, source: 'ipn' | 'browser-validate', rawPayload: unknown, ip?: string, deviceInfo?: string) {
  const tx = await prisma.transaction.findFirst({ where: { reference } });
  if (!tx) {
    await prisma.paymentCallback.create({ data: { reference, source, rawPayload: JSON.stringify(rawPayload), verified: false, ipAddress: ip } }).catch(() => {});
    return { status: 'failed' as const, message: 'Transaction not found' };
  }

  if (tx.status === 'Success') {
    await prisma.paymentCallback.create({ data: { transactionId: tx.id, reference, source, rawPayload: JSON.stringify(rawPayload), sslStatus: 'ALREADY_CONFIRMED', verified: true, ipAddress: ip } }).catch(() => {});
    return { status: 'valid' as const, message: 'Payment already confirmed' };
  }
  if (tx.status === 'Failed' || tx.status === 'Cancelled') {
    await prisma.paymentCallback.create({ data: { transactionId: tx.id, reference, source, rawPayload: JSON.stringify(rawPayload), sslStatus: tx.status, verified: false, ipAddress: ip } }).catch(() => {});
    return { status: 'failed' as const, message: `Payment ${tx.status.toLowerCase()}` };
  }

  let data: Record<string, unknown>;
  try {
    const params = new URLSearchParams({ store_id: process.env.SSLCOMMERZ_STORE_ID || '', store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '', tran_id: reference, v: '1', format: 'json' });
    const response = await fetch(`${sslValidationUrl()}?${params.toString()}`);
    data = await response.json() as Record<string, unknown>;
  } catch (err: any) {
    console.error(`[confirmSslPayment] Validator call failed for ${reference} (source=${source}):`, err.message || err);
    await prisma.paymentCallback.create({ data: { transactionId: tx.id, reference, source, rawPayload: JSON.stringify(rawPayload), sslStatus: 'VALIDATION_UNREACHABLE', verified: false, ipAddress: ip } }).catch(() => {});
    return { status: 'pending' as const, message: 'Could not reach the payment gateway validator. Please check again shortly.' };
  }

  const element = (Array.isArray(data.element) ? data.element[0] : data) as Record<string, unknown>;
  const sslStatus = (element?.status as string)?.toUpperCase();
  const validId = element?.val_id as string;
  const bankTranId = element?.bank_tran_id as string;
  const amount = parseFloat(element?.amount as string) || tx.amount || 0;

  await prisma.paymentCallback.create({
    data: { transactionId: tx.id, reference, source, rawPayload: JSON.stringify({ callback: rawPayload, validation: data }), sslStatus: sslStatus || 'UNKNOWN', verified: false, ipAddress: ip },
  }).catch(() => {});

  if (sslStatus === 'VALID' || sslStatus === 'VALIDATED') {
    if (Math.abs(amount - (tx.amount || 0)) > 1) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Failed' } });
      return { status: 'failed' as const, message: 'Payment amount mismatch. Contact support.' };
    }

    // Re-fetch immediately before writing — guards the race between the real IPN and the
    // browser's own status check both landing at roughly the same time.
    const fresh = await prisma.transaction.findUnique({ where: { id: tx.id } });
    if (fresh?.status === 'Success') return { status: 'valid' as const, message: 'Payment already confirmed' };

    const cardType = (element?.card_type as string) || '';
    const payMethod = cardType.includes('bkash') ? 'bKash' : cardType.includes('nagad') ? 'Nagad' : cardType.includes('rocket') ? 'Rocket' : cardType.includes('visa') || cardType.includes('master') ? 'Card' : (cardType || 'Online');
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: 'Success', gatewayTxnId: validId, bankTxnId: bankTranId, paymentMethod: payMethod,
        // Financial Dispute module — additive audit-context fields. deviceInfo is only trustworthy
        // as "the customer's browser" when this call came from the browser's own status check —
        // the IPN's user-agent would just be SSLCommerz's server, not the student.
        ipAddress: ip, deviceInfo: source === 'browser-validate' ? (deviceInfo || null) : null,
      },
    });

    let items: PayItem[] = [];
    try { items = tx.itemsJson ? JSON.parse(tx.itemsJson) : []; } catch { items = []; }
    for (const item of items) await markItemPaid(item, reference);

    // Wallet top-up: credit the user's wallet balance now that SSLCommerz has confirmed the payment.
    if (tx.purpose === 'wallet_topup') {
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: tx.userId } });
      const balanceBefore = wallet?.balance || 0;
      if (wallet) {
        await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
      } else {
        await prisma.wallet.create({ data: { walletId: `W-${tx.userId.slice(0, 8)}`, ownerId: tx.userId, balance: amount } });
      }
      // Financial Dispute module — captured as a follow-up update since the credited amount isn't
      // known until this branch runs, after the main status update above.
      await prisma.transaction.update({ where: { id: tx.id }, data: { balanceBefore, balanceAfter: balanceBefore + amount } }).catch(() => {});
    }

    await prisma.auditLog.create({ data: { action: 'SSLCommerz Payment Verified', actorId: tx.userId, entityType: 'Transaction', entityId: tx.id, details: `Amount: ৳${amount}, Purpose: ${tx.purpose}, Val ID: ${validId}, Source: ${source}`, ipAddress: ip } }).catch(() => {});

    try {
      const user = await prisma.user.findUnique({ where: { id: tx.userId } });
      if (user?.email) {
        await sendEmail(user.email, `Payment Successful — ৳${amount.toLocaleString()} — Smart Campus`, [
          { type: 'text', content: `<strong>Hi ${user.fullName || 'Student'},</strong>\n\nYour payment was successful and verified with the payment gateway.\n\n<strong>Amount:</strong> ৳${amount.toLocaleString()}\n<strong>Purpose:</strong> ${(tx.purpose || '').replace(/_/g, ' ')}\n<strong>Reference:</strong> ${reference}\n<strong>Gateway ID:</strong> ${validId || 'N/A'}\n<strong>Date:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })}` },
          { type: 'divider' }, { type: 'text', content: '<em>If you did not make this payment, contact support immediately.</em>\n\n🎓 Smart Campus — Your University Wallet' },
        ]);
      }
    } catch { /* best-effort */ }

    const notifMeta = SSL_NOTIF_META[tx.purpose as SslPurpose] || { category: 'payment', title: 'Payment Successful', link: '/student/ledger' };
    void notifyUser({
      recipientId: tx.userId, category: notifMeta.category, type: `${tx.purpose}.success`,
      title: notifMeta.title, body: `Your payment of ৳${amount.toLocaleString()} was verified and completed. Reference: ${reference}.`,
      link: notifMeta.link,
    });

    return { status: 'valid' as const, message: 'Payment successful' };
  }

  if (sslStatus === 'FAILED' || sslStatus === 'CANCELLED') {
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: sslStatus === 'FAILED' ? 'Failed' : 'Cancelled' } });
    void notifyUser({
      recipientId: tx.userId, category: 'payment', type: 'payment.failed',
      title: sslStatus === 'FAILED' ? 'Payment Failed' : 'Payment Cancelled',
      body: `Your payment of ৳${amount.toLocaleString()} (reference ${reference}) was ${sslStatus.toLowerCase()}.`,
      link: '/student/ledger',
    });
    return { status: 'failed' as const, message: `Payment ${sslStatus.toLowerCase()}` };
  }

  return { status: 'pending' as const, message: 'Payment is still being processed' };
}

// SSLCommerz delivers success_url/fail_url/cancel_url as a browser-submitted HTML form POST, not
// a GET — pointing those directly at the frontend's SPA route (as they used to) makes the browser
// issue a raw POST to a static host, which has no handler for it and 404s before React ever loads.
// This backend endpoint accepts that POST and does a standard Post/Redirect/Get: a 303 turns it
// into a GET to the actual frontend route, which is what PaymentResultPage already expects.
router.all('/payment/redirect', (req: AuthRequest, res) => {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const status = (req.query.status as string) || 'failed';
  const ref = (req.query.ref as string) || '';
  res.redirect(303, `${appUrl}/student/payment-result?status=${encodeURIComponent(status)}&ref=${encodeURIComponent(ref)}`);
});

router.post('/payment/init', authMiddleware, paymentInitLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { purpose, items, itemLabel, otpId } = req.body as { purpose: SslPurpose; items: PayItem[]; itemLabel?: string; otpId?: string };

    if (!SSL_PURPOSES.includes(purpose)) return res.status(400).json({ message: 'Invalid payment purpose.' });

    // Wallet top-up has no fee/fine/shop items to validate — the user is simply adding money to
    // their wallet via SSLCommerz. Every other purpose still goes through normal item validation.
    const isTopUp = purpose === 'wallet_topup';
    const topUpAmount = isTopUp ? parseFloat(req.body.amount) : 0;

    if (!isTopUp && (!Array.isArray(items) || items.length === 0)) {
      return res.status(400).json({ message: 'No items specified for payment.' });
    }
    if (isTopUp && (!topUpAmount || topUpAmount < 50)) {
      return res.status(400).json({ message: 'Minimum top-up amount is ৳50.' });
    }
    if (isTopUp) {
      const existingWallet = await prisma.wallet.findFirst({ where: { ownerId: userId } });
      if (existingWallet?.frozen) return res.status(403).json({ message: 'Your wallet is frozen. Contact support.' });
    }
    if (isTopUp && topUpAmount > 50000) {
      return res.status(400).json({ message: 'Maximum top-up amount is ৳50,000.' });
    }

    let shopId: string | undefined;
    if (!isTopUp) {
      for (const item of items) {
        if (item.source === 'semester') {
          const rec = await prisma.semesterFee.findUnique({ where: { id: item.id } });
          if (!rec || rec.studentId !== userId) return res.status(404).json({ message: 'Semester fee not found.' });
          if (rec.status !== 'Pending') return res.status(400).json({ message: 'This fee is no longer pending.' });
        } else if (item.source === 'library') {
          const rec = await prisma.libraryFine.findUnique({ where: { id: item.id } });
          if (!rec || rec.studentId !== userId) return res.status(404).json({ message: 'Library fine not found.' });
          if (rec.status !== 'Pending') return res.status(400).json({ message: 'This fine is no longer pending.' });
        } else if (item.source === 'admin') {
          const rec = await prisma.adminFine.findUnique({ where: { id: item.id } });
          if (!rec || rec.studentId !== userId) return res.status(404).json({ message: 'Admin fine not found.' });
          if (rec.status !== 'Pending') return res.status(400).json({ message: 'This fine is no longer pending.' });
        } else if (item.source === 'payLater') {
          const rec = await prisma.payLaterDue.findUnique({ where: { id: item.id } });
          if (!rec || rec.studentId !== userId) return res.status(404).json({ message: 'Due not found.' });
          if (rec.status !== 'Pending') return res.status(400).json({ message: 'This due is no longer pending.' });
        } else if (item.source === 'shop') {
          const shop = await prisma.shop.findUnique({ where: { id: item.id } });
          if (!shop || shop.status !== 'Active') return res.status(400).json({ message: 'This shop cannot accept payments right now.' });
          shopId = shop.id;
        } else {
          return res.status(400).json({ message: 'Unknown item source.' });
        }
      }
    }

    const amount = isTopUp ? topUpAmount : items.reduce((s, i) => s + (i.amount || 0), 0);
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid payment amount.' });

    if (amount >= PIN_REQUIRED_THRESHOLD) {
      const freshUser = await prisma.user.findUnique({ where: { id: userId } });
      const pinFresh = freshUser?.pinVerifiedAt && (Date.now() - new Date(freshUser.pinVerifiedAt).getTime()) < AUTH_FRESHNESS_WINDOW_MS;
      if (!pinFresh) return res.status(403).json({ message: 'Please verify your PIN before this payment.', requiresPin: true });

      if (amount >= OTP_REQUIRED_THRESHOLD) {
        const otp = otpId ? await prisma.otpCode.findUnique({ where: { id: otpId } }) : null;
        const otpFresh = otp && otp.userId === userId && otp.status === 'Used' && otp.purpose === 'Large Payment' && (Date.now() - new Date(otp.updatedAt).getTime()) < AUTH_FRESHNESS_WINDOW_MS;
        if (!otpFresh) return res.status(403).json({ message: 'OTP verification required for this payment.', requiresOtp: true });
      }
    }

    const ref = `SSL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const pendingTxns = await prisma.transaction.findMany({ where: { userId, status: 'Pending', gateway: 'SSLCommerz', createdAt: { gte: new Date(Date.now() - PENDING_TXN_ABANDON_WINDOW_MS) } }, take: 5 });
    if (pendingTxns.length >= 3) return res.status(429).json({ message: 'Too many pending payments. Complete or cancel existing ones first.' });

    const topUpLabel = `Wallet Top-Up — ৳${amount.toLocaleString()}`;
    const tx = await prisma.transaction.create({
      data: {
        reference: ref, userId, type: SSL_TYPE_MAP[purpose],
        direction: isTopUp ? 'Credit' : 'Debit',
        amount, status: 'Pending',
        gateway: 'SSLCommerz', idempotencyKey: `${userId}-${purpose}-${Date.now()}`,
        description: isTopUp ? topUpLabel : (itemLabel || items.map(i => i.label).join(', ')),
        paymentMethod: 'Online',
        purpose, itemsJson: isTopUp ? '[]' : JSON.stringify(items), shopId,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
    const SSLCOMMERZ_URL = isLive ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php' : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;

    const formData = new URLSearchParams({
      store_id: process.env.SSLCOMMERZ_STORE_ID || '',
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
      total_amount: amount.toString(), currency: 'BDT', tran_id: ref,
      // SSLCommerz POSTs to these — they must hit a backend route that can accept a POST and
      // redirect to the frontend's GET route (see /payment/redirect above), not the SPA directly.
      success_url: `${backendUrl}/api/payment/redirect?status=success&ref=${ref}`,
      fail_url: `${backendUrl}/api/payment/redirect?status=failed&ref=${ref}`,
      cancel_url: `${backendUrl}/api/payment/redirect?status=cancelled&ref=${ref}`,
      // Real server-to-server IPN — this is what actually confirms payment now, not the browser's return trip.
      ipn_url: `${backendUrl}/api/payment/ipn`,
      cus_name: user?.fullName || 'Student',
      cus_email: user?.email || req.user!.email,
      cus_phone: user?.phone || '01700000000',
      cus_add1: 'University Campus', cus_city: 'Dhaka', cus_country: 'Bangladesh',
      shipping_method: 'NO', product_name: isTopUp ? topUpLabel : (itemLabel || items[0]?.label || 'Campus Payment'),
      product_category: 'Payment', product_profile: 'general',
      value_a: userId, value_b: purpose, value_c: ref, value_d: tx.id,
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
    await prisma.auditLog.create({ data: { action: 'SSLCommerz Payment Initiated', actorId: userId, entityType: 'Transaction', entityId: tx.id, details: `Amount: ৳${amount}, Purpose: ${purpose}, Ref: ${ref}`, ipAddress: req.ip } });

    res.json({ gatewayUrl: data.GatewayPageURL as string, transactionRef: ref, sessionKey: data.sessionkey as string });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Browser's post-redirect status check — just reflects current state via the same shared
// confirmation logic the IPN uses. Safe to call repeatedly; never double-applies an effect.
router.post('/payment/validate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { transactionRef } = req.body;
    if (!transactionRef) return res.status(400).json({ message: 'Missing transaction reference.' });
    const result = await confirmSslPayment(transactionRef, 'browser-validate', req.body, req.ip, (req.headers['user-agent'] as string | undefined)?.slice(0, 300));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Real SSLCommerz IPN — server-to-server, no student session/Bearer token involved. This is the
// endpoint that actually confirms a payment; the browser-return path above is just a UX mirror.
router.post('/payment/ipn', paymentIpnLimiter, async (req, res) => {
  try {
    const tranId = (req.body?.tran_id || req.body?.value_c) as string | undefined;
    if (tranId) await confirmSslPayment(tranId, 'ipn', req.body, req.ip);
  } catch (err: any) {
    console.error('[payment/ipn] error:', err.message);
  }
  // Always ack fast with 200 — SSLCommerz retries on non-200, and retries must be safe no-ops (they are).
  res.status(200).json({ received: true });
});

// ─── SEMESTER FEE — QUICK PAY (STUDENT ID LOOKUP, SELF OR ON-BEHALF) ───
// A Home-page shortcut, separate from the tabbed Dues & Fines flow: look up any student by
// Student ID, see their live pending semester fee total, and settle it — via Campus Wallet
// (instant, direct deduction) or SSLCommerz (gateway checkout). The payer never has to be the
// fee owner, so every write below records who actually authorized/paid, not just whose fee it
// was — and the amount is always recomputed from the live SemesterFee rows server-side, never
// trusted from the client, so a tampered request can't under/over-pay what's actually owed.
const semesterFeeLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.user?.id || ipKeyGenerator(req.ip || 'unknown'),
  message: { message: 'Too many lookups. Please wait a moment and try again.' },
});

async function getPendingSemesterFees(studentDbId: string) {
  const fees = await prisma.semesterFee.findMany({ where: { studentId: studentDbId, status: 'Pending' }, take: 200 });
  const total = fees.reduce((s, f) => s + (f.amount || 0), 0);
  return { fees, total };
}

router.post('/semester-fees/lookup', authMiddleware, semesterFeeLookupLimiter, async (req: AuthRequest, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    if (!studentId || studentId.length > 40) {
      return res.status(400).json({ message: 'Enter a valid Student ID.' });
    }

    // Scoped to role: 'Student' — this lookup only ever needs to resolve semester-fee-paying
    // accounts, and it keeps staff/admin accounts (which never carry SemesterFee rows) out of
    // the response even if a Student ID string happened to collide with one.
    const student = await prisma.user.findFirst({ where: { studentId, role: 'Student' } });
    if (!student) return res.status(404).json({ message: 'No student found with this ID.' });

    const { fees, total } = await getPendingSemesterFees(student.id);

    // Only the fields the payer needs to confirm they have the right person — no email, no
    // internal id, no other account details.
    res.json({
      found: true,
      student: {
        fullName: student.fullName || 'Student',
        studentId: student.studentId || '',
        department: student.department || '',
        batch: student.batch || '',
      },
      totalDue: total,
      feeCount: fees.length,
      fees: fees.map(f => ({ id: f.id, label: f.label || 'Semester Fee', amount: f.amount, dueDate: f.dueDate || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/semester-fees/pay', authMiddleware, paymentInitLimiter, async (req: AuthRequest, res) => {
  try {
    const payer = req.user!;
    const payerId = payer.id;
    const { studentId, method, otpId } = req.body as { studentId: string; method: 'wallet' | 'sslcommerz'; otpId?: string };

    const cleanStudentId = String(studentId || '').trim();
    if (!cleanStudentId) return res.status(400).json({ message: 'Student ID is required.' });
    if (method !== 'wallet' && method !== 'sslcommerz') return res.status(400).json({ message: 'Invalid payment method.' });

    const target = await prisma.user.findFirst({ where: { studentId: cleanStudentId, role: 'Student' } });
    if (!target) return res.status(404).json({ message: 'No student found with this ID.' });

    // Recomputed fresh, right now — this is the amount that's actually charged, regardless of
    // anything the client believes the total to be.
    const { fees, total } = await getPendingSemesterFees(target.id);
    if (!fees.length || total <= 0) {
      return res.status(400).json({ message: 'No pending semester fees found for this student.' });
    }

    const isOnBehalf = target.id !== payerId;

    // Same tiered PIN/OTP authorization as every other payment path in this app — enforced on
    // the PAYER's freshly-verified PIN/OTP, regardless of whose fee is actually being settled.
    if (total >= PIN_REQUIRED_THRESHOLD) {
      const freshPayer = await prisma.user.findUnique({ where: { id: payerId } });
      const pinFresh = freshPayer?.pinVerifiedAt && (Date.now() - new Date(freshPayer.pinVerifiedAt).getTime()) < AUTH_FRESHNESS_WINDOW_MS;
      if (!pinFresh) return res.status(403).json({ message: 'Please verify your PIN before this payment.', requiresPin: true });

      if (total >= OTP_REQUIRED_THRESHOLD) {
        const otp = otpId ? await prisma.otpCode.findUnique({ where: { id: otpId } }) : null;
        const otpFresh = otp && otp.userId === payerId && otp.status === 'Used' && otp.purpose === 'Large Payment' && (Date.now() - new Date(otp.updatedAt).getTime()) < AUTH_FRESHNESS_WINDOW_MS;
        if (!otpFresh) return res.status(403).json({ message: 'OTP verification required for this payment.', requiresOtp: true });
      }
    }

    const ref = `SEM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const label = `Semester Fee — ${target.fullName || target.studentId}${isOnBehalf ? ` (paid by ${payer.fullName || payer.email})` : ''}`;
    const itemsJson = JSON.stringify(fees.map(f => ({ id: f.id, source: 'semester', amount: f.amount, label: f.label })));

    if (method === 'wallet') {
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: payerId } });
      if (wallet?.frozen) return res.status(403).json({ message: 'Your wallet is frozen. Contact support.' });
      if (!wallet || (wallet.balance || 0) < total) {
        return res.status(400).json({ message: 'Insufficient balance in your wallet' });
      }

      let newBalance: number;
      try {
        newBalance = await prisma.$transaction(async (txClient) => {
          // Atomic, conditional decrement — guards the race between two concurrent payment
          // attempts (e.g. two tabs) rather than trusting the balance read above.
          const walletUpdate = await txClient.wallet.updateMany({
            where: { id: wallet.id, balance: { gte: total } },
            data: { balance: { decrement: total } },
          });
          if (walletUpdate.count === 0) throw new Error('INSUFFICIENT_BALANCE');

          // Guards the same race on the fee rows — if someone else settled these fees a moment
          // ago, this update touches 0 rows and we roll the whole transaction back.
          const feesUpdate = await txClient.semesterFee.updateMany({
            where: { studentId: target.id, status: 'Pending' },
            data: { status: 'Paid', reference: ref },
          });
          if (feesUpdate.count !== fees.length) throw new Error('FEES_CHANGED');

          // Financial Dispute module — fetched here (before the Transaction row is written) so the
          // post-decrement balance can be captured on the row itself; additive to the existing flow.
          const freshWallet = await txClient.wallet.findUnique({ where: { id: wallet.id } });

          await txClient.transaction.create({
            data: {
              reference: ref, userId: payerId, type: 'Fee Payment', direction: 'Debit',
              amount: total, status: 'Success', gateway: 'Wallet', paymentMethod: 'Wallet',
              purpose: 'semester_fee', itemsJson, description: label,
              idempotencyKey: `${payerId}-semester_fee-${target.id}-${Date.now()}`,
              receiverId: isOnBehalf ? target.id : undefined,
              receiverRoleSnapshot: isOnBehalf ? (target.role || 'Student') : undefined,
              receiverDepartmentSnapshot: isOnBehalf ? (target.department || undefined) : undefined,
              balanceBefore: wallet.balance || 0,
              balanceAfter: freshWallet?.balance ?? null,
              ipAddress: req.ip,
              deviceInfo: (req.headers['user-agent'] as string | undefined)?.slice(0, 300),
            },
          });

          await txClient.auditLog.create({
            data: {
              action: 'Semester Fee Paid (Wallet)', actorId: payerId, entityType: 'SemesterFee', entityId: target.id,
              details: `Paid ৳${total} for ${target.fullName || target.studentId} (${target.studentId})${isOnBehalf ? ` — on behalf, by ${payer.fullName || payer.email}` : ''}`,
              ipAddress: req.ip,
            },
          });

          return freshWallet?.balance || 0;
        });
      } catch (e: any) {
        if (e.message === 'FEES_CHANGED') {
          return res.status(409).json({ message: 'These fees were already settled. Please look up the student again.' });
        }
        return res.status(400).json({ message: 'Insufficient balance in your wallet' });
      }

      try {
        if (payer.email) {
          await sendEmail(payer.email, `Payment Successful — ৳${total.toLocaleString()} — Smart Campus`, [
            { type: 'text', content: `<strong>Hi ${payer.fullName || 'Student'},</strong>\n\nYour semester fee payment was successful.\n\n<strong>Paid For:</strong> ${target.fullName} (${target.studentId})\n<strong>Amount:</strong> ৳${total.toLocaleString()}\n<strong>Reference:</strong> ${ref}\n<strong>Paid By:</strong> ${payer.fullName || payer.email}` },
            { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus — Your University Wallet' },
          ]);
        }
        if (isOnBehalf && target.email) {
          await sendEmail(target.email, `Your Semester Fee Was Paid — Smart Campus`, [
            { type: 'text', content: `<strong>Hi ${target.fullName},</strong>\n\nYour semester fee of ৳${total.toLocaleString()} has been paid by ${payer.fullName || payer.email}.\n\n<strong>Reference:</strong> ${ref}` },
            { type: 'divider' }, { type: 'text', content: '🎓 Smart Campus' },
          ]);
        }
      } catch { /* best-effort */ }

      void notifyUser({
        recipientId: payerId, category: 'payment', type: 'semester_fee.success',
        title: 'Semester Fee Paid', body: `৳${total.toLocaleString()} paid for ${target.fullName || target.studentId}. Reference: ${ref}.`,
        link: '/student/dues',
      });
      if (isOnBehalf) {
        void notifyUser({
          recipientId: target.id, category: 'payment', type: 'semester_fee.paid_for_you',
          title: 'Your Semester Fee Was Paid', body: `৳${total.toLocaleString()} was paid by ${payer.fullName || payer.email}. Reference: ${ref}.`,
          link: '/student/dues',
        });
      }

      return res.json({
        success: true, method: 'wallet', amount: total, reference: ref, newBalance,
        paidByName: payer.fullName || payer.email, studentName: target.fullName || target.studentId,
      });
    }

    // method === 'sslcommerz'
    const pendingTxns = await prisma.transaction.findMany({ where: { userId: payerId, status: 'Pending', gateway: 'SSLCommerz', createdAt: { gte: new Date(Date.now() - PENDING_TXN_ABANDON_WINDOW_MS) } }, take: 5 });
    if (pendingTxns.length >= 3) return res.status(429).json({ message: 'Too many pending payments. Complete or cancel existing ones first.' });

    const tx = await prisma.transaction.create({
      data: {
        reference: ref, userId: payerId, type: SSL_TYPE_MAP.semester_fee, direction: 'Debit',
        amount: total, status: 'Pending', gateway: 'SSLCommerz',
        idempotencyKey: `${payerId}-semester_fee-${target.id}-${Date.now()}`,
        description: label, paymentMethod: 'Online', purpose: 'semester_fee', itemsJson,
        // Financial Dispute module — known at creation time (unlike the generic SSL flow), so
        // captured here rather than guessed later when the payment is confirmed.
        receiverId: isOnBehalf ? target.id : undefined,
        receiverRoleSnapshot: isOnBehalf ? (target.role || 'Student') : undefined,
        receiverDepartmentSnapshot: isOnBehalf ? (target.department || undefined) : undefined,
      },
    });

    const isLive = process.env.SSLCOMMERZ_IS_LIVE === 'true';
    const SSLCOMMERZ_URL = isLive ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php' : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;

    const formData = new URLSearchParams({
      store_id: process.env.SSLCOMMERZ_STORE_ID || '',
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
      total_amount: total.toString(), currency: 'BDT', tran_id: ref,
      // SSLCommerz POSTs to these — they must hit a backend route that can accept a POST and
      // redirect to the frontend's GET route (see /payment/redirect above), not the SPA directly.
      success_url: `${backendUrl}/api/payment/redirect?status=success&ref=${ref}`,
      fail_url: `${backendUrl}/api/payment/redirect?status=failed&ref=${ref}`,
      cancel_url: `${backendUrl}/api/payment/redirect?status=cancelled&ref=${ref}`,
      // Real server-to-server IPN — confirmSslPayment() re-validates against SSLCommerz's own
      // Merchant Transaction Validation API before marking anything Paid, exactly like every
      // other payment purpose in this app.
      ipn_url: `${backendUrl}/api/payment/ipn`,
      cus_name: payer.fullName || 'Student',
      cus_email: payer.email,
      cus_phone: payer.phone || '01700000000',
      cus_add1: 'University Campus', cus_city: 'Dhaka', cus_country: 'Bangladesh',
      shipping_method: 'NO', product_name: label,
      product_category: 'Payment', product_profile: 'general',
      value_a: payerId, value_b: 'semester_fee', value_c: ref, value_d: tx.id,
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
    await prisma.auditLog.create({ data: { action: 'Semester Fee Payment Initiated (SSLCommerz)', actorId: payerId, entityType: 'Transaction', entityId: tx.id, details: `Amount: ৳${total} for ${target.fullName} (${target.studentId})${isOnBehalf ? ' — on behalf' : ''}, Ref: ${ref}`, ipAddress: req.ip } });

    res.json({ success: true, method: 'sslcommerz', gatewayUrl: data.GatewayPageURL as string, transactionRef: ref, sessionKey: data.sessionkey as string, amount: total, studentName: target.fullName || target.studentId });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN ROUTES ───
router.post('/admin/overview', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [totalStudents, totalShops, activeShops, suspendedShops, totalTransactions, recentLogs] = await Promise.all([
      prisma.user.count({ where: { role: 'Student' } }),
      prisma.shop.count(),
      prisma.shop.count({ where: { status: 'Active' } }),
      prisma.shop.count({ where: { status: 'Suspended' } }),
      prisma.transaction.count(),
      prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: 'desc' }, include: { actor: true } }),
    ]);
    const txSum = await prisma.transaction.aggregate({ _sum: { amount: true }, where: { status: 'Success', direction: 'Credit' } });
    const pendingFines = await prisma.adminFine.count({ where: { status: 'Pending' } });

    res.json({
      totalStudents, totalShops, activeShops, suspendedShops, totalTransactions, totalRevenue: txSum._sum.amount || 0, pendingFines,
      recentActivity: recentLogs.map(l => ({ id: l.id, action: l.action, actor: l.actorId || '', actorName: l.actor?.fullName || '', entityType: l.entityType || '', details: l.details || '', createdAt: l.createdAt.toISOString() })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/seed', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
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

router.post('/admin/shops', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const shops = await prisma.shop.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
    const results = await Promise.all(shops.map(async (s) => {
      const [revenueAgg, settledAgg] = await Promise.all([
        prisma.transaction.aggregate({ _sum: { amount: true }, where: { shopId: s.id, status: 'Success' } }),
        prisma.settlement.aggregate({ _sum: { amount: true }, where: { shopId: s.id } }),
      ]);
      const totalReceived = revenueAgg._sum.amount || 0;
      const totalSettled = settledAgg._sum.amount || 0;
      return {
        id: s.id, name: s.name, category: s.category, rating: s.rating,
        status: s.status, location: s.location || '', logoUrl: s.logoUrl || '',
        merchantId: s.merchantId || '', qrToken: s.qrToken || '',
        totalReceived, totalSettled, pendingSettlement: Math.max(0, totalReceived - totalSettled),
      };
    }));
    res.json({ shops: results });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/shops/manage', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { action, shopId, ...data } = req.body;
    if (action === 'create') {
      const shop = await prisma.shop.create({ data: { ...data, qrToken: `QR-${crypto.randomBytes(6).toString('hex')}`, merchantId: `MERCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}` } });
      await prisma.auditLog.create({ data: { action: 'Shop Created', actorId: req.user!.id, entityType: 'Shop', entityId: shop.id, details: `Created shop "${shop.name}"`, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Shop created', shopId: shop.id });
    }
    if (action === 'update') {
      await prisma.shop.update({ where: { id: shopId }, data });
      await prisma.auditLog.create({ data: { action: 'Shop Updated', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, details: JSON.stringify(data), ipAddress: req.ip } });
      return res.json({ success: true, message: 'Shop updated' });
    }
    if (action === 'delete' || action === 'deactivate' || action === 'remove') {
      await prisma.shop.update({ where: { id: shopId }, data: { status: 'Inactive' } });
      await prisma.auditLog.create({ data: { action: 'Shop Deactivated', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Shop deactivated' });
    }
    if (action === 'suspend') {
      await prisma.shop.update({ where: { id: shopId }, data: { status: 'Suspended' } });
      await prisma.auditLog.create({ data: { action: 'Shop Suspended', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Shop suspended' });
    }
    if (action === 'activate') {
      await prisma.shop.update({ where: { id: shopId }, data: { status: 'Active' } });
      await prisma.auditLog.create({ data: { action: 'Shop Activated', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Shop activated' });
    }
    if (action === 'settle') {
      // Manual internal reconciliation — SSLCommerz doesn't expose a "funds disbursed" API, so
      // this records Admin Office confirming a shop has actually been paid outside the app.
      const amount = Number(data.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Enter a valid settlement amount.' });
      const settlement = await prisma.settlement.create({ data: { shopId, amount, notes: data.notes || null, settledBy: req.user!.id } });
      await prisma.auditLog.create({ data: { action: 'Shop Settlement Recorded', actorId: req.user!.id, entityType: 'Shop', entityId: shopId, details: `Settled ৳${amount}${data.notes ? ` — ${data.notes}` : ''}`, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Settlement recorded', settlementId: settlement.id });
    }
    res.status(400).json({ message: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/withdrawals', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const where: any = { type: 'Withdrawal' };
    if (status && status !== 'all') where.status = status;

    const withdrawals = await prisma.transaction.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    res.json({
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        reference: w.reference,
        amount: w.amount,
        status: w.status,
        provider: w.paymentMethod || w.gateway || 'Mobile Banking',
        description: w.description || '',
        createdAt: w.createdAt.toISOString(),
        studentName: w.user?.fullName || 'N/A',
        studentId: w.user?.studentId || 'N/A',
        email: w.user?.email || 'N/A',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/withdrawals/process', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { transactionId, action, notes } = req.body; // action: 'approve' | 'reject'
    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx || tx.type !== 'Withdrawal') return res.status(404).json({ message: 'Withdrawal transaction not found' });
    if (tx.status !== 'Pending') return res.status(400).json({ message: `Transaction is already ${tx.status}` });

    if (action === 'approve') {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'Success', description: `${tx.description}${notes ? ` — ${notes}` : ''}` },
      });
      await prisma.auditLog.create({
        data: { action: 'Withdrawal Approved', actorId: req.user!.id, entityType: 'Transaction', entityId: tx.id, details: `Approved ৳${tx.amount} (${tx.reference})`, ipAddress: req.ip },
      });
      void notifyUser({
        recipientId: tx.userId, category: 'wallet', type: 'withdraw.approved',
        title: 'Withdrawal Approved', body: `Your withdrawal of ৳${tx.amount.toLocaleString()} (${tx.reference}) was approved and sent.`,
        link: '/student/ledger',
        emailSubject: `Withdrawal Approved — ৳${tx.amount} — Smart Campus`,
      });
      return res.json({ success: true, message: 'Withdrawal approved successfully' });
    } else if (action === 'reject') {
      // Refund balance back to student wallet
      const wallet = await prisma.wallet.findFirst({ where: { ownerId: tx.userId } });
      if (wallet) {
        await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: tx.amount } } });
      }
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'Failed', description: `${tx.description} (Rejected${notes ? `: ${notes}` : ''})` },
      });
      await prisma.auditLog.create({
        data: { action: 'Withdrawal Rejected', actorId: req.user!.id, entityType: 'Transaction', entityId: tx.id, details: `Rejected ৳${tx.amount} (${tx.reference}) — Balance refunded`, ipAddress: req.ip },
      });
      void notifyUser({
        recipientId: tx.userId, category: 'wallet', type: 'withdraw.rejected',
        title: 'Withdrawal Rejected', body: `Your withdrawal of ৳${tx.amount.toLocaleString()} (${tx.reference}) was rejected and refunded to your wallet.${notes ? ` Reason: ${notes}` : ''}`,
        link: '/student/ledger',
        emailSubject: `Withdrawal Rejected — ৳${tx.amount} — Smart Campus`,
      });
      return res.json({ success: true, message: 'Withdrawal rejected and balance refunded to student' });
    }

    res.status(400).json({ message: 'Invalid action. Must be approve or reject.' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/audit-logs', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
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

router.post('/admin/audit-logs/report', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { format = 'csv', action, entityType } = req.body as { format?: ReportFormat; action?: string; entityType?: string };
    const where: any = {};
    if (action) where.action = { contains: action };
    if (entityType) where.entityType = entityType;

    const logs = await prisma.auditLog.findMany({ where, take: 1000, orderBy: { createdAt: 'desc' }, include: { actor: true } });
    const url = await generateTabularReport({
      title: 'Audit Log Report',
      format,
      columns: [
        { key: 'createdAt', label: 'Date', width: 20 }, { key: 'action', label: 'Action', width: 26 },
        { key: 'actorName', label: 'Actor', width: 20 }, { key: 'entityType', label: 'Entity Type', width: 16 },
        { key: 'entityId', label: 'Entity ID', width: 22 }, { key: 'details', label: 'Details', width: 40 },
        { key: 'ipAddress', label: 'IP Address', width: 16 },
      ],
      rows: logs.map(l => ({
        createdAt: l.createdAt.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }), action: l.action,
        actorName: l.actor?.fullName || '', entityType: l.entityType || '', entityId: l.entityId || '',
        details: l.details || '', ipAddress: l.ipAddress || '',
      })),
      uploadsSubdir: 'audit-reports', filenamePrefix: 'audit-log',
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/staff', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
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

router.post('/admin/staff/manage', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { action, staffId, userId: legacyUserId, ...data } = req.body;
    const userId = staffId || legacyUserId;
    if (action === 'create') {
      const hashed = await bcrypt.hash(data.password || 'changeme123', 10);
      const staff = await prisma.user.create({ data: { email: data.email, password: hashed, fullName: data.fullName, role: data.role, department: data.department, phone: data.phone, status: 'Active' } });
      await prisma.auditLog.create({ data: { action: 'Staff Account Created', actorId: req.user!.id, entityType: 'User', entityId: staff.id, details: `Created ${data.role} account for ${data.email}`, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Staff account created' });
    }
    if (action === 'update') {
      await prisma.user.update({ where: { id: userId }, data });
      await prisma.auditLog.create({ data: { action: 'Staff Account Updated', actorId: req.user!.id, entityType: 'User', entityId: userId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Staff updated' });
    }
    if (action === 'suspend') {
      await prisma.user.update({ where: { id: userId }, data: { status: 'Suspended' } });
      await prisma.auditLog.create({ data: { action: 'Staff Account Suspended', actorId: req.user!.id, entityType: 'User', entityId: userId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Staff suspended' });
    }
    if (action === 'activate') {
      await prisma.user.update({ where: { id: userId }, data: { status: 'Active' } });
      await prisma.auditLog.create({ data: { action: 'Staff Account Activated', actorId: req.user!.id, entityType: 'User', entityId: userId, ipAddress: req.ip } });
      return res.json({ success: true, message: 'Staff activated' });
    }
    res.status(400).json({ message: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/search-students', authMiddleware, requireRole('Admin Office', 'Accounts Office'), async (req: AuthRequest, res) => {
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

router.post('/admin/fines/assign', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { studentId, reason, amount, incidentDate } = req.body;
    const ref = `AF-${Date.now().toString(36).toUpperCase()}`;
    const fine = await prisma.adminFine.create({ data: { reason, studentId, amount, incidentDate: incidentDate || new Date().toISOString().split('T')[0], status: 'Pending', reference: ref } });
    await prisma.auditLog.create({ data: { action: 'Admin Fine Assigned', actorId: req.user!.id, entityType: 'AdminFine', entityId: fine.id, details: `Fine of ৳${amount}: ${reason}`, ipAddress: req.ip } });
    void notifyUser({
      recipientId: studentId, category: 'payment', type: 'admin_fine.assigned',
      title: 'New Fine Assigned', body: `You have been fined ৳${Number(amount).toLocaleString()}: ${reason}`,
      link: '/student/dues',
      emailSubject: `Fine Assigned — ৳${amount} — Smart Campus`,
    });
    res.json({ success: true, fineId: fine.id, message: 'Fine assigned successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/waivers', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
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

router.post('/admin/waivers/update', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { waiverId, type, action } = req.body;
    const newStatus = action === 'approve' ? 'Waived' : action === 'reject' ? 'Pending' : 'Pending';
    const updated = type === 'admin'
      ? await prisma.adminFine.update({ where: { id: waiverId }, data: { status: newStatus } })
      : await prisma.libraryFine.update({ where: { id: waiverId }, data: { status: newStatus } });
    await prisma.auditLog.create({ data: { action: `Waiver ${action === 'approve' ? 'Approved' : 'Rejected'}`, actorId: req.user!.id, entityType: type === 'admin' ? 'AdminFine' : 'LibraryFine', entityId: waiverId, ipAddress: req.ip } });
    void notifyUser({
      recipientId: updated.studentId, category: 'payment', type: `${type}_fine.waiver_${action}`,
      title: action === 'approve' ? 'Fine Waived' : 'Waiver Request Rejected',
      body: action === 'approve' ? 'Your fine dispute was approved and the fine has been waived.' : 'Your fine waiver request was rejected; the fine remains due.',
      link: '/student/dues',
      emailSubject: `Fine Waiver ${action === 'approve' ? 'Approved' : 'Rejected'} — Smart Campus`,
    });
    res.json({ success: true, message: `Waiver ${action}d` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── LIBRARY ROUTES ───
router.post('/library/overview', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
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
    const pendingFinesForStudents = await prisma.libraryFine.findMany({ where: { status: 'Pending' }, select: { studentId: true } });
    const studentsPendingClearance = new Set(pendingFinesForStudents.map(f => f.studentId)).size;
    const recent = await prisma.libraryFine.findMany({ take: 10, orderBy: { createdAt: 'desc' }, include: { student: true } });

    res.json({
      totalFines: total, pendingFines: pending, paidFines: paid,
      totalAmount: totalAmt._sum.amount || 0, pendingAmount: pendingAmt._sum.amount || 0, paidAmount: paidAmt._sum.amount || 0,
      totalFinesOutstanding: pending, fineAmount: pendingAmt._sum.amount || 0, studentsPendingClearance,
      recentFines: recent.map(f => ({ id: f.id, label: f.label || '', studentName: f.student?.fullName || '', fineType: f.fineType || '', amount: f.amount, status: f.status, dueDate: f.dueDate || '' })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/student-lookup', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { query } = req.body as { query?: string };
    if (!query?.trim()) return res.json({ students: [] });
    const q = query.trim();

    const students = await prisma.user.findMany({
      where: {
        role: 'Student',
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { studentId: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });

    const result = await Promise.all(students.map(async student => {
      const fines = await prisma.libraryFine.findMany({ where: { studentId: student.id } });
      const mappedFines = fines.map(f => ({ id: f.id, label: f.label || '', fineType: f.fineType || '', amount: f.amount, status: f.status, dueDate: f.dueDate || '' }));
      return {
        id: student.id, fullName: student.fullName || '', email: student.email, studentId: student.studentId || '',
        department: student.department || '', batch: student.batch || '',
        fines: mappedFines,
        totalPending: mappedFines.filter(f => f.status === 'Pending').reduce((s, f) => s + (f.amount || 0), 0),
      };
    }));

    res.json({ students: result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/fines/assign', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { studentId, fineType, amount, dueDate, label } = req.body;
    const ref = `LIB-${Date.now().toString(36).toUpperCase()}`;
    const fine = await prisma.libraryFine.create({ data: { label: label || `${fineType} Fine`, studentId, fineType, amount, dueDate, status: 'Pending', reference: ref } });
    await prisma.auditLog.create({ data: { action: 'Library Fine Assigned', actorId: req.user!.id, entityType: 'LibraryFine', entityId: fine.id, details: `${fineType} fine of ৳${amount}`, ipAddress: req.ip } });
    void notifyUser({
      recipientId: studentId, category: 'payment', type: 'library_fine.assigned',
      title: 'New Library Fine', body: `A ${fineType} fine of ৳${Number(amount).toLocaleString()} has been added to your account.`,
      link: '/student/dues',
      emailSubject: `Library Fine Assigned — ৳${amount} — Smart Campus`,
    });
    res.json({ success: true, fineId: fine.id, message: 'Library fine assigned' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/fines/waive', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { fineId, reason, action, newAmount } = req.body as { fineId: string; reason?: string; action?: 'waive' | 'reduce'; newAmount?: number };

    if (action === 'reduce') {
      const existing = await prisma.libraryFine.findUnique({ where: { id: fineId } });
      if (!existing) return res.status(404).json({ message: 'Fine not found.' });
      if (!newAmount || newAmount <= 0 || newAmount >= existing.amount) {
        return res.status(400).json({ message: 'Reduced amount must be less than the current fine amount.' });
      }
      const originalAmount = existing.amount;
      const reducedFine = await prisma.libraryFine.update({ where: { id: fineId }, data: { amount: newAmount } });
      await prisma.auditLog.create({ data: { action: 'Library Fine Reduced', actorId: req.user!.id, entityType: 'LibraryFine', entityId: fineId, details: `Reduced from ৳${originalAmount} to ৳${newAmount}${reason ? ` — ${reason}` : ''}`, ipAddress: req.ip } });
      void notifyUser({
        recipientId: reducedFine.studentId, category: 'payment', type: 'library_fine.reduced',
        title: 'Library Fine Reduced', body: `Your ${reducedFine.fineType || ''} fine was reduced from ৳${originalAmount.toLocaleString()} to ৳${newAmount.toLocaleString()}.${reason ? ` Reason: ${reason}` : ''}`,
        link: '/student/dues',
        emailSubject: 'Library Fine Reduced — Smart Campus',
      });
      return res.json({ success: true, message: `Fine reduced to ৳${newAmount.toLocaleString()}` });
    }

    const waivedFine = await prisma.libraryFine.update({ where: { id: fineId }, data: { status: 'Waived' } });
    await prisma.auditLog.create({ data: { action: 'Library Fine Waived', actorId: req.user!.id, entityType: 'LibraryFine', entityId: fineId, details: reason || 'Fine waived', ipAddress: req.ip } });
    void notifyUser({
      recipientId: waivedFine.studentId, category: 'payment', type: 'library_fine.waived',
      title: 'Library Fine Waived', body: `Your ${waivedFine.fineType || ''} fine of ৳${waivedFine.amount.toLocaleString()} has been waived.${reason ? ` Reason: ${reason}` : ''}`,
      link: '/student/dues',
      emailSubject: 'Library Fine Waived — Smart Campus',
    });
    res.json({ success: true, message: 'Fine waived' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/clearance', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { department } = req.body as { department?: string };
    const students = await prisma.user.findMany({ where: { role: 'Student', ...(department ? { department } : {}) }, take: 100 });
    const result = [];
    for (const s of students) {
      const fines = await prisma.libraryFine.findMany({ where: { studentId: s.id, status: 'Pending' } });
      const pendingAmount = fines.reduce((sum, f) => sum + f.amount, 0);
      result.push({
        id: s.id, fullName: s.fullName || '', studentId: s.studentId || '', department: s.department || '',
        status: fines.length > 0 ? 'Unpaid' as const : 'Cleared' as const,
        pendingAmount, pendingCount: fines.length,
      });
    }
    const departments = [...new Set(students.map(s => s.department).filter(Boolean) as string[])];
    res.json({ students: result, departments });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/library/clearance/report', authMiddleware, requireLibrary, async (req: AuthRequest, res) => {
  try {
    const { format = 'csv', department } = req.body as { format?: ReportFormat; department?: string };
    const students = await prisma.user.findMany({ where: { role: 'Student', ...(department ? { department } : {}) }, take: 1000 });
    const rows = [];
    for (const s of students) {
      const fines = await prisma.libraryFine.findMany({ where: { studentId: s.id, status: 'Pending' } });
      const pendingAmount = fines.reduce((sum, f) => sum + f.amount, 0);
      rows.push({
        studentId: s.studentId || '', fullName: s.fullName || '', department: s.department || '',
        status: fines.length > 0 ? 'Unpaid' : 'Cleared', pendingCount: fines.length, pendingAmount,
      });
    }
    const url = await generateTabularReport({
      title: 'Library Clearance Report',
      format,
      columns: [
        { key: 'studentId', label: 'Student ID', width: 16 }, { key: 'fullName', label: 'Name', width: 24 },
        { key: 'department', label: 'Department', width: 20 }, { key: 'status', label: 'Status', width: 12 },
        { key: 'pendingCount', label: 'Pending Fines', width: 14 }, { key: 'pendingAmount', label: 'Amount (৳)', width: 14 },
      ],
      rows, uploadsSubdir: 'library-reports', filenamePrefix: 'clearance-status',
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ACCOUNTS ROUTES ───
router.post('/accounts/overview', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const [totalAgg, collectedAgg, pendingAgg, pendingCount, totalStudents] = await Promise.all([
      prisma.semesterFee.aggregate({ _sum: { amount: true } }),
      prisma.semesterFee.aggregate({ _sum: { amount: true }, where: { status: 'Paid' } }),
      prisma.semesterFee.aggregate({ _sum: { amount: true }, where: { status: 'Pending' } }),
      prisma.semesterFee.count({ where: { status: 'Pending' } }),
      prisma.user.count({ where: { role: 'Student' } }),
    ]);
    const total = totalAgg._sum.amount || 0;
    const collected = collectedAgg._sum.amount || 0;
    const pending = pendingAgg._sum.amount || 0;
    const collectionRate = total > 0 ? Math.round((collected / total) * 100) : 0;

    const recent = await prisma.semesterFee.findMany({ where: { status: 'Paid' }, take: 10, orderBy: { updatedAt: 'desc' }, include: { student: true } });
    res.json({
      totalFees: total, totalCollected: collected, totalPending: pending, collectionRate,
      totalAssigned: total, totalPaid: collected, totalOutstanding: pending,
      collectionPercent: collectionRate, pendingCount, totalStudents,
      recentPayments: recent.map(r => ({ id: r.id, studentName: r.student?.fullName || '', amount: r.amount, status: r.status, date: r.updatedAt.toISOString() })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/fee-push', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
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

router.post('/accounts/fee-adjust', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const { feeId, newAmount, newStatus, reason } = req.body;
    const data: any = {};
    if (newAmount !== undefined) data.amount = newAmount;
    if (newStatus) data.status = newStatus;
    await prisma.semesterFee.update({ where: { id: feeId }, data });
    await prisma.auditLog.create({ data: { action: 'Semester Fee Adjusted', actorId: req.user!.id, entityType: 'SemesterFee', entityId: feeId, details: reason || 'Fee adjusted', ipAddress: req.ip } });
    res.json({ success: true, message: 'Fee adjusted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/analytics', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const students = await prisma.user.findMany({ where: { role: 'Student' } });
    const fees = await prisma.semesterFee.findMany({ include: { student: true } });

    const deptMap: Record<string, { total: number; paid: number; pending: number }> = {};
    fees.forEach(f => {
      const dept = f.student?.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { total: 0, paid: 0, pending: 0 };
      deptMap[dept].total += f.amount;
      if (f.status === 'Paid') deptMap[dept].paid += f.amount;
      else if (f.status === 'Pending') deptMap[dept].pending += f.amount;
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
      overall: { paid: collected, pending: total - collected, percent: total > 0 ? Math.round((collected / total) * 100) : 0 },
      departments: Object.entries(deptMap).map(([name, d]) => ({
        name, collected: d.paid, pending: d.pending,
        percent: d.total > 0 ? Math.round((d.paid / d.total) * 100) : 0,
        students: students.filter(s => (s.department || 'Unknown') === name).length,
        pendingAmount: d.pending,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/accounts/analytics/report', authMiddleware, requireAccounts, async (req: AuthRequest, res) => {
  try {
    const { format = 'csv' } = req.body as { format?: ReportFormat };
    const students = await prisma.user.findMany({ where: { role: 'Student' } });
    const fees = await prisma.semesterFee.findMany({ include: { student: true } });

    const deptMap: Record<string, { total: number; paid: number; pending: number }> = {};
    fees.forEach(f => {
      const dept = f.student?.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { total: 0, paid: 0, pending: 0 };
      deptMap[dept].total += f.amount;
      if (f.status === 'Paid') deptMap[dept].paid += f.amount;
      else if (f.status === 'Pending') deptMap[dept].pending += f.amount;
    });

    const rows = Object.entries(deptMap).map(([department, d]) => ({
      department,
      students: students.filter(s => (s.department || 'Unknown') === department).length,
      total: d.total, collected: d.paid, pending: d.pending,
      collectionRate: d.total > 0 ? `${Math.round((d.paid / d.total) * 100)}%` : '0%',
    }));

    const url = await generateTabularReport({
      title: 'Collection Analytics Report',
      format,
      columns: [
        { key: 'department', label: 'Department', width: 24 }, { key: 'students', label: 'Students', width: 12 },
        { key: 'total', label: 'Total Fees (৳)', width: 16 }, { key: 'collected', label: 'Collected (৳)', width: 16 },
        { key: 'pending', label: 'Pending (৳)', width: 16 }, { key: 'collectionRate', label: 'Collection Rate', width: 14 },
      ],
      rows, uploadsSubdir: 'analytics-reports', filenamePrefix: 'collection-analytics',
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── SHOP DASHBOARD ROUTES ───
router.post('/shop/dashboard', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
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

    const [todayTxns, weekTxns, monthTxns, allTimeAgg, recentTxns, payLater, settledAgg, recentSettlements] = await Promise.all([
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: todayStart } } }),
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: weekStart } } }),
      prisma.transaction.findMany({ where: { shopId: shop.id, status: 'Success', createdAt: { gte: monthStart } } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { shopId: shop.id, status: 'Success' } }),
      prisma.transaction.findMany({ where: { shopId: shop.id }, take: 20, orderBy: { createdAt: 'desc' } }),
      prisma.payLaterDue.findMany({ where: { shopId: shop.id, status: 'Pending' }, include: { student: true } }),
      prisma.settlement.aggregate({ _sum: { amount: true }, where: { shopId: shop.id } }),
      prisma.settlement.findMany({ where: { shopId: shop.id }, take: 10, orderBy: { settledAt: 'desc' } }),
    ]);

    const totalRevenue = allTimeAgg._sum.amount || 0;
    const totalSettled = settledAgg._sum.amount || 0;
    const totalCount = allTimeAgg._count._all || 0;

    res.json({
      shop: { id: shop.id, name: shop.name, category: shop.category, rating: shop.rating, status: shop.status, location: shop.location || '', logoUrl: shop.logoUrl || '', merchantId: shop.merchantId || '', qrToken: shop.qrToken || '', qrSignature: shop.qrSignature || '' },
      totalCount,
      todayRevenue: todayTxns.reduce((s, t) => s + t.amount, 0), todayCount: todayTxns.length,
      weekRevenue: weekTxns.reduce((s, t) => s + t.amount, 0), monthRevenue: monthTxns.reduce((s, t) => s + t.amount, 0),
      totalRevenue, totalSettled, pendingSettlement: Math.max(0, totalRevenue - totalSettled),
      recentTransactions: recentTxns.map(t => ({ id: t.id, reference: t.reference, amount: t.amount, status: t.status, description: t.description || '', paymentMethod: t.paymentMethod || '', createdAt: t.createdAt.toISOString() })),
      pendingPayLater: payLater.map(p => ({ id: p.id, reference: p.reference || '', amount: p.amount, status: p.status, studentName: p.student?.fullName || '', dueDate: p.dueDate || '', description: p.description || '' })),
      recentSettlements: recentSettlements.map(s => ({ id: s.id, amount: s.amount, notes: s.notes || '', settledAt: s.settledAt.toISOString() })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shop/sales-ledger/report', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
  try {
    const { format = 'csv', period = 'all' } = req.body as { format?: ReportFormat; period?: 'today' | 'week' | 'month' | 'all' };
    const shop = await prisma.shop.findFirst({ where: { status: 'Active' } });
    if (!shop) return res.status(404).json({ message: 'No shop found' });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = period === 'today' ? todayStart : period === 'week' ? weekStart : period === 'month' ? monthStart : undefined;

    const txns = await prisma.transaction.findMany({
      where: { shopId: shop.id, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 2000,
    });

    const url = await generateTabularReport({
      title: `Sales Ledger — ${shop.name}`,
      format,
      columns: [
        { key: 'createdAt', label: 'Date', width: 20 }, { key: 'reference', label: 'Reference', width: 20 },
        { key: 'description', label: 'Description', width: 30 }, { key: 'paymentMethod', label: 'Method', width: 14 },
        { key: 'amount', label: 'Amount (৳)', width: 14 }, { key: 'status', label: 'Status', width: 12 },
      ],
      rows: txns.map(t => ({
        createdAt: t.createdAt.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }), reference: t.reference,
        description: t.description || '', paymentMethod: t.paymentMethod || t.gateway || '',
        amount: t.amount, status: t.status,
      })),
      uploadsSubdir: 'sales-reports', filenamePrefix: 'sales-ledger',
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/shop/regenerate-qr', authMiddleware, requireShopStaff, async (req: AuthRequest, res) => {
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

// Health check
router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Start server
app.use('/api', router);
app.use('/', router);

// Financial Dispute & Case Management System — separate router files (server/src/routes/disputes/)
// so this module doesn't grow index.ts further; mounted with the same /api + / double-mount
// convention as the router above. Existing routes above are untouched.
app.use('/api', studentDisputeRouter);
app.use('/', studentDisputeRouter);
app.use('/api', accountsDisputeRouter);
app.use('/', accountsDisputeRouter);
app.use('/api', adminDisputeRouter);
app.use('/', adminDisputeRouter);
app.use('/api', libraryDisputeRouter);
app.use('/', libraryDisputeRouter);
app.use('/api', shopDisputeRouter);
app.use('/', shopDisputeRouter);
app.use('/api', disputeNotificationsRouter);
app.use('/', disputeNotificationsRouter);
app.use('/api', feeRouter);
app.use('/', feeRouter);

// Fallback JSON 404 handler (ensures HTML is NEVER returned)
app.use((_req, res) => {
  res.status(404).json({ message: 'API endpoint not found. Please check endpoint URL.' });
});

// Socket.IO needs the raw HTTP server (not just the Express app) to attach its WebSocket upgrade
// handling — this is the one required change to how the server *starts listening*; no
// request-handling logic changes.
const httpServer = http.createServer(app);
attachRealtime(httpServer);

// Loud, impossible-to-miss warning if the JWT signing secret is the hardcoded fallback (see
// lib/auth.ts / lib/realtime.ts) — that fallback string is visible in public source, so anyone
// could forge valid login tokens for any account. This never blocks startup (a hard crash on a
// misconfigured free-tier restart would be worse than a loud log), it just makes the gap
// impossible to miss in the Render log output.
if (!process.env.JWT_SECRET) {
  console.error(
    '\n*** SECURITY WARNING: JWT_SECRET is not set — using the hardcoded fallback secret. ***\n' +
    '*** Anyone can forge valid login tokens for any account. Set a real JWT_SECRET in the ***\n' +
    '*** hosting environment (Render -> Environment) immediately.                          ***\n'
  );
}

httpServer.listen(PORT, () => {
  console.log(`🎓 Smart Campus API running on port ${PORT}`);
});