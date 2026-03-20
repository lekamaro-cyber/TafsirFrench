import { register } from '../../../lib/auth.js';

export const prerender = false;

export async function POST({ request }) {
  const body = await request.json();
  const { email, password, name } = body;

  if (!email || !password || !name) {
    return new Response(JSON.stringify({ error: 'Tous les champs sont requis.' }), { status: 400 });
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: 'Le mot de passe doit faire au moins 6 caracteres.' }), { status: 400 });
  }

  const result = register(email.trim().toLowerCase(), password, name.trim());
  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), { status: 409 });
  }

  return new Response(JSON.stringify({ ok: true, user: result.user }), { status: 201 });
}
