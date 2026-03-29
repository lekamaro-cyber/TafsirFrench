// ../worker/auth.js
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function generateId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function createHash(password) {
  const salt = generateId();
  const hash = await hashPassword(password, salt);
  return `${salt}:${hash}`;
}
async function verifyHash(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = await hashPassword(password, salt);
  return hash === attempt;
}
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}
var VALID_ROLES = ["admin", "relecteur", "correcteur"];
var DEFAULT_ROLE = "relecteur";
async function getSessionWithRole(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) return null;
  const session = JSON.parse(data);
  const userData = await env.TAFSIR_AUTH.get(`user:${session.email}`);
  if (!userData) return null;
  const user = JSON.parse(userData);
  return { ...session, role: user.role || DEFAULT_ROLE };
}
async function requireRole(request, env, ...allowedRoles) {
  const session = await getSessionWithRole(request, env);
  if (!session) return { error: jsonResponse({ error: "Non authentifie." }, 401) };
  if (!allowedRoles.includes(session.role)) {
    return { error: jsonResponse({ error: "Acces refuse. Role requis: " + allowedRoles.join(" ou ") + "." }, 403) };
  }
  return { session };
}
async function handleSendCode(request, env) {
  const { email } = await request.json();
  if (!email) {
    return jsonResponse({ error: "Email requis." }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return jsonResponse({ error: "Format d'email invalide." }, 400);
  }
  const existing = await env.TAFSIR_AUTH.get(`user:${normalizedEmail}`);
  if (existing) {
    return jsonResponse({ error: "Cet email est deja utilise." }, 409);
  }
  const rateLimitKey = `code_rate:${normalizedEmail}`;
  const lastSent = await env.TAFSIR_AUTH.get(rateLimitKey);
  if (lastSent) {
    return jsonResponse({ error: "Un code a deja ete envoye. Attendez 60 secondes." }, 429);
  }
  const code = String(Math.floor(1e5 + Math.random() * 9e5));
  await env.TAFSIR_AUTH.put(`email_code:${normalizedEmail}`, code, { expirationTtl: 600 });
  await env.TAFSIR_AUTH.put(rateLimitKey, "1", { expirationTtl: 60 });
  try {
    const mailRes = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: normalizedEmail }] }],
        from: { email: "noreply@tafsir-french.org", name: "Tafsir French" },
        subject: "Votre code de verification - Tafsir French",
        content: [{
          type: "text/html",
          value: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
              <h2 style="color: #1e40af; margin-bottom: 1rem;">Verification de votre email</h2>
              <p>Votre code de verification est :</p>
              <div style="background: #f0f4ff; border: 2px solid #2563eb; border-radius: 8px; padding: 1rem; text-align: center; margin: 1.5rem 0;">
                <span style="font-size: 2rem; font-weight: bold; letter-spacing: 0.3em; color: #1e40af;">${code}</span>
              </div>
              <p style="color: #6b7280; font-size: 0.9rem;">Ce code expire dans 10 minutes. Si vous n'avez pas demande ce code, ignorez cet email.</p>
            </div>
          `
        }]
      })
    });
    if (!mailRes.ok) {
      const errText = await mailRes.text().catch(() => "");
      console.error("MailChannels error:", mailRes.status, errText);
      return jsonResponse({ error: "Impossible d'envoyer l'email. Verifiez votre adresse." }, 502);
    }
  } catch (e) {
    console.error("Email send error:", e);
    return jsonResponse({ error: "Erreur lors de l'envoi de l'email." }, 500);
  }
  return jsonResponse({ ok: true, message: "Code envoye." });
}
async function handleRegister(request, env) {
  const { email, password, name, code } = await request.json();
  if (!email || !password || !name || !code) {
    return jsonResponse({ error: "Tous les champs sont requis (y compris le code de verification)." }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ error: "Le mot de passe doit faire au moins 6 caracteres." }, 400);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const codeKey = `email_code:${normalizedEmail}`;
  const storedCode = await env.TAFSIR_AUTH.get(codeKey);
  if (!storedCode) {
    return jsonResponse({ error: "Code expire ou non envoye. Demandez un nouveau code." }, 400);
  }
  if (storedCode !== code.trim()) {
    return jsonResponse({ error: "Code de verification incorrect." }, 400);
  }
  await env.TAFSIR_AUTH.delete(codeKey);
  const key = `user:${normalizedEmail}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (existing) {
    return jsonResponse({ error: "Cet email est deja utilise." }, 409);
  }
  const userListData = await env.TAFSIR_AUTH.get("users_list");
  const userList = userListData ? JSON.parse(userListData) : [];
  const role = userList.length === 0 ? "admin" : DEFAULT_ROLE;
  const user = {
    id: generateId(),
    email: normalizedEmail,
    name: name.trim(),
    password: await createHash(password),
    role,
    created: (/* @__PURE__ */ new Date()).toISOString()
  };
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
  userList.push({ id: user.id, email: user.email, name: user.name, role: user.role, created: user.created });
  await env.TAFSIR_AUTH.put("users_list", JSON.stringify(userList));
  return jsonResponse({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
}
async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return jsonResponse({ error: "Email et mot de passe requis." }, 400);
  }
  const key = `user:${email.trim().toLowerCase()}`;
  const data = await env.TAFSIR_AUTH.get(key);
  if (!data) {
    return jsonResponse({ error: "Email ou mot de passe incorrect." }, 401);
  }
  const user = JSON.parse(data);
  const valid = await verifyHash(password, user.password);
  if (!valid) {
    return jsonResponse({ error: "Email ou mot de passe incorrect." }, 401);
  }
  const token = generateId();
  const session = { userId: user.id, email: user.email, name: user.name, role: user.role || DEFAULT_ROLE };
  await env.TAFSIR_AUTH.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 7 * 24 * 3600 });
  return new Response(JSON.stringify({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role || DEFAULT_ROLE } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setCookie("session", token, 7 * 24 * 3600)
    }
  });
}
async function handleLogout(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (match) {
    await env.TAFSIR_AUTH.delete(`session:${match[1]}`);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setCookie("session", "", 0)
    }
  });
}
async function handleMe(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) {
    return jsonResponse({ error: "Non authentifie." }, 401);
  }
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) {
    return jsonResponse({ error: "Session expiree." }, 401);
  }
  const session = JSON.parse(data);
  const userData = await env.TAFSIR_AUTH.get(`user:${session.email}`);
  if (!userData) {
    return jsonResponse({ error: "Utilisateur introuvable." }, 401);
  }
  const user = JSON.parse(userData);
  return jsonResponse({ user: { ...session, role: user.role || DEFAULT_ROLE } });
}
async function handleListUsers(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const data = await env.TAFSIR_AUTH.get("users_list");
  const users = data ? JSON.parse(data) : [];
  return jsonResponse({ users });
}
async function handleChangeRole(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const { email, role } = await request.json();
  if (!email || !role || !VALID_ROLES.includes(role)) {
    return jsonResponse({ error: "Email et role valide requis (" + VALID_ROLES.join(", ") + ")." }, 400);
  }
  if (email === session.email) {
    return jsonResponse({ error: "Vous ne pouvez pas modifier votre propre role." }, 400);
  }
  const key = `user:${email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: "Utilisateur introuvable." }, 404);
  }
  const user = JSON.parse(userData);
  user.role = role;
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
  const listData = await env.TAFSIR_AUTH.get("users_list");
  const list = listData ? JSON.parse(listData) : [];
  const idx = list.findIndex((u) => u.email === email);
  if (idx >= 0) {
    list[idx].role = role;
    await env.TAFSIR_AUTH.put("users_list", JSON.stringify(list));
  }
  return jsonResponse({ ok: true, email, role });
}
async function handleDeleteUser(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const { email } = await request.json();
  if (!email) {
    return jsonResponse({ error: "Email requis." }, 400);
  }
  if (email === session.email) {
    return jsonResponse({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
  }
  const key = `user:${email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: "Utilisateur introuvable." }, 404);
  }
  await env.TAFSIR_AUTH.delete(key);
  const listData = await env.TAFSIR_AUTH.get("users_list");
  const list = listData ? JSON.parse(listData) : [];
  const filtered = list.filter((u) => u.email !== email);
  await env.TAFSIR_AUTH.put("users_list", JSON.stringify(filtered));
  return jsonResponse({ ok: true });
}
async function handleResetPassword(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const { email, newPassword } = await request.json();
  if (!email || !newPassword) {
    return jsonResponse({ error: "Email et nouveau mot de passe requis." }, 400);
  }
  if (newPassword.length < 6) {
    return jsonResponse({ error: "Le mot de passe doit faire au moins 6 caracteres." }, 400);
  }
  const key = `user:${email.trim().toLowerCase()}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) {
    return jsonResponse({ error: "Utilisateur introuvable." }, 404);
  }
  const user = JSON.parse(userData);
  user.password = await createHash(newPassword);
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
  return jsonResponse({ ok: true, message: `Mot de passe reinitialise pour ${email}.` });
}
async function handleCreateRoleRequest(request, env) {
  const session = await getSessionWithRole(request, env);
  if (!session) return jsonResponse({ error: "Non authentifie." }, 401);
  if (session.role !== "relecteur") {
    return jsonResponse({ error: "Seuls les relecteurs peuvent demander une promotion." }, 400);
  }
  const body = await request.json().catch(() => ({}));
  const requestsData = await env.TAFSIR_AUTH.get("role_requests");
  const requests = requestsData ? JSON.parse(requestsData) : [];
  const existing = requests.find((r) => r.email === session.email && r.status === "pending");
  if (existing) {
    return jsonResponse({ error: "Vous avez deja une demande en attente." }, 409);
  }
  requests.push({
    id: generateId(),
    email: session.email,
    name: session.name,
    requestedRole: "correcteur",
    message: (body.message || "").slice(0, 500),
    status: "pending",
    created: (/* @__PURE__ */ new Date()).toISOString()
  });
  await env.TAFSIR_AUTH.put("role_requests", JSON.stringify(requests));
  return jsonResponse({ ok: true, message: "Demande envoyee." }, 201);
}
async function handleMyRoleRequest(request, env) {
  const session = await getSessionWithRole(request, env);
  if (!session) return jsonResponse({ error: "Non authentifie." }, 401);
  const data = await env.TAFSIR_AUTH.get("role_requests");
  const requests = data ? JSON.parse(data) : [];
  const mine = requests.find((r) => r.email === session.email && r.status === "pending");
  return jsonResponse({ pending: !!mine });
}
async function handleListRoleRequests(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const data = await env.TAFSIR_AUTH.get("role_requests");
  const requests = data ? JSON.parse(data) : [];
  return jsonResponse({ requests });
}
async function handleResolveRoleRequest(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const { id, action } = await request.json();
  if (!id || !["approve", "deny"].includes(action)) {
    return jsonResponse({ error: "ID et action (approve/deny) requis." }, 400);
  }
  const data = await env.TAFSIR_AUTH.get("role_requests");
  const requests = data ? JSON.parse(data) : [];
  const req = requests.find((r) => r.id === id);
  if (!req) return jsonResponse({ error: "Demande introuvable." }, 404);
  if (req.status !== "pending") return jsonResponse({ error: "Cette demande a deja ete traitee." }, 400);
  req.status = action === "approve" ? "approved" : "denied";
  req.resolvedBy = session.email;
  req.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (action === "approve") {
    const key = `user:${req.email}`;
    const userData = await env.TAFSIR_AUTH.get(key);
    if (userData) {
      const user = JSON.parse(userData);
      user.role = req.requestedRole;
      await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
      const listData = await env.TAFSIR_AUTH.get("users_list");
      const list = listData ? JSON.parse(listData) : [];
      const idx = list.findIndex((u) => u.email === req.email);
      if (idx >= 0) {
        list[idx].role = req.requestedRole;
        await env.TAFSIR_AUTH.put("users_list", JSON.stringify(list));
      }
    }
  }
  await env.TAFSIR_AUTH.put("role_requests", JSON.stringify(requests));
  return jsonResponse({ ok: true, status: req.status });
}
async function handleBootstrapAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return jsonResponse({ error: "Non authentifie." }, 401);
  const sessionData = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!sessionData) return jsonResponse({ error: "Session expiree." }, 401);
  const session = JSON.parse(sessionData);
  const bootstrapDone = await env.TAFSIR_AUTH.get("bootstrap_done");
  if (bootstrapDone) {
    return jsonResponse({ error: "Le bootstrap a deja ete effectue. Contactez un administrateur." }, 403);
  }
  const listData = await env.TAFSIR_AUTH.get("users_list");
  const userList = listData ? JSON.parse(listData) : [];
  for (const u of userList) {
    const ud = await env.TAFSIR_AUTH.get(`user:${u.email}`);
    if (ud) {
      const parsed = JSON.parse(ud);
      if (parsed.role === "admin") {
        await env.TAFSIR_AUTH.put("bootstrap_done", "true");
        return jsonResponse({ error: "Un administrateur existe deja. Contactez-le pour changer votre role." }, 403);
      }
    }
  }
  const key = `user:${session.email}`;
  const userData = await env.TAFSIR_AUTH.get(key);
  if (!userData) return jsonResponse({ error: "Utilisateur introuvable dans KV." }, 404);
  const user = JSON.parse(userData);
  const previousRole = user.role || "aucun";
  user.role = "admin";
  await env.TAFSIR_AUTH.put(key, JSON.stringify(user));
  const idx = userList.findIndex((u) => u.email === session.email);
  if (idx >= 0) {
    userList[idx].role = "admin";
  } else {
    userList.push({ id: user.id, email: user.email, name: user.name, role: "admin", created: user.created });
  }
  await env.TAFSIR_AUTH.put("users_list", JSON.stringify(userList));
  await env.TAFSIR_AUTH.put("bootstrap_done", "true");
  return jsonResponse({
    ok: true,
    promoted: true,
    currentUser: session.email,
    previousRole,
    newRole: "admin",
    users: userList.map((u) => ({ name: u.name, email: u.email, role: u.role, created: u.created })),
    message: "Vous etes maintenant administrateur. Deconnectez-vous et reconnectez-vous pour appliquer."
  });
}

// ../worker/votes.js
var VOTES_REQUIRED = 5;
function jsonResponse2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function getSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) return null;
  return JSON.parse(data);
}
async function handleCastVote(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const { surah, verse } = await request.json();
  if (!surah || !verse) {
    return jsonResponse2({ error: "Sourate et verset requis." }, 400);
  }
  const key = `vote:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  const votes = existing ? JSON.parse(existing) : [];
  if (votes.some((v) => v.userId === user.userId)) {
    return jsonResponse2({ error: "Vous avez deja vote pour ce verset." }, 409);
  }
  votes.push({
    userId: user.userId,
    name: user.name,
    email: user.email,
    date: (/* @__PURE__ */ new Date()).toISOString()
  });
  await env.TAFSIR_AUTH.put(key, JSON.stringify(votes));
  const validated = votes.length >= VOTES_REQUIRED;
  let surahValidated = false;
  if (validated) {
    surahValidated = await checkSurahValidation(surah, env);
  }
  return jsonResponse2({
    ok: true,
    votes: votes.length,
    required: VOTES_REQUIRED,
    validated,
    surahValidated,
    voters: votes.map((v) => ({ name: v.name, date: v.date }))
  });
}
async function handleRemoveVote(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const { surah, verse } = await request.json();
  if (!surah || !verse) {
    return jsonResponse2({ error: "Sourate et verset requis." }, 400);
  }
  const key = `vote:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse2({ error: "Aucun vote trouve." }, 404);
  const votes = JSON.parse(existing);
  const filtered = votes.filter((v) => v.userId !== user.userId);
  if (filtered.length === votes.length) {
    return jsonResponse2({ error: "Vous n'avez pas vote pour ce verset." }, 404);
  }
  await env.TAFSIR_AUTH.put(key, JSON.stringify(filtered));
  return jsonResponse2({
    ok: true,
    votes: filtered.length,
    required: VOTES_REQUIRED,
    validated: filtered.length >= VOTES_REQUIRED,
    voters: filtered.map((v) => ({ name: v.name, date: v.date }))
  });
}
async function handleGetSurahVotes(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const url = new URL(request.url);
  const surahNumber = url.pathname.split("/").pop();
  const surahInfoKey = `surah_info:${surahNumber}`;
  const summaryKey = `votes_summary:${surahNumber}`;
  const summaryData = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = summaryData ? JSON.parse(summaryData) : {};
  const verses = {};
  const keys = Object.keys(summary);
  const totalVerses = parseInt(url.searchParams.get("total") || "0");
  const maxVerse = Math.max(totalVerses, ...keys.map(Number), 0);
  const fetchPromises = [];
  for (let i = 1; i <= maxVerse; i++) {
    fetchPromises.push(
      env.TAFSIR_AUTH.get(`vote:${surahNumber}:${i}`).then((data) => {
        if (data) {
          const votes = JSON.parse(data);
          verses[i] = {
            votes: votes.length,
            required: VOTES_REQUIRED,
            validated: votes.length >= VOTES_REQUIRED,
            hasVoted: votes.some((v) => v.userId === user.userId),
            voters: votes.map((v) => ({ name: v.name, date: v.date }))
          };
        }
      })
    );
  }
  await Promise.all(fetchPromises);
  const validatedCount = Object.values(verses).filter((v) => v.validated).length;
  return jsonResponse2({
    surah: parseInt(surahNumber),
    verses,
    validatedCount,
    totalVerses: maxVerse,
    required: VOTES_REQUIRED,
    surahValidated: maxVerse > 0 && validatedCount === maxVerse
  });
}
async function handleGetVotesSummary(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const summaryKey = "votes_global_summary";
  const data = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = data ? JSON.parse(data) : {};
  return jsonResponse2({ summary, required: VOTES_REQUIRED });
}
async function checkSurahValidation(surahNumber, env) {
  const metaKey = `surah_meta:${surahNumber}`;
  const metaData = await env.TAFSIR_AUTH.get(metaKey);
  if (!metaData) return false;
  const meta = JSON.parse(metaData);
  const totalVerses = meta.totalVerses;
  let allValidated = true;
  for (let i = 1; i <= totalVerses; i++) {
    const voteData = await env.TAFSIR_AUTH.get(`vote:${surahNumber}:${i}`);
    if (!voteData) {
      allValidated = false;
      break;
    }
    const votes = JSON.parse(voteData);
    if (votes.length < VOTES_REQUIRED) {
      allValidated = false;
      break;
    }
  }
  if (allValidated) {
    await env.TAFSIR_AUTH.put(`surah_validated:${surahNumber}`, JSON.stringify({
      validated: true,
      date: (/* @__PURE__ */ new Date()).toISOString()
    }));
    await updateGlobalSummary(surahNumber, totalVerses, totalVerses, env);
  }
  return allValidated;
}
async function handleInitSurah(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const { surah, totalVerses } = await request.json();
  if (!surah || !totalVerses) {
    return jsonResponse2({ error: "Sourate et nombre de versets requis." }, 400);
  }
  const metaKey = `surah_meta:${surah}`;
  await env.TAFSIR_AUTH.put(metaKey, JSON.stringify({ totalVerses }));
  return jsonResponse2({ ok: true });
}
async function updateGlobalSummary(surahNumber, validatedCount, totalVerses, env) {
  const summaryKey = "votes_global_summary";
  const data = await env.TAFSIR_AUTH.get(summaryKey);
  const summary = data ? JSON.parse(data) : {};
  summary[surahNumber] = {
    validatedCount,
    totalVerses,
    completed: validatedCount === totalVerses,
    lastUpdate: (/* @__PURE__ */ new Date()).toISOString()
  };
  await env.TAFSIR_AUTH.put(summaryKey, JSON.stringify(summary));
}
async function handleCreateReport(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const { surah, verse, note } = await request.json();
  if (!surah || !verse || !note || !note.trim()) {
    return jsonResponse2({ error: "Sourate, verset et note requis." }, 400);
  }
  const key = `report:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  const reports = existing ? JSON.parse(existing) : [];
  reports.push({
    id: crypto.randomUUID(),
    userId: user.userId,
    name: user.name,
    note: note.trim().slice(0, 1e3),
    date: (/* @__PURE__ */ new Date()).toISOString(),
    resolved: false
  });
  await env.TAFSIR_AUTH.put(key, JSON.stringify(reports));
  return jsonResponse2({
    ok: true,
    reports: reports.filter((r) => !r.resolved),
    totalReports: reports.filter((r) => !r.resolved).length
  });
}
async function handleResolveReport(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const { surah, verse, reportId } = await request.json();
  if (!surah || !verse || !reportId) {
    return jsonResponse2({ error: "Sourate, verset et ID du signalement requis." }, 400);
  }
  const key = `report:${surah}:${verse}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse2({ error: "Aucun signalement trouve." }, 404);
  const reports = JSON.parse(existing);
  const report = reports.find((r) => r.id === reportId);
  if (!report) return jsonResponse2({ error: "Signalement introuvable." }, 404);
  report.resolved = true;
  report.resolvedBy = user.name;
  report.resolvedDate = (/* @__PURE__ */ new Date()).toISOString();
  await env.TAFSIR_AUTH.put(key, JSON.stringify(reports));
  return jsonResponse2({
    ok: true,
    reports: reports.filter((r) => !r.resolved),
    totalReports: reports.filter((r) => !r.resolved).length
  });
}
async function handleGetSurahReports(request, env) {
  const user = await getSession(request, env);
  if (!user) return jsonResponse2({ error: "Non authentifie." }, 401);
  const url = new URL(request.url);
  const surahNumber = url.pathname.split("/").pop();
  const totalVerses = parseInt(url.searchParams.get("total") || "0");
  const verses = {};
  const fetchPromises = [];
  for (let i = 1; i <= totalVerses; i++) {
    fetchPromises.push(
      env.TAFSIR_AUTH.get(`report:${surahNumber}:${i}`).then((data) => {
        if (data) {
          const reports = JSON.parse(data);
          const active = reports.filter((r) => !r.resolved);
          if (active.length > 0) {
            verses[i] = active;
          }
        }
      })
    );
  }
  await Promise.all(fetchPromises);
  const totalReports = Object.values(verses).reduce((sum, arr) => sum + arr.length, 0);
  const versesWithErrors = Object.keys(verses).length;
  return jsonResponse2({
    surah: parseInt(surahNumber),
    verses,
    totalReports,
    versesWithErrors
  });
}

// ../worker/corrections.js
var APPROVALS_REQUIRED = 2;
function jsonResponse3(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function handleCreateCorrection(request, env) {
  const { error, session } = await requireRole(request, env, "admin", "correcteur");
  if (error) return error;
  const { surah, verse, originalText, correctedText, reason } = await request.json();
  if (!surah || !verse || !correctedText || !reason) {
    return jsonResponse3({ error: "Sourate, verset, texte corrige et motif requis." }, 400);
  }
  if (correctedText.trim() === (originalText || "").trim()) {
    return jsonResponse3({ error: "Le texte corrige est identique a l'original." }, 400);
  }
  const correction = {
    id: crypto.randomUUID(),
    surah,
    verse,
    originalText: (originalText || "").trim(),
    correctedText: correctedText.trim(),
    reason: reason.trim().slice(0, 1e3),
    authorId: session.userId,
    authorName: session.name,
    authorEmail: session.email,
    status: "pending",
    // pending, approved, rejected, applied
    approvals: [],
    rejections: [],
    created: (/* @__PURE__ */ new Date()).toISOString()
  };
  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  const corrections = existing ? JSON.parse(existing) : [];
  corrections.push(correction);
  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));
  await ensureSurahInIndex(surah, env);
  await updateCorrectionIndex(env);
  return jsonResponse3({ ok: true, correction: { id: correction.id, status: correction.status } }, 201);
}
async function handleReviewCorrection(request, env) {
  const { error, session } = await requireRole(request, env, "admin", "relecteur");
  if (error) return error;
  const { surah, correctionId, action } = await request.json();
  if (!surah || !correctionId || !["approve", "reject"].includes(action)) {
    return jsonResponse3({ error: "Sourate, ID de correction et action (approve/reject) requis." }, 400);
  }
  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse3({ error: "Aucune correction trouvee." }, 404);
  const corrections = JSON.parse(existing);
  const correction = corrections.find((c) => c.id === correctionId);
  if (!correction) return jsonResponse3({ error: "Correction introuvable." }, 404);
  if (correction.status !== "pending") {
    return jsonResponse3({ error: "Cette correction a deja ete traitee." }, 400);
  }
  if (correction.authorId === session.userId && session.role !== "admin") {
    return jsonResponse3({ error: "Vous ne pouvez pas valider votre propre correction." }, 403);
  }
  const alreadyReviewed = [...correction.approvals, ...correction.rejections].some((r) => r.userId === session.userId);
  if (alreadyReviewed) {
    return jsonResponse3({ error: "Vous avez deja donne votre avis sur cette correction." }, 409);
  }
  const review = {
    userId: session.userId,
    name: session.name,
    date: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (action === "approve") {
    correction.approvals.push(review);
    if (session.role === "admin") {
      correction.status = "applied";
      correction.approvedDate = (/* @__PURE__ */ new Date()).toISOString();
      correction.appliedBy = session.name;
      correction.appliedDate = (/* @__PURE__ */ new Date()).toISOString();
    } else if (correction.approvals.length >= APPROVALS_REQUIRED) {
      correction.status = "approved";
      correction.approvedDate = (/* @__PURE__ */ new Date()).toISOString();
    }
  } else {
    correction.rejections.push(review);
    correction.status = "rejected";
    correction.rejectedDate = (/* @__PURE__ */ new Date()).toISOString();
  }
  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));
  await updateCorrectionIndex(env);
  return jsonResponse3({
    ok: true,
    status: correction.status,
    approvals: correction.approvals.length,
    required: APPROVALS_REQUIRED
  });
}
async function handleApplyCorrection(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const { surah, correctionId } = await request.json();
  if (!surah || !correctionId) {
    return jsonResponse3({ error: "Sourate et ID de correction requis." }, 400);
  }
  const key = `corrections:${surah}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  if (!existing) return jsonResponse3({ error: "Aucune correction trouvee." }, 404);
  const corrections = JSON.parse(existing);
  const correction = corrections.find((c) => c.id === correctionId);
  if (!correction) return jsonResponse3({ error: "Correction introuvable." }, 404);
  if (correction.status !== "approved") {
    return jsonResponse3({ error: "Seules les corrections approuvees peuvent etre appliquees." }, 400);
  }
  correction.status = "applied";
  correction.appliedBy = session.name;
  correction.appliedDate = (/* @__PURE__ */ new Date()).toISOString();
  await env.TAFSIR_AUTH.put(key, JSON.stringify(corrections));
  await updateCorrectionIndex(env);
  return jsonResponse3({ ok: true, correction });
}
async function handleGetSurahCorrections(request, env) {
  const { error, session } = await requireRole(request, env, "admin", "relecteur", "correcteur");
  if (error) return error;
  const url = new URL(request.url);
  const surahNumber = url.pathname.split("/").pop();
  const statusFilter = url.searchParams.get("status");
  const key = `corrections:${surahNumber}`;
  const existing = await env.TAFSIR_AUTH.get(key);
  let corrections = existing ? JSON.parse(existing) : [];
  if (statusFilter) {
    corrections = corrections.filter((c) => c.status === statusFilter);
  }
  return jsonResponse3({
    surah: parseInt(surahNumber),
    corrections,
    total: corrections.length,
    approvalsRequired: APPROVALS_REQUIRED
  });
}
async function handleGetPendingCorrections(request, env) {
  const { error, session } = await requireRole(request, env, "admin", "relecteur", "correcteur");
  if (error) return error;
  const indexData = await env.TAFSIR_AUTH.get("corrections_index");
  const index = indexData ? JSON.parse(indexData) : { pending: 0, approved: 0, surahs: [] };
  const allCorrections = [];
  for (const surahNum of index.surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (data) {
      const corrections = JSON.parse(data);
      allCorrections.push(...corrections);
    }
  }
  allCorrections.sort((a, b) => new Date(b.created) - new Date(a.created));
  return jsonResponse3({
    corrections: allCorrections,
    total: allCorrections.length,
    approvalsRequired: APPROVALS_REQUIRED
  });
}
async function handleExportJson(request, env) {
  const { error, session } = await requireRole(request, env, "admin");
  if (error) return error;
  const indexData = await env.TAFSIR_AUTH.get("corrections_index");
  const index = indexData ? JSON.parse(indexData) : { surahs: [] };
  const appliedCorrections = [];
  for (const surahNum of index.surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (!data) continue;
    const corrections = JSON.parse(data);
    const applied = corrections.filter((c) => c.status === "applied");
    for (const c of applied) {
      appliedCorrections.push({ surah: String(c.surah), verse: String(c.verse), text: c.correctedText });
    }
  }
  return jsonResponse3({ corrections: appliedCorrections, count: appliedCorrections.length });
}
async function updateCorrectionIndex(env) {
  const indexData = await env.TAFSIR_AUTH.get("corrections_index");
  const currentIndex = indexData ? JSON.parse(indexData) : { surahs: [] };
  let pending = 0;
  let approved = 0;
  const surahs = new Set(currentIndex.surahs);
  for (const surahNum of surahs) {
    const data = await env.TAFSIR_AUTH.get(`corrections:${surahNum}`);
    if (data) {
      const corrections = JSON.parse(data);
      pending += corrections.filter((c) => c.status === "pending").length;
      approved += corrections.filter((c) => c.status === "approved").length;
    }
  }
  await env.TAFSIR_AUTH.put("corrections_index", JSON.stringify({
    pending,
    approved,
    surahs: [...surahs],
    lastUpdate: (/* @__PURE__ */ new Date()).toISOString()
  }));
}
async function ensureSurahInIndex(surah, env) {
  const indexData = await env.TAFSIR_AUTH.get("corrections_index");
  const index = indexData ? JSON.parse(indexData) : { pending: 0, approved: 0, surahs: [] };
  if (!index.surahs.includes(surah)) {
    index.surahs.push(surah);
    await env.TAFSIR_AUTH.put("corrections_index", JSON.stringify(index));
  }
}

