#!/usr/bin/env node
/**
 * Regenerate llms.txt by concatenating every page referenced from
 * docs/src/SUMMARY.md in order, with H1s demoted by one level so the
 * overall outline is browsable as a single document.
 *
 * Run: npm run docs:generate
 * Check without writing: npm run docs:check
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'docs/src');
const SUMMARY = resolve(SRC, 'SUMMARY.md');
const OUT = resolve(ROOT, 'llms.txt');

const summary = await readFile(SUMMARY, 'utf-8');
const seen = new Set();
const files = [];

for (const line of summary.split('\n')) {
  const m = line.match(/\(([\w-]+\.md)\)/);
  if (!m) continue;
  if (seen.has(m[1])) continue;
  seen.add(m[1]);
  files.push(m[1]);
}

const blocks = [];

// Header from introduction.md as the canonical "what is this" blurb
const intro = await readFile(resolve(SRC, 'introduction.md'), 'utf-8');
const introBlurb = intro.split('\n').slice(2, 4).join(' ').trim();

blocks.push('# ConClear');
blocks.push('');
blocks.push(`> ${introBlurb}`);
blocks.push('');
blocks.push('## Full Documentation');
blocks.push('');

for (const file of files) {
  try {
    const raw = await readFile(resolve(SRC, file), 'utf-8');
    // Demote H1 to H2 so the document has one logical outline
    const demoted = raw.replace(/^# /, '## ');
    blocks.push(demoted.trimEnd());
    blocks.push('');
  } catch (err) {
    throw new Error(`Cannot include ${file}: ${err.message}`);
  }
}

const generated = blocks.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf-8').catch(() => null);
  if (current !== generated) {
    process.stderr.write('llms.txt is out of date. Run npm run docs:generate and include the result.\n');
    process.exitCode = 1;
  } else {
    process.stderr.write('llms.txt matches the documentation sources.\n');
  }
} else {
  await writeFile(OUT, generated, 'utf-8');
  process.stderr.write(`Wrote ${OUT} (${blocks.length} blocks)\n`);
}
