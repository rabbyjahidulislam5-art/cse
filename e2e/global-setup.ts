import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shells out to a plain Node script inside server/ so it can use server's own @prisma/client and
// bcryptjs (server/node_modules) without duplicating those as root devDependencies. Creates
// disposable, known-password test accounts for each role — never touches real seeded demo data.
export default function globalSetup() {
  execFileSync('node', ['e2e-seed.mjs'], { cwd: path.join(__dirname, '..', 'server'), stdio: 'inherit' });
}
