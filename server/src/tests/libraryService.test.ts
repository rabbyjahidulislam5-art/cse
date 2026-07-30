import { describe, it, expect, vi } from 'vitest';
import { parseLibraryQrPayload, ensureLibrarySingleton } from '../lib/libraryService.js';
import { signQrToken, verifyQrSignature } from '../lib/merchantService.js';

describe('Library Service — Unit Tests', () => {

  describe('QR Payload Parsing', () => {
    it('should parse the composite SMARTCAMPUS:LIBRARY:{libraryId}:{qrToken} format', () => {
      const result = parseLibraryQrPayload('SMARTCAMPUS:LIBRARY:lib-abc:QR-xyz123');
      expect(result.libraryId).toBe('lib-abc');
      expect(result.token).toBe('QR-xyz123');
    });

    it('should handle a qrToken that itself contains a colon (rejoins remaining segments)', () => {
      const result = parseLibraryQrPayload('SMARTCAMPUS:LIBRARY:lib-abc:QR-xyz:123');
      expect(result.libraryId).toBe('lib-abc');
      expect(result.token).toBe('QR-xyz:123');
    });

    it('should not be confused by a Shop QR payload (different prefix)', () => {
      const result = parseLibraryQrPayload('SMARTCAMPUS:SHOP:shop-abc:QR-xyz123');
      // Falls through to the JSON/bare-token branch since the LIBRARY: prefix doesn't match —
      // never silently misattributes a shop QR to a library.
      expect(result.libraryId).toBeUndefined();
      expect(result.token).toBe('SMARTCAMPUS:SHOP:shop-abc:QR-xyz123');
    });

    it('should parse a legacy JSON {token, libraryId} payload', () => {
      const result = parseLibraryQrPayload(JSON.stringify({ token: 'QR-legacy', libraryId: 'lib-legacy' }));
      expect(result.token).toBe('QR-legacy');
      expect(result.libraryId).toBe('lib-legacy');
    });

    it('should treat a bare non-JSON, non-composite string as a raw token (manual entry fallback)', () => {
      const result = parseLibraryQrPayload('QR-raw-token-abc');
      expect(result.token).toBe('QR-raw-token-abc');
      expect(result.libraryId).toBeUndefined();
    });

    it('should return a null token for empty input', () => {
      expect(parseLibraryQrPayload('').token).toBeNull();
    });

    it('should not crash on malformed JSON that starts with a brace', () => {
      const result = parseLibraryQrPayload('{not valid json');
      expect(result.token).toBe('{not valid json');
    });
  });

  describe('QR Signing (reused from merchantService — generic, not Shop-specific)', () => {
    const secret = 'test-secret';

    it('should sign and verify a Library id/token pair identically to a Shop one', () => {
      const sig = signQrToken('library-1', 'QR-abc123', secret);
      expect(verifyQrSignature('library-1', 'QR-abc123', sig, secret)).toBe(true);
    });

    it('should reject a signature copied from a different secret', () => {
      const sig = signQrToken('library-1', 'QR-abc123', secret);
      expect(verifyQrSignature('library-1', 'QR-abc123', sig, 'other-secret')).toBe(false);
    });
  });

  describe('ensureLibrarySingleton', () => {
    it('should return the existing row via a direct lookup, without upserting, when one already exists', async () => {
      const existing = { id: 'singleton-library', qrToken: 'QR-existing' };
      const prisma = {
        library: {
          findUnique: vi.fn().mockResolvedValue(existing),
          upsert: vi.fn(),
        },
      };
      const result = await ensureLibrarySingleton(prisma, 'secret');
      expect(result).toBe(existing);
      expect(prisma.library.upsert).not.toHaveBeenCalled();
    });

    it('should upsert on the fixed singleton id (one atomic call, not a create-then-update pair) when none exists yet', async () => {
      const created = { id: 'singleton-library', qrToken: 'QR-new-token', qrSignature: 'signed' };
      const prisma = {
        library: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue(created),
        },
      };
      const result = await ensureLibrarySingleton(prisma, 'secret');
      expect(prisma.library.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.library.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'singleton-library' });
      expect(call.create.id).toBe('singleton-library');
      expect(result).toEqual(created);
    });

    it('should always target the same fixed id — never a random one — so concurrent first-ever calls converge on one row via the DB upsert instead of racing to two separate creates', async () => {
      const prisma = {
        library: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
        },
      };
      const [a, b] = await Promise.all([
        ensureLibrarySingleton(prisma, 'secret'),
        ensureLibrarySingleton(prisma, 'secret'),
      ]);
      expect(a.id).toBe('singleton-library');
      expect(b.id).toBe('singleton-library');
    });
  });
});
