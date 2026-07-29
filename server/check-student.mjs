import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const u = await p.user.findFirst({
  where: { studentId: 'STU-2026-009' },
  include: { semesterFees: true, wallets: true }
});
console.log(JSON.stringify(u, null, 2));
await p.$disconnect();
