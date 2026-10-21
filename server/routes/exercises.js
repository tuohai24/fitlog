import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { db, exerciseRow } from '../db.js';
import { buildGuide } from '../exercise-guide.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GIF_DIR = path.join(__dirname, '..', '..', 'public', 'media', 'gifs');

/* 列表 / 搜索 */
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cat = String(req.query.cat || '').trim();
  const equip = String(req.query.equip || '').trim();
  const target = String(req.query.target || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 40));

  const where = [];
  const params = {};
  if (q) {
    where.push('(zh LIKE @like OR en LIKE @like OR kw LIKE @like OR target_zh LIKE @like OR muscle_zh LIKE @like OR equip_zh LIKE @like)');
    params.like = `%${q}%`;
  }
  if (cat) { where.push('cat = @cat'); params.cat = cat; }
  if (equip) { where.push('equip = @equip'); params.equip = equip; }
  if (target) { where.push('target = @target'); params.target = target; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM exercises ${whereSql}`).get(params).n;
  const rows = db.prepare(`
    SELECT * FROM exercises ${whereSql}
    ORDER BY ${q ? 'CASE WHEN zh = @q THEN 0 WHEN zh LIKE @prefix THEN 1 ELSE 2 END,' : ''}
      popularity DESC, (length(zh) > 8) ASC, length(zh) ASC, zh ASC
    LIMIT @limit OFFSET @offset
  `).all({
    ...params,
    q,
    prefix: `${q}%`,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  res.json({ total, page, pageSize, items: rows.map(exerciseRow) });
});

/* 筛选维度 */
router.get('/meta', (req, res) => {
  const cats = db.prepare(`
    SELECT cat AS key, cat_zh AS label, COUNT(*) AS count
    FROM exercises GROUP BY cat, cat_zh
    ORDER BY count DESC
  `).all();
  const equips = db.prepare(`
    SELECT equip AS key, equip_zh AS label, COUNT(*) AS count
    FROM exercises GROUP BY equip, equip_zh ORDER BY count DESC
  `).all();
  const targets = db.prepare(`
    SELECT target AS key, target_zh AS label, COUNT(*) AS count
    FROM exercises WHERE target <> '' GROUP BY target, target_zh ORDER BY count DESC
  `).all();
  res.json({ cats, equips, targets, total: db.prepare('SELECT COUNT(*) AS n FROM exercises').get().n });
});

/* 详情（含结构化讲解、动图可用性、同类动作） */
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM exercises WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '动作不存在' });

  const ex = exerciseRow(row);
  const hasGif = !!(row.gif && fs.existsSync(path.join(GIF_DIR, row.gif)));

  const alternatives = db.prepare(`
    SELECT * FROM exercises
    WHERE id <> @id AND (target = @target OR cat = @cat)
    ORDER BY CASE WHEN target = @target THEN 0 ELSE 1 END, popularity DESC, length(zh) ASC
    LIMIT 6
  `).all({ id: row.id, target: row.target || '', cat: row.cat || '' });

  res.json({
    ...ex,
    hasGif,
    attribution: row.attribution || '© Gym visual',
    guide: buildGuide(ex),
    alternatives: alternatives.map(exerciseRow),
  });
});

/* 该动作的历史记录（最近 N 次） */
router.get('/:id/history', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
  const rows = db.prepare(`
    SELECT w.id AS workoutId, w.date, w.title, we.id AS weId, we.note
    FROM workout_exercises we
    JOIN workouts w ON w.id = we.workout_id
    WHERE we.exercise_id = ? AND w.user_id = ?
    ORDER BY w.date DESC, w.id DESC
    LIMIT ?
  `).all(req.params.id, req.user.id, limit);

  const setStmt = db.prepare('SELECT weight, reps, done, kind FROM sets WHERE workout_exercise_id = ? ORDER BY position ASC');
  const items = rows.map(r => ({
    workoutId: r.workoutId,
    date: r.date,
    title: r.title,
    note: r.note,
    sets: setStmt.all(r.weId),
  }));
  const best = db.prepare(`
    SELECT MAX(s.weight) AS maxWeight, MAX(s.weight * s.reps) AS maxVolume, COUNT(*) AS totalSets
    FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    WHERE we.exercise_id = ? AND s.done = 1 AND w.user_id = ?
  `).get(req.params.id, req.user.id);
  res.json({ items, best });
});

export default router;
