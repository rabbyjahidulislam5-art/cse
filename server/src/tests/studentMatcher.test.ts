import { describe, it, expect } from 'vitest';
import { matchStudent, normalizeStudentId, normalizeEmail, MatchableUser } from '../lib/studentMatcher.js';

describe('studentMatcher — normalization', () => {
  it('trims and uppercases Student IDs', () => {
    expect(normalizeStudentId('  stu-2026-001 ')).toBe('STU-2026-001');
  });

  it('trims and lowercases emails', () => {
    expect(normalizeEmail('  Jahid@STD.ewubd.EDU ')).toBe('jahid@std.ewubd.edu');
  });

  it('treats null/undefined as empty string', () => {
    expect(normalizeStudentId(null)).toBe('');
    expect(normalizeStudentId(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('studentMatcher — matchStudent (in-memory pool)', () => {
  const pool: MatchableUser[] = [
    { id: 'user-1', studentId: 'STU-2026-001', email: 'jahid@std.ewubd.edu' },
    { id: 'user-2', studentId: 'STU-2026-002', email: 'karim@std.ewubd.edu' },
    { id: 'user-3', studentId: null, email: 'noid@std.ewubd.edu' },
  ];

  it('matches on an exact Student ID', () => {
    const result = matchStudent({ studentId: 'STU-2026-001', email: '' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.user.id).toBe('user-1');
      expect(result.matchedBy).toBe('studentId');
    }
  });

  it('matches a Student ID regardless of case', () => {
    const result = matchStudent({ studentId: 'stu-2026-001', email: '' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.user.id).toBe('user-1');
  });

  it('matches a Student ID with surrounding whitespace', () => {
    const result = matchStudent({ studentId: '  STU-2026-002  ', email: '' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.user.id).toBe('user-2');
  });

  it('falls back to email when Student ID is absent', () => {
    const result = matchStudent({ studentId: '', email: 'noid@std.ewubd.edu' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.user.id).toBe('user-3');
      expect(result.matchedBy).toBe('email');
    }
  });

  it('falls back to email (case-insensitive) when Student ID matches nobody', () => {
    const result = matchStudent({ studentId: 'STU-9999-999', email: 'KARIM@std.ewubd.edu' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.user.id).toBe('user-2');
      expect(result.matchedBy).toBe('email');
    }
  });

  it('prefers Student ID over email when they would resolve to different users', () => {
    // Row claims STU-2026-001 by ID but karim's email by mistake — ID wins.
    const result = matchStudent({ studentId: 'STU-2026-001', email: 'karim@std.ewubd.edu' }, pool);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.user.id).toBe('user-1');
      expect(result.matchedBy).toBe('studentId');
    }
  });

  it('returns not_found when neither Student ID nor email matches anyone', () => {
    const result = matchStudent({ studentId: 'STU-0000-000', email: 'nobody@std.ewubd.edu' }, pool);
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('not_found');
  });

  it('returns not_found when both fields are empty', () => {
    const result = matchStudent({ studentId: '', email: '' }, pool);
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('not_found');
  });

  it('flags an ambiguous Student ID match rather than silently picking one', () => {
    const dupPool: MatchableUser[] = [
      ...pool,
      { id: 'user-4', studentId: 'STU-2026-001', email: 'duplicate@std.ewubd.edu' },
    ];
    const result = matchStudent({ studentId: 'stu-2026-001', email: '' }, dupPool);
    expect(result.matched).toBe(false);
    if (!result.matched && result.reason === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    } else {
      throw new Error('expected ambiguous result');
    }
  });

  it('flags an ambiguous email match rather than silently picking one', () => {
    const dupPool: MatchableUser[] = [
      { id: 'user-5', studentId: 'STU-2026-005', email: 'shared@std.ewubd.edu' },
      { id: 'user-6', studentId: 'STU-2026-006', email: 'shared@std.ewubd.edu' },
    ];
    const result = matchStudent({ studentId: '', email: 'shared@std.ewubd.edu' }, dupPool);
    expect(result.matched).toBe(false);
    if (!result.matched && result.reason === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    } else {
      throw new Error('expected ambiguous result');
    }
  });
});
