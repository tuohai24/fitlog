// 「训练动态 + 留言」演示数据（仅本地预览 / 截图用，生产环境请勿执行）
//
// 用法：
//   node scripts/seed-social-demo.mjs          # 生成 2 个演示账号 + 3 条已分享训练 + 若干留言
//   node scripts/seed-social-demo.mjs --clean  # 删掉这套演示数据（连带其训练、组、留言、会话）
//
// 也可以在代码里 import { seedSocialDemo, cleanSocialDemo } 使用（scripts/screenshots.mjs 就是这么做的）
import { db, nowISO } from '../server/db.js';
import { hashPassword } from '../server/password.js';

const DEMO_USERS = [
  { username: 'demo_lin', displayName: '林一舟', password: 'demo1234' },
  { username: 'demo_zhou', displayName: '周叙', password: 'demo1234' },
];

// 每条动态 = 一次已完成的训练；weights 是每组重量，reps 是每组次数
const DEMO_WORKOUTS = [
  {
    author: 'demo_lin',
    offsetDays: 1,
    title: '推日 · 胸肩三头',
    notes: '卧推状态不错，最后一组 80 还能推 5 个。下周试试 82.5。',
    items: [
      { id: '0025', weights: [60, 70, 75, 80], reps: [10, 8, 6, 5] },
      { id: '0577', weights: [40, 45, 45], reps: [12, 10, 10] },
      { id: '0662', weights: [0, 0, 0], reps: [20, 18, 15] },
    ],
    comments: [
      { by: 'demo_zhou', text: '卧推进步好快，肩胛后收的细节做得到位', minutesAgo: 300 },
      { by: 'admin', text: '80kg×5 这组很扎实，注意别耸肩', minutesAgo: 120 },
    ],
  },
  {
    author: 'demo_zhou',
    offsetDays: 2,
    title: '拉日 · 背二头',
    notes: '硬拉换成正反握，握力终于不是瓶颈了。',
    items: [
      { id: '0032', weights: [90, 100, 110], reps: [5, 5, 4] },
      { id: '0027', weights: [50, 55, 60], reps: [10, 8, 8] },
      { id: '1327', weights: [0, 0, 0], reps: [8, 7, 6] },
    ],
    comments: [
      { by: 'demo_lin', text: '110 拉 4 个，腰背别塌，拍个视频看看', minutesAgo: 900 },
    ],
  },
  {
    author: 'demo_lin',
    offsetDays: 3,
    title: '腿日 · 深蹲 + 后链',
    notes: '',
    items: [
      { id: '1461', weights: [80, 90, 95, 95], reps: [8, 6, 5, 5] },
      { id: '0085', weights: [60, 70, 70], reps: [10, 8, 8] },
      { id: '0489', weights: [0, 0, 0], reps: [15, 15, 12] },
    ],
    comments: [],
  },
];

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function demoUserIds() {
  const names = DEMO_USERS.map((u) => u.username);
  const rows = db
    .prepare(`SELECT id FROM users WHERE username IN (${names.map(() => '?').join(',')})`)
    .all(...names);
  return rows.map((r) => r.id);
}

