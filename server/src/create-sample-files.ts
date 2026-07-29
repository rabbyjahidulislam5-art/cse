import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

async function generateSampleFiles() {
  const rootDir = path.resolve(__dirname, '../../');
  
  const students = [
    { studentId: '2023-2-60-053', name: 'Jahidul Islam', email: '2023-2-60-053@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-001', name: 'Tanvir Ahmed', email: 'student001@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 42000, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-002', name: 'Sadia Rahman', email: 'student002@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-003', name: 'Nusrat Jahan', email: 'student003@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 40000, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-004', name: 'Rafiqul Islam', email: 'student004@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-005', name: 'Anika Tabassum', email: 'student005@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-006', name: 'Shakib Al Hasan', email: 'student006@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-007', name: 'Faria Chowdhury', email: 'student007@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 42000, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-008', name: 'Mehedi Hasan', email: 'student008@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-009', name: 'Ayesha Siddiqua', email: 'student009@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-010', name: 'Mahfuzur Rahman', email: 'student010@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-011', name: 'Naimur Rashid', email: 'student011@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 42000, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-012', name: 'Sharmin Sultana', email: 'student012@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-013', name: 'Imran Hossain', email: 'student013@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-014', name: 'Taskin Ahmed', email: 'student014@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-015', name: 'Rubaiya Khan', email: 'student015@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 42000, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-016', name: 'Soumya Sarkar', email: 'student016@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-017', name: 'Nabila Ferdous', email: 'student017@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-018', name: 'Zahid Hasan', email: 'student018@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
    { studentId: 'STU-2026-019', name: 'Zarin Tasnim', email: 'student019@std.ewubd.edu', dept: 'Computer Science', prog: 'Undergraduate', sem: 'Spring', year: '2026', amount: 45500, dueDate: '2026-08-30', label: 'Spring 2026 Semester Fee' },
  ];

  // 1. Create Excel Workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Semester Fee Import');

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 18 },
    { header: 'Student Name', key: 'name', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Department', key: 'dept', width: 20 },
    { header: 'Program', key: 'prog', width: 16 },
    { header: 'Semester', key: 'sem', width: 14 },
    { header: 'Academic Year', key: 'year', width: 14 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Due Date', key: 'dueDate', width: 16 },
    { header: 'Fee Label', key: 'label', width: 26 },
  ];

  students.forEach(st => sheet.addRow(st));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };

  const excelPath = path.join(rootDir, 'sample_20_students_fee.xlsx');
  await workbook.xlsx.writeFile(excelPath);
  console.log(`✅ Created Excel File: ${excelPath}`);

  // 2. Create CSV File
  const csvHeaders = ['Student ID', 'Student Name', 'Email', 'Department', 'Program', 'Semester', 'Academic Year', 'Amount', 'Due Date', 'Fee Label'];
  const csvLines = [
    csvHeaders.join(','),
    ...students.map(s => [
      `"${s.studentId}"`,
      `"${s.name}"`,
      `"${s.email}"`,
      `"${s.dept}"`,
      `"${s.prog}"`,
      `"${s.sem}"`,
      `"${s.year}"`,
      s.amount,
      `"${s.dueDate}"`,
      `"${s.label}"`
    ].join(','))
  ];

  const csvPath = path.join(rootDir, 'sample_20_students_fee.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');
  console.log(`✅ Created CSV File: ${csvPath}`);
}

generateSampleFiles().catch(console.error);
