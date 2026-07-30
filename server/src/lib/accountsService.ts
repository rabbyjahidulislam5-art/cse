import crypto from 'crypto';
import { signQrToken } from './merchantService';

// Pure/testable logic for the Accounts Office QR feature — mirrors libraryService.ts exactly,
// reusing signQrToken/verifyQrSignature from merchantService.ts rather than duplicating them.
// Accounts Office QR does not lead to one flat payment like Shop/Library — scanning it opens the
// student's own payment-category chooser (all their unpaid dues), so no per-scan amount/entity
// record is minted here, only identity + signature verification.

export interface ParsedAccountsQrPayload {
  token: string | null;
  accountsId?: string;
}

// Same 3-shape handling as parseQrPayload/parseLibraryQrPayload, for the
// "SMARTCAMPUS:ACCOUNTS:{accountsId}:{qrToken}" prefix.
export function parseAccountsQrPayload(qrData: string): ParsedAccountsQrPayload {
  if (typeof qrData !== 'string' || !qrData) return { token: null };

  if (qrData.startsWith('SMARTCAMPUS:ACCOUNTS:')) {
    const parts = qrData.split(':');
    const accountsId = parts[2];
    const token = parts.slice(3).join(':');
    return { token: token || null, accountsId };
  }

  let parsed: any = null;
  try { parsed = JSON.parse(qrData); } catch { parsed = null; }
  const token = parsed?.token || parsed?.qrToken || qrData;
  return { token: token || null, accountsId: parsed?.accountsId };
}

// Fixed, well-known primary key for the one AccountsOffice row this app ever has — same
// fixed-id-upsert pattern as Library's SINGLETON_ID, immune to the TOCTOU race a
// findFirst()-then-create() would have under concurrent first-ever calls.
const SINGLETON_ID = 'singleton-accounts';

export async function ensureAccountsOfficeSingleton(prisma: any, secret: string) {
  const existing = await prisma.accountsOffice.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;

  const qrToken = `QR-${crypto.randomBytes(6).toString('hex')}`;
  const qrSignature = signQrToken(SINGLETON_ID, qrToken, secret);

  return prisma.accountsOffice.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: {
      id: SINGLETON_ID,
      name: 'Accounts Office',
      qrToken, qrSignature,
    },
  });
}
