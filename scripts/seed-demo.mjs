// 生成演示数据（仅用于本地预览/截图，生产环境请勿执行）
// 用法: node scripts/seed-demo.mjs [天数]
import { db, nowISO } from '../server/db.js';

const WEEKS = Number(process.argv[2]) || 8;

// 演示数据挂到哪个账号：默认第一个账号（或 ADMIN_USERNAME 指定的账号）
const ownerName = process.env.ADMIN_USERNAME || process.argv[3] || '';
const owner = (ownerName
  ? db.prepare('SELECT * FROM users WHERE username = ?').get(ownerName)
  : null) || db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
if (!owner) {
  console.error('[seed-demo] 还没有任何账号，先启动一次服务创建管理员');
  process.exit(1);
}
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function pick(zhLike, preferEquip) {
  let row = db.prepare(`SELECT id, zh FROM exercises WHERE zh = ? LIMIT 1`).get(zhLike);
  if (!row && preferEquip) {
    row = db.prepare(`SELECT id, zh FROM exercises WHERE zh LIKE ? AND equip = ? ORDER BY popularity DESC LIMIT 1`)
      .get(`%${zhLike}%`, preferEquip);
  }
  if (!row) row = db.prepare(`SELECT id, zh FROM exercises WHERE zh LIKE ? ORDER BY popularity DESC LIMIT 1`).get(`%${zhLike}%`);
  return row;
}

const TEMPLATES = [
  {
    title: '胸 + 三头', focus: '胸部',
    items: [
      ['杠铃卧推', 'barbell', 4, [60, 62.5, 65]], ['哑铃上斜卧推', 'dumbbell', 3, [22.5, 25, 27.5]],
      ['绳索夹胸', 'cable', 3, [15, 17.5, 20]], ['绳索下压', 'cable', 3, [20, 22.5, 25]],
    ],
  },
  {
    title: '背 + 二头', focus: '背部',
    items: [
      ['引体向上', 'body weight', 3, [0, 0, 0]], ['杠铃俯身划船', 'barbell', 4, [50, 55, 60]],
      ['绳索高位下拉（全幅度）', 'cable', 3, [45, 50, 55]], ['哑铃弯举', 'dumbbell', 3, [12.5, 15, 15]],
    ],
  },
  {
    title: '腿 + 核心', focus: '腿部',
    items: [
      ['杠铃深蹲', 'barbell', 4, [70, 75, 80]], ['杠铃罗马尼亚硬拉', 'barbell', 3, [60, 65, 70]],
      ['45° 腿举机', 'sled machine', 3, [100, 110, 120]], ['坐姿提踵', 'leverage machine', 3, [40, 45, 50]],
    ],
  },
  {
    title: '肩 + 手臂', focus: '肩部',
    items: [
      ['杠铃站姿宽握肩推', 'barbell', 4, [35, 37.5, 40]], ['哑铃侧平举', 'dumbbell', 3, [8, 9, 10]],
      ['哑铃俯身后束举', 'dumbbell', 3, [7.5, 8, 9]], ['杠铃弯举', 'barbell', 3, [25, 27.5, 30]],
    ],
  },
];

