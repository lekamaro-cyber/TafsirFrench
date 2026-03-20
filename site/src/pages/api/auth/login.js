import { login } from '../../../lib/auth.js';

export const prerender = false;

export async function POST({ request }) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email et mot de passe requis.' }), { status: 400 });
  }

  const result = login(email.trim().toLowerCase(), password);
  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), { status: 401 });
  }

  const headers = new Headers();
  headers.append('Set-Cookie', `session=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);

  return new Response(JSON.stringify({ ok: true, user: result.user }), { status: 200, headers });
}
