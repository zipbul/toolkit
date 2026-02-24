/**
 * Resolves `workspace:*` protocol in package.json dependencies
 * to actual versions from the monorepo before `changeset publish`.
 *
 * This is needed because `npm publish` (used by changeset) does not
 * understand bun's `workspace:*` protocol.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const packagesDir = join(import.meta.dirname, '..', 'packages');
const entries = await readdir(packagesDir);

// 1. Build name → version map from all packages
const versionMap = new Map<string, string>();

for (const entry of entries) {
  const pkgJsonPath = join(packagesDir, entry, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    if (pkg.name && pkg.version) {
      versionMap.set(pkg.name, pkg.version);
    }
  } catch {
    continue;
  }
}

// 2. Replace workspace:* with real versions
for (const entry of entries) {
  const pkgJsonPath = join(packagesDir, entry, 'package.json');
  let raw: string;

  try {
    raw = await readFile(pkgJsonPath, 'utf8');
  } catch {
    continue;
  }

  if (!raw.includes('workspace:')) continue;

  const pkg = JSON.parse(raw);
  let changed = false;

  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[depField];
    if (!deps) continue;

    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;

      const realVersion = versionMap.get(name);
      if (!realVersion) {
        console.error(`Cannot resolve ${name} (${range}) — not found in workspace`);
        process.exit(1);
      }

      deps[name] = realVersion;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`Resolved workspace protocols in ${pkg.name}`);
  }
}
