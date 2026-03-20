import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '../data');
const JSON_PATH = path.join(DATA_DIR, 'json/tafsir_fr.json');
const PDF_DIR = path.join(DATA_DIR, 'pdf');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');

let _tafsirCache = null;
let _statusCache = null;

/** Surah metadata (number, arabic name, french name, transliteration, verse count, revelation type) */
const SURAH_META = [
  { number: 1, name_ar: "الفاتحة", name_fr: "L'Ouverture", translit: "Al-Fatiha", verses: 7, type: "mecquoise" },
  { number: 2, name_ar: "البقرة", name_fr: "La Vache", translit: "Al-Baqara", verses: 286, type: "medinoise" },
  { number: 3, name_ar: "آل عمران", name_fr: "La Famille d'Imran", translit: "Ali 'Imran", verses: 200, type: "medinoise" },
  { number: 4, name_ar: "النساء", name_fr: "Les Femmes", translit: "An-Nisa", verses: 176, type: "medinoise" },
  { number: 5, name_ar: "المائدة", name_fr: "La Table Servie", translit: "Al-Ma'ida", verses: 120, type: "medinoise" },
  { number: 6, name_ar: "الأنعام", name_fr: "Les Bestiaux", translit: "Al-An'am", verses: 165, type: "mecquoise" },
  { number: 7, name_ar: "الأعراف", name_fr: "Les Murailles", translit: "Al-A'raf", verses: 206, type: "mecquoise" },
  { number: 8, name_ar: "الأنفال", name_fr: "Le Butin", translit: "Al-Anfal", verses: 75, type: "medinoise" },
  { number: 9, name_ar: "التوبة", name_fr: "Le Repentir", translit: "At-Tawba", verses: 129, type: "medinoise" },
  { number: 10, name_ar: "يونس", name_fr: "Jonas", translit: "Yunus", verses: 109, type: "mecquoise" },
  { number: 11, name_ar: "هود", name_fr: "Hud", translit: "Hud", verses: 123, type: "mecquoise" },
  { number: 12, name_ar: "يوسف", name_fr: "Joseph", translit: "Yusuf", verses: 111, type: "mecquoise" },
  { number: 13, name_ar: "الرعد", name_fr: "Le Tonnerre", translit: "Ar-Ra'd", verses: 43, type: "medinoise" },
  { number: 14, name_ar: "إبراهيم", name_fr: "Abraham", translit: "Ibrahim", verses: 52, type: "mecquoise" },
  { number: 15, name_ar: "الحجر", name_fr: "Al-Hijr", translit: "Al-Hijr", verses: 99, type: "mecquoise" },
  { number: 16, name_ar: "النحل", name_fr: "Les Abeilles", translit: "An-Nahl", verses: 128, type: "mecquoise" },
  { number: 17, name_ar: "الإسراء", name_fr: "Le Voyage Nocturne", translit: "Al-Isra", verses: 111, type: "mecquoise" },
  { number: 18, name_ar: "الكهف", name_fr: "La Caverne", translit: "Al-Kahf", verses: 110, type: "mecquoise" },
  { number: 19, name_ar: "مريم", name_fr: "Marie", translit: "Maryam", verses: 98, type: "mecquoise" },
  { number: 20, name_ar: "طه", name_fr: "Ta-Ha", translit: "Ta-Ha", verses: 135, type: "mecquoise" },
  { number: 21, name_ar: "الأنبياء", name_fr: "Les Prophetes", translit: "Al-Anbiya", verses: 112, type: "mecquoise" },
  { number: 22, name_ar: "الحج", name_fr: "Le Pelerinage", translit: "Al-Hajj", verses: 78, type: "medinoise" },
  { number: 23, name_ar: "المؤمنون", name_fr: "Les Croyants", translit: "Al-Mu'minun", verses: 118, type: "mecquoise" },
  { number: 24, name_ar: "النور", name_fr: "La Lumiere", translit: "An-Nur", verses: 64, type: "medinoise" },
  { number: 25, name_ar: "الفرقان", name_fr: "Le Discernement", translit: "Al-Furqan", verses: 77, type: "mecquoise" },
  { number: 26, name_ar: "الشعراء", name_fr: "Les Poetes", translit: "Ash-Shu'ara", verses: 227, type: "mecquoise" },
  { number: 27, name_ar: "النمل", name_fr: "Les Fourmis", translit: "An-Naml", verses: 93, type: "mecquoise" },
  { number: 28, name_ar: "القصص", name_fr: "Le Recit", translit: "Al-Qasas", verses: 88, type: "mecquoise" },
  { number: 29, name_ar: "العنكبوت", name_fr: "L'Araignee", translit: "Al-'Ankabut", verses: 69, type: "mecquoise" },
  { number: 30, name_ar: "الروم", name_fr: "Les Romains", translit: "Ar-Rum", verses: 60, type: "mecquoise" },
  { number: 31, name_ar: "لقمان", name_fr: "Luqman", translit: "Luqman", verses: 34, type: "mecquoise" },
  { number: 32, name_ar: "السجدة", name_fr: "La Prosternation", translit: "As-Sajda", verses: 30, type: "mecquoise" },
  { number: 33, name_ar: "الأحزاب", name_fr: "Les Coalises", translit: "Al-Ahzab", verses: 73, type: "medinoise" },
  { number: 34, name_ar: "سبأ", name_fr: "Saba", translit: "Saba", verses: 54, type: "mecquoise" },
  { number: 35, name_ar: "فاطر", name_fr: "Le Createur", translit: "Fatir", verses: 45, type: "mecquoise" },
  { number: 36, name_ar: "يس", name_fr: "Ya-Sin", translit: "Ya-Sin", verses: 83, type: "mecquoise" },
  { number: 37, name_ar: "الصافات", name_fr: "Les Ranges", translit: "As-Saffat", verses: 182, type: "mecquoise" },
  { number: 38, name_ar: "ص", name_fr: "Sad", translit: "Sad", verses: 88, type: "mecquoise" },
  { number: 39, name_ar: "الزمر", name_fr: "Les Groupes", translit: "Az-Zumar", verses: 75, type: "mecquoise" },
  { number: 40, name_ar: "غافر", name_fr: "Le Pardonneur", translit: "Ghafir", verses: 85, type: "mecquoise" },
  { number: 41, name_ar: "فصلت", name_fr: "Les Versets Detailles", translit: "Fussilat", verses: 54, type: "mecquoise" },
  { number: 42, name_ar: "الشورى", name_fr: "La Consultation", translit: "Ash-Shura", verses: 53, type: "mecquoise" },
  { number: 43, name_ar: "الزخرف", name_fr: "L'Ornement", translit: "Az-Zukhruf", verses: 89, type: "mecquoise" },
  { number: 44, name_ar: "الدخان", name_fr: "La Fumee", translit: "Ad-Dukhan", verses: 59, type: "mecquoise" },
  { number: 45, name_ar: "الجاثية", name_fr: "L'Agenouillee", translit: "Al-Jathiya", verses: 37, type: "mecquoise" },
  { number: 46, name_ar: "الأحقاف", name_fr: "Al-Ahqaf", translit: "Al-Ahqaf", verses: 35, type: "mecquoise" },
  { number: 47, name_ar: "محمد", name_fr: "Muhammad", translit: "Muhammad", verses: 38, type: "medinoise" },
  { number: 48, name_ar: "الفتح", name_fr: "La Victoire Eclatante", translit: "Al-Fath", verses: 29, type: "medinoise" },
  { number: 49, name_ar: "الحجرات", name_fr: "Les Appartements", translit: "Al-Hujurat", verses: 18, type: "medinoise" },
  { number: 50, name_ar: "ق", name_fr: "Qaf", translit: "Qaf", verses: 45, type: "mecquoise" },
  { number: 51, name_ar: "الذاريات", name_fr: "Qui Eparpillent", translit: "Adh-Dhariyat", verses: 60, type: "mecquoise" },
  { number: 52, name_ar: "الطور", name_fr: "Le Mont", translit: "At-Tur", verses: 49, type: "mecquoise" },
  { number: 53, name_ar: "النجم", name_fr: "L'Etoile", translit: "An-Najm", verses: 62, type: "mecquoise" },
  { number: 54, name_ar: "القمر", name_fr: "La Lune", translit: "Al-Qamar", verses: 55, type: "mecquoise" },
  { number: 55, name_ar: "الرحمن", name_fr: "Le Tout Misericordieux", translit: "Ar-Rahman", verses: 78, type: "medinoise" },
  { number: 56, name_ar: "الواقعة", name_fr: "L'Evenement", translit: "Al-Waqi'a", verses: 96, type: "mecquoise" },
  { number: 57, name_ar: "الحديد", name_fr: "Le Fer", translit: "Al-Hadid", verses: 29, type: "medinoise" },
  { number: 58, name_ar: "المجادلة", name_fr: "La Discussion", translit: "Al-Mujadala", verses: 22, type: "medinoise" },
  { number: 59, name_ar: "الحشر", name_fr: "L'Exode", translit: "Al-Hashr", verses: 24, type: "medinoise" },
  { number: 60, name_ar: "الممتحنة", name_fr: "L'Eprouvee", translit: "Al-Mumtahana", verses: 13, type: "medinoise" },
  { number: 61, name_ar: "الصف", name_fr: "Le Rang", translit: "As-Saff", verses: 14, type: "medinoise" },
  { number: 62, name_ar: "الجمعة", name_fr: "Le Vendredi", translit: "Al-Jumu'a", verses: 11, type: "medinoise" },
  { number: 63, name_ar: "المنافقون", name_fr: "Les Hypocrites", translit: "Al-Munafiqun", verses: 11, type: "medinoise" },
  { number: 64, name_ar: "التغابن", name_fr: "La Grande Perte", translit: "At-Taghabun", verses: 18, type: "medinoise" },
  { number: 65, name_ar: "الطلاق", name_fr: "Le Divorce", translit: "At-Talaq", verses: 12, type: "medinoise" },
  { number: 66, name_ar: "التحريم", name_fr: "L'Interdiction", translit: "At-Tahrim", verses: 12, type: "medinoise" },
  { number: 67, name_ar: "الملك", name_fr: "La Royaute", translit: "Al-Mulk", verses: 30, type: "mecquoise" },
  { number: 68, name_ar: "القلم", name_fr: "La Plume", translit: "Al-Qalam", verses: 52, type: "mecquoise" },
  { number: 69, name_ar: "الحاقة", name_fr: "Celle qui Montre la Verite", translit: "Al-Haqqa", verses: 52, type: "mecquoise" },
  { number: 70, name_ar: "المعارج", name_fr: "Les Voies d'Ascension", translit: "Al-Ma'arij", verses: 44, type: "mecquoise" },
  { number: 71, name_ar: "نوح", name_fr: "Noe", translit: "Nuh", verses: 28, type: "mecquoise" },
  { number: 72, name_ar: "الجن", name_fr: "Les Djinns", translit: "Al-Jinn", verses: 28, type: "mecquoise" },
  { number: 73, name_ar: "المزمل", name_fr: "L'Enveloppe", translit: "Al-Muzzammil", verses: 20, type: "mecquoise" },
  { number: 74, name_ar: "المدثر", name_fr: "Le Revetu d'un Manteau", translit: "Al-Muddaththir", verses: 56, type: "mecquoise" },
  { number: 75, name_ar: "القيامة", name_fr: "La Resurrection", translit: "Al-Qiyama", verses: 40, type: "mecquoise" },
  { number: 76, name_ar: "الإنسان", name_fr: "L'Homme", translit: "Al-Insan", verses: 31, type: "medinoise" },
  { number: 77, name_ar: "المرسلات", name_fr: "Les Envoyees", translit: "Al-Mursalat", verses: 50, type: "mecquoise" },
  { number: 78, name_ar: "النبأ", name_fr: "La Nouvelle", translit: "An-Naba", verses: 40, type: "mecquoise" },
  { number: 79, name_ar: "النازعات", name_fr: "Les Anges qui Arrachent", translit: "An-Nazi'at", verses: 46, type: "mecquoise" },
  { number: 80, name_ar: "عبس", name_fr: "Il s'est Renfrogne", translit: "'Abasa", verses: 42, type: "mecquoise" },
  { number: 81, name_ar: "التكوير", name_fr: "L'Obscurcissement", translit: "At-Takwir", verses: 29, type: "mecquoise" },
  { number: 82, name_ar: "الانفطار", name_fr: "La Rupture", translit: "Al-Infitar", verses: 19, type: "mecquoise" },
  { number: 83, name_ar: "المطففين", name_fr: "Les Fraudeurs", translit: "Al-Mutaffifin", verses: 36, type: "mecquoise" },
  { number: 84, name_ar: "الانشقاق", name_fr: "La Dechirure", translit: "Al-Inshiqaq", verses: 25, type: "mecquoise" },
  { number: 85, name_ar: "البروج", name_fr: "Les Constellations", translit: "Al-Buruj", verses: 22, type: "mecquoise" },
  { number: 86, name_ar: "الطارق", name_fr: "L'Astre Nocturne", translit: "At-Tariq", verses: 17, type: "mecquoise" },
  { number: 87, name_ar: "الأعلى", name_fr: "Le Tres-Haut", translit: "Al-A'la", verses: 19, type: "mecquoise" },
  { number: 88, name_ar: "الغاشية", name_fr: "L'Enveloppante", translit: "Al-Ghashiya", verses: 26, type: "mecquoise" },
  { number: 89, name_ar: "الفجر", name_fr: "L'Aube", translit: "Al-Fajr", verses: 30, type: "mecquoise" },
  { number: 90, name_ar: "البلد", name_fr: "La Cite", translit: "Al-Balad", verses: 20, type: "mecquoise" },
  { number: 91, name_ar: "الشمس", name_fr: "Le Soleil", translit: "Ash-Shams", verses: 15, type: "mecquoise" },
  { number: 92, name_ar: "الليل", name_fr: "La Nuit", translit: "Al-Layl", verses: 21, type: "mecquoise" },
  { number: 93, name_ar: "الضحى", name_fr: "Le Jour Montant", translit: "Ad-Duha", verses: 11, type: "mecquoise" },
  { number: 94, name_ar: "الشرح", name_fr: "L'Ouverture de la Poitrine", translit: "Ash-Sharh", verses: 8, type: "mecquoise" },
  { number: 95, name_ar: "التين", name_fr: "Le Figuier", translit: "At-Tin", verses: 8, type: "mecquoise" },
  { number: 96, name_ar: "العلق", name_fr: "L'Adherence", translit: "Al-'Alaq", verses: 19, type: "mecquoise" },
  { number: 97, name_ar: "القدر", name_fr: "La Destinee", translit: "Al-Qadr", verses: 5, type: "mecquoise" },
  { number: 98, name_ar: "البينة", name_fr: "La Preuve", translit: "Al-Bayyina", verses: 8, type: "medinoise" },
  { number: 99, name_ar: "الزلزلة", name_fr: "La Secousse", translit: "Az-Zalzala", verses: 8, type: "medinoise" },
  { number: 100, name_ar: "العاديات", name_fr: "Les Coursiers", translit: "Al-'Adiyat", verses: 11, type: "mecquoise" },
  { number: 101, name_ar: "القارعة", name_fr: "Le Fracas", translit: "Al-Qari'a", verses: 11, type: "mecquoise" },
  { number: 102, name_ar: "التكاثر", name_fr: "La Course aux Richesses", translit: "At-Takathur", verses: 8, type: "mecquoise" },
  { number: 103, name_ar: "العصر", name_fr: "Le Temps", translit: "Al-'Asr", verses: 3, type: "mecquoise" },
  { number: 104, name_ar: "الهمزة", name_fr: "Le Calomniateur", translit: "Al-Humaza", verses: 9, type: "mecquoise" },
  { number: 105, name_ar: "الفيل", name_fr: "L'Elephant", translit: "Al-Fil", verses: 5, type: "mecquoise" },
  { number: 106, name_ar: "قريش", name_fr: "Quraych", translit: "Quraysh", verses: 4, type: "mecquoise" },
  { number: 107, name_ar: "الماعون", name_fr: "L'Ustensile", translit: "Al-Ma'un", verses: 7, type: "mecquoise" },
  { number: 108, name_ar: "الكوثر", name_fr: "L'Abondance", translit: "Al-Kawthar", verses: 3, type: "mecquoise" },
  { number: 109, name_ar: "الكافرون", name_fr: "Les Infideles", translit: "Al-Kafirun", verses: 6, type: "mecquoise" },
  { number: 110, name_ar: "النصر", name_fr: "Le Secours", translit: "An-Nasr", verses: 3, type: "medinoise" },
  { number: 111, name_ar: "المسد", name_fr: "Les Fibres", translit: "Al-Masad", verses: 5, type: "mecquoise" },
  { number: 112, name_ar: "الإخلاص", name_fr: "Le Monotheisme Pur", translit: "Al-Ikhlas", verses: 4, type: "mecquoise" },
  { number: 113, name_ar: "الفلق", name_fr: "L'Aube Naissante", translit: "Al-Falaq", verses: 5, type: "mecquoise" },
  { number: 114, name_ar: "الناس", name_fr: "Les Hommes", translit: "An-Nas", verses: 6, type: "medinoise" },
];

