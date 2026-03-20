import { logout } from '../../../lib/auth.js';

export const prerender = false;

export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  if (token) logout(token);

  const headers = new Headers();
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