function demoWorkoutIds() {
  const ids = demoUserIds();
  if (!ids.length) return [];
  return db
    .prepare(`SELECT id FROM workouts WHERE user_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids)
    .map((r) => r.id);
}

export function cleanSocialDemo() {
  const userIds = demoUserIds();
  if (!userIds.length) {
    console.log('[seed-social] 没有演示账号，无需清理');
    return { users: 0, workouts: 0, comments: 0 };
  }
  const workoutIds = demoWorkoutIds();
  const stats = db.transaction(() => {
    let comments = 0;
    for (const wid of workoutIds) {
      comments += db.prepare('DELETE FROM workout_comments WHERE workout_id = ?').run(wid).changes;
    }
    let workouts = 0;
    for (const wid of workoutIds) {
      // 手动删子表，避免依赖 foreign_keys 开关
      db.prepare(
        'DELETE FROM sets WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)',
      ).run(wid);
      db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?').run(wid);
      workouts += db.prepare('DELETE FROM workouts WHERE id = ?').run(wid).changes;
    }
    // 演示账号可能在别人（真实账号）的训练下留过言，一并清掉
    let extra = 0;
    for (const uid of userIds) {
      extra += db.prepare('DELETE FROM workout_comments WHERE user_id = ?').run(uid).changes;
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM settings WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM plans WHERE user_id = ?').run(uid);
    }
    let users = 0;
    for (const uid of userIds) users += db.prepare('DELETE FROM users WHERE id = ?').run(uid).changes;
    return { users, workouts, comments: comments + extra };
  })();

  console.log(
    `[seed-social] 已清理 ${stats.users} 个演示账号、${stats.workouts} 次训练、${stats.comments} 条留言`,
  );
  return stats;
}

export function seedSocialDemo() {
  cleanSocialDemo(); // 幂等：先清再生成，避免重复数据

  const now = new Date();
  const userIds = {};

  db.transaction(() => {
    for (const u of DEMO_USERS) {
      const info = db
        .prepare(`INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
          VALUES (?, ?, ?, 0, ?)`)
        .run(u.username, u.displayName, hashPassword(u.password), nowISO());
      userIds[u.username] = Number(info.lastInsertRowid);
    }

    // 真实管理员（第一个账号）用来在演示动态下发一条留言，体现跨账号互动
    const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
    if (admin) userIds.admin = admin.id;

    const metaStmt = db.prepare('SELECT id, zh FROM exercises WHERE id = ?');

    for (const w of DEMO_WORKOUTS) {
      const uid = userIds[w.author];
      const day = new Date(now);
      day.setDate(now.getDate() - w.offsetDays);
      const sharedAt = new Date(day);
      sharedAt.setHours(20, 30, 0, 0);
      const finishedAt = new Date(day);
      finishedAt.setHours(20, 10, 0, 0);
      const startedAt = new Date(day);
      startedAt.setHours(18, 50, 0, 0);

      const wid = Number(
        db
          .prepare(`INSERT INTO workouts
            (user_id, date, title, notes, started_at, finished_at, created_at, updated_at, shared, shared_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
          .run(
            uid,
            dateStr(day),
            w.title,
            w.notes || null,
            startedAt.toISOString(),
            finishedAt.toISOString(),
            startedAt.toISOString(),
            finishedAt.toISOString(),
            sharedAt.toISOString(),
          ).lastInsertRowid,
      );

      w.items.forEach((item, pos) => {
        if (!metaStmt.get(item.id)) return;
        const weId = Number(
          db
            .prepare('INSERT INTO workout_exercises (workout_id, exercise_id, position, note) VALUES (?, ?, ?, NULL)')
            .run(wid, item.id, pos).lastInsertRowid,
        );
        item.reps.forEach((reps, s) => {
          db.prepare(`INSERT INTO sets (workout_exercise_id, position, weight, reps, done, kind, note)
            VALUES (?, ?, ?, ?, 1, 'normal', NULL)`).run(weId, s, item.weights[s] ?? 0, reps);
        });
      });

      for (const c of w.comments || []) {
        const cuid = userIds[c.by];
        if (!cuid) continue;
        db.prepare('INSERT INTO workout_comments (workout_id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(
          wid,
          cuid,
          c.text,
          new Date(now.getTime() - c.minutesAgo * 60 * 1000).toISOString(),
        );
      }
    }
  })();

  const n = DEMO_WORKOUTS.length;
  console.log(`[seed-social] 已生成 ${DEMO_USERS.length} 个演示账号（密码 demo1234）、${n} 条公开训练及留言`);
}

const isCLI = process.argv[1] && /seed-social-demo\.mjs$/.test(process.argv[1]);
if (isCLI) {
  if (process.argv.includes('--clean')) cleanSocialDemo();
  else seedSocialDemo();
}
