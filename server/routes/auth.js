import { Router } from 'express';
import { db, publicUser, nowISO } from '../db.js';
import { hashPassword, verifyPassword, validateCredentials } from '../password.js';
import {
  createSession, destroySession, parseCookies, sessionTokenFrom, setSessionCookie, clearSessionCookie,
  userFromToken, touchLogin, signupPolicy, createUser, findUserByUsername, requireAuth,
} from '../auth.js';

const router = Router();

/* 登录失败限流 */
const failures = new Map();
function tooManyFailures(ip) {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 10 * 60 * 1000) { failures.delete(ip); return false; }
  return rec.count >= 10;
}
function noteFailure(ip) {
  const rec = failures.get(ip);
  if (!rec || Date.now() - rec.first > 10 * 60 * 1000) failures.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

/* 当前状态：是否已登录、系统里有没有账号、能否注册 */
router.get('/status', (req, res) => {
  const user = userFromToken(sessionTokenFrom(req));
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  res.json({
    authed: !!user,
    user: user ? publicUser(user) : null,
    hasUsers,
    signup: signupPolicy(),
  });
});

router.get('/me', (req, res) => {
  const user = userFromToken(sessionTokenFrom(req));
  res.json({ authed: !!user, user: user ? publicUser(user) : null });
});

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (tooManyFailures(ip)) return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });

  const { username, password } = req.body || {};
  const user = findUserByUsername(String(username || 'admin'));
  const ok = user && verifyPassword(user.password_hash, password);
  if (!ok) {
    noteFailure(ip);
    return res.status(401).json({ error: user ? '密码不正确' : '用户名不存在' });
  }

  failures.delete(ip);
  touchLogin(user.id);
  const { token, exp } = createSession(user.id);
  setSessionCookie(res, req, token, exp);
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/register', (req, res) => {
  const policy = signupPolicy();
  if (!policy.open) return res.status(403).json({ error: '管理员未开放注册，请让管理员在「我的 → 用户管理」中创建账号' });

  const { username, password, displayName, code } = req.body || {};
  if (policy.needsCode && String(code || '').trim() !== String(process.env.SIGNUP_CODE || '').trim()) {
    return res.status(403).json({ error: '邀请码不正确' });
  }
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  if (findUserByUsername(username)) return res.status(409).json({ error: '用户名已被使用' });

  const user = createUser({
    username: String(username).trim(),
    password: hashPassword(password),
    displayName: String(displayName || '').trim().slice(0, 24),
    isAdmin: policy.isFirst, // 第一个账号自动成为管理员
  });
  touchLogin(user.id);
  const { token, exp } = createSession(user.id);
  setSessionCookie(res, req, token, exp);
  res.status(201).json({ ok: true, user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(sessionTokenFrom(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* 修改自己的密码：验证旧密码，其他设备的会话全部失效 */
router.post('/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!verifyPassword(req.user.password_hash, oldPassword)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (String(newPassword || '').length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  if (String(newPassword).length > 128) return res.status(400).json({ error: '密码过长' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  const token = sessionTokenFrom(req);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, token);
  res.json({ ok: true });
});

/* 修改昵称 */
router.patch('/profile', requireAuth, (req, res) => {
  const name = String((req.body || {}).displayName || '').trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: '昵称不能为空' });
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: publicUser(user) });
});

export default router;
