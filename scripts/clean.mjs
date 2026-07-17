// SPDX-License-Identifier: AGPL-3.0-or-later
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedDirectories = ['coverage', 'dist'];

for (const directory of generatedDirectories) {
  await rm(resolve(process.cwd(), directory), { force: true, recursive: true });
}
