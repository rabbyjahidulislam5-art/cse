import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import dns from 'dns';

// `family` and `servername` are honored by nodemailer at runtime (forwarded through to
// net/tls.connect and used for SNI respectively) but aren't part of the @types/nodemailer surface.
type TransportOptions = SMTPPool.Options & { family?: number; servername?: string };

const SMTP_HOSTNAME = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_SECURE = SMTP_PORT === 465; // implicit TLS on 465, STARTTLS on 587/others

// nodemailer 9's own hostname resolver (lib/shared/index.js resolveHostname) resolves BOTH IPv4
// and IPv6 addresses for SMTP_HOST and picks one AT RANDOM — `family: 4` does NOT filter that
// choice (confirmed by reading the source; it concatenates ipv4+ipv6 results and does
// `addresses[Math.floor(Math.random() * addresses.length)]`). That's why Render logs showed two
// different failures on the same config: a plain timeout on some boots (random IPv4 pick) and an
// explicit `ENETUNREACH ...:587` on others (random IPv6 pick — Render's containers have no real
// IPv6 route at all). Passing a literal IP as `host` makes nodemailer's resolver a no-op (it
// special-cases `net.isIP(host)`), so we resolve the hostname to a real IPv4 address ourselves via
// Node's DNS resolver and hand nodemailer that literal address instead — this guarantees IPv4,
// regardless of nodemailer's internal (buggy) family selection. `servername` is set explicitly
// so TLS/SNI and certificate validation still target the real hostname, not the raw IP.
let transporter: Transporter | null = null;
let transporterReady: Promise<void> = Promise.resolve();

function buildTransporter(ipv4Address: string): Transporter {
  const transportConfig: TransportOptions = {
    host: ipv4Address,
    servername: SMTP_HOSTNAME,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  };
  return nodemailer.createTransport(transportConfig as SMTPPool.Options);
}

async function initTransporter(): Promise<void> {
  try {
    // dns.lookup() (OS-level getaddrinfo) rather than dns.resolve4() (raw DNS-server query, which
    // needs a directly reachable nameserver and can fail in restrictive/VPN'd networks even when
    // normal resolution works fine) — this is the same call used to confirm family:4 behavior
    // during the original profiling.
    const addresses = await dns.promises.lookup(SMTP_HOSTNAME, { family: 4, all: true });
    if (!addresses.length) throw new Error(`No IPv4 addresses found for ${SMTP_HOSTNAME}`);
    const chosen = addresses[Math.floor(Math.random() * addresses.length)].address;
    transporter = buildTransporter(chosen);

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.verify();
      console.log(`[Email] SMTP transporter verified and ready (${SMTP_HOSTNAME} -> ${chosen}:${SMTP_PORT}, IPv4-pinned).`);
    } else {
      console.warn('[Email] SMTP_USER/SMTP_PASS not set — email sending will fail until configured.');
    }
  } catch (err: any) {
    console.error('[Email] SMTP transporter setup FAILED at startup:', err.message);
  }
}
transporterReady = initTransporter();

// Gmail's SMTP front-end IPs can rotate over a long-running process — re-resolve periodically so
// a long-lived server doesn't end up pinned to a retired address. Cheap relative to email volume.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
setInterval(() => {
  const previous = transporter;
  transporterReady = initTransporter().then(() => {
    if (previous && previous !== transporter) previous.close();
  });
}, REFRESH_INTERVAL_MS).unref();

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

  await transporterReady.catch(() => {});
  if (!transporter) {
    throw new Error('Email transporter failed to initialize (DNS resolution or SMTP setup failed at startup — check server logs).');
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
