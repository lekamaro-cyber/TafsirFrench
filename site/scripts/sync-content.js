#!/usr/bin/env node

/**
 * Script de verification et synchronisation du contenu.
 *
 * Verifie la coherence entre le JSON du tafsir, les PDFs et le fichier de statut.
 *
 * Usage :
 *   cd site && node scripts/sync-content.js
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '../data');
const JSON_PATH = path.join(DATA_DIR, 'json/tafsir_fr.json');
const PDF_DIR = path.join(DATA_DIR, 'pdf');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');

function main() {
  const issues = [];

  // Check JSON
  if (!fs.existsSync(JSON_PATH)) {
    console.log('ERREUR: data/json/tafsir_fr.json non trouve.');
    return;
  }

  const tafsir = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  const surahCount = Object.keys(tafsir).length;
  const totalVerses = Object.values(tafsir).reduce((sum, s) => sum + Object.keys(s).length, 0);

  // Check PDFs
  let pdfCount = 0;
  for (let i = 1; i <= 114; i++) {
    const pdfPath = path.join(PDF_DIR, `${String(i).padStart(3, '0')}.pdf`);
    if (fs.existsSync(pdfPath)) {
      pdfCount++;
    } else {
      issues.push(`PDF manquant: ${String(i).padStart(3, '0')}.pdf`);
    }
  }

  // Check status
  let statusStats = { draft: 0, review: 0, scheduled: 0, published: 0 };
  if (fs.existsSync(STATUS_PATH)) {
    const status = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8'));
    for (const [num, info] of Object.entries(status)) {
      const s = info.status || 'draft';
      if (statusStats[s] !== undefined) statusStats[s]++;

      if (s === 'scheduled' && !info.publish_date) {
        issues.push(`Sourate ${num}: statut "scheduled" sans publish_date`);
      }

      if (!tafsir[num]) {
        issues.push(`Sourate ${num}: presente dans status.json mais absente du JSON tafsir`);
      }
    }
  } else {
    issues.push('status.json non trouve (sera genere au premier build)');
  }

  // Check verse consistency
  for (const [num, verses] of Object.entries(tafsir)) {
    const verseNums = Object.keys(verses).map(Number).sort((a, b) => a - b);
    if (verseNums.length > 0) {
      const expected = verseNums[verseNums.length - 1];
      if (verseNums.length < expected) {
        const missing = [];
        for (let i = 1; i <= expected; i++) {
          if (!verseNums.includes(i)) missing.push(i);
        }
        if (missing.length > 0 && missing.length <= 5) {
          issues.push(`Sourate ${num}: versets manquants: ${missing.join(', ')}`);
        } else if (missing.length > 5) {
          issues.push(`Sourate ${num}: ${missing.length} versets manquants`);
        }
      }
    }
  }

  console.log('\n=== Resume du contenu ===\n');
  console.log(`Sourates dans le JSON : ${surahCount}/114`);
  console.log(`Total versets tafsir  : ${totalVerses}`);
  console.log(`PDFs de reference     : ${pdfCount}/114`);
  console.log();
  console.log(`  Brouillons   : ${statusStats.draft}`);
  console.log(`  En relecture : ${statusStats.review}`);
  console.log(`  Planifiees   : ${statusStats.scheduled}`);
  console.log(`  Publiees     : ${statusStats.published}`);

  if (issues.length > 0) {
    console.log(`\n=== Problemes detectes (${issues.length}) ===\n`);
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log('\nAucun probleme detecte.');
  }
}

main();
