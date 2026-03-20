// Password hashing using Web Crypto API (available in Workers)
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function generateId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function createHash(password) {
  const salt = generateId();
  const hash = await hashPassword(password, salt);
  return `${salt}:${hash}`;
}

async function verifyHash(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = await hashPassword(password, salt);
  return hash === attempt;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export async function handleRegister(request, env) {
  const { email, password, name } = await request.json();
  if (!email || !password || !name) {
    return jsonResponse({ error: 'Tous les champs sont requis.' }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ error: 'Le mot de passe doit faire au moins 6 caracteres.' }, 400);
  }

  const key = `user:${email.trim().toLowerCase()}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (existing) {
    return jsonResponse({ error: 'Cet email est deja utilise.' }, 409);
  }

  const user = {
    id: generateId(),
    email: email.trim().toLowerCase(),
    name: name.trim(),
    password: await createHash(password),
    created: new Date().toISOString(),
  };

  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
  return jsonResponse({ ok: true, user: { id: user.id, email: user.email, name: user.name } }, 201);
}

export async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return jsonResponse({ error: 'Email et mot de passe requis.' }, 400);
  }

  const key = `user:${email.trim().toLowerCase()}`;
  const data = await env.TAFSIR_AUTH.get(key);
  if (!data) {
    return jsonResponse({ error: 'Email ou mot de passe incorrect.' }, 401);
  }

  const user = JSON.parse(data);
  const valid = await verifyHash(password, user.password);
  if (!valid) {
    return jsonResponse({ error: 'Email ou mot de passe incorrect.' }, 401);
  }

  // Create session token
  const token = generateId();
  const session = { userId: user.id, email: user.email, name: user.name };
  await env.TAFSIR_AUTH.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 7 * 24 * 3600 });

  return new Response(JSON.stringify({ ok: true, user: { id: user.id, email: user.email, name: user.name } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie('session', token, 7 * 24 * 3600),
    },
  });
}

export async function handleLogout(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (match) {
    await env.TAFSIR_AUTH.delete(`session:${match[1]}`);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie('session', '', 0),
    },
  });
}

export async function handleMe(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) {
    return jsonResponse({ error: 'Non authentifie.' }, 401);
  }
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) {
    return jsonResponse({ error: 'Session expiree.' }, 401);
  }
  return jsonResponse({ user: JSON.parse(data) });
}
