// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later';
const roots = ['scripts', 'src', 'tests'];
const rootSources = ['eslint.config.js', 'prettier.config.js', 'vitest.config.ts'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts']);

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = [...rootSources];
for (const root of roots) files.push(...(await walk(root)));

const missing = [];
for (const file of files.sort()) {
  const lines = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n').split('\n');
  const headerLine = lines[0]?.startsWith('#!') ? 1 : 0;
  if (lines[headerLine] !== SPDX) missing.push(file);
}

if (missing.length > 0) {
  process.stderr.write(`Missing AGPL SPDX header:\n${missing.join('\n')}\n`);
  process.exitCode = 1;
}
