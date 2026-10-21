import { Router } from 'express';
import { db, nowISO, exerciseRow } from '../db.js';

const router = Router();

const todayStr = () => {
  const d = new Date();
  const tz = process.env.TZ_OFFSET ? Number(process.env.TZ_OFFSET) : -d.getTimezoneOffset();
  const local = new Date(d.getTime() + tz * 60000);
  return local.toISOString().slice(0, 10);
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readWorkout(id, userId) {
  const w = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(id, userId);
  if (!w) return null;
  const exRows = db.prepare(`
    SELECT we.*, e.en, e.zh, e.cat, e.cat_zh, e.equip, e.equip_zh, e.target, e.target_zh,
           e.muscle, e.muscle_zh, e.secondary, e.img, e.gif, e.steps
    FROM workout_exercises we LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE we.workout_id = ? ORDER BY we.position ASC, we.id ASC
  `).all(id);
  const setStmt = db.prepare('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position ASC, id ASC');

  let volume = 0, doneSets = 0, totalReps = 0;
  const exercises = exRows.map(we => {
    const sets = setStmt.all(we.id).map(s => ({
      id: s.id, weight: s.weight, reps: s.reps, done: !!s.done, kind: s.kind, note: s.note,
    }));
    for (const s of sets) {
      if (!s.done) continue;
      volume += s.weight * s.reps;
      doneSets++;
      totalReps += s.reps;
    }
    return {
      id: we.id,
      exerciseId: we.exercise_id,
      position: we.position,
      note: we.note,
      exercise: we.zh ? exerciseRow(we) : null,
      sets,
    };
  });

  return {
    id: w.id, date: w.date, title: w.title, notes: w.notes,
    planId: w.plan_id, planDay: w.plan_day,
    startedAt: w.started_at, finishedAt: w.finished_at,
    createdAt: w.created_at, updatedAt: w.updated_at,
    stats: { volume: Math.round(volume), doneSets, totalReps, exerciseCount: exercises.length },
    exercises,
  };
}

/* 列表 */
router.get('/', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const limit = Math.min(365, Math.max(1, Number(req.query.limit) || 60));
  const where = ['w.user_id = @uid'];
  const params = { limit, uid: req.user.id };
  if (from) { where.push('w.date >= @from'); params.from = from; }
  if (to) { where.push('w.date <= @to'); params.to = to; }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM workout_exercises we WHERE we.workout_id = w.id) AS exerciseCount,
      COALESCE((SELECT SUM(s.weight * s.reps) FROM sets s
        JOIN workout_exercises we ON we.id = s.workout_exercise_id
        WHERE we.workout_id = w.id AND s.done = 1), 0) AS volume,
      COALESCE((SELECT COUNT(*) FROM sets s
        JOIN workout_exercises we ON we.id = s.workout_exercise_id
        WHERE we.workout_id = w.id AND s.done = 1), 0) AS doneSets
    FROM workouts w ${whereSql}
    ORDER BY w.date DESC, w.id DESC
    LIMIT @limit
  `).all(params);

  const nameStmt = db.prepare(`
    SELECT COALESCE(e.zh, we.exercise_id) AS name, e.cat_zh AS cat
    FROM workout_exercises we LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE we.workout_id = ? ORDER BY we.position ASC LIMIT 6
  `);

  res.json(rows.map(r => ({
    id: r.id, date: r.date, title: r.title, notes: r.notes,
    planId: r.plan_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
    exerciseCount: r.exerciseCount,
    doneSets: r.doneSets,
    volume: Math.round(r.volume),
    exercises: nameStmt.all(r.id),
  })));
});

/* 今日训练 */
router.get('/today', (req, res) => {
  const date = String(req.query.date || todayStr());
  const row = db.prepare('SELECT id FROM workouts WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, req.user.id);
  res.json(row ? readWorkout(row.id, req.user.id) : null);
});

/* 详情 */
router.get('/:id', (req, res) => {
  const w = readWorkout(Number(req.params.id), req.user.id);
  if (!w) return res.status(404).json({ error: '训练不存在' });
  res.json(w);
});

/* 新建 */
router.post('/', (req, res) => {
  const body = req.body || {};
  const date = String(body.date || todayStr()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });

  const create = db.transaction(() => {
    const ts = nowISO();
    const info = db.prepare(`INSERT INTO workouts (user_id, date, title, notes, plan_id, plan_day, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.user.id, date, body.title || null, body.notes || null,
      body.planId || null, body.planDay ?? null,
      body.startedAt || ts, ts, ts,
    );
    const workoutId = Number(info.lastInsertRowid);
    insertExercises(workoutId, body.exercises);
    return workoutId;
  });

  const id = create();
  res.status(201).json(readWorkout(id, req.user.id));
});

/* 整份替换 */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM workouts WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: '训练不存在' });
  const body = req.body || {};

  db.transaction(() => {
    db.prepare(`UPDATE workouts SET date = ?, title = ?, notes = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .run(
        String(body.date || todayStr()).slice(0, 10),
        body.title ?? null,
        body.notes ?? null,
        body.finishedAt ?? null,
        nowISO(),
        id,
      );
    db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?').run(id);
    insertExercises(id, body.exercises);
  })();

  res.json(readWorkout(id, req.user.id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: '训练不存在' });
  res.json({ ok: true });
});

/* 从计划某天生成训练草稿 */
router.post('/from-plan', (req, res) => {
  const { planId, dayIndex } = req.body || {};
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(Number(planId), req.user.id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  let content;
  try { content = JSON.parse(plan.content); } catch { return res.status(400).json({ error: '计划数据损坏' }); }
  const day = (content.days || [])[Number(dayIndex) || 0];
  if (!day) return res.status(404).json({ error: '该计划没有这一天' });

  const exercises = (day.exercises || []).map(item => ({
    exerciseId: item.exerciseId,
    sets: Array.from({ length: Math.max(1, Number(item.sets) || 3) }, () => ({
      weight: 0, reps: Number(String(item.reps).split(/[-~]/)[0]) || 10, done: false,
    })),
    note: item.note || null,
  })).filter(e => e.exerciseId && db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(e.exerciseId));

  const ts = nowISO();
  const info = db.prepare(`INSERT INTO workouts (user_id, date, title, notes, plan_id, plan_day, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.user.id, String(req.body.date || todayStr()).slice(0, 10),
    day.name || plan.title, day.focus || null, plan.id, Number(dayIndex) || 0, ts, ts, ts,
  );
  const workoutId = Number(info.lastInsertRowid);
  insertExercises(workoutId, exercises);
  res.status(201).json(readWorkout(workoutId, req.user.id));
});

function insertExercises(workoutId, exercises) {
  const insWe = db.prepare('INSERT INTO workout_exercises (workout_id, exercise_id, position, note) VALUES (?, ?, ?, ?)');
  const insSet = db.prepare('INSERT INTO sets (workout_exercise_id, position, weight, reps, done, kind, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  (Array.isArray(exercises) ? exercises : []).forEach((ex, i) => {
    if (!ex || !ex.exerciseId) return;
    const weId = Number(insWe.run(workoutId, String(ex.exerciseId), i, ex.note || null).lastInsertRowid);
    (Array.isArray(ex.sets) ? ex.sets : []).forEach((s, j) => {
      insSet.run(
        weId, j,
        Math.max(0, num(s.weight)),
        Math.max(0, Math.round(num(s.reps))),
        s.done ? 1 : 0,
        ['normal', 'warmup', 'drop', 'failure'].includes(s.kind) ? s.kind : 'normal',
        s.note || null,
      );
    });
  });
}

export default router;
