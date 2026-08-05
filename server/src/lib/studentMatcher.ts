import { PrismaClient, Prisma } from '@prisma/client';

// Shared student-identity resolver used by every Excel/CSV import feature (Fee Push, Scholarship
// Push, and any future import). Consolidates what used to be two independently-drifting matching
// passes (validation vs. push-execution) into one normalization + precedence rule, applied
// identically everywhere a spreadsheet row needs to be resolved to a real student account.
//
// Normalization is deliberately conservative: trim + case-fold only. It does NOT strip internal
// separators (dashes/spaces inside a Student ID) — every real Student ID in this system already
// uses a fixed dash-delimited format (e.g. STU-2026-001, 2023-2-60-053), so case/whitespace is the
// only real-world inconsistency worth tolerating; silently reformatting the ID itself would risk
// matching two genuinely different IDs.

export function normalizeStudentId(raw: string | null | undefined): string {
  return (raw || '').trim().toUpperCase();
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase();
}

export interface MatchableUser {
  id: string;
  studentId: string | null;
  email: string;
}

export type MatchResult<T extends MatchableUser> =
  | { matched: true; user: T; matchedBy: 'studentId' | 'email' }
  | { matched: false; reason: 'not_found' }
  | { matched: false; reason: 'ambiguous'; candidates: T[] };

/**
 * Resolves a spreadsheet row to exactly one student from an in-memory candidate pool.
 * - Student ID is the primary key: a normalized Student ID match wins even if a different
 *   candidate would also match on email.
 * - Email is a fallback, used only when the row has no Student ID or it matches nobody.
 * - Never silently picks between multiple equally-valid matches — returns `ambiguous` instead,
 *   surfaced by callers as a validation error rather than a guess.
 */
export function matchStudent<T extends MatchableUser>(
  row: { studentId?: string | null; email?: string | null },
  pool: T[]
): MatchResult<T> {
  const normId = normalizeStudentId(row.studentId);
  if (normId) {
    const idMatches = pool.filter(u => normalizeStudentId(u.studentId) === normId);
    if (idMatches.length === 1) return { matched: true, user: idMatches[0], matchedBy: 'studentId' };
    if (idMatches.length > 1) return { matched: false, reason: 'ambiguous', candidates: idMatches };
  }

  const normEmail = normalizeEmail(row.email);
  if (normEmail) {
    const emailMatches = pool.filter(u => normalizeEmail(u.email) === normEmail);
    if (emailMatches.length === 1) return { matched: true, user: emailMatches[0], matchedBy: 'email' };
    if (emailMatches.length > 1) return { matched: false, reason: 'ambiguous', candidates: emailMatches };
  }

  return { matched: false, reason: 'not_found' };
}

type Db = PrismaClient | Prisma.TransactionClient;

const DB_MATCH_SELECT = { id: true, studentId: true, email: true } as const;

/**
 * Same precedence/ambiguity rules as matchStudent(), but resolves directly against the database
 * instead of a pre-loaded pool — used at push-execution time (inside a $transaction), where the
 * candidate pool isn't already in memory. Runs one case-insensitive query per row rather than
 * loading every student, since push execution only ever processes the batch's own Valid items.
 */
export async function matchStudentInDb(
  row: { studentId?: string | null; email?: string | null },
  db: Db
): Promise<MatchResult<MatchableUser>> {
  const normId = normalizeStudentId(row.studentId);
  if (normId) {
    const idMatches = await db.user.findMany({
      where: { studentId: { equals: normId, mode: 'insensitive' } },
      select: DB_MATCH_SELECT,
    });
    if (idMatches.length === 1) return { matched: true, user: idMatches[0], matchedBy: 'studentId' };
    if (idMatches.length > 1) return { matched: false, reason: 'ambiguous', candidates: idMatches };
  }

  const normEmail = normalizeEmail(row.email);
  if (normEmail) {
    const emailMatches = await db.user.findMany({
      where: { email: { equals: normEmail, mode: 'insensitive' } },
      select: DB_MATCH_SELECT,
    });
    if (emailMatches.length === 1) return { matched: true, user: emailMatches[0], matchedBy: 'email' };
    if (emailMatches.length > 1) return { matched: false, reason: 'ambiguous', candidates: emailMatches };
  }

  return { matched: false, reason: 'not_found' };
}
