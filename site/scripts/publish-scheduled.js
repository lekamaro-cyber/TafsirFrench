#!/usr/bin/env node

/**
 * Script de publication planifiee.
 *
 * Parcourt tous les fichiers de sourates et passe en "published"
 * ceux qui ont le statut "scheduled" et dont la publish_date <= aujourd'hui.
 *
 * Usage :
 *   node scripts/publish-scheduled.js
 *
 * Peut etre execute via un cron job ou un CI/CD pipeline :
 *   0 6 * * * cd /path/to/site && node scripts/publish-scheduled.js && npm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const DATA_DIR = path.resolve(process.cwd(), '../data/surahs');

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('Dossier data/surahs/ non trouve.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.md'));

  let published = 0;

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);

    if (data.status === 'scheduled' && data.publish_date && data.publish_date <= today) {
      data.status = 'published';
      const updated = matter.stringify(content, data);
      fs.writeFileSync(filePath, updated, 'utf-8');
      console.log(`[PUBLIE] ${file} (date: ${data.publish_date})`);
      published++;
    }
  }

  if (published === 0) {
    console.log('Aucune sourate a publier aujourd\'hui.');
  } else {
    console.log(`\n${published} sourate(s) publiee(s). Relancez "npm run build" pour mettre a jour le site.`);
  }
}

main();
