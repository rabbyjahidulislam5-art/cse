import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
