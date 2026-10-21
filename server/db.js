import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from './password.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'fitlog.db');

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  cat TEXT, cat_zh TEXT, body TEXT,
  equip TEXT, equip_zh TEXT,
  target TEXT, target_zh TEXT,
  muscle TEXT, muscle_zh TEXT,
  secondary TEXT,
  img TEXT, gif TEXT,
  steps TEXT,
  kw TEXT,
  popularity INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  plan_id INTEGER,
  plan_day INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date DESC);

CREATE TABLE IF NOT EXISTS workout_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_workout ON workout_comments(workout_id, id);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_we_workout ON workout_exercises(workout_id);
CREATE INDEX IF NOT EXISTS idx_we_exercise ON workout_exercises(exercise_id);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'normal',
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_we ON sets(workout_exercise_id);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  goal TEXT, level TEXT,
  days_per_week INTEGER, weeks INTEGER,
  summary TEXT,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
`);

/* ---------------- 多用户迁移 ---------------- */
const hasColumn = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
const tableExists = (name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// 1) 会话绑定用户：老会话没有归属信息，直接失效（重新登录即可）
if (!hasColumn('sessions', 'user_id')) {
  db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER');
  db.exec('DELETE FROM sessions');
}

// 2) 训练 / 计划归属用户
if (!hasColumn('workouts', 'user_id')) db.exec('ALTER TABLE workouts ADD COLUMN user_id INTEGER');
if (!hasColumn('plans', 'user_id')) db.exec('ALTER TABLE plans ADD COLUMN user_id INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, date DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, active)');

// 2.1) 训练动态：shared=1 表示这次训练公开给其他账号看
if (!hasColumn('workouts', 'shared')) db.exec('ALTER TABLE workouts ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('workouts', 'shared_at')) db.exec('ALTER TABLE workouts ADD COLUMN shared_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_workouts_shared ON workouts(shared, shared_at DESC)');
// 留言表（老库补建）
db.exec(`
CREATE TABLE IF NOT EXISTS workout_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_workout ON workout_comments(workout_id, id);
`);

// 3) 设置改为按用户隔离：(user_id, key) 复合主键
let legacySettings = false;
if (tableExists('settings') && !hasColumn('settings', 'user_id')) {
  db.exec('ALTER TABLE settings RENAME TO settings_legacy');
  legacySettings = true;
}
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
)`);

// 4) 首次启动创建管理员账号（密码沿用 APP_PASSWORD，保持老部署可直接登录）
function ensureFirstUser() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();

  const username = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const password = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || 'fitlog';
  db.prepare(`INSERT INTO users (username, display_name, password_hash, is_admin, created_at)
    VALUES (?, ?, ?, 1, ?)`).run(username, '管理员', hashPassword(password), new Date().toISOString());
  console.log(`[db] 已创建管理员账号：${username}（密码来自 ${process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : process.env.APP_PASSWORD ? 'APP_PASSWORD' : '默认值 fitlog'}）`);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

const owner = ensureFirstUser();

// 5) 老数据归属到第一个用户
db.prepare('UPDATE workouts SET user_id = ? WHERE user_id IS NULL').run(owner.id);
db.prepare('UPDATE plans SET user_id = ? WHERE user_id IS NULL').run(owner.id);

if (legacySettings) {
  const rows = db.prepare('SELECT key, value FROM settings_legacy').all();
  const ins = db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)');
  for (const r of rows) ins.run(owner.id, r.key, r.value);
  db.exec('DROP TABLE settings_legacy');
  if (rows.length) console.log(`[db] 已把 ${rows.length} 条旧设置迁移给 ${owner.username}`);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');

/* ---------------- 动作库导入 ---------------- */
const exerciseFile = process.env.EXERCISE_FILE || path.join(process.cwd(), 'data', 'exercises.json');

