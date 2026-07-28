import crypto from 'crypto';

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
  mimeType?: string;
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

const MAGIC_BYTES: { mime: string; sig: Buffer }[] = [
  { mime: 'image/jpeg', sig: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', sig: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'application/pdf', sig: Buffer.from('%PDF-', 'ascii') },
];

function sniffMimeType(buffer: Buffer): string | null {
  for (const { mime, sig } of MAGIC_BYTES) {
    if (buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)) return mime;
  }
  // WEBP isn't a simple fixed-byte prefix: bytes 0-3 are "RIFF", a 4-byte size field, then "WEBP".
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function sanitizeFilename(name: string): string {
  const stripped = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
  const safe = stripped.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.slice(-150) || 'file';
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Real validation today: magic-byte sniffing (not just trusting the extension or the client's
// declared Content-Type), an extension allowlist, a size cap, and a check that the extension
// actually agrees with the sniffed content (blocks e.g. a renamed executable disguised as ".pdf").
export function validateAttachment(originalName: string, buffer: Buffer): FileValidationResult {
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: 'Only JPG, PNG, WEBP, and PDF files are allowed.' };
  }
  if (buffer.length === 0) return { ok: false, reason: 'File is empty.' };
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'File exceeds the 10MB attachment size limit.' };
  }

  const sniffed = sniffMimeType(buffer);
  if (!sniffed) {
    return { ok: false, reason: 'File content does not match a supported image or PDF format.' };
  }

  const extMatchesMime =
    (sniffed === 'application/pdf' && ext === '.pdf') ||
    (sniffed === 'image/jpeg' && (ext === '.jpg' || ext === '.jpeg')) ||
    (sniffed === 'image/png' && ext === '.png') ||
    (sniffed === 'image/webp' && ext === '.webp');
  if (!extMatchesMime) {
    return { ok: false, reason: 'File extension does not match its actual content.' };
  }

  return { ok: true, mimeType: sniffed };
}

// Pluggable async scan hook. No antivirus engine is provisioned in this project today, so this
// intentionally does NOT report "clean" — that would be a fake result pretending to be a real
// security check. It reports "pending" (not yet backed by a real scan). Once a real engine (a
// ClamAV daemon, a cloud AV API) is provisioned, replace this function's body with a real call —
// every caller already treats scanStatus as async and nothing else needs to change.
export async function scanFile(_buffer: Buffer, _mimeType: string): Promise<'pending' | 'clean' | 'infected' | 'error'> {
  return 'pending';
}
