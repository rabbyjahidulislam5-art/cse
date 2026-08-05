// Creates disposable, known-state test accounts for the Playwright E2E suite — one per role,
// bcrypt-hashed known password, emailVerified/mustChangePassword pre-satisfied so tests never hit
// the onboarding gate. Never touches any real seeded demo account (admin@ewubd.edu etc.) or resets
// any existing password — every row here is newly created and removed by e2e-teardown.mjs.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();
const PASSWORD = 'E2ETest@12345';
const suffix = Date.now();

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const [admin, library, accounts, shopStaff, student] = await Promise.all([
    prisma.user.create({ data: { email: `e2e-admin-${suffix}@ewubd.edu`, password: hash, fullName: 'E2E Admin', role: 'Admin Office', status: 'Active', emailVerified: true, mustChangePassword: false } }),
    prisma.user.create({ data: { email: `e2e-library-${suffix}@ewubd.edu`, password: hash, fullName: 'E2E Library Staff', role: 'Library', status: 'Active', emailVerified: true, mustChangePassword: false } }),
    prisma.user.create({ data: { email: `e2e-accounts-${suffix}@ewubd.edu`, password: hash, fullName: 'E2E Accounts Officer', role: 'Accounts Office', status: 'Active', emailVerified: true, mustChangePassword: false } }),
    prisma.user.create({ data: { email: `e2e-shop-${suffix}@ewubd.edu`, password: hash, fullName: 'E2E Shop Owner', role: 'Shop Staff', status: 'Active', emailVerified: true, mustChangePassword: false } }),
    prisma.user.create({ data: { email: `e2e-student-${suffix}@std.ewubd.edu`, password: hash, fullName: 'E2E Test Student', role: 'Student', studentId: `E2E-STU-${suffix}`, department: 'Computer Science', batch: 'Undergraduate', status: 'Active', emailVerified: true, mustChangePassword: false } }),
  ]);

  const shop = await prisma.shop.create({
    data: { name: `E2E Test Shop ${suffix}`, category: 'Cafe', status: 'Active', ownerId: shopStaff.id, qrToken: `QR-E2E-${suffix}` },
  });

  const [studentWallet, shopWallet] = await Promise.all([
    prisma.wallet.create({ data: { walletId: `W-E2E-STU-${suffix}`, ownerId: student.id, balance: 50000 } }),
    prisma.wallet.create({ data: { walletId: `W-E2E-SHOP-${suffix}`, ownerId: shopStaff.id, balance: 0 } }),
  ]);

  // One Pending PayLaterDue so the shop's Outstanding tab and one Success Transaction so the
  // shop's Completed tab both have real data to render/filter during the Shop Payments E2E test.
  const payLaterDue = await prisma.payLaterDue.create({
    data: { studentId: student.id, shopId: shop.id, amount: 250, description: 'E2E Test Pay-Later Purchase', status: 'Pending' },
  });
  const completedTxn = await prisma.transaction.create({
    data: {
      reference: `E2E-TXN-${suffix}`, userId: student.id, shopId: shop.id, type: 'Shop Payment', direction: 'Debit',
      amount: 150, status: 'Success', gateway: 'Wallet', description: 'E2E Test Completed Purchase',
    },
  });

  // Pre-resolved as if the Phase 3 daily automation had already run on it — real elapsed time
  // can't be simulated in a browser E2E test, so this fixture lets the reminder/auto-deduct E2E
  // spec verify the *visible* UI surface of an already-automated row (student dues page, Accounts
  // profile Dues History) without needing to wait on the real cron. The state-machine timing
  // itself is covered by reminderAutoDeduct.integration.test.ts, not E2E.
  const autoDeductedFine = await prisma.libraryFine.create({
    data: {
      studentId: student.id, fineType: 'Overdue Book', label: 'E2E Auto-Deducted Fine', amount: 300,
      status: 'Paid', reference: `E2E-AUTODED-${suffix}`, firstReminderSentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      autoDeductedAt: new Date(),
    },
  });

  const seed = {
    password: PASSWORD, suffix,
    admin: { id: admin.id, email: admin.email },
    library: { id: library.id, email: library.email },
    accounts: { id: accounts.id, email: accounts.email },
    shopStaff: { id: shopStaff.id, email: shopStaff.email },
    student: { id: student.id, email: student.email, studentId: student.studentId },
    shop: { id: shop.id },
    studentWallet: { id: studentWallet.id },
    shopWallet: { id: shopWallet.id },
    payLaterDue: { id: payLaterDue.id },
    completedTxn: { id: completedTxn.id },
    autoDeductedFine: { id: autoDeductedFine.id },
  };

  writeFileSync(new URL('./e2e-seed-data.json', import.meta.url), JSON.stringify(seed, null, 2));
  console.log('[e2e-seed] created', Object.keys(seed).length - 2, 'test accounts + fixtures');
}

main().then(() => prisma.$disconnect()).catch(async (err) => {
  console.error('[e2e-seed] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
