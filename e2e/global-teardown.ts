import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function globalTeardown() {
  execFileSync('node', ['e2e-teardown.mjs'], { cwd: path.join(__dirname, '..', 'server'), stdio: 'inherit' });
}
