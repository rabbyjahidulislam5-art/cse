import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface E2ESeedData {
  password: string;
  suffix: number;
  admin: { id: string; email: string };
  library: { id: string; email: string };
  accounts: { id: string; email: string };
  shopStaff: { id: string; email: string };
  student: { id: string; email: string; studentId: string };
  shop: { id: string };
  studentWallet: { id: string };
  shopWallet: { id: string };
  payLaterDue: { id: string };
  completedTxn: { id: string };
  autoDeductedFine: { id: string };
}

// Reads the fixture file global-setup.ts's e2e-seed.mjs wrote — always called after globalSetup
// has run, so the file is guaranteed to exist for the duration of the test run.
export function getSeedData(): E2ESeedData {
  const raw = readFileSync(path.join(__dirname, '..', '..', 'server', 'e2e-seed-data.json'), 'utf-8');
  return JSON.parse(raw);
}
