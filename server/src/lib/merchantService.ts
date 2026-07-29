import crypto from 'crypto';

// Pure/testable logic for the Shop → Merchant User feature (Phase 1). Kept separate from
// index.ts's route handlers for the same reason feeManagementService.ts is separate — so it can
// be unit tested without spinning up Express/Prisma, matching this project's existing convention.

export function signQrToken(shopId: string, qrToken: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${shopId}:${qrToken}`).digest('hex');
}

export function verifyQrSignature(shopId: string, qrToken: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature) return false;
  return signature === signQrToken(shopId, qrToken, secret);
}

export function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function isStrongPassword(pw: string): string | null {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
  return null;
}

export interface ParsedQrPayload {
  token: string | null;
  shopId?: string;
}

// Accepts three payload shapes a scanned QR can produce:
//  1. The composite string a merchant's own QR image encodes: "SMARTCAMPUS:SHOP:{shopId}:{qrToken}"
//  2. A JSON object: {"token" | "qrToken": "...", "shopId"?: "..."}
//  3. A bare qrToken string (legacy/manual entry fallback)
export function parseQrPayload(qrData: string): ParsedQrPayload {
  if (typeof qrData !== 'string' || !qrData) return { token: null };

  if (qrData.startsWith('SMARTCAMPUS:SHOP:')) {
    const parts = qrData.split(':');
    const shopId = parts[2];
    const token = parts.slice(3).join(':');
    return { token: token || null, shopId };
  }

  let parsed: any = null;
  try { parsed = JSON.parse(qrData); } catch { parsed = null; }
  const token = parsed?.token || parsed?.qrToken || qrData;
  return { token: token || null, shopId: parsed?.shopId };
}

// The merchant first-login onboarding gate: which standalone route (if any) a Shop Staff user
// must be redirected to before the real dashboard is reachable. Mirrors ShopLayout.tsx's redirect
// logic on the frontend — kept here too so the underlying business rule has a test that doesn't
// depend on React Router.
export type OnboardingStep = 'change-password' | 'verify-email' | null;

export function nextOnboardingStep(user: { mustChangePassword?: boolean; emailVerified?: boolean }): OnboardingStep {
  if (user.mustChangePassword) return 'change-password';
  if (!user.emailVerified) return 'verify-email';
  return null;
}
