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

/**
 * POST /api/auth/send-code
 * Body: { email: string }
 * Sends a 6-digit verification code to the email address.
 */
export async function handleSendCode(request, env) {
  const { email } = await request.json();
  if (!email) {
    return jsonResponse({ error: 'Email requis.' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return jsonResponse({ error: 'Format d\'email invalide.' }, 400);
  }

  // Check if already registered
  const existing = await env.TAFSIR_AUTH.get(`user:${normalizedEmail}`);
  if (existing) {
    return jsonResponse({ error: 'Cet email est deja utilise.' }, 409);
  }

  // Rate limit: max 1 code per email per 60 seconds
  const rateLimitKey = `code_rate:${normalizedEmail}`;
  const lastSent = await env.TAFSIR_AUTH.get(rateLimitKey);
  if (lastSent) {
    return jsonResponse({ error: 'Un code a deja ete envoye. Attendez 60 secondes.' }, 429);
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Store code in KV with 10-minute TTL
  await env.TAFSIR_AUTH.put(`email_code:${normalizedEmail}`, code, { expirationTtl: 600 });
  // Rate limit: 60 seconds
  await env.TAFSIR_AUTH.put(rateLimitKey, '1', { expirationTtl: 60 });

  // Send email via MailChannels
  try {
    const mailRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: normalizedEmail }] }],
        from: { email: 'noreply@tafsir-french.org', name: 'Tafsir French' },
        subject: 'Votre code de verification - Tafsir French',
        content: [{
          type: 'text/html',
          value: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
              <h2 style="color: #1e40af; margin-bottom: 1rem;">Verification de votre email</h2>
              <p>Votre code de verification est :</p>
              <div style="background: #f0f4ff; border: 2px solid #2563eb; border-radius: 8px; padding: 1rem; text-align: center; margin: 1.5rem 0;">
                <span style="font-size: 2rem; font-weight: bold; letter-spacing: 0.3em; color: #1e40af;">${code}</span>
              </div>
              <p style="color: #6b7280; font-size: 0.9rem;">Ce code expire dans 10 minutes. Si vous n'avez pas demande ce code, ignorez cet email.</p>
            </div>
          `,
        }],
      }),
    });

    if (!mailRes.ok) {
      const errText = await mailRes.text().catch(() => '');
      console.error('MailChannels error:', mailRes.status, errText);
      return jsonResponse({ error: 'Impossible d\'envoyer l\'email. Verifiez votre adresse.' }, 502);
    }
  } catch (e) {
    console.error('Email send error:', e);
    return jsonResponse({ error: 'Erreur lors de l\'envoi de l\'email.' }, 500);
  }

  return jsonResponse({ ok: true, message: 'Code envoye.' });
}

export async function handleRegister(request, env) {
  const { email, password, name, code } = await request.json();
  if (!email || !password || !name || !code) {
    return jsonResponse({ error: 'Tous les champs sont requis (y compris le code de verification).' }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ error: 'Le mot de passe doit faire au moins 6 caracteres.' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Verify the code
  const codeKey = `email_code:${normalizedEmail}`;
  const storedCode = await env.TAFSIR_AUTH.get(codeKey);
  if (!storedCode) {
    return jsonResponse({ error: 'Code expire ou non envoye. Demandez un nouveau code.' }, 400);
  }
  if (storedCode !== code.trim()) {
    return jsonResponse({ error: 'Code de verification incorrect.' }, 400);
  }

  // Code verified - delete it
  await env.TAFSIR_AUTH.delete(codeKey);

  const key = `user:${normalizedEmail}`;
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
    email: normalizedEmail,
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

/**
 * POST /api/users/reset-password
 * Body: { email: string, newPassword: string }
 * Reset a user's password (admin only).
 */
export async function handleResetPassword(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const { email, newPassword } = await request.json();
  if (!email || !newPassword) {
    return jsonResponse({ error: 'Email et nouveau mot de passe requis.' }, 400);
  }
  if (newPassword.length < 6) {
    return jsonResponse({ error: 'Le mot de passe doit faire au moins 6 caracteres.' }, 400);
  }

  const key = `user:${email.trim().toLowerCase()}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: 'Utilisateur introuvable.' }, 404);
  }

  const user = JSON.parse(userData);
  user.password = await createHash(newPassword);
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));

  return jsonResponse({ ok: true, message: `Mot de passe reinitialise pour ${email}.` });
}

// ========== ROLE REQUESTS ==========

/**
 * POST /api/role-requests
 * Body: { message?: string }
 * A relecteur requests promotion to correcteur.
 */
export async function handleCreateRoleRequest(request, env) {
  const session = await getSessionWithRole(request, env);
  if (!session) return jsonResponse({ error: 'Non authentifie.' }, 401);

  if (session.role !== 'relecteur') {
    return jsonResponse({ error: 'Seuls les relecteurs peuvent demander une promotion.' }, 400);
  }

  const body = await request.json().catch(() => ({}));
  const requestsData = await env.TAFSIR_AUTH.get('role_requests');
  const requests = requestsData ? JSON.parse(requestsData) : [];

  // Check for existing pending request
  const existing = requests.find(r => r.email === session.email && r.status === 'pending');
  if (existing) {
    return jsonResponse({ error: 'Vous avez deja une demande en attente.' }, 409);
  }

  requests.push({
    id: generateId(),
    email: session.email,
    name: session.name,
    requestedRole: 'correcteur',
    message: (body.message || '').slice(0, 500),
    status: 'pending',
    created: new Date().toISOString(),
  });

  await env.TAFSIR_AUTH.put('role_requests', JSON.stringify(requests));
  return jsonResponse({ ok: true, message: 'Demande envoyee.' }, 201);
}

