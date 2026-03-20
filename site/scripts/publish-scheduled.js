#!/usr/bin/env node

/**
 * Script de publication planifiee.
 *
 * Parcourt le fichier status.json et passe en "published"
 * les sourates qui ont le statut "scheduled" et dont publish_date <= aujourd'hui.
 *
 * Usage :
 *   cd site && node scripts/publish-scheduled.js
 *
 * Automatiser avec cron :
 *   0 6 * * * cd /path/to/TafsirFrench/site && node scripts/publish-scheduled.js && npm run build
 */

import fs from 'node:fs';
import path from 'node:path';

const STATUS_PATH = path.resolve(process.cwd(), '../data/status.json');

function main() {
  if (!fs.existsSync(STATUS_PATH)) {
    console.log('Fichier data/status.json non trouve. Lancez d\'abord npm run build pour le generer.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const status = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8'));

  let published = 0;

  for (const [surahNum, info] of Object.entries(status)) {
    if (info.status === 'scheduled' && info.publish_date && info.publish_date <= today) {
      info.status = 'published';
      console.log(`[PUBLIE] Sourate ${surahNum} (date: ${info.publish_date})`);
      published++;
    }
  }

  if (published > 0) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`\n${published} sourate(s) publiee(s). Relancez "npm run build" pour mettre a jour le site.`);
  } else {
    console.log('Aucune sourate a publier aujourd\'hui.');
  }
}

main();
