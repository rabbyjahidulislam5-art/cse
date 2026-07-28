import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';

// `family` (force IPv4) is honored by nodemailer at runtime — it's forwarded straight through to
// net.connect — but isn't part of the @types/nodemailer Options surface.
type TransportOptions = SMTPPool.Options & { family?: number };

// `nodemailer.createTransport()` doesn't throw if auth is missing — it only fails when a send is
// actually attempted — so this is safe to construct even before SMTP_USER/SMTP_PASS are set.
const transportConfig: TransportOptions = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  family: 4,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  // Note: a prior Render deploy failed every send with ETIMEDOUT at the raw TCP-connect stage
  // (before EHLO/AUTH), even with family:4 forced — that looked like Render's network being
  // unable to reach smtp.gmail.com:587 at all, independent of which account's credentials were
  // used. If that recurs with these credentials, these timeouts bound how long a request waits
  // (paired with OTP_EMAIL_RESPONSE_BUDGET_MS in index.ts) rather than hanging for minutes.
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 20_000,
};
const transporter = nodemailer.createTransport(transportConfig as SMTPPool.Options);

// One-time check at boot (not per-request) so a broken SMTP config is visible in the logs
// immediately instead of surfacing late on a student's first registration attempt.
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter.verify()
    .then(() => console.log('[Email] SMTP transporter verified and ready.'))
    .catch(err => console.error('[Email] SMTP transporter verification FAILED at startup:', err.message));
} else {
  console.warn('[Email] SMTP_USER/SMTP_PASS not set — email sending will fail until configured.');
}

interface EmailBody {
  type: 'text' | 'divider';
  content?: string;
}

// Throws on failure — callers decide whether a failed send is critical (OTP: must surface
// to the user) or best-effort (welcome/receipt notifications: safe to catch and ignore).
export async function sendEmail(to: string, subject: string, body: EmailBody[]) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email service is not configured (SMTP_USER/SMTP_PASS missing on the server).');
  }

  const htmlParts = body.map(b => {
    if (b.type === 'divider') return '<hr style="border:none;border-top:1px solid #333;margin:16px 0;" />';
    return `<div style="white-space:pre-line;">${b.content || ''}</div>`;
  });

  try {
    await transporter.sendMail({
      from: `"Smart Campus" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: `<div style="font-family:'Inter',sans-serif;color:#e0e0e0;background:#0a0a0f;padding:24px;border-radius:12px;">${htmlParts.join('')}</div>`,
    });
    console.log(`[Email] Sent: ${subject} → ${to}`);
  } catch (err: any) {
    console.error(`[Email] Failed: ${subject} → ${to}`, err);
    throw new Error(`Failed to send email to ${to}: ${err.message || 'SMTP error'}`);
  }
}
