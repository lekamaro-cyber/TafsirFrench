const VOTES_REQUIRED = 5;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * POST /api/votes/cast
 * Body: { surah: number, verse: number }
 * Adds the current user's vote for a verse.
 */
export async function handleCastVote(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const { surah, verse } = await request.json();
  if (!surah || !verse) {
    return jsonResponse({ error: 'Sourate et verset requis.' }, 400);
  }

  const key = `vote:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  const votes = existing ? JSON.parse(existing) : [];

  // Check if user already voted
  if (votes.some(v => v.userId === user.userId)) {
    return jsonResponse({ error: 'Vous avez deja vote pour ce verset.' }, 409);
  }

  votes.push({
    userId: user.userId,
    name: user.name,
    email: user.email,
    date: new Date().toISOString(),
  });

  await env.TAFSIR_AUTH.put(key, JSON.stringify(votes));

  const validated = votes.length >= VOTES_REQUIRED;

  // If this verse just got validated, check if whole surah is now complete
  let surahValidated = false;
  if (validated) {
    surahValidated = await checkSurahValidation(surah, env);
  }

  return jsonResponse({
    ok: true,
    votes: votes.length,
    required: VOTES_REQUIRED,
    validated,
    surahValidated,
    voters: votes.map(v => ({ name: v.name, date: v.date })),
  });
}

/**
 * DELETE /api/votes/cast
 * Body: { surah: number, verse: number }
 * Removes the current user's vote.
 */
export async function handleRemoveVote(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const { surah, verse } = await request.json();
  if (!surah || !verse) {
    return jsonResponse({ error: 'Sourate et verset requis.' }, 400);
  }

  const key = `vote:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse({ error: 'Aucun vote trouve.' }, 404);

  const votes = JSON.parse(existing);
  const filtered = votes.filter(v => v.userId !== user.userId);

  if (filtered.length === votes.length) {
    return jsonResponse({ error: 'Vous n\'avez pas vote pour ce verset.' }, 404);
  }

  await env.TAFSIR_AUTH.put(key, JSON.stringify(filtered));

  return jsonResponse({
    ok: true,
    votes: filtered.length,
    required: VOTES_REQUIRED,
    validated: filtered.length >= VOTES_REQUIRED,
    voters: filtered.map(v => ({ name: v.name, date: v.date })),
  });
}

/**
 * GET /api/votes/surah/:number
 * Returns vote status for all verses in a surah.
 */
export async function handleGetSurahVotes(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const url = new URL(request.url);
  const surahNumber = url.pathname.split('/').pop();

  // Get the surah info to know how many verses it has
  const surahInfoKey = `surah_info:${surahNumber}`;

  // We need to list all votes for this surah
  // KV doesn't have a native prefix list, so we'll store a verse count reference
  // and iterate. For efficiency, we also maintain a summary key.
  const summaryKey = `votes_summary:${surahNumber}`;
  const summaryData = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = summaryData ? JSON.parse(summaryData) : {};

  // Fetch individual vote data for all known verses
  const verses = {};
  const keys = Object.keys(summary);

  // Also check if there are votes not in summary yet (fetch up to 300 verses)
  const totalVerses = parseInt(url.searchParams.get('total') || '0');
  const maxVerse = Math.max(totalVerses, ...keys.map(Number), 0);

  const fetchPromises = [];
  for (let i = 1; i <= maxVerse; i++) {
    fetchPromises.push(
      env.TAFSIR_AUTH.get(`vote:${surahNumber}:${i}`).then(data => {
        if (data) {
          const votes = JSON.parse(data);
          verses[i] = {
            votes: votes.length,
            required: VOTES_REQUIRED,
            validated: votes.length >= VOTES_REQUIRED,
            hasVoted: votes.some(v => v.userId === user.userId),
            voters: votes.map(v => ({ name: v.name, date: v.date })),
          };
        }
      })
    );
  }
  await Promise.all(fetchPromises);

  // Count validated verses
  const validatedCount = Object.values(verses).filter(v => v.validated).length;

  return jsonResponse({
    surah: parseInt(surahNumber),
    verses,
    validatedCount,
    totalVerses: maxVerse,
    required: VOTES_REQUIRED,
    surahValidated: maxVerse > 0 && validatedCount === maxVerse,
  });
}

/**
 * GET /api/votes/summary
 * Returns a summary of validation progress for all surahs.
 */
export async function handleGetVotesSummary(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const summaryKey = 'votes_global_summary';
  const data = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = data ? JSON.parse(data) : {};

  return jsonResponse({ summary, required: VOTES_REQUIRED });
}

/**
 * Check if all verses of a surah are validated.
 * If so, mark surah as validated in KV.
 */
async function checkSurahValidation(surahNumber, env) {
  // Get total verse count from the meta stored in KV
  const metaKey = `surah_meta:${surahNumber}`;
  const metaData = await env.TAFSIR_AUTH.get(metaKey);
  if (!metaData) return false;

  const meta = JSON.parse(metaData);
  const totalVerses = meta.totalVerses;

  // Check each verse
  let allValidated = true;
  for (let i = 1; i <= totalVerses; i++) {
    const voteData = await env.TAFSIR_AUTH.get(`vote:${surahNumber}:${i}`);
    if (!voteData) { allValidated = false; break; }
    const votes = JSON.parse(voteData);
    if (votes.length < VOTES_REQUIRED) { allValidated = false; break; }
  }

  if (allValidated) {
    // Store surah validation status
    await env.TAFSIR_AUTH.put(`surah_validated:${surahNumber}`, JSON.stringify({
      validated: true,
      date: new Date().toISOString(),
    }));

    // Update global summary
    await updateGlobalSummary(surahNumber, totalVerses, totalVerses, env);
  }

  return allValidated;
}

/**
 * POST /api/votes/init-surah
 * Body: { surah: number, totalVerses: number }
 * Initialize surah metadata for vote tracking.
 */
export async function handleInitSurah(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const { surah, totalVerses } = await request.json();
  if (!surah || !totalVerses) {
    return jsonResponse({ error: 'Sourate et nombre de versets requis.' }, 400);
  }

  const metaKey = `surah_meta:${surah}`;
  await env.TAFSIR_AUTH.put(metaKey, JSON.stringify({ totalVerses }));

  return jsonResponse({ ok: true });
}

async function updateGlobalSummary(surahNumber, validatedCount, totalVerses, env) {
  const summaryKey = 'votes_global_summary';
  const data = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = data ? JSON.parse(data) : {};

  summary[surahNumber] = {
    validatedCount,
    totalVerses,
    completed: validatedCount === totalVerses,
    lastUpdate: new Date().toISOString(),
  };

  await env.TAFSIR_AUTH.put(summaryKey, JSON.stringify(summary));
}
