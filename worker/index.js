import { handleSendCode, handleRegister, handleLogin, handleLogout, handleMe, handleChangePassword, handleListUsers, handleChangeRole, handleDeleteUser, handleResetPassword, handleBootstrapAdmin, handleCreateRoleRequest, handleMyRoleRequest, handleListRoleRequests, handleResolveRoleRequest } from './auth.js';
import { handleCastVote, handleRemoveVote, handleGetSurahVotes, handleGetVotesSummary, handleInitSurah, handleGetPublishedSurahs, handleCheckPublish, handleCreateReport, handleResolveReport, handleGetSurahReports } from './votes.js';
import { handleCreateCorrection, handleReviewCorrection, handleApplyCorrection, handleGetSurahCorrections, handleGetPendingCorrections, handleExportJson } from './corrections.js';
import { handleTTS } from './tts.js';

export default {
  async fetch(request, env, ctx) {
    try {
    const url = new URL(request.url);
    const { pathname } = url;

    // Auth API routes
    if (pathname === '/api/auth/send-code' && request.method === 'POST') {
      return handleSendCode(request, env);
    }
    if (pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env, ctx);
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
    if (pathname === '/api/auth/change-password' && request.method === 'POST') {
      return handleChangePassword(request, env);
    }

    // User management API routes (admin only)
    if (pathname === '/api/users' && request.method === 'GET') {
      return handleListUsers(request, env);
    }
    if (pathname === '/api/users/role' && request.method === 'POST') {
      return handleChangeRole(request, env);
    }
    if (pathname === '/api/users' && request.method === 'DELETE') {
      return handleDeleteUser(request, env);
    }
    if (pathname === '/api/users/reset-password' && request.method === 'POST') {
      return handleResetPassword(request, env);
    }
    // Role request routes
    if (pathname === '/api/role-requests' && request.method === 'POST') {
      return handleCreateRoleRequest(request, env, ctx);
    }
    if (pathname === '/api/role-requests/mine' && request.method === 'GET') {
      return handleMyRoleRequest(request, env);
    }
    if (pathname === '/api/role-requests' && request.method === 'GET') {
      return handleListRoleRequests(request, env);
    }
    if (pathname === '/api/role-requests/resolve' && request.method === 'POST') {
      return handleResolveRoleRequest(request, env, ctx);
    }
    if (pathname === '/api/admin/export-json' && request.method === 'GET') {
      return handleExportJson(request, env);
    }
    if (pathname === '/api/admin/bootstrap' && request.method === 'POST') {
      return handleBootstrapAdmin(request, env);
    }

    // Public API: published surahs (no auth)
    if (pathname === '/api/published-surahs' && request.method === 'GET') {
      return handleGetPublishedSurahs(request, env);
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
    if (pathname === '/api/votes/check-publish' && request.method === 'POST') {
      return handleCheckPublish(request, env);
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

    // Corrections API routes
    if (pathname === '/api/corrections/create' && request.method === 'POST') {
      return handleCreateCorrection(request, env);
    }
    if (pathname === '/api/corrections/review' && request.method === 'POST') {
      return handleReviewCorrection(request, env);
    }
    if (pathname === '/api/corrections/apply' && request.method === 'POST') {
      return handleApplyCorrection(request, env);
    }
    if (pathname.startsWith('/api/corrections/surah/') && request.method === 'GET') {
      return handleGetSurahCorrections(request, env);
    }
    if (pathname === '/api/corrections/pending' && request.method === 'GET') {
      return handleGetPendingCorrections(request, env);
    }

    // TTS API route
    if (pathname === '/api/tts' && request.method === 'POST') {
      return handleTTS(request, env);
    }

    // Debug: catch unmatched API routes
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Route API non trouvee', pathname, method: request.method }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything else is handled by static assets (configured in wrangler.toml)
    return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Erreur interne du serveur: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
