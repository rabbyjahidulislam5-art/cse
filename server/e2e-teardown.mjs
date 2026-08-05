// Removes every row e2e-seed.mjs created, in FK-safe order, then deletes the fixture file itself.
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const prisma = new PrismaClient();
const dataPath = new URL('./e2e-seed-data.json', import.meta.url);

async function main() {
  if (!existsSync(dataPath)) {
    console.log('[e2e-teardown] no fixture file found, nothing to clean up');
    return;
  }
  const seed = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const userIds = [seed.admin.id, seed.library.id, seed.accounts.id, seed.shopStaff.id, seed.student.id];

  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.payLaterDue.deleteMany({ where: { studentId: seed.student.id } });
  await prisma.libraryFine.deleteMany({ where: { studentId: seed.student.id } });
  await prisma.adminFine.deleteMany({ where: { studentId: seed.student.id } });
  // ScholarshipPushBatch.uploadedById -> User is a RESTRICT FK — the scholarship-push E2E spec
  // uploads a batch as the admin test user, so it must be removed before that user is (items
  // cascade automatically via the batch's onDelete: Cascade relation).
  await prisma.scholarshipPushBatch.deleteMany({ where: { uploadedById: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.shop.delete({ where: { id: seed.shop.id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  unlinkSync(dataPath);
  console.log('[e2e-teardown] cleaned up all E2E test fixtures');
}

main().then(() => prisma.$disconnect()).catch(async (err) => {
  console.error('[e2e-teardown] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
