// One-off migration: link every pre-existing Shop row (created before Shop.ownerId existed) to a
// real merchant User account, and sign every Shop's QR (qrSignature was never populated before
// this phase, so every pre-existing shop — including ones already linked to an owner — needs it).
// Safe to re-run: skips shops that already have both an owner and a signature.
//   npx tsx src/backfill-shop-owners.ts
//
// Prefers reusing an already-seeded, unlinked 'Shop Staff' account (e.g. shop@ewubd.edu from
// seed-admin.ts) for the first owner-less shop; any further owner-less shops each get a freshly
// generated merchant account, exactly like /admin/shops/manage's `create` action.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from './lib/prisma';
import { sendEmail } from './lib/email';

const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || process.env.JWT_SECRET || 'smart-campus-jwt-secret-change-me';
function signQrToken(shopId: string, qrToken: string): string {
  return crypto.createHmac('sha256', QR_SIGNING_SECRET).update(`${shopId}:${qrToken}`).digest('hex');
}
function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

async function main() {
  console.log('🔗 Backfilling merchant owners and QR signatures for pre-existing Shop rows...');

  const orphanShops = await prisma.shop.findMany({ where: { ownerId: null } });
  const unsignedOwnedShops = await prisma.shop.findMany({ where: { ownerId: { not: null }, OR: [{ qrSignature: null }, { qrSignature: '' }] } });

  for (const shop of unsignedOwnedShops) {
    const qrToken = shop.qrToken || `QR-${crypto.randomBytes(6).toString('hex')}`;
    const qrSignature = signQrToken(shop.id, qrToken);
    await prisma.shop.update({ where: { id: shop.id }, data: { qrToken, qrSignature } });
    console.log(`✅ Signed QR for already-linked shop "${shop.name}"`);
  }

  if (orphanShops.length === 0) {
    console.log('Nothing else to do — every Shop already has an owner.');
    return;
  }

  const unlinkedShopStaff = await prisma.user.findMany({
    where: { role: 'Shop Staff' },
    include: { shop: true },
  });
  const reusableAccounts = unlinkedShopStaff.filter(u => !u.shop);

  for (const shop of orphanShops) {
    const reused = reusableAccounts.shift();

    if (reused) {
      const qrToken = shop.qrToken || `QR-${crypto.randomBytes(6).toString('hex')}`;
      const qrSignature = signQrToken(shop.id, qrToken);
      await prisma.shop.update({ where: { id: shop.id }, data: { ownerId: reused.id, ownerName: reused.fullName || undefined, qrToken, qrSignature } });
      // Existing seeded accounts already have a real password (Admin@12345) and are already
      // active — don't force a password change/OTP gate onto an account that's been in use.
      console.log(`✅ Linked existing account ${reused.email} to shop "${shop.name}" (QR signed)`);
      continue;
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const emailLocal = shop.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || shop.id;
    const email = `${emailLocal}@shops.ewubd.edu`;

    const merchantUser = await prisma.user.create({
      data: {
        email, fullName: shop.name, password: hashedPassword,
        role: 'Shop Staff', status: 'Active', mustChangePassword: true, emailVerified: false,
      },
    });
    await prisma.wallet.create({
      data: { walletId: `W-${merchantUser.id.slice(0, 8)}`, ownerId: merchantUser.id, balance: 0, dailyTransferLimit: 10000, dailyTransferred: 0 },
    });

    const qrToken = shop.qrToken || `QR-${crypto.randomBytes(6).toString('hex')}`;
    const qrSignature = signQrToken(shop.id, qrToken);
    await prisma.shop.update({ where: { id: shop.id }, data: { ownerId: merchantUser.id, qrToken, qrSignature } });

    try {
      await sendEmail(email, 'Your Merchant Account — Smart Campus', [
        { type: 'text', content: `<strong>Welcome!</strong>\n\nA merchant account for "<strong>${shop.name}</strong>" has been created on Smart Campus.\n\n<strong>Login Email:</strong> ${email}\n<strong>Temporary Password:</strong> ${tempPassword}\n\nYou will be required to set a new password and verify your email on first login.` },
      ]);
      console.log(`✅ Created new merchant account ${email} for shop "${shop.name}" (credentials emailed)`);
    } catch (err: any) {
      console.warn(`⚠️  Created merchant account ${email} for shop "${shop.name}" but email failed to send: ${err.message}`);
      console.warn(`    Temporary password (relay manually, not stored anywhere): ${tempPassword}`);
    }
  }

  console.log('\n🎉 Shop owner backfill complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
