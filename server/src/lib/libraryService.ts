import crypto from 'crypto';
import { signQrToken } from './merchantService';

// Pure/testable logic for the Library QR feature — reuses generateTempPassword, isStrongPassword,
// signQrToken, verifyQrSignature, and nextOnboardingStep straight from merchantService.ts (all
// already generic, not Shop-specific). Only what's genuinely new to Library lives here.

export interface ParsedLibraryQrPayload {
  token: string | null;
  libraryId?: string;
}

// Same 3-shape handling as merchantService.ts's parseQrPayload, but for the
// "SMARTCAMPUS:LIBRARY:{libraryId}:{qrToken}" prefix instead of ":SHOP:".
export function parseLibraryQrPayload(qrData: string): ParsedLibraryQrPayload {
  if (typeof qrData !== 'string' || !qrData) return { token: null };

  if (qrData.startsWith('SMARTCAMPUS:LIBRARY:')) {
    const parts = qrData.split(':');
    const libraryId = parts[2];
    const token = parts.slice(3).join(':');
    return { token: token || null, libraryId };
  }

  let parsed: any = null;
  try { parsed = JSON.parse(qrData); } catch { parsed = null; }
  const token = parsed?.token || parsed?.qrToken || qrData;
  return { token: token || null, libraryId: parsed?.libraryId };
}

// Fixed, well-known primary key for the one Library row this app ever has — NOT a random cuid.
// A `findFirst()`-then-`create()` singleton has a TOCTOU race (two concurrent first-ever calls
// can both see no row and both create one); pinning the id and using `upsert` makes "ensure it
// exists" a single atomic DB operation instead, immune to that race. Same precedent as
// SequenceCounter's fixed-id upsert pattern elsewhere in this schema.
const SINGLETON_ID = 'singleton-library';

// Ensures exactly one Library row exists (singleton — every Library Staff account shares it,
// mirroring the existing shared fine-queue dashboard, unlike Shop's 1:1 merchant ownership).
// Creates it with a signed QR on first access so a Library record + QR always exist by the time
// any /library/* QR route needs one. `secret` is supplied by the caller (index.ts already owns
// QR_SIGNING_SECRET's env-var/fallback resolution for the Shop QR — reused as-is here rather than
// re-deriving it in a second place).
export async function ensureLibrarySingleton(prisma: any, secret: string) {
  const existing = await prisma.library.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;

  const qrToken = `QR-${crypto.randomBytes(6).toString('hex')}`;
  const qrSignature = signQrToken(SINGLETON_ID, qrToken, secret);

  // Atomic: if two requests race here, the DB's primary-key constraint lets exactly one INSERT
  // win — Prisma's upsert retries as an update against the row the other request just created,
  // rather than ever producing two rows.
  return prisma.library.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: {
      id: SINGLETON_ID,
      name: 'Central Library',
      libraryCode: `LIB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      qrToken, qrSignature,
    },
  });
}
