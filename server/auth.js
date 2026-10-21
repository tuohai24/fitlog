import crypto from 'node:crypto';
import { db, nowISO } from './db.js';

const COOKIE_NAME = 'fl_session';
const SESSION_DAYS = 60;

/* ---------------- Cookie ---------------- */
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionTokenFrom(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

export function setSessionCookie(res, req, token, expiresAt) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------------- 会话 ---------------- */
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, nowISO(), exp.toISOString());
  return { token, exp };
}

export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* ---------------- 中间件 ---------------- */
export const requireAuth = (req, res, next) => {
  const user = userFromToken(sessionTokenFrom(req));
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = user;
  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
};

export function touchLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowISO(), userId);
}

/* ---------------- 注册策略 ----------------
 * - 还没有任何用户 → 允许注册（成为管理员）
 * - 已有用户且配置了 SIGNUP_CODE → 带邀请码可注册
 * - 其余情况 → 关闭注册，由管理员在「我的 → 用户管理」里创建
 */
export function signupPolicy() {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const code = String(process.env.SIGNUP_CODE || '').trim();
  if (users === 0) return { open: true, needsCode: false, isFirst: true };
  return { open: !!code, needsCode: !!code, isFirst: false };
}

export function createUser({ username, password, displayName, isAdmin = false }) {
  const info = db.prepare(`INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(username, displayName || username, password, isAdmin ? 1 : 0, nowISO());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

/** 删除用户及其全部数据（最后一个管理员不可删） */
export function deleteUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { ok: false, error: '用户不存在' };
  const admins = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
  if (user.is_admin && admins <= 1) return { ok: false, error: '至少保留一个管理员账号' };

  db.transaction(() => {
    const workoutIds = db.prepare('SELECT id FROM workouts WHERE user_id = ?').all(id).map(r => r.id);
    const delWe = db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?');
    for (const wid of workoutIds) delWe.run(wid);
    db.prepare('DELETE FROM workouts WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM plans WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  })();
  return { ok: true };
}
