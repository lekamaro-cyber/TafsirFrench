import { getSessionWithRole, requireRole } from './auth.js';

const APPROVALS_REQUIRED = 2;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/corrections/create
 * Body: { surah: number, verse: number, originalText: string, correctedText: string, reason: string }
 * Propose a correction (correcteur or admin).
 */
export async function handleCreateCorrection(request, env) {
  const { error, session } = await requireRole(request, env, 'admin', 'correcteur');
  if (error) return error;

  const { surah, verse, originalText, correctedText, reason } = await request.json();
  if (!surah || !verse || !correctedText || !reason) {
    return jsonResponse({ error: 'Sourate, verset, texte corrige et motif requis.' }, 400);
  }

  if (correctedText.trim() === (originalText || '').trim()) {
    return jsonResponse({ error: 'Le texte corrige est identique a l\'original.' }, 400);
  }

  const correction = {
    id: crypto.randomUUID(),
    surah,
    verse,
    originalText: (originalText || '').trim(),
    correctedText: correctedText.trim(),
    reason: reason.trim().slice(0, 1000),
    authorId: session.userId,
    authorName: session.name,
    authorEmail: session.email,
    status: 'pending', // pending, approved, rejected, applied
    approvals: [],
    rejections: [],
    created: new Date().toISOString(),
  };

  // Store in per-surah correction list
  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  const corrections = existing ? JSON.parse(existing) : [];
  corrections.push(correction);
  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));

  // Register surah in index and update counts
  await ensureSurahInIndex(surah, env);
  await updateCorrectionIndex(env);

  return jsonResponse({ ok: true, correction: { id: correction.id, status: correction.status } }, 201);
}

/**
 * POST /api/corrections/review
 * Body: { surah: number, correctionId: string, action: 'approve' | 'reject' }
 * Approve or reject a correction (relecteur or admin, not the author).
 */
export async function handleReviewCorrection(request, env) {
  const { error, session } = await requireRole(request, env, 'admin', 'relecteur');
  if (error) return error;

  const { surah, correctionId, action } = await request.json();
  if (!surah || !correctionId || !['approve', 'reject'].includes(action)) {
    return jsonResponse({ error: 'Sourate, ID de correction et action (approve/reject) requis.' }, 400);
  }

  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse({ error: 'Aucune correction trouvee.' }, 404);

  const corrections = JSON.parse(existing);
  const correction = corrections.find(c => c.id === correctionId);
  if (!correction) return jsonResponse({ error: 'Correction introuvable.' }, 404);

  if (correction.status !== 'pending') {
    return jsonResponse({ error: 'Cette correction a deja ete traitee.' }, 400);
  }

  // Cannot review your own correction (unless admin)
  if (correction.authorId === session.userId && session.role !== 'admin') {
    return jsonResponse({ error: 'Vous ne pouvez pas valider votre propre correction.' }, 403);
  }

  // Check if already reviewed by this user
  const alreadyReviewed = [...correction.approvals, ...correction.rejections].some(r => r.userId === session.userId);
  if (alreadyReviewed) {
    return jsonResponse({ error: 'Vous avez deja donne votre avis sur cette correction.' }, 409);
  }

  const review = {
    userId: session.userId,
    name: session.name,
    date: new Date().toISOString(),
  };

  if (action === 'approve') {
    correction.approvals.push(review);
    // Admin approval is sufficient on its own; otherwise need 2 approvals
    if (session.role === 'admin' || correction.approvals.length >= APPROVALS_REQUIRED) {
      correction.status = 'approved';
      correction.approvedDate = new Date().toISOString();
    }
  } else {
    correction.rejections.push(review);
    // Any rejection rejects the correction
    correction.status = 'rejected';
    correction.rejectedDate = new Date().toISOString();
  }

  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));
  await updateCorrectionIndex(env);

  return jsonResponse({
    ok: true,
    status: correction.status,
    approvals: correction.approvals.length,
    required: APPROVALS_REQUIRED,
  });
}

/**
 * POST /api/corrections/apply
 * Body: { surah: number, correctionId: string }
 * Mark an approved correction as applied (admin only).
 * The actual file modification must be done in the build/deploy pipeline.
 */
