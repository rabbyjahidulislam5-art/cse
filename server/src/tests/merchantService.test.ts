import { describe, it, expect } from 'vitest';
import {
  signQrToken, verifyQrSignature, generateTempPassword, isStrongPassword,
  parseQrPayload, nextOnboardingStep,
} from '../lib/merchantService.js';

describe('Merchant Service — Unit Tests', () => {

  describe('QR Signing', () => {
    const secret = 'test-secret';

    it('should produce a deterministic signature for the same shopId+token+secret', () => {
      const sig1 = signQrToken('shop-1', 'QR-abc123', secret);
      const sig2 = signQrToken('shop-1', 'QR-abc123', secret);
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // hex-encoded HMAC-SHA256
    });

    it('should produce a different signature for a different shopId', () => {
      const sig1 = signQrToken('shop-1', 'QR-abc123', secret);
      const sig2 = signQrToken('shop-2', 'QR-abc123', secret);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce a different signature for a different token', () => {
      const sig1 = signQrToken('shop-1', 'QR-abc123', secret);
      const sig2 = signQrToken('shop-1', 'QR-xyz789', secret);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce a different signature for a different secret', () => {
      const sig1 = signQrToken('shop-1', 'QR-abc123', secret);
      const sig2 = signQrToken('shop-1', 'QR-abc123', 'other-secret');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('QR Signature Verification (forgery rejection)', () => {
    const secret = 'test-secret';

    it('should accept a correctly signed QR', () => {
      const sig = signQrToken('shop-1', 'QR-abc123', secret);
      expect(verifyQrSignature('shop-1', 'QR-abc123', sig, secret)).toBe(true);
    });

    it('should reject a tampered token with a signature computed for a different token', () => {
      const sig = signQrToken('shop-1', 'QR-abc123', secret);
      expect(verifyQrSignature('shop-1', 'QR-tampered', sig, secret)).toBe(false);
    });

    it('should reject a signature copied from a different shop (cross-shop replay)', () => {
      const sigForOtherShop = signQrToken('shop-2', 'QR-abc123', secret);
      expect(verifyQrSignature('shop-1', 'QR-abc123', sigForOtherShop, secret)).toBe(false);
    });

    it('should reject a missing/null signature (pre-Phase-1 unsigned shops)', () => {
      expect(verifyQrSignature('shop-1', 'QR-abc123', null, secret)).toBe(false);
      expect(verifyQrSignature('shop-1', 'QR-abc123', undefined, secret)).toBe(false);
      expect(verifyQrSignature('shop-1', 'QR-abc123', '', secret)).toBe(false);
    });

    it('should reject a garbage/random signature string', () => {
      expect(verifyQrSignature('shop-1', 'QR-abc123', 'not-a-real-signature', secret)).toBe(false);
    });
  });

  describe('Temp Password Generation', () => {
    it('should generate a non-empty, sufficiently long password', () => {
      const pw = generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(10);
    });

    it('should generate a different password on every call', () => {
      const passwords = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
      expect(passwords.size).toBe(50);
    });

    it('should never contain characters unsafe for email/URL contexts', () => {
      // base64url alphabet only — no '+', '/', or '=' that could break a query string or need escaping
      const pw = generateTempPassword();
      expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('Password Strength Validation', () => {
    it('should reject a password shorter than 8 characters', () => {
      expect(isStrongPassword('Ab1')).toMatch(/at least 8 characters/);
    });

    it('should reject a password with no uppercase letter', () => {
      expect(isStrongPassword('lowercase1')).toMatch(/uppercase/);
    });

    it('should reject a password with no lowercase letter', () => {
      expect(isStrongPassword('UPPERCASE1')).toMatch(/lowercase/);
    });

    it('should reject a password with no number', () => {
      expect(isStrongPassword('NoNumbersHere')).toMatch(/number/);
    });

    it('should accept a password meeting all requirements', () => {
      expect(isStrongPassword('ValidPass123')).toBeNull();
    });

    it('should reject an empty password', () => {
      expect(isStrongPassword('')).toMatch(/at least 8 characters/);
    });
  });

  describe('QR Payload Parsing', () => {
    it('should parse the composite SMARTCAMPUS:SHOP:{shopId}:{qrToken} format the merchant QR image encodes', () => {
      const result = parseQrPayload('SMARTCAMPUS:SHOP:shop-abc:QR-xyz123');
      expect(result.shopId).toBe('shop-abc');
      expect(result.token).toBe('QR-xyz123');
    });

    it('should handle a qrToken that itself contains a colon (rejoins remaining segments)', () => {
      const result = parseQrPayload('SMARTCAMPUS:SHOP:shop-abc:QR-xyz:123');
      expect(result.shopId).toBe('shop-abc');
      expect(result.token).toBe('QR-xyz:123');
    });

    it('should parse a legacy JSON {token, shopId} payload', () => {
      const result = parseQrPayload(JSON.stringify({ token: 'QR-legacy', shopId: 'shop-legacy' }));
      expect(result.token).toBe('QR-legacy');
      expect(result.shopId).toBe('shop-legacy');
    });

    it('should parse a legacy JSON {qrToken} payload (alternate key name)', () => {
      const result = parseQrPayload(JSON.stringify({ qrToken: 'QR-alt' }));
      expect(result.token).toBe('QR-alt');
    });

    it('should treat a bare non-JSON, non-composite string as a raw token (manual entry fallback)', () => {
      const result = parseQrPayload('QR-raw-token-abc');
      expect(result.token).toBe('QR-raw-token-abc');
      expect(result.shopId).toBeUndefined();
    });

    it('should return a null token for empty input', () => {
      expect(parseQrPayload('').token).toBeNull();
    });

    it('should return a null token for non-string input', () => {
      // @ts-expect-error — deliberately testing a malformed call
      expect(parseQrPayload(null).token).toBeNull();
      // @ts-expect-error — deliberately testing a malformed call
      expect(parseQrPayload(undefined).token).toBeNull();
    });

    it('should not crash on malformed JSON that starts with a brace', () => {
      const result = parseQrPayload('{not valid json');
      // Falls back to treating the raw string as the token — never throws.
      expect(result.token).toBe('{not valid json');
    });
  });

  describe('Merchant First-Login Onboarding Gate', () => {
    it('should route to change-password when mustChangePassword is true, regardless of email verification', () => {
      expect(nextOnboardingStep({ mustChangePassword: true, emailVerified: false })).toBe('change-password');
      expect(nextOnboardingStep({ mustChangePassword: true, emailVerified: true })).toBe('change-password');
    });

    it('should route to verify-email once password is changed but email is not verified', () => {
      expect(nextOnboardingStep({ mustChangePassword: false, emailVerified: false })).toBe('verify-email');
    });

    it('should return null (dashboard reachable) once both steps are complete', () => {
      expect(nextOnboardingStep({ mustChangePassword: false, emailVerified: true })).toBeNull();
    });

    it('should default missing flags to falsy (never crash on incomplete user objects)', () => {
      expect(nextOnboardingStep({})).toBe('verify-email');
    });
  });

  describe('Full Merchant Onboarding State Machine (integration-style, no I/O)', () => {
    it('should walk create -> forced password change -> forced email verify -> dashboard reachable', () => {
      // 1. Admin creates the shop — a fresh merchant starts locked out of the dashboard.
      let user = { mustChangePassword: true, emailVerified: false };
      expect(nextOnboardingStep(user)).toBe('change-password');

      // 2. Merchant sets a new password — the temp password must pass strength validation first.
      const newPassword = 'NewMerchantPass1';
      expect(isStrongPassword(newPassword)).toBeNull();
      user = { ...user, mustChangePassword: false };
      expect(nextOnboardingStep(user)).toBe('verify-email');

      // 3. Merchant verifies email via OTP.
      user = { ...user, emailVerified: true };
      expect(nextOnboardingStep(user)).toBeNull();
    });

    it('should keep the merchant locked out if only email is verified but password was never changed', () => {
      const user = { mustChangePassword: true, emailVerified: true };
      expect(nextOnboardingStep(user)).toBe('change-password');
    });
  });
});
