import { handleRegister, handleLogin, handleLogout, handleMe } from './auth.js';

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

    // Everything else is handled by static assets (configured in wrangler.toml)
    return env.ASSETS.fetch(request);
  },
};
