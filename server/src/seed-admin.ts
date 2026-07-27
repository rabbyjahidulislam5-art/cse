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
  ];

  const defaultPassword = await bcrypt.hash('Admin@12345', 10);

  for (const acc of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: acc.email } });
    if (!existing) {
      const user = await prisma.user.create({
        data: {
          email: acc.email,
          password: defaultPassword,
          fullName: acc.fullName,
          role: acc.role,
          studentId: acc.studentId,
          department: acc.department,
          status: 'Active',
        },
      });

      // Create wallet for each account
      await prisma.wallet.create({
        data: {
          walletId: `W-${user.id.slice(0, 8)}`,
          ownerId: user.id,
          balance: 5000,
        },
      });

      console.log(`✅ Created ${acc.role}: ${acc.email}`);
    } else {
      // Ensure password and role are updated
      await prisma.user.update({
        where: { id: existing.id },
        data: { password: defaultPassword, role: acc.role, status: 'Active' },
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
