import { Router } from 'express';
import { db, publicUser } from '../db.js';
import { hashPassword, validateCredentials } from '../password.js';
import { requireAdmin, createUser, findUserByUsername, deleteUser } from '../auth.js';

const router = Router();

/* 用户列表（管理员）：附带各自的训练数、计划数 */
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM workouts w WHERE w.user_id = u.id) AS workout_count,
      (SELECT COUNT(*) FROM plans p WHERE p.user_id = u.id) AS plan_count
    FROM users u ORDER BY u.id ASC
  `).all();
  res.json(rows.map(r => ({ ...publicUser(r), workoutCount: r.workout_count, planCount: r.plan_count })));
});

/* 新建用户 */
router.post('/', requireAdmin, (req, res) => {
  const { username, password, displayName, isAdmin } = req.body || {};
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  if (findUserByUsername(username)) return res.status(409).json({ error: '用户名已被使用' });

  const user = createUser({
    username: String(username).trim(),
    password: hashPassword(password),
    displayName: String(displayName || '').trim().slice(0, 24),
    isAdmin: !!isAdmin,
  });
  res.status(201).json(publicUser(user));
});

/* 重置他人密码 */
router.post('/:id/password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const password = String((req.body || {}).password || '');
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // 强制重新登录
  res.json({ ok: true });
});

/* 删除用户及其全部训练数据 */
router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除当前登录的账号' });
  const r = deleteUser(id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

export default router;