export async function handleApplyCorrection(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const { surah, correctionId } = await request.json();
  if (!surah || !correctionId) {
    return jsonResponse({ error: 'Sourate et ID de correction requis.' }, 400);
  }

  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse({ error: 'Aucune correction trouvee.' }, 404);

  const corrections = JSON.parse(existing);
  const correction = corrections.find(c => c.id === correctionId);
  if (!correction) return jsonResponse({ error: 'Correction introuvable.' }, 404);

  if (correction.status !== 'approved') {
    return jsonResponse({ error: 'Seules les corrections approuvees peuvent etre appliquees.' }, 400);
  }

  correction.status = 'applied';
  correction.appliedBy = session.name;
  correction.appliedDate = new Date().toISOString();

  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));
  await updateCorrectionIndex(env);

  return jsonResponse({ ok: true, correction });
}

/**
 * GET /api/corrections/surah/:number
 * Get all corrections for a surah.
 */
export async function handleGetSurahCorrections(request, env) {
  const { error, session } = await requireRole(request, env, 'admin', 'relecteur', 'correcteur');
  if (error) return error;

  const url = new URL(request.url);
  const surahNumber = url.pathname.split('/').pop();
  const statusFilter = url.searchParams.get('status'); // optional: pending, approved, rejected, applied

  const key = `corrections:${surahNumber}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  let corrections = existing ? JSON.parse(existing) : [];

  if (statusFilter) {
    corrections = corrections.filter(c => c.status === statusFilter);
  }

  return jsonResponse({
    surah: parseInt(surahNumber),
    corrections,
    total: corrections.length,
    approvalsRequired: APPROVALS_REQUIRED,
  });
}

/**
 * GET /api/corrections/pending
 * Get all corrections across all surahs (for the dashboard).
 */
export async function handleGetPendingCorrections(request, env) {
  const { error, session } = await requireRole(request, env, 'admin', 'relecteur', 'correcteur');
  if (error) return error;

  const indexData = await env.TAFSIR_AUTH.get('corrections_index');
  const index = indexData ? JSON.parse(indexData) : { pending: 0, approved: 0, surahs: [] };

  // Fetch ALL corrections from all tracked surahs
  const allCorrections = [];
  for (const surahNum of index.surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (data) {
      const corrections = JSON.parse(data);
      allCorrections.push(...corrections);
    }
  }

  // Sort by date descending
  allCorrections.sort((a, b) => new Date(b.created) - new Date(a.created));

  return jsonResponse({
    corrections: allCorrections,
    total: allCorrections.length,
    approvalsRequired: APPROVALS_REQUIRED,
  });
}

/**
 * GET /api/admin/export-json
 * Returns all applied corrections so the client can merge them with the original JSON.
 * Admin only.
 */
export async function handleExportJson(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  // Fetch all applied corrections from KV
  const indexData = await env.TAFSIR_AUTH.get('corrections_index');
  const index = indexData ? JSON.parse(indexData) : { surahs: [] };

  const appliedCorrections = [];
  for (const surahNum of index.surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (!data) continue;
    const corrections = JSON.parse(data);
    const applied = corrections.filter(c => c.status === 'applied');
    for (const c of applied) {
      appliedCorrections.push({ surah: String(c.surah), verse: String(c.verse), text: c.correctedText });
    }
  }

  return jsonResponse({ corrections: appliedCorrections, count: appliedCorrections.length });
}

/**
 * Update the global corrections index for quick dashboard stats.
 */
async function updateCorrectionIndex(env) {
  // We'll track which surahs have corrections and counts
  const indexData = await env.TAFSIR_AUTH.get('corrections_index');
  const currentIndex = indexData ? JSON.parse(indexData) : { surahs: [] };

  // Rebuild counts from all known surahs
  let pending = 0;
  let approved = 0;
  const surahs = new Set(currentIndex.surahs);

  // Also check the surah we just modified (it's in the call stack)
  for (const surahNum of surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (data) {
      const corrections = JSON.parse(data);
      pending += corrections.filter(c => c.status === 'pending').length;
      approved += corrections.filter(c => c.status === 'approved').length;
    }
  }

  await env.TAFSIR_AUTH.put('corrections_index', JSON.stringify({
    pending,
    approved,
    surahs: [...surahs],
    lastUpdate: new Date().toISOString(),
  }));
}

/**
 * Helper: register a surah in the corrections index when a correction is created.
 */
export async function ensureSurahInIndex(surah, env) {
  const indexData = await env.TAFSIR_AUTH.get('corrections_index');
  const index = indexData ? JSON.parse(indexData) : { pending: 0, approved: 0, surahs: [] };
  if (!index.surahs.includes(surah)) {
    index.surahs.push(surah);
    await env.TAFSIR_AUTH.put('corrections_index', JSON.stringify(index));
  }
}
