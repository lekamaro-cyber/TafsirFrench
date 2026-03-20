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

// ========== ROLES ==========
// admin: full access (manage users, approve corrections, everything)
// relecteur: can vote, report errors, approve corrections
// correcteur: can propose corrections (text edits), vote, report errors
const VALID_ROLES = ['admin', 'relecteur', 'correcteur'];
const DEFAULT_ROLE = 'relecteur';

/**
 * Get session with role info from KV user record.
 */
export async function getSessionWithRole(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) return null;
  const session = JSON.parse(data);
  // Fetch full user to get current role
  const userData = await env.TAFSIR_AUTH.get(`user:${session.email}`);
  if (!userData) return null;
  const user = JSON.parse(userData);
  return { ...session, role: user.role || DEFAULT_ROLE };
}

/**
 * Middleware: require specific roles.
 * Returns the session if authorized, or a Response to return if not.
 */
export async function requireRole(request, env, ...allowedRoles) {
  const session = await getSessionWithRole(request, env);
  if (!session) return { error: jsonResponse({ error: 'Non authentifie.' }, 401) };
  if (!allowedRoles.includes(session.role)) {
    return { error: jsonResponse({ error: 'Acces refuse. Role requis: ' + allowedRoles.join(' ou ') + '.' }, 403) };
  }
  return { session };
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

  // Check if this is the very first user → make them admin
  const userListData = await env.TAFSIR_AUTH.get('users_list');
  const userList = userListData ? JSON.parse(userListData) : [];
  const role = userList.length === 0 ? 'admin' : DEFAULT_ROLE;

  const user = {
    id: generateId(),
    email: email.trim().toLowerCase(),
    name: name.trim(),
    password: await createHash(password),
    role,
    created: new Date().toISOString(),
  };

  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));

  // Track user in list
  userList.push({ id: user.id, email: user.email, name: user.name, role: user.role, created: user.created });
  await env.TAFSIR_AUTH.put('users_list', JSON.stringify(userList));

  return jsonResponse({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
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

  // Create session token with role
  const token = generateId();
  const session = { userId: user.id, email: user.email, name: user.name, role: user.role || DEFAULT_ROLE };
  await env.TAFSIR_AUTH.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 7 * 24 * 3600 });

  return new Response(JSON.stringify({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role || DEFAULT_ROLE } }), {
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
  const session = JSON.parse(data);
  // Fetch fresh role from user record
  const userData = await env.TAFSIR_AUTH.get(`user:${session.email}`);
  if (!userData) {
    return jsonResponse({ error: 'Utilisateur introuvable.' }, 401);
  }
  const user = JSON.parse(userData);
  return jsonResponse({ user: { ...session, role: user.role || DEFAULT_ROLE } });
}

// ========== USER MANAGEMENT (Admin only) ==========

/**
 * GET /api/users
 * List all users (admin only).
 */
export async function handleListUsers(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const data = await env.TAFSIR_AUTH.get('users_list');
  const users = data ? JSON.parse(data) : [];

  return jsonResponse({ users });
}

/**
 * POST /api/users/role
 * Body: { email: string, role: string }
 * Change a user's role (admin only).
 */
export async function handleChangeRole(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const { email, role } = await request.json();
  if (!email || !role || !VALID_ROLES.includes(role)) {
    return jsonResponse({ error: 'Email et role valide requis (' + VALID_ROLES.join(', ') + ').' }, 400);
  }

  // Prevent self-demotion
  if (email === session.email) {
    return jsonResponse({ error: 'Vous ne pouvez pas modifier votre propre role.' }, 400);
  }

  const key = `user:${email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: 'Utilisateur introuvable.' }, 404);
  }

  const user = JSON.parse(userData);
  user.role = role;
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));

  // Update users_list
  const listData = await env.TAFSIR_AUTH.get('users_list');
  const list = listData ? JSON.parse(listData) : [];
  const idx = list.findIndex(u => u.email === email);
  if (idx >= 0) {
    list[idx].role = role;
    await env.TAFSIR_AUTH.put('users_list', JSON.stringify(list));
  }

  return jsonResponse({ ok: true, email, role });
}

/**
 * DELETE /api/users
 * Body: { email: string }
 * Delete a user (admin only).
 */
export async function handleDeleteUser(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const { email } = await request.json();
  if (!email) {
    return jsonResponse({ error: 'Email requis.' }, 400);
  }

  if (email === session.email) {
    return jsonResponse({ error: 'Vous ne pouvez pas supprimer votre propre compte.' }, 400);
  }

  const key = `user:${email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: 'Utilisateur introuvable.' }, 404);
  }

  await env.TAFSIR_AUTH.delete(key);

  // Update users_list
  const listData = await env.TAFSIR_AUTH.get('users_list');
  const list = listData ? JSON.parse(listData) : [];
  const filtered = list.filter(u => u.email !== email);
  await env.TAFSIR_AUTH.put('users_list', JSON.stringify(filtered));

  return jsonResponse({ ok: true });
}
