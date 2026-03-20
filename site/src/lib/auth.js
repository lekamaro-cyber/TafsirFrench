import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const USERS_PATH = join(process.cwd(), '..', 'data', 'users.json');
const SESSIONS = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadUsers() {
  if (!existsSync(USERS_PATH)) return [];
  return JSON.parse(readFileSync(USERS_PATH, 'utf-8'));
}

function saveUsers(users) {
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const buf = Buffer.from(hash, 'hex');
  const attempt = scryptSync(password, salt, 64);
  return timingSafeEqual(buf, attempt);
}

export function register(email, password, name) {
  const users = loadUsers();
  if (users.find((u) => u.email === email)) {
    return { error: 'Cet email est deja utilise.' };
  }
  const user = {
    id: randomBytes(8).toString('hex'),
    email,
    name,
    password: hashPassword(password),
    created: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return { user: { id: user.id, email: user.email, name: user.name } };
}

export function login(email, password) {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user || !verifyPassword(password, user.password)) {
    return { error: 'Email ou mot de passe incorrect.' };
  }
  const token = randomBytes(32).toString('hex');
  SESSIONS.set(token, { userId: user.id, email: user.email, name: user.name, expires: Date.now() + SESSION_TTL });
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}

export function logout(token) {
  SESSIONS.delete(token);
}

export function getSession(token) {
  if (!token) return null;
  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    SESSIONS.delete(token);
    return null;
  }
  return session;
}
