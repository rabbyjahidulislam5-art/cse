import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import prisma from './lib/prisma';

// Fresh demo students for testing the Fee Push wizard end-to-end.
// Unlike the old sample_20_students_fee file, none of these accounts
// have a FeeInvoice yet, so they will validate as "Valid" instead of "Duplicate".

const names = [
  'Farhan Kabir', 'Mim Akter', 'Ovi Rahman', 'Tasnia Islam', 'Rakib Hasan',
  'Promi Sultana', 'Sadman Anik', 'Nazia Haque', 'Rifat Chowdhury', 'Lamia Yesmin',
  'Sabbir Ahmed', 'Trisha Roy', 'Emon Talukder', 'Jannatul Ferdous', 'Arafat Hossain',
  'Nusaiba Karim', 'Rezwan Shahriar', 'Maliha Nowshin', 'Fahim Muntasir', 'Sumaiya Binte',
];

const students = names.map((name, i) => {
  const idx = String(i + 1).padStart(3, '0');
  return {
    studentId: `BBA-2027-${idx}`,
    name,
    email: `bba2027${idx}@std.ewubd.edu`,
    dept: 'BBA',
    prog: 'Undergraduate',
    sem: 'Summer',
    year: '2027',
    amount: 45000 + (i % 3) * 1500,
    dueDate: '2027-09-15',
    label: 'Summer 2027 Semester Fee',
  };
});

async function seedStudents() {
  const defaultPassword = await bcrypt.hash('Student@12345', 10);

  for (const st of students) {
    const existing = await prisma.user.findUnique({ where: { email: st.email } });
    let userId: string;

    if (!existing) {
      const user = await prisma.user.create({
        data: {
          email: st.email,
          password: defaultPassword,
          fullName: st.name,
          role: 'Student',
          studentId: st.studentId,
          department: st.dept,
          batch: st.prog,
          status: 'Active',
        },
      });
      userId = user.id;
      await prisma.wallet.create({
        data: { walletId: `W-${user.id.slice(0, 8)}`, ownerId: user.id, balance: 50000 },
      });
      console.log(`Created student: ${st.studentId} (${st.name})`);
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: { studentId: st.studentId, department: st.dept, batch: st.prog, status: 'Active' },
      });
      userId = existing.id;
      console.log(`Updated student: ${st.studentId} (${st.name})`);
    }

    // Safety check: make sure no invoice already exists for this fresh batch
    const pushed = await prisma.feeInvoice.findFirst({
      where: { studentId: userId, status: { in: ['Unpaid', 'Paid'] } },
    });
    if (pushed) {
      console.warn(`WARNING: ${st.studentId} already has an invoice (${pushed.invoiceNumber}) — it will show as Duplicate, not Valid.`);
    }
  }
}

async function generateExampleFiles() {
  const rootDir = path.resolve(__dirname, '../../');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fee Push Example');
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

  const excelPath = path.join(rootDir, 'sample_fee_push_example.xlsx');
  await workbook.xlsx.writeFile(excelPath);
  console.log(`Created Excel file: ${excelPath}`);

  const csvHeaders = ['Student ID', 'Student Name', 'Email', 'Department', 'Program', 'Semester', 'Academic Year', 'Amount', 'Due Date', 'Fee Label'];
  const csvLines = [
    csvHeaders.join(','),
    ...students.map(s => [
      `"${s.studentId}"`, `"${s.name}"`, `"${s.email}"`, `"${s.dept}"`, `"${s.prog}"`,
      `"${s.sem}"`, `"${s.year}"`, s.amount, `"${s.dueDate}"`, `"${s.label}"`,
    ].join(',')),
  ];
  const csvPath = path.join(rootDir, 'sample_fee_push_example.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');
  console.log(`Created CSV file: ${csvPath}`);
}

async function main() {
  console.log('Seeding fresh demo students for Fee Push testing...');
  await seedStudents();
  console.log('\nGenerating example import files...');
  await generateExampleFiles();
  console.log('\nDone. Upload sample_fee_push_example.xlsx in Step 1 (Import Excel) with Department=BBA, Semester=Summer, Academic Year=2027.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
