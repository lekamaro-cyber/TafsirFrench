#!/usr/bin/env node

/**
 * Copie les PDFs de reference dans le dossier public pour qu'ils soient servis par le site.
 */

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), '../data/pdf');
const DEST = path.resolve(process.cwd(), 'public/pdf');

if (!fs.existsSync(SRC)) {
  console.log('Dossier data/pdf/ non trouve.');
  process.exit(0);
}

fs.mkdirSync(DEST, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.pdf'));

for (const file of files) {
  const src = path.join(SRC, file);
  const dest = path.join(DEST, file);
  if (!fs.existsSync(dest) || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs) {
    fs.copyFileSync(src, dest);
  }
}

console.log(`${files.length} PDFs copies dans public/pdf/`);