// ../worker/tts.js
function jsonResponse4(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function getSession2(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const data = await env.TAFSIR_AUTH.get(`session:${match[1]}`);
  if (!data) return null;
  return JSON.parse(data);
}
async function handleTTS(request, env) {
  const user = await getSession2(request, env);
  if (!user) return jsonResponse4({ error: "Non authentifie." }, 401);
  const { text } = await request.json();
  if (!text || text.trim().length === 0) {
    return jsonResponse4({ error: "Texte requis." }, 400);
  }
  const trimmed = text.trim().slice(0, 2e3);
  try {
    const audio = await env.AI.run("@cf/myshell-ai/melotts", {
      prompt: trimmed,
      lang: "fr"
    });
    if (audio && audio.audio) {
      const binaryStr = atob(audio.audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }
    if (audio instanceof ReadableStream) {
      return new Response(audio, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (e) {
    return jsonResponse4({
      error: "TTS indisponible.",
      detail: e.message || "Erreur Workers AI",
      fallback: true
    }, 503);
  }
}

// ../worker/index.js
var index_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      if (pathname === "/api/auth/send-code" && request.method === "POST") {
        return handleSendCode(request, env);
      }
      if (pathname === "/api/auth/register" && request.method === "POST") {
        return handleRegister(request, env);
      }
      if (pathname === "/api/auth/login" && request.method === "POST") {
        return handleLogin(request, env);
      }
      if (pathname === "/api/auth/logout" && request.method === "POST") {
        return handleLogout(request, env);
      }
      if (pathname === "/api/auth/me" && request.method === "GET") {
        return handleMe(request, env);
      }
      if (pathname === "/api/users" && request.method === "GET") {
        return handleListUsers(request, env);
      }
      if (pathname === "/api/users/role" && request.method === "POST") {
        return handleChangeRole(request, env);
      }
      if (pathname === "/api/users" && request.method === "DELETE") {
        return handleDeleteUser(request, env);
      }
      if (pathname === "/api/users/reset-password" && request.method === "POST") {
        return handleResetPassword(request, env);
      }
      if (pathname === "/api/role-requests" && request.method === "POST") {
        return handleCreateRoleRequest(request, env);
      }
      if (pathname === "/api/role-requests/mine" && request.method === "GET") {
        return handleMyRoleRequest(request, env);
      }
      if (pathname === "/api/role-requests" && request.method === "GET") {
        return handleListRoleRequests(request, env);
      }
      if (pathname === "/api/role-requests/resolve" && request.method === "POST") {
        return handleResolveRoleRequest(request, env);
      }
      if (pathname === "/api/admin/export-json" && request.method === "GET") {
        return handleExportJson(request, env);
      }
      if (pathname === "/api/admin/bootstrap" && request.method === "POST") {
        return handleBootstrapAdmin(request, env);
      }
      if (pathname === "/api/votes/cast" && request.method === "POST") {
        return handleCastVote(request, env);
      }
      if (pathname === "/api/votes/cast" && request.method === "DELETE") {
        return handleRemoveVote(request, env);
      }
      if (pathname.startsWith("/api/votes/surah/") && request.method === "GET") {
        return handleGetSurahVotes(request, env);
      }
      if (pathname === "/api/votes/summary" && request.method === "GET") {
        return handleGetVotesSummary(request, env);
      }
      if (pathname === "/api/votes/init-surah" && request.method === "POST") {
        return handleInitSurah(request, env);
      }
      if (pathname === "/api/reports/create" && request.method === "POST") {
        return handleCreateReport(request, env);
      }
      if (pathname === "/api/reports/resolve" && request.method === "POST") {
        return handleResolveReport(request, env);
      }
      if (pathname.startsWith("/api/reports/surah/") && request.method === "GET") {
        return handleGetSurahReports(request, env);
      }
      if (pathname === "/api/corrections/create" && request.method === "POST") {
        return handleCreateCorrection(request, env);
      }
      if (pathname === "/api/corrections/review" && request.method === "POST") {
        return handleReviewCorrection(request, env);
      }
      if (pathname === "/api/corrections/apply" && request.method === "POST") {
        return handleApplyCorrection(request, env);
      }
      if (pathname.startsWith("/api/corrections/surah/") && request.method === "GET") {
        return handleGetSurahCorrections(request, env);
      }
      if (pathname === "/api/corrections/pending" && request.method === "GET") {
        return handleGetPendingCorrections(request, env);
      }
      if (pathname === "/api/tts" && request.method === "POST") {
        return handleTTS(request, env);
      }
      if (pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "Route API non trouvee", pathname, method: request.method }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Erreur interne du serveur: " + err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
export {
  index_default as default
};
