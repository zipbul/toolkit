/**
 * Publish script for changesets/action.
 *
 * 1. Resolves `workspace:*` → real versions in package.json (in-place)
 * 2. Copies root LICENSE into each public package directory
 * 3. Runs `npx changeset publish` with stdout inherited so
 *    changesets/action can parse `New tag:` lines for GitHub releases.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const packagesDir = join(root, 'packages');
const entries = await readdir(packagesDir);

// ── 1. Resolve workspace:* ─────────────────────────────────

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

// ── 2. Copy LICENSE to each public package ──────────────────

const license = await readFile(join(root, 'LICENSE'), 'utf8');

for (const entry of entries) {
  const pkgJsonPath = join(packagesDir, entry, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    if (pkg.private) continue;
    await writeFile(join(packagesDir, entry, 'LICENSE'), license);
    console.log(`Copied LICENSE to ${pkg.name}`);
  } catch {
    continue;
  }
}

// ── 3. Run changeset publish ────────────────────────────────

const proc = Bun.spawn(['npx', 'changeset', 'publish'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
  env: process.env,
});

const exitCode = await proc.exited;
process.exit(exitCode);
