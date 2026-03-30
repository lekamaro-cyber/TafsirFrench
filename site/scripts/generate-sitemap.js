import fs from 'node:fs';
import path from 'node:path';

const SITE_URL = 'https://tafsir-french.org';
const DATA_DIR = path.resolve(process.cwd(), '../data');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const DIST_DIR = path.resolve(process.cwd(), 'dist');

// Load published surahs
let status = {};
if (fs.existsSync(STATUS_PATH)) {
  status = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8'));
}

const today = new Date().toISOString().split('T')[0];

const urls = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/surahs/', changefreq: 'weekly', priority: '0.9' },
];

// Add published surah pages
for (const [num, info] of Object.entries(status)) {
  if (info.status === 'published' && (!info.publish_date || info.publish_date <= today)) {
    const slug = num.padStart(3, '0');
    urls.push({
      loc: `/surahs/${slug}/`,
      changefreq: 'monthly',
      priority: '0.8',
      lastmod: info.last_reviewed || info.publish_date || today,
    });
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), xml);
console.log(`Sitemap generated with ${urls.length} URLs`);
