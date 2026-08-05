import { describe, it, expect } from 'vitest';
import {
  parseScholarshipRows, validateScholarshipRow, findMissingScholarshipColumns,
} from '../lib/scholarshipService.js';

describe('Scholarship Service — Unit Tests', () => {
  describe('Row Parsing', () => {
    it('parses raw array rows into structured scholarship objects', () => {
      const rawRows = [
        ['Student ID', 'Student Name', 'Email', 'Amount', 'Remark'],
        ['STU-2026-001', 'Jahidul Islam', 'stu-2026-001@std.ewubd.edu', '10000', 'Merit Scholarship'],
      ];

      const parsed = parseScholarshipRows(rawRows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].studentId).toBe('STU-2026-001');
      expect(parsed[0].amount).toBe(10000);
      expect(parsed[0].remark).toBe('Merit Scholarship');
    });

    it('tolerates header/column order and casing variations', () => {
      const rawRows = [
        ['email', 'amount', 'student id', 'name'],
        ['stu-2026-002@std.ewubd.edu', '5000', 'STU-2026-002', 'Karim Ahmed'],
      ];

      const parsed = parseScholarshipRows(rawRows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].studentId).toBe('STU-2026-002');
      expect(parsed[0].amount).toBe(5000);
      expect(parsed[0].studentName).toBe('Karim Ahmed');
    });

    it('skips rows with no Student ID cell', () => {
      const rawRows = [
        ['Student ID', 'Amount'],
        ['', '5000'],
        ['STU-2026-003', '5000'],
      ];
      expect(parseScholarshipRows(rawRows)).toHaveLength(1);
    });
  });

  describe('Missing Column Detection', () => {
    it('flags a missing Student ID / Amount header', () => {
      expect(findMissingScholarshipColumns([['Name', 'Email']])).toEqual(['Student ID', 'Amount']);
      expect(findMissingScholarshipColumns([['Student ID', 'Name']])).toEqual(['Amount']);
      expect(findMissingScholarshipColumns([['Student ID', 'Amount']])).toEqual([]);
    });
  });

  describe('Row Validation Engine', () => {
    const existingStudents = [
      { id: 'user-1', studentId: 'STU-2026-001', fullName: 'Jahidul Islam', email: 'stu-2026-001@std.ewubd.edu', status: 'Active' },
      { id: 'user-2', studentId: 'STU-2026-002', fullName: 'Karim Ahmed', email: 'stu-2026-002@std.ewubd.edu', status: 'Inactive' },
    ];

    it('passes validation for a valid, matching row', () => {
      const result = validateScholarshipRow(
        { studentId: 'STU-2026-001', studentEmail: 'stu-2026-001@std.ewubd.edu', amount: 10000 },
        existingStudents, new Set()
      );
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('matches a Student ID case-insensitively (the improved shared matcher)', () => {
      const result = validateScholarshipRow(
        { studentId: 'stu-2026-001', amount: 10000 },
        existingStudents, new Set()
      );
      expect(result.isValid).toBe(true);
    });

    it('rejects a row whose Student ID does not exist', () => {
      const result = validateScholarshipRow(
        { studentId: 'STU-9999-999', amount: 10000 },
        existingStudents, new Set()
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Student ID does not exist');
    });

    it('rejects a row for an inactive student', () => {
      const result = validateScholarshipRow(
        { studentId: 'STU-2026-002', amount: 5000 },
        existingStudents, new Set()
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Student account is inactive or locked');
    });

    it('rejects a zero or negative amount', () => {
      const result = validateScholarshipRow(
        { studentId: 'STU-2026-001', amount: 0 },
        existingStudents, new Set()
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Amount must be positive');
    });

    it('rejects a missing Student ID', () => {
      const result = validateScholarshipRow({ studentId: '', amount: 5000 }, existingStudents, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Student ID is required');
    });

    it('detects a duplicate Student ID within the same file', () => {
      const seen = new Set<string>();
      const first = validateScholarshipRow({ studentId: 'STU-2026-001', amount: 1000 }, existingStudents, seen);
      const second = validateScholarshipRow({ studentId: 'STU-2026-001', amount: 2000 }, existingStudents, seen);
      expect(first.isValid).toBe(true);
      expect(second.isValid).toBe(false);
      expect(second.errors).toContain('Duplicate student entry in file');
    });

    it('flags an ambiguous match rather than silently picking a student', () => {
      const dupPool = [...existingStudents, { id: 'user-3', studentId: 'STU-2026-001', fullName: 'Duplicate', email: 'dup@std.ewubd.edu', status: 'Active' }];
      const result = validateScholarshipRow({ studentId: 'STU-2026-001', amount: 1000 }, dupPool, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Ambiguous student match — multiple accounts found');
    });
  });
});
