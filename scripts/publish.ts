import { readdir, readFile, unlink } from 'node:fs/promises';
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

  // 1. bun pm pack — resolves workspace:* to real versions
  console.log(`Packing ${pkg.name}@${pkg.version} ...`);

  const packProc = Bun.spawn(['bun', 'pm', 'pack'], {
    cwd,
    stdout: 'pipe',
    stderr: 'inherit',
  });

  const packOut = await new Response(packProc.stdout).text();
  const packExit = await packProc.exited;

  if (packExit !== 0) {
    console.error(`Failed to pack ${pkg.name}@${pkg.version} (exit ${packExit})`);
    process.exit(packExit);
  }

  // tarball filename is the line ending in .tgz
  const tarball = packOut
    .trim()
    .split('\n')
    .find((l) => l.trim().endsWith('.tgz'))!
    .trim();
  const tarballPath = join(cwd, tarball);

  // 2. npm publish <tarball> — auth via NODE_AUTH_TOKEN (.npmrc from setup-node)
  console.log(`Publishing ${tarball} ...`);

  const pubProc = Bun.spawn(
    ['npm', 'publish', tarballPath, '--access', 'public'],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );

  const pubStderr = await new Response(pubProc.stderr).text();
  const pubExit = await pubProc.exited;

  // cleanup tarball regardless of result
  await unlink(tarballPath).catch(() => {});

  // npm returns 1 when version already exists — treat as success
  if (pubExit !== 0) {
    if (pubStderr.includes('previously published') || pubStderr.includes('already exists')) {
      console.log(`Already published ${pkg.name}@${pkg.version}, skipping.`);
    } else {
      console.error(pubStderr);
      console.error(`Failed to publish ${pkg.name}@${pkg.version} (exit ${pubExit})`);
      process.exit(pubExit);
    }
  }
}