const insertWorkout = db.transaction((date, tpl, week) => {
  const ts = nowISO();
  const info = db.prepare(`INSERT INTO workouts (user_id, date, title, notes, started_at, finished_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(owner.id, date, tpl.title, null, ts, ts, ts, ts);
  const wid = Number(info.lastInsertRowid);

  let totalSets = 0;
  for (const [name, equip, setCount, baseWeights] of tpl.items) {
    const ex = pick(name, equip);
    if (!ex) { console.warn('未找到动作:', name); continue; }
    const weId = Number(db.prepare(`INSERT INTO workout_exercises (workout_id, exercise_id, position, note) VALUES (?, ?, ?, NULL)`)
      .run(wid, ex.id, tpl.items.findIndex(i => i[0] === name)).lastInsertRowid);

    for (let s = 0; s < setCount; s++) {
      const base = baseWeights[Math.min(s, baseWeights.length - 1)];
      const weight = base + week * 2.5 * (0.5 + s * 0.1);
      const reps = equip === 'body weight' ? 8 + s : Math.max(5, 12 - s * 2 - Math.floor(week / 3));
      db.prepare(`INSERT INTO sets (workout_exercise_id, position, weight, reps, done, kind, note)
        VALUES (?, ?, ?, ?, 1, 'normal', NULL)`)
        .run(weId, s, Math.round(weight * 2) / 2, reps);
      totalSets++;
    }
  }
  return totalSets;
});

let created = 0, sets = 0;
const today = new Date();
for (let w = WEEKS - 1; w >= 0; w--) {
  for (let d = 0; d < 4; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - (w * 7 + (6 - d * 2)));
    if (day > today) continue;
    const date = iso(day);
    if (db.prepare('SELECT 1 FROM workouts WHERE date = ?').get(date)) continue;
    sets += insertWorkout(date, TEMPLATES[(w * 4 + d) % TEMPLATES.length], w);
    created++;
  }
}
console.log(`[seed-demo] 生成 ${created} 次训练，${sets} 组记录`);

/* ---------------- 演示用每周计划（首页按周几显示当天内容） ---------------- */
const DEMO_PLAN = {
  title: '四分化增肌 · 每周四练',
  goal: '增肌',
  level: '中级',
  weeks: 8,
  summary: '推 / 拉 / 腿 / 肩臂四分化，每周四练。复合动作放前面做 4 组大重量，孤立动作放后面补量；每两周主项加 2.5kg，第四周减量一次。',
  days: [
    {
      weekday: 2, name: '上肢推', focus: '胸 / 肩 / 肱三头',
      exercises: [
        { id: '0025', sets: 4, reps: '6-8', rest: '120s', note: '肩胛后收，杠铃触胸后推起' },
        { id: '0603', sets: 3, reps: '8-10', rest: '90s', note: '肘部略前于身体，避免耸肩' },
        { id: '0155', sets: 3, reps: '12-15', rest: '60s', note: '顶峰收缩 1 秒' },
        { id: '0201', sets: 3, reps: '10-12', rest: '60s', note: '大臂固定，只动小臂' },
      ],
    },
    {
      weekday: 4, name: '下肢', focus: '股四头 / 臀 / 腘绳',
      exercises: [
        { id: '1461', sets: 4, reps: '6-8', rest: '150s', note: '蹲至大腿平行，膝盖沿脚尖方向' },
        { id: '1464', sets: 3, reps: '10-12', rest: '90s', note: '膝盖不锁死，控制离心' },
        { id: '0599', sets: 3, reps: '12-15', rest: '60s', note: '髋部贴紧垫面不要抬起' },
        { id: '0594', sets: 4, reps: '15-20', rest: '45s', note: '顶峰停 2 秒' },
      ],
    },
    {
      weekday: 6, name: '上肢拉', focus: '背 / 肱二头',
      exercises: [
        { id: '0032', sets: 3, reps: '5', rest: '180s', note: '杠铃贴腿，背部中立' },
        { id: '2330', sets: 4, reps: '8-10', rest: '90s', note: '先沉肩再下拉' },
        { id: '1350', sets: 3, reps: '10-12', rest: '90s', note: '肩胛先收再拉' },
        { id: '0294', sets: 3, reps: '12', rest: '60s', note: '肘部固定在体侧' },
      ],
    },
    {
      weekday: 7, name: '肩 + 手臂', focus: '肩 / 手臂 / 核心',
      exercises: [
        { id: '0334', sets: 3, reps: '12-15', rest: '60s', note: '小重量，肘微屈' },
        { id: '0031', sets: 3, reps: '10-12', rest: '60s', note: '离心 3 秒' },
        { id: '0201', sets: 3, reps: '12', rest: '60s', note: '控制离心' },
        { id: '2135', sets: 3, reps: '45s', rest: '60s', note: '腰椎中立，臀腹收紧' },
      ],
    },
  ],
};

function seedPlan() {
  if (db.prepare('SELECT 1 FROM plans WHERE user_id = ? LIMIT 1').get(owner.id)) {
    console.log('[seed-demo] 该账号已有计划，跳过');
    return;
  }
  const metaStmt = db.prepare('SELECT id, zh, target_zh, equip_zh FROM exercises WHERE id = ?');
  const days = DEMO_PLAN.days.map(d => ({
    name: d.name,
    focus: d.focus,
    weekday: d.weekday,
    exercises: d.exercises.map(it => {
      const meta = metaStmt.get(it.id);
      if (!meta) return null;
      return {
        exerciseId: meta.id, name: meta.zh,
        targetZh: meta.target_zh, equipZh: meta.equip_zh,
        sets: it.sets, reps: it.reps, rest: it.rest, note: it.note,
      };
    }).filter(Boolean),
  })).filter(d => d.exercises.length);

  db.prepare(`INSERT INTO plans (user_id, title, goal, level, days_per_week, weeks, summary, content, source, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?)`)
    .run(owner.id, DEMO_PLAN.title, DEMO_PLAN.goal, DEMO_PLAN.level, days.length, DEMO_PLAN.weeks,
      DEMO_PLAN.summary, JSON.stringify({ days }), nowISO());
  console.log(`[seed-demo] 已为 ${owner.username} 创建演示计划「${DEMO_PLAN.title}」（${days.length} 天）`);
}

seedPlan();