/**
 * Load the tafsir JSON data (cached).
 */
function loadTafsir() {
  if (_tafsirCache) return _tafsirCache;
  if (!fs.existsSync(JSON_PATH)) return {};
  _tafsirCache = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  return _tafsirCache;
}

/**
 * Load or initialize the status file.
 * Format: { "1": { status, publish_date, reviewer, last_reviewed, notes }, ... }
 */
function loadStatus() {
  if (_statusCache) return _statusCache;
  if (fs.existsSync(STATUS_PATH)) {
    _statusCache = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8'));
  } else {
    // Initialize all surahs as draft
    _statusCache = {};
    for (const meta of SURAH_META) {
      _statusCache[String(meta.number)] = {
        status: 'draft',
        publish_date: '',
        reviewer: '',
        last_reviewed: '',
        notes: '',
      };
    }
    saveStatus();
  }
  return _statusCache;
}

function saveStatus() {
  fs.writeFileSync(STATUS_PATH, JSON.stringify(_statusCache, null, 2), 'utf-8');
}

/**
 * Get surah metadata by number.
 */
export function getSurahMeta(number) {
  return SURAH_META.find(s => s.number === number) || null;
}

/**
 * Get all surahs with metadata + status + verse count from JSON.
 */
export function getAllSurahs() {
  const tafsir = loadTafsir();
  const status = loadStatus();

  return SURAH_META.map(meta => {
    const num = String(meta.number);
    const surahData = tafsir[num] || {};
    const surahStatus = status[num] || { status: 'draft', publish_date: '', reviewer: '', last_reviewed: '', notes: '' };
    return {
      ...meta,
      slug: String(meta.number).padStart(3, '0'),
      tafsirVerseCount: Object.keys(surahData).length,
      ...surahStatus,
    };
  });
}

