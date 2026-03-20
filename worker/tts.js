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
 * POST /api/tts
 * Body: { text: string }
 * Returns audio/mpeg stream from Workers AI MeloTTS (French).
 * Falls back to error if AI is unavailable.
 */
export async function handleTTS(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const { text } = await request.json();
  if (!text || text.trim().length === 0) {
    return jsonResponse({ error: 'Texte requis.' }, 400);
  }

  // Limit text length to prevent abuse (max ~2000 chars per request)
  const trimmed = text.trim().slice(0, 2000);

  try {
    const audio = await env.AI.run('@cf/myshell-ai/melotts', {
      prompt: trimmed,
      lang: 'fr',
    });

    // MeloTTS returns { audio: base64_string }
    if (audio && audio.audio) {
      const binaryStr = atob(audio.audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new Response(bytes, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // If AI returns a ReadableStream directly
    if (audio instanceof ReadableStream) {
      return new Response(audio, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // If it's an ArrayBuffer or similar
    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return jsonResponse({
      error: 'TTS indisponible.',
      detail: e.message || 'Erreur Workers AI',
      fallback: true,
    }, 503);
  }
}
