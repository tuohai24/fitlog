import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

function localToday() {
  const d = new Date();
  const tz = process.env.TZ_OFFSET ? Number(process.env.TZ_OFFSET) : -d.getTimezoneOffset();
  return new Date(d.getTime() + tz * 60000).toISOString().slice(0, 10);
}
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* 概览：近 N 天与上一个同周期对比 */
router.get('/overview', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const today = localToday();
  const start = shiftDate(today, -(days - 1));
  const prevStart = shiftDate(start, -days);
  const prevEnd = shiftDate(start, -1);

  const agg = (a, b) => db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS workouts,
           COUNT(s.id) AS sets,
           COALESCE(SUM(s.weight * s.reps), 0) AS volume,
           COALESCE(SUM(s.reps), 0) AS reps
    FROM workouts w
    LEFT JOIN workout_exercises we ON we.workout_id = w.id
    LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.done = 1
    WHERE w.user_id = ? AND w.date BETWEEN ? AND ?
  `).get(req.user.id, a, b);

  const cur = agg(start, today);
  const prev = agg(prevStart, prevEnd);

  // 连续训练天数
  const dates = new Set(db.prepare('SELECT DISTINCT date FROM workouts WHERE user_id = ?').all(req.user.id).map(r => r.date));
  let streak = 0;
  let cursor = dates.has(today) ? today : shiftDate(today, -1);
  while (dates.has(cursor)) { streak++; cursor = shiftDate(cursor, -1); }

  const totals = db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS workouts,
           COALESCE(SUM(s.weight * s.reps), 0) AS volume,
           COUNT(s.id) AS sets
    FROM workouts w
    LEFT JOIN workout_exercises we ON we.workout_id = w.id
    LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.done = 1
    WHERE w.user_id = ?
  `).get(req.user.id);

  res.json({
    days, today, start,
    current: { ...cur, volume: Math.round(cur.volume) },
    previous: { ...prev, volume: Math.round(prev.volume) },
    streak,
    totals: { ...totals, volume: Math.round(totals.volume) },
  });
});

/* 每日训练量趋势 */
router.get('/daily', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const end = String(req.query.to || localToday());
  const start = shiftDate(end, -(days - 1));

  const rows = db.prepare(`
    SELECT w.date,
           COALESCE(SUM(s.weight * s.reps), 0) AS volume,
           COUNT(s.id) AS sets
    FROM workouts w
    LEFT JOIN workout_exercises we ON we.workout_id = w.id
    LEFT JOIN sets s ON s.workout_exercise_id = we.id AND s.done = 1
    WHERE w.user_id = ? AND w.date BETWEEN ? AND ?
    GROUP BY w.date
  `).all(req.user.id, start, end);

  const map = new Map(rows.map(r => [r.date, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDate(start, i);
    const r = map.get(date);
    series.push({ date, volume: Math.round(r ? r.volume : 0), sets: r ? r.sets : 0 });
  }
  res.json({ start, end, series });
});

/* 肌群分布 */
router.get('/muscles', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const start = shiftDate(localToday(), -(days - 1));
  const rows = db.prepare(`
    SELECT COALESCE(e.target_zh, e.cat_zh, '其他') AS label,
           COUNT(s.id) AS sets,
           COALESCE(SUM(s.weight * s.reps), 0) AS volume
    FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE s.done = 1 AND w.user_id = ? AND w.date >= ?
    GROUP BY label
    ORDER BY sets DESC
  `).all(req.user.id, start);
  res.json(rows.map(r => ({ ...r, volume: Math.round(r.volume) })));
});

/* 个人纪录 */
router.get('/prs', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
  const rows = db.prepare(`
    SELECT we.exercise_id AS id, e.zh AS name, e.cat_zh AS cat, s.weight, s.reps, w.date
    FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE s.done = 1 AND s.weight > 0 AND w.user_id = ?
  `).all(req.user.id);

  const best = new Map();
  for (const r of rows) {
    const e1rm = r.weight * (1 + r.reps / 30);
    const cur = best.get(r.id);
    if (!cur || e1rm > cur.e1rm) {
      best.set(r.id, { id: r.id, name: r.name, cat: r.cat, weight: r.weight, reps: r.reps, date: r.date, e1rm: Math.round(e1rm * 10) / 10 });
    }
  }
  const list = [...best.values()].sort((a, b) => b.e1rm - a.e1rm).slice(0, limit);
  res.json(list);
});

/* 单个动作的进步曲线 */
router.get('/exercise/:id', (req, res) => {
  const limit = Math.min(100, Math.max(2, Number(req.query.limit) || 20));
  const rows = db.prepare(`
    SELECT w.date, MAX(s.weight) AS maxWeight, COALESCE(SUM(s.weight * s.reps), 0) AS volume,
           COALESCE(SUM(s.reps), 0) AS reps
    FROM sets s
    JOIN workout_exercises we ON we.id = s.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    WHERE we.exercise_id = ? AND s.done = 1 AND w.user_id = ?
    GROUP BY w.id
    ORDER BY w.date DESC
    LIMIT ?
  `).all(req.params.id, req.user.id, limit);
  res.json(rows.reverse().map(r => ({ ...r, volume: Math.round(r.volume) })));
});

export default router;
