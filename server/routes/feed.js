import { Router } from 'express';
import { db, nowISO, exerciseRow } from '../db.js';

const router = Router();

const COMMENT_MAX = 500;
const MAX_LIMIT = 50;

const COMMENT_SELECT = `
  SELECT c.id, c.workout_id, c.user_id, c.content, c.created_at,
         u.username, u.display_name, u.is_admin
  FROM workout_comments c JOIN users u ON u.id = c.user_id
`;

function commentRow(c, viewer, ownerId = null) {
  const me = viewer || {};
  return {
    id: c.id,
    content: c.content,
    createdAt: c.created_at,
    workoutId: c.workout_id,
    author: {
      id: c.user_id,
      displayName: c.display_name || c.username,
      username: c.username,
      initial: (c.display_name || c.username || '?').charAt(0).toUpperCase(),
      isAdmin: !!c.is_admin,
    },
    canDelete: c.user_id === me.id || c.user_id === ownerId || !!me.is_admin,
  };
}

const commentStmtAll = db.prepare(`${COMMENT_SELECT} WHERE c.workout_id = ? ORDER BY c.id ASC LIMIT ?`);
const commentStmtLast = db.prepare(`${COMMENT_SELECT} WHERE c.workout_id = ? ORDER BY c.id DESC LIMIT ?`);
const commentStmtOne = db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`);

function canView(workout, userId) {
  return !!workout && (workout.shared === 1 || workout.user_id === userId);
}

function authorOf(r, viewerId) {
  return {
    id: r.user_id,
    displayName: r.display_name || r.username,
    username: r.username,
    initial: (r.display_name || r.username || '?').charAt(0).toUpperCase(),
    isAdmin: !!r.is_admin,
    isMe: r.user_id === viewerId,
  };
}

/**
 * 动态列表
 * GET /api/feed?limit=20&before=<workoutId>&scope=all|mine
 */
router.get('/', (req, res) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 20));
  const before = Number(req.query.before) || null;
  const scope = req.query.scope === 'mine' ? 'mine' : 'all';

  const where = ['w.shared = 1'];
  const params = { limit, viewer: req.user.id };
  if (scope === 'mine') {
    where.push('w.user_id = @uid');
    params.uid = req.user.id;
  }
  if (before) {
    where.push('w.id < @before');
    params.before = before;
  }

  const rows = db.prepare(`
    SELECT w.id, w.date, w.title, w.notes, w.finished_at, w.shared_at, w.updated_at, w.user_id,
           u.username, u.display_name, u.is_admin,
           (SELECT COUNT(*) FROM workout_exercises we WHERE we.workout_id = w.id) AS exerciseCount,
           COALESCE((SELECT SUM(s.weight * s.reps) FROM sets s
             JOIN workout_exercises we ON we.id = s.workout_exercise_id
             WHERE we.workout_id = w.id AND s.done = 1), 0) AS volume,
           COALESCE((SELECT COUNT(*) FROM sets s
             JOIN workout_exercises we ON we.id = s.workout_exercise_id
             WHERE we.workout_id = w.id AND s.done = 1), 0) AS doneSets,
           COALESCE((SELECT SUM(s.reps) FROM sets s
             JOIN workout_exercises we ON we.id = s.workout_exercise_id
             WHERE we.workout_id = w.id AND s.done = 1), 0) AS totalReps,
           (SELECT COUNT(*) FROM workout_comments c WHERE c.workout_id = w.id) AS commentCount
    FROM workouts w JOIN users u ON u.id = w.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(w.shared_at, w.updated_at) DESC, w.id DESC
    LIMIT @limit
  `).all(params);

  const exStmt = db.prepare(`
    SELECT COALESCE(e.zh, we.exercise_id) AS name, e.cat_zh AS cat,
           (SELECT COUNT(*) FROM sets s WHERE s.workout_exercise_id = we.id AND s.done = 1) AS doneSets
    FROM workout_exercises we LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE we.workout_id = ? ORDER BY we.position ASC LIMIT 5
  `);

  res.json(rows.map(r => ({
    id: r.id,
    date: r.date,
    title: r.title || '训练',
    notes: r.notes || '',
    finishedAt: r.finished_at,
    sharedAt: r.shared_at,
    author: authorOf(r, req.user.id),
    stats: {
      volume: Math.round(r.volume),
      doneSets: r.doneSets,
      exerciseCount: r.exerciseCount,
      totalReps: r.totalReps,
    },
    exercises: exStmt.all(r.id),
    commentCount: r.commentCount,
    lastComments: commentStmtLast.all(r.id, 2).reverse().map(c => commentRow(c, req.user, r.user_id)),
    isMine: r.user_id === req.user.id,
  })));
});

/** 动态详情：训练全文 + 留言 */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare(`
    SELECT w.*, u.username, u.display_name, u.is_admin
    FROM workouts w JOIN users u ON u.id = w.user_id WHERE w.id = ?
  `).get(id);
  if (!canView(w, req.user.id)) return res.status(404).json({ error: '动态不存在或未公开' });

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
      weight: s.weight, reps: s.reps, done: !!s.done, kind: s.kind,
    }));
    for (const s of sets) {
      if (!s.done) continue;
      volume += s.weight * s.reps;
      doneSets += 1;
      totalReps += s.reps;
    }
    return {
      exerciseId: we.exercise_id,
      note: we.note,
      exercise: we.zh ? exerciseRow(we) : null,
      name: we.zh || we.exercise_id,
      sets,
    };
  });

  res.json({
    id: w.id,
    date: w.date,
    title: w.title || '训练',
    notes: w.notes || '',
    finishedAt: w.finished_at,
    sharedAt: w.shared_at,
    shared: w.shared === 1,
    isMine: w.user_id === req.user.id,
    author: authorOf(w, req.user.id),
    stats: { volume: Math.round(volume), doneSets, totalReps, exerciseCount: exercises.length },
    exercises,
    comments: commentStmtAll.all(id, 300).map(c => commentRow(c, req.user, w.user_id)),
  });
});

/** 发表留言 */
router.post('/:id/comments', (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare('SELECT id, user_id, shared FROM workouts WHERE id = ?').get(id);
  if (!canView(w, req.user.id)) return res.status(404).json({ error: '动态不存在或未公开' });

  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '留言不能为空' });
  if (content.length > COMMENT_MAX) return res.status(400).json({ error: `留言最多 ${COMMENT_MAX} 个字` });

  const info = db.prepare(`INSERT INTO workout_comments (workout_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?)`).run(id, req.user.id, content, nowISO());
  const row = commentStmtOne.get(Number(info.lastInsertRowid));
  res.status(201).json(commentRow(row, req.user, w.user_id));
});

/** 删除留言：本人或管理员 */
router.delete('/comments/:cid', (req, res) => {
  const cid = Number(req.params.cid);
  const row = db.prepare(`
    SELECT c.*, w.user_id AS owner_id FROM workout_comments c
    JOIN workouts w ON w.id = c.workout_id WHERE c.id = ?
  `).get(cid);
  if (!row) return res.status(404).json({ error: '留言不存在' });
  const allowed = row.user_id === req.user.id || row.owner_id === req.user.id || req.user.is_admin;
  if (!allowed) {
    return res.status(403).json({ error: '只能删除自己的留言' });
  }
  db.prepare('DELETE FROM workout_comments WHERE id = ?').run(cid);
  res.json({ ok: true });
});

export default router;
