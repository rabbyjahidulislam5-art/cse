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

export async function sendEmail(to: string, subject: string, body: EmailBody[]) {
  if (!process.env.SMTP_USER) {
    console.log(`[Email] Skipped (no SMTP config): ${subject} → ${to}`);
    return;
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
  } catch (err) {
    console.error(`[Email] Failed: ${subject} → ${to}`, err);
  }
}