/**
 * GET /api/role-requests/mine
 * Check if the current user has a pending role request.
 */
export async function handleMyRoleRequest(request, env) {
  const session = await getSessionWithRole(request, env);
  if (!session) return jsonResponse({ error: 'Non authentifie.' }, 401);

  const data = await env.TAFSIR_AUTH.get('role_requests');
  const requests = data ? JSON.parse(data) : [];
  const mine = requests.find(r => r.email === session.email && r.status === 'pending');
  return jsonResponse({ pending: !!mine });
}

/**
 * GET /api/role-requests
 * List all role requests (admin only).
 */
export async function handleListRoleRequests(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const data = await env.TAFSIR_AUTH.get('role_requests');
  const requests = data ? JSON.parse(data) : [];
  return jsonResponse({ requests });
}

/**
 * POST /api/role-requests/resolve
 * Body: { id: string, action: 'approve' | 'deny' }
 * Admin approves or denies a role request.
 */
export async function handleResolveRoleRequest(request, env) {
  const { error, session } = await requireRole(request, env, 'admin');
  if (error) return error;

  const { id, action } = await request.json();
  if (!id || !['approve', 'deny'].includes(action)) {
    return jsonResponse({ error: 'ID et action (approve/deny) requis.' }, 400);
  }

  const data = await env.TAFSIR_AUTH.get('role_requests');
  const requests = data ? JSON.parse(data) : [];
  const req = requests.find(r => r.id === id);
  if (!req) return jsonResponse({ error: 'Demande introuvable.' }, 404);
  if (req.status !== 'pending') return jsonResponse({ error: 'Cette demande a deja ete traitee.' }, 400);

  req.status = action === 'approve' ? 'approved' : 'denied';
  req.resolvedBy = session.email;
  req.resolvedAt = new Date().toISOString();

  if (action === 'approve') {
    // Update user role to correcteur
    const key = `user:${req.email}`;
    const userData = await env.TAFSIR_AUTH.get(key);
    if (userData) {
      const user = JSON.parse(userData);
      user.role = req.requestedRole;
      await env.TAFSIR_AUTH.put(key, JSON.stringify(user));

      // Update users_list
      const listData = await env.TAFSIR_AUTH.get('users_list');
      const list = listData ? JSON.parse(listData) : [];
      const idx = list.findIndex(u => u.email === req.email);
      if (idx >= 0) {
        list[idx].role = req.requestedRole;
        await env.TAFSIR_AUTH.put('users_list', JSON.stringify(list));
      }
    }
  }

  await env.TAFSIR_AUTH.put('role_requests', JSON.stringify(requests));
  return jsonResponse({ ok: true, status: req.status });
}

/**
 * POST /api/admin/bootstrap
 * Promotes the currently logged-in user to admin ONLY if no admin exists yet.
 * Works even if users_list doesn't exist (pre-role accounts).
 * Once an admin exists, this endpoint is permanently locked.
 */
export async function handleBootstrapAdmin(request, env) {
  // Get session directly (bypass role check since no admin may exist yet)
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return jsonResponse({ error: 'Non authentifie.' }, 401);
  const sessionData = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!sessionData) return jsonResponse({ error: 'Session expiree.' }, 401);
  const session = JSON.parse(sessionData);

  // Check if bootstrap has already been used (lock flag)
  const bootstrapDone = await env.TAFSIR_AUTH.get('bootstrap_done');
  if (bootstrapDone) {
    return jsonResponse({ error: 'Le bootstrap a deja ete effectue. Contactez un administrateur.' }, 403);
  }

  // Also scan users_list to check for existing admins
  const listData = await env.TAFSIR_AUTH.get('users_list');
  const userList = listData ? JSON.parse(listData) : [];
  for (const u of userList) {
    const ud = await env.TAFSIR_AUTH.get(`user:${u.email}`);
    if (ud) {
      const parsed = JSON.parse(ud);
      if (parsed.role === 'admin') {
        // Lock bootstrap permanently
        await env.TAFSIR_AUTH.put('bootstrap_done', 'true');
        return jsonResponse({ error: 'Un administrateur existe deja. Contactez-le pour changer votre role.' }, 403);
      }
    }
  }

  // No admin found → promote current user
  const key = `user:${session.email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) return jsonResponse({ error: 'Utilisateur introuvable dans KV.' }, 404);

  const user = JSON.parse(userData);
  const previousRole = user.role || 'aucun';
  user.role = 'admin';
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));

  // Rebuild users_list: add this user if not present
  const idx = userList.findIndex(u => u.email === session.email);
  if (idx >= 0) {
    userList[idx].role = 'admin';
  } else {
    userList.push({ id: user.id, email: user.email, name: user.name, role: 'admin', created: user.created });
  }
  await env.TAFSIR_AUTH.put('users_list', JSON.stringify(userList));

  // Lock bootstrap permanently so no one else can use it
  await env.TAFSIR_AUTH.put('bootstrap_done', 'true');

  return jsonResponse({
    ok: true,
    promoted: true,
    currentUser: session.email,
    previousRole,
    newRole: 'admin',
    users: userList.map(u => ({ name: u.name, email: u.email, role: u.role, created: u.created })),
    message: 'Vous etes maintenant administrateur. Deconnectez-vous et reconnectez-vous pour appliquer.',
  });
}
