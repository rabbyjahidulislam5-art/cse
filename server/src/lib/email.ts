import { Resend } from 'resend';

// Raw SMTP to Gmail was replaced after production logs showed every send failing with ETIMEDOUT
// at the TCP-connect stage from Render, even after forcing IPv4 and pooling connections — Render's
// outbound network can't reliably reach smtp.gmail.com:587 at all. Resend sends over HTTPS, which
// isn't subject to that class of port blocking.
const resend = new Resend(process.env.RESEND_API_KEY);

// Sandbox sender until a custom domain is verified in Resend's dashboard — until then, Resend
// only delivers to the email address the account was signed up with (anti-abuse restriction on
// their end, not a bug here). Once a domain is verified, set RESEND_FROM_EMAIL to something like
// "Smart Campus <noreply@yourdomain.com>" and real students will receive OTPs.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'Smart Campus <onboarding@resend.dev>';

if (!process.env.RESEND_API_KEY) {
  console.warn('[Email] RESEND_API_KEY not set — email sending will fail until configured.');
} else if (!process.env.RESEND_FROM_EMAIL) {
  console.warn(`[Email] Resend configured in SANDBOX mode (from: ${FROM_ADDRESS}) — emails will only deliver to the address your Resend account signed up with, not to real students, until a domain is verified and RESEND_FROM_EMAIL is set.`);
} else {
  console.log(`[Email] Resend configured. From: ${FROM_ADDRESS}`);
}

interface EmailBody {
  type: 'text' | 'divider';
  content?: string;
}

// Throws on failure — callers decide whether a failed send is critical (OTP: must surface
// to the user) or best-effort (welcome/receipt notifications: safe to catch and ignore).
export async function sendEmail(to: string, subject: string, body: EmailBody[]) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Email service is not configured (RESEND_API_KEY missing on the server).');
  }

  const htmlParts = body.map(b => {
    if (b.type === 'divider') return '<hr style="border:none;border-top:1px solid #333;margin:16px 0;" />';
    return `<div style="white-space:pre-line;">${b.content || ''}</div>`;
  });

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html: `<div style="font-family:'Inter',sans-serif;color:#e0e0e0;background:#0a0a0f;padding:24px;border-radius:12px;">${htmlParts.join('')}</div>`,
  });

  if (error) {
    console.error(`[Email] Failed: ${subject} → ${to}`, error);
    throw new Error(`Failed to send email to ${to}: ${error.message}`);
  }
  console.log(`[Email] Sent: ${subject} → ${to}`);
}
