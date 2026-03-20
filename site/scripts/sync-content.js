#!/usr/bin/env node

/**
 * Script de synchronisation du contenu.
 *
 * Verifie la coherence des fichiers de sourates et affiche un resume.
 *
 * Usage :
 *   node scripts/sync-content.js
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const DATA_DIR = path.resolve(process.cwd(), '../data/surahs');

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('Dossier data/surahs/ non trouve. Creez-le et ajoutez vos fichiers markdown.');
    return;
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('Aucun fichier markdown trouve dans data/surahs/.');
    console.log('Consultez data/README.md pour le format attendu.');
    return;
  }

  const stats = { draft: 0, review: 0, scheduled: 0, published: 0 };
  const issues = [];

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');

    try {
      const { data } = matter(raw);

      if (!data.number) issues.push(`${file}: champ "number" manquant`);
      if (!data.name_fr) issues.push(`${file}: champ "name_fr" manquant`);
      if (!data.status) issues.push(`${file}: champ "status" manquant`);

      const status = data.status || 'draft';
      if (stats[status] !== undefined) {
        stats[status]++;
      } else {
        issues.push(`${file}: statut inconnu "${status}"`);
      }

      if (status === 'scheduled' && !data.publish_date) {
        issues.push(`${file}: statut "scheduled" mais pas de "publish_date"`);
      }
    } catch (e) {
      issues.push(`${file}: erreur de parsing - ${e.message}`);
    }
  }

  console.log('\n=== Resume du contenu ===\n');
  console.log(`Total fichiers : ${files.length}`);
  console.log(`  Brouillons   : ${stats.draft}`);
  console.log(`  En relecture : ${stats.review}`);
  console.log(`  Planifiees   : ${stats.scheduled}`);
  console.log(`  Publiees     : ${stats.published}`);

  if (issues.length > 0) {
    console.log(`\n=== Problemes detectes (${issues.length}) ===\n`);
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log('\nAucun probleme detecte.');
  }
}

main();
