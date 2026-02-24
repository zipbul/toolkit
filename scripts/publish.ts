import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const packagesDir = join(import.meta.dirname, '..', 'packages');
const entries = await readdir(packagesDir);

for (const entry of entries) {
  const pkgJsonPath = join(packagesDir, entry, 'package.json');
  let pkg: { name: string; version: string; private?: boolean };

  try {
    pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
  } catch {
    continue;
  }

  if (pkg.private) continue;

  const cwd = join(packagesDir, entry);

  console.log(`Publishing ${pkg.name}@${pkg.version} ...`);

  const proc = Bun.spawn(['bun', 'publish', '--access', 'public', '--tolerate-republish'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`Failed to publish ${pkg.name}@${pkg.version} (exit ${exitCode})`);
    process.exit(exitCode);
  }
}
