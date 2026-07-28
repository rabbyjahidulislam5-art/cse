import { OAuth2Client } from 'google-auth-library';

// Raw SMTP (any provider, any port, any Nodemailer config) cannot work from this server: Render's
// free-tier web services have blocked ALL outbound traffic to SMTP ports 25/465/587 since
// 2025-09-26 (https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).
// That's an infrastructure-level firewall rule enforced before a packet ever reaches Gmail — it's
// why every previous fix here (DNS resolution, forcing IPv4, pinning a literal IP to bypass
// nodemailer's resolver, switching 587->465) failed identically with ETIMEDOUT at the raw
// TCP-connect stage (`command: 'CONN'`, before EHLO/TLS/AUTH). Nodemailer's Gmail "OAuth2" auth
// mode does NOT help either — it still opens a raw SMTP socket on the same blocked ports; only
// changing the *auth method*, not the *transport*, so it hits the identical firewall block.
//
// The only way to send through a real Gmail account from here is Gmail's own REST API
// (https://gmail.googleapis.com), which is plain HTTPS on port 443 — a port Render's free tier
// does not block. This trades SMTP for OAuth2 + HTTPS, but keeps using the actual Gmail account
// (not a third-party provider like SendGrid/Resend/Mailgun).
//
// Setup (one-time, cannot be done from code — see server/src/get-gmail-token.ts):
//   1. Google Cloud Console: enable the "Gmail API" for a project, create an OAuth 2.0 Client ID
//      of type "Desktop app" (Desktop clients support the localhost-loopback consent flow without
//      pre-registering a redirect URI).
//   2. Run `npx tsx src/get-gmail-token.ts <CLIENT_ID> <CLIENT_SECRET>` locally, open the printed
//      URL, sign in with the Gmail account to send FROM, approve the "Send email on your behalf"
//      permission. The script prints a refresh token.
//   3. Set GMAIL_SENDER_ADDRESS, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and
//      GMAIL_OAUTH_REFRESH_TOKEN in Render's environment.
const GMAIL_SENDER = process.env.GMAIL_SENDER_ADDRESS;
const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_OAUTH_REFRESH_TOKEN;

const CONFIGURED = !!(GMAIL_SENDER && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);

// google-auth-library caches the access token internally and only calls out to Google to refresh
// it once it's actually expired, so repeated getAccessToken() calls across requests are cheap.
let oauth2Client: OAuth2Client | null = null;
if (CONFIGURED) {
  oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
} else {
  console.warn('[Email] Gmail API not configured (GMAIL_SENDER_ADDRESS / GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN missing) — email sending will fail until configured.');
}

// One-time check at boot (not per-request) so an invalid/expired refresh token is visible in the
// logs immediately instead of surfacing late on a student's first registration attempt.
async function verifyAtStartup() {
  if (!oauth2Client) return;
  try {
    const stage = 'oauth-token-refresh';
    const { token } = await oauth2Client.getAccessToken();
    if (!token) throw new Error(`[stage=${stage}] no access token returned`);
    console.log(`[Email] Gmail API OAuth token refresh succeeded at startup — ready (sender: ${GMAIL_SENDER}).`);
  } catch (err: any) {
    console.error('[Email] Gmail API setup FAILED at startup (stage=oauth-token-refresh):', err.message);
  }
}
verifyAtStartup();

interface EmailBody {
  type: 'text' | 'divider';
  content?: string;
}

function encodeSubject(subject: string): string {
  // RFC 2047 encoded-word — subjects here contain non-ASCII characters (e.g. an em dash), which a
  // raw header value can't carry safely.
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

function buildRawMessage(to: string, from: string, subject: string, html: string): string {
  const mime = [
    `From: "Smart Campus" <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
  ].join('\r\n');

  // Gmail API requires base64url (RFC 4648 §5), not standard base64.
  return Buffer.from(mime, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Throws on failure — callers decide whether a failed send is critical (OTP: must surface
// to the user) or best-effort (welcome/receipt notifications: safe to catch and ignore).
export async function sendEmail(to: string, subject: string, body: EmailBody[]) {
  if (!oauth2Client || !GMAIL_SENDER) {
    throw new Error('Email service is not configured (Gmail API OAuth credentials missing on the server).');
  }

  const htmlParts = body.map(b => {
    if (b.type === 'divider') return '<hr style="border:none;border-top:1px solid #333;margin:16px 0;" />';
    return `<div style="white-space:pre-line;">${b.content || ''}</div>`;
  });
  const html = `<div style="font-family:'Inter',sans-serif;color:#e0e0e0;background:#0a0a0f;padding:24px;border-radius:12px;">${htmlParts.join('')}</div>`;

  let stage = 'oauth-token-refresh';
  try {
    const tokenStart = Date.now();
    const { token } = await oauth2Client.getAccessToken();
    if (!token) throw new Error('no access token returned');
    console.log(`[Email] [${stage}] OK in ${Date.now() - tokenStart}ms`);

    stage = 'gmail-api-send';
    const sendStart = Date.now();
    const raw = buildRawMessage(to, GMAIL_SENDER, subject, html);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    const elapsed = Date.now() - sendStart;

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gmail API responded ${res.status} ${res.statusText} in ${elapsed}ms: ${errBody}`);
    }

    const result = (await res.json()) as { id?: string };
    console.log(`[Email] [${stage}] OK in ${elapsed}ms (messageId: ${result.id})`);
    console.log(`[Email] Sent: ${subject} → ${to}`);
  } catch (err: any) {
    console.error(`[Email] Failed at stage=${stage}: ${subject} → ${to}`, err);
    throw new Error(`Failed to send email to ${to} (stage=${stage}): ${err.message || 'Gmail API error'}`);
  }
}
