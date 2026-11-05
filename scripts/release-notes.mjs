#!/usr/bin/env node
/**
 * release-notes.mjs — copy one version section of CHANGELOG.md into
 * RELEASE_NOTES.md, which the release workflow hands to `gh release`.
 *
 *   node scripts/release-notes.mjs v0.6.0
 */

import fs from 'node:fs';

const tag = (process.argv[2] || '').replace(/^v/, '');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = changelog.findIndex((line) => line.startsWith('## ' + tag));

let notes = '';
if (start >= 0) {
  const rest = changelog.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  notes = rest.slice(0, end === -1 ? rest.length : end).join('\n').trim();
}
if (!notes) notes = 'See CHANGELOG.md.';

fs.writeFileSync('RELEASE_NOTES.md', notes + '\n');
process.stdout.write(notes + '\n');
