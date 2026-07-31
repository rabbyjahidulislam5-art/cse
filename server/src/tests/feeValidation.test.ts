import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateFeeLabel,
  validateImportRow,
  calculateFinalAmount,
  validateApprovalWorkflowPermissions,
  parseImportRows
} from '../lib/feeManagementService.js';

describe('Fee Management Service — Unit Tests', () => {

  describe('Fee Label Generator', () => {
    it('should generate correct semester fee label format', () => {
      const label = generateFeeLabel('Spring', '2026');
      expect(label).toBe('Spring 2026 Semester Fee');
    });

    it('should handle custom labels or trim whitespace', () => {
      const label = generateFeeLabel(' Fall ', ' 2027 ');
      expect(label).toBe('Fall 2027 Semester Fee');
    });
  });

  describe('Amount & Waiver Calculations', () => {
    it('should calculate final amount correctly with tuition, late fee, waiver, and adjustment', () => {
      const amount = calculateFinalAmount({
        tuition: 50000,
        lateFee: 1000,
        waiver: 5000,
        waiverAdjustment: 500,
      });
      // 50000 + 1000 - 5000 - 500 = 45500
      expect(amount).toBe(45500);
    });

    it('should never return a negative final amount', () => {
      const amount = calculateFinalAmount({
        tuition: 10000,
        lateFee: 0,
        waiver: 15000,
        waiverAdjustment: 0,
      });
      expect(amount).toBe(0);
    });
  });

  describe('Import Row Validation Engine', () => {
    const existingStudents = [
      {
        id: 'user-1',
        studentId: 'STU-2026-001',
        fullName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        batch: 'Undergraduate',
        status: 'Active',
      },
      {
        id: 'user-2',
        studentId: 'STU-2026-002',
        fullName: 'Karim Ahmed',
        email: 'karim@ewu.edu.bd',
        department: 'EEE',
        batch: 'Undergraduate',
        status: 'Inactive',
      },
    ];

    const existingPushedStudentIds = new Set(['STU-2026-099']);

    it('should pass validation for valid student row matching database record', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject row if Student ID does not exist in system', () => {
      const row = {
        studentId: 'STU-9999-999',
        studentName: 'Unknown Student',
        email: 'unknown@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Student ID does not exist');
    });

    it('should reject row if Email does not match student account', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'wrong-email@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Email mismatch');
    });

    it('should reject row if Department does not match student account', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'EEE',
        program: 'Undergraduate',
        amount: 45500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Department mismatch');
    });

    it('should reject row if student is inactive or locked', () => {
      const row = {
        studentId: 'STU-2026-002',
        studentName: 'Karim Ahmed',
        email: 'karim@ewu.edu.bd',
        department: 'EEE',
        program: 'Undergraduate',
        amount: 45500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Student account is inactive or locked');
    });

    it('should reject row if amount is zero or negative', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: -500,
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Amount must be positive');
    });

    it('should detect duplicate student in file and existing pushed dues', () => {
      const rowAlreadyPushed = {
        studentId: 'STU-2026-099',
        studentName: 'Pushed Student',
        email: 'pushed@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 40000,
      };

      const result = validateImportRow(rowAlreadyPushed, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Fee already pushed for this student');
    });

    describe('Row vs. Officer-selected context (Step 1 metadata)', () => {
      const context = { department: 'Computer Science', program: 'Undergraduate', semester: 'Summer', academicYear: '2027' };

      it('should pass when row semester/program/academicYear match the selected context', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'Computer Science',
          program: 'Undergraduate',
          semester: 'Summer',
          academicYear: '2027',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set(), context);
        expect(result.isValid).toBe(true);
      });

      it('should reject row if Semester does not match the selected context', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'Computer Science',
          program: 'Undergraduate',
          semester: 'Spring',
          academicYear: '2027',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set(), context);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Semester mismatch');
      });

      it('should reject row if Program does not match the selected context', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'Computer Science',
          program: 'Postgraduate',
          semester: 'Summer',
          academicYear: '2027',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set(), context);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Program mismatch');
      });

      it('should reject row if Academic Year does not match the selected context', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'Computer Science',
          program: 'Undergraduate',
          semester: 'Summer',
          academicYear: '2026',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set(), context);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Academic year mismatch');
      });

      it('should not double-count Department mismatch when both the DB check and context check would flag it', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'EEE',
          program: 'Undergraduate',
          semester: 'Summer',
          academicYear: '2027',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set(), context);
        expect(result.errors.filter(e => e === 'Department mismatch')).toHaveLength(1);
      });

      it('should remain backward-compatible when no context is passed (existing 4-arg call sites)', () => {
        const row = {
          studentId: 'STU-2026-001',
          studentName: 'Jahidul Islam',
          email: 'jahid@ewu.edu.bd',
          department: 'Computer Science',
          program: 'Undergraduate',
          semester: 'Spring', // would mismatch a context, but none is passed
          academicYear: '2020',
          amount: 45500,
        };

        const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject a row with an unparsable due date', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
        dueDate: 'not-a-date',
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid due date');
    });

    it('should reject a due date that is calendar-invalid even though Date.parse silently rolls it over (e.g. Feb 31)', () => {
      // Real case found via live testing: Date.parse('2027-02-31') doesn't return NaN, it
      // silently returns March 3rd 2027 — a naive isNaN(Date.parse(...)) check misses this.
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
        dueDate: '2027-02-31',
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid due date');
    });

    it('should accept a genuinely valid ISO due date', () => {
      const row = {
        studentId: 'STU-2026-001',
        studentName: 'Jahidul Islam',
        email: 'jahid@ewu.edu.bd',
        department: 'Computer Science',
        program: 'Undergraduate',
        amount: 45500,
        dueDate: '2027-02-28',
      };

      const result = validateImportRow(row, existingStudents, existingPushedStudentIds, new Set());
      expect(result.isValid).toBe(true);
    });
  });

  describe('Maker / Checker / Approver Workflow Permissions', () => {
    it('should allow Maker to create and submit draft batch', () => {
      const permission = validateApprovalWorkflowPermissions('Maker', 'Draft', 'SUBMIT_FOR_REVIEW');
      expect(permission.allowed).toBe(true);
    });

    it('should prevent Maker from approving fee push directly', () => {
      const permission = validateApprovalWorkflowPermissions('Maker', 'PendingApproval', 'APPROVE_BATCH');
      expect(permission.allowed).toBe(false);
      expect(permission.reason).toContain('Only Approver can approve fee push');
    });

    it('should allow Checker to verify batch', () => {
      const permission = validateApprovalWorkflowPermissions('Checker', 'Draft', 'VERIFY_BATCH');
      expect(permission.allowed).toBe(true);
    });

    it('should allow Approver to approve pending batch for fee push', () => {
      const permission = validateApprovalWorkflowPermissions('Approver', 'PendingApproval', 'APPROVE_BATCH');
      expect(permission.allowed).toBe(true);
    });

    it('should allow pushing fees directly from Draft or Validated state in 5-step workflow', () => {
      const permission = validateApprovalWorkflowPermissions('Accounts Office', 'Draft', 'EXECUTE_PUSH');
      expect(permission.allowed).toBe(true);
    });
  });

  describe('File Row Parsing', () => {
    it('should parse raw array rows into structured fee objects', () => {
      const rawRows = [
        ['Student ID', 'Student Name', 'Email', 'Department', 'Program', 'Semester', 'Academic Year', 'Amount', 'Due Date', 'Fee Label'],
        ['STU-2026-001', 'Jahidul Islam', 'jahid@ewu.edu.bd', 'Computer Science', 'Undergraduate', 'Spring', '2026', '45500', '2026-08-15', 'Spring 2026 Semester Fee']
      ];

      const parsed = parseImportRows(rawRows);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].studentId).toBe('STU-2026-001');
      expect(parsed[0].amount).toBe(45500);
      expect(parsed[0].department).toBe('Computer Science');
    });
  });
});