function seedExercises() {
  const force = process.env.RESEED_EXERCISES === '1';
  const count = db.prepare('SELECT COUNT(*) AS n FROM exercises').get().n;
  if (!fs.existsSync(exerciseFile)) return;
  if (count > 0 && !force) return;
  if (force && count > 0) db.prepare('DELETE FROM exercises').run();
  const list = JSON.parse(fs.readFileSync(exerciseFile, 'utf8'));
  const insert = db.prepare(`INSERT OR REPLACE INTO exercises
    (id,en,zh,cat,cat_zh,body,equip,equip_zh,target,target_zh,muscle,muscle_zh,secondary,img,gif,steps,kw,popularity)
    VALUES (@id,@en,@zh,@cat,@catZh,@body,@equip,@equipZh,@target,@targetZh,@muscle,@muscleZh,@secondary,@img,@gif,@steps,@kw,@pop)`);

  // 核心动作优先展示（人工校对过的经典动作名）
  const CORE = [
    '杠铃卧推', '杠铃深蹲', '杠铃硬拉', '杠铃俯身划船', '引体向上', '绳索高位下拉（全幅度）',
    '坐姿划船', '器械肩推', '坐姿腿屈伸', '坐姿腿弯举', '坐姿提踵', '负重平板支撑', '杠铃臀桥',
    '双杠臂屈伸', '哑铃弯举', '绳索下压', '绳索夹胸', '哑铃飞鸟', '45° 腿举机', '杠铃直立划船',
    '杠铃耸肩', '杠铃罗马尼亚硬拉', '史密斯深蹲', '哑铃侧平举', '哑铃上斜卧推', '杠铃上斜卧推',
    '哑铃锤式弯举', '哑铃俯身后束举', '绳索交叉', '反向划船', '悬垂举腿', '俄罗斯转体',
    '杠铃弯举', '杠铃站姿提踵', '杠铃站姿宽握肩推', '哑铃坐姿肩推（对握）', '壶铃摆荡',
    '俯卧撑', '卷腹', '波比跳', '坐姿绳索划船', '器械腿屈伸', '杠铃前蹲', '哑铃弓步',
  ];
  const famous = ['卧推', '深蹲', '硬拉', '引体向上', '划船', '推举', '弯举', '侧平举', '腿举', '下拉', '俯卧撑', '弓步', '提踵', '卷腹', '臂屈伸', '飞鸟', '耸肩', '臀桥', '上拉'];

  db.transaction(() => {
    for (const x of list) {
      const coreIdx = CORE.indexOf(x.zh);
      const pop = coreIdx >= 0
        ? 1000 - coreIdx
        : famous.reduce((acc, k) => acc + (x.zh.includes(k) ? 1 : 0), 0) * 10 + (x.equip === 'body weight' ? 1 : 0);
      insert.run({
        id: x.id, en: x.en, zh: x.zh, cat: x.cat, catZh: x.catZh, body: x.body,
        equip: x.equip, equipZh: x.equipZh, target: x.target, targetZh: x.targetZh,
        muscle: x.muscle, muscleZh: x.muscleZh,
        secondary: JSON.stringify(x.secondary || []),
        img: x.img, gif: x.gif,
        steps: JSON.stringify(x.steps || []),
        kw: x.kw || `${x.zh} ${x.en}`,
        pop,
      });
    }
  })();
  console.log(`[db] 已导入 ${list.length} 个动作`);
}

seedExercises();

/* ---------------- 小工具 ---------------- */
export const nowISO = () => new Date().toISOString();

/* 设置按用户隔离：getSetting(userId, key, fallback) */
export function getSetting(userId, key, fallback = null) {
  if (!userId) return fallback;
  const row = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? row.value : fallback;
}

export function setSetting(userId, key, value) {
  if (!userId) return;
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key);
  } else {
    db.prepare(`INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`).run(userId, key, String(value));
  }
}

/* 用户对外字段（不含密码哈希） */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export function exerciseRow(x) {
  if (!x) return null;
  return {
    id: x.id, en: x.en, zh: x.zh,
    cat: x.cat, catZh: x.cat_zh, body: x.body,
    equip: x.equip, equipZh: x.equip_zh,
    target: x.target, targetZh: x.target_zh,
    muscle: x.muscle, muscleZh: x.muscle_zh,
    secondary: safeJSON(x.secondary, []),
    img: x.img, gif: x.gif,
    steps: safeJSON(x.steps, []),
  };
}

export function safeJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
