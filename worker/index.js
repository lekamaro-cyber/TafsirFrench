import { handleRegister, handleLogin, handleLogout, handleMe } from './auth.js';
import { handleCastVote, handleRemoveVote, handleGetSurahVotes, handleGetVotesSummary, handleInitSurah, handleCreateReport, handleResolveReport, handleGetSurahReports } from './votes.js';
import { handleTTS } from './tts.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Auth API routes
    if (pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (pathname === '/api/auth/me' && request.method === 'GET') {
      return handleMe(request, env);
    }

    // Vote API routes
    if (pathname === '/api/votes/cast' && request.method === 'POST') {
      return handleCastVote(request, env);
    }
    if (pathname === '/api/votes/cast' && request.method === 'DELETE') {
      return handleRemoveVote(request, env);
    }
    if (pathname.startsWith('/api/votes/surah/') && request.method === 'GET') {
      return handleGetSurahVotes(request, env);
    }
    if (pathname === '/api/votes/summary' && request.method === 'GET') {
      return handleGetVotesSummary(request, env);
    }
    if (pathname === '/api/votes/init-surah' && request.method === 'POST') {
      return handleInitSurah(request, env);
    }

    // Report API routes
    if (pathname === '/api/reports/create' && request.method === 'POST') {
      return handleCreateReport(request, env);
    }
    if (pathname === '/api/reports/resolve' && request.method === 'POST') {
      return handleResolveReport(request, env);
    }
    if (pathname.startsWith('/api/reports/surah/') && request.method === 'GET') {
      return handleGetSurahReports(request, env);
    }

    // TTS API route
    if (pathname === '/api/tts' && request.method === 'POST') {
      return handleTTS(request, env);
    }

    // Everything else is handled by static assets (configured in wrangler.toml)
    return env.ASSETS.fetch(request);
  },
};
