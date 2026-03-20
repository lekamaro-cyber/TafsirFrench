import { getSession } from './lib/auth.js';

export function onRequest({ request, cookies, redirect, url }, next) {
  const isAdmin = url.pathname.startsWith('/admin');
  const isLoginPage = url.pathname === '/admin/login' || url.pathname === '/admin/login/';
  const isAuthApi = url.pathname.startsWith('/api/auth/');

  if (!isAdmin && !isAuthApi) return next();
  if (isLoginPage || isAuthApi) return next();

  const token = cookies.get('session')?.value;
  const session = getSession(token);

  if (!session) {
    return redirect('/admin/login');
  }

  return next();
}
