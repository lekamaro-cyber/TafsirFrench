import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const DATA_DIR = path.resolve(process.cwd(), '../data/surahs');

/**
 * Read and parse all surah markdown files from the data directory.
 */
export function getAllSurahs() {
  if (!fs.existsSync(DATA_DIR)) return [];

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.md'));

  return files.map(file => {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
    const { data, content } = matter(raw);
    return {
      slug: file.replace('.md', ''),
      frontmatter: data,
      rawContent: content,
    };
  }).sort((a, b) => (a.frontmatter.number || 0) - (b.frontmatter.number || 0));
}

/**
 * Get only published surahs (status = published and publish_date <= today).
 */
export function getPublishedSurahs() {
  const today = new Date().toISOString().split('T')[0];
  return getAllSurahs().filter(s => {
    if (s.frontmatter.status !== 'published') return false;
    if (s.frontmatter.publish_date && s.frontmatter.publish_date > today) return false;
    return true;
  });
}

/**
 * Get surahs grouped by status for the admin panel.
 */
export function getSurahsByStatus() {
  const all = getAllSurahs();
  return {
    draft: all.filter(s => s.frontmatter.status === 'draft'),
    review: all.filter(s => s.frontmatter.status === 'review'),
    scheduled: all.filter(s => s.frontmatter.status === 'scheduled'),
    published: all.filter(s => s.frontmatter.status === 'published'),
  };
}

/**
 * Get a single surah by slug.
 */
export function getSurah(slug) {
  const filePath = path.join(DATA_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  return {
    slug,
    frontmatter: data,
    rawContent: content,
    htmlContent: marked(content),
  };
}

/**
 * Parse verses from a surah's markdown content.
 * Expects ## Verset N headers.
 */
export function parseVerses(rawContent) {
  const sections = rawContent.split(/^## /m).filter(Boolean);
  return sections.map(section => {
    const lines = section.trim().split('\n');
    const title = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    const verseMatch = title.match(/Verset\s+(\d+)/i);
    return {
      number: verseMatch ? parseInt(verseMatch[1]) : 0,
      title,
      body,
      html: marked(body),
    };
  });
}

/**
 * Update the frontmatter of a surah file (for status changes, etc.).
 */
export function updateSurahFrontmatter(slug, updates) {
  const filePath = path.join(DATA_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  const newData = { ...data, ...updates };
  const newFile = matter.stringify(content, newData);
  fs.writeFileSync(filePath, newFile, 'utf-8');
  return true;
}
