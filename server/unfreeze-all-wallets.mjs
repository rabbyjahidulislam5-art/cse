import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.wallet.updateMany({
    where: { frozen: true },
    data: { frozen: false }
  });
  console.log(`Unfrozen ${result.count} wallet(s) successfully.`);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
