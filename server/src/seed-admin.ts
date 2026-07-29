import bcrypt from 'bcryptjs';
import prisma from './lib/prisma';

async function main() {
  console.log('🌱 Seeding demo Admin and Staff accounts...');

  const accounts = [
    {
      email: 'admin@ewubd.edu',
      fullName: 'System Administrator',
      role: 'Admin Office',
      studentId: 'ADMIN-001',
      department: 'Administration',
    },
    {
      email: 'library@ewubd.edu',
      fullName: 'Chief Librarian',
      role: 'Library',
      studentId: 'LIB-001',
      department: 'Library Services',
    },
    {
      email: 'accounts@ewubd.edu',
      fullName: 'Accounts Officer',
      role: 'Accounts Office',
      studentId: 'ACC-001',
      department: 'Finance & Accounts',
    },
    {
      email: 'shop@ewubd.edu',
      fullName: 'Campus Store Manager',
      role: 'Shop Staff',
      studentId: 'SHOP-001',
      department: 'Campus Services',
    },
    {
      email: '2023-2-60-053@std.ewubd.edu',
      fullName: 'Jahidul Islam',
      role: 'Student',
      studentId: '2023-2-60-053',
      department: 'Computer Science',
      passwordRaw: '654321',
    },
    ...Array.from({ length: 19 }, (_, i) => {
      const idx = String(i + 1).padStart(3, '0');
      const names = [
        'Tanvir Ahmed', 'Sadia Rahman', 'Nusrat Jahan', 'Rafiqul Islam', 'Anika Tabassum',
        'Shakib Al Hasan', 'Faria Chowdhury', 'Mehedi Hasan', 'Ayesha Siddiqua', 'Mahfuzur Rahman',
        'Naimur Rashid', 'Sharmin Sultana', 'Imran Hossain', 'Taskin Ahmed', 'Rubaiya Khan',
        'Soumya Sarkar', 'Nabila Ferdous', 'Zahid Hasan', 'Zarin Tasnim'
      ];
      return {
        email: `student${idx}@std.ewubd.edu`,
        fullName: names[i] || `Student ${idx}`,
        role: 'Student',
        studentId: `STU-2026-${idx}`,
        department: 'Computer Science',
        passwordRaw: '654321',
      };
    }),
  ];

  const defaultPassword = await bcrypt.hash('Admin@12345', 10);

  for (const acc of accounts) {
    const accountPassword = (acc as any).passwordRaw
      ? await bcrypt.hash((acc as any).passwordRaw, 10)
      : defaultPassword;

    const existing = await prisma.user.findUnique({
      where: { email: acc.email },
    });

    if (!existing) {
      const user = await prisma.user.create({
        data: {
          email: acc.email,
          password: accountPassword,
          fullName: acc.fullName,
          role: acc.role,
          studentId: acc.studentId,
          department: acc.department,
          batch: 'Undergraduate',
          status: 'Active',
        },
      });

      // Create wallet for each account
      await prisma.wallet.create({
        data: {
          walletId: `W-${user.id.slice(0, 8)}`,
          ownerId: user.id,
          balance: 50000,
        },
      });

      console.log(`✅ Created ${acc.role}: ${acc.email}`);
    } else {
      // Ensure password, studentId, and role are updated
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          password: accountPassword,
          role: acc.role,
          studentId: acc.studentId,
          department: acc.department,
          status: 'Active',
        },
      });
      console.log(`🔄 Updated ${acc.role}: ${acc.email}`);
    }
  }

  console.log('\n🎉 Admin & Staff Seeding Completed Successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