/**
 * Get published surahs only.
 */
export function getPublishedSurahs() {
  const today = new Date().toISOString().split('T')[0];
  return getAllSurahs().filter(s => {
    if (s.status !== 'published') return false;
    if (s.publish_date && s.publish_date > today) return false;
    return true;
  });
}

/**
 * Get surahs grouped by status.
 */
export function getSurahsByStatus() {
  const all = getAllSurahs();
  return {
    draft: all.filter(s => s.status === 'draft'),
    review: all.filter(s => s.status === 'review'),
    scheduled: all.filter(s => s.status === 'scheduled'),
    published: all.filter(s => s.status === 'published'),
  };
}

/**
 * Get tafsir verses for a surah by number.
 */
export function getSurahTafsir(surahNumber) {
  const tafsir = loadTafsir();
  const data = tafsir[String(surahNumber)];
  if (!data) return [];

  return Object.entries(data)
    .map(([verseNum, text]) => ({
      number: parseInt(verseNum),
      text,
    }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Check if a PDF exists for a surah.
 */
export function hasPdf(surahNumber) {
  const pdfPath = path.join(PDF_DIR, `${String(surahNumber).padStart(3, '0')}.pdf`);
  return fs.existsSync(pdfPath);
}

/**
 * Get PDF path relative to data dir.
 */
export function getPdfPath(surahNumber) {
  return `/pdf/${String(surahNumber).padStart(3, '0')}.pdf`;
}

/**
 * Update status for a surah.
 */
export function updateSurahStatus(surahNumber, updates) {
  const status = loadStatus();
  const num = String(surahNumber);
  if (!status[num]) {
    status[num] = { status: 'draft', publish_date: '', reviewer: '', last_reviewed: '', notes: '' };
  }
  Object.assign(status[num], updates);
  _statusCache = status;
  saveStatus();
}
