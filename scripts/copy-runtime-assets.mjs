// SPDX-License-Identifier: AGPL-3.0-or-later
// The build emits only what TypeScript compiles, and `tsconfig.build.json` compiles `src/**/*.ts`.
// A runtime asset that is already JavaScript — today the kernel mutation lock's waiter, which the
// OS lock helper executes as a process of its own — would therefore never reach `dist/`, and a
// server installed from the npm tarball would fail closed on EVERY mutation while the in-repo tests
// stayed green, because those resolve the waiter from `src/`. This copies such assets after the
// compile, preserving the tree shape the compiled modules resolve them by (`import.meta.dirname`).
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const sourceRoot = resolve(process.cwd(), 'src');
const outputRoot = resolve(process.cwd(), 'dist');
const assetExtension = '.mjs';

// Regular files only: a symlink under `src` is not an asset this build is willing to publish the
// contents of, and skipping it keeps the packaged tree a copy of the repository tree.
async function assetPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await assetPaths(path)));
    else if (entry.isFile() && entry.name.endsWith(assetExtension)) paths.push(path);
  }
  return paths.sort();
}

for (const source of await assetPaths(sourceRoot)) {
  const destination = join(outputRoot, relative(sourceRoot, source));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}
