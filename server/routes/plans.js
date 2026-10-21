import { Router } from 'express';
import { db, nowISO } from '../db.js';
import { chat, deepseekConfig } from '../deepseek.js';

const router = Router();

const EQUIP_MAP = {
  '杠铃': ['barbell', 'olympic barbell', 'ez barbell', 'smith machine', 'trap bar'],
  '哑铃': ['dumbbell'],
  '固定器械': ['leverage machine', 'sled machine', 'assisted'],
  '绳索': ['cable', 'rope'],
  '自重': ['body weight', 'weighted'],
  '弹力带': ['band', 'resistance band'],
  '壶铃': ['kettlebell'],
  '瑞士球/药球': ['stability ball', 'bosu ball', 'medicine ball'],
};

/* 1 = 周一 … 7 = 周日 */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const DEFAULT_SLOTS = {
  1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 6],
  5: [1, 2, 3, 4, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7],
};

function localDate() {
  const d = new Date();
  const tz = process.env.TZ_OFFSET ? Number(process.env.TZ_OFFSET) : -d.getTimezoneOffset();
  return new Date(d.getTime() + tz * 60000).toISOString().slice(0, 10);
}

function isoWeekday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay() || 7;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* 校验并规范化训练日（动作 ID 必须存在于动作库） */
function sanitizeDays(days) {
  const metaStmt = db.prepare('SELECT id, zh, target_zh, equip_zh FROM exercises WHERE id = ?');
  const out = [];

  for (const d of Array.isArray(days) ? days : []) {
    const seen = new Set();
    const exercises = [];
    for (const it of Array.isArray(d.exercises) ? d.exercises : []) {
      const id = String(it.exerciseId || '').trim();
      if (!id || seen.has(id)) continue;
      const meta = metaStmt.get(id);
      if (!meta) continue;
      seen.add(id);
      exercises.push({
        exerciseId: id,
        name: meta.zh,
        targetZh: meta.target_zh || '',
        equipZh: meta.equip_zh || '',
        sets: clamp(Number(it.sets) || 3, 1, 12),
        reps: String(it.reps || '8-12').slice(0, 12),
        rest: String(it.rest || '90s').slice(0, 12),
        note: String(it.note || '').slice(0, 120),
      });
    }
    if (!exercises.length) continue;

    const wd = Number(d.weekday);
    out.push({
      name: String(d.name || '').trim().slice(0, 30) || `第 ${out.length + 1} 天`,
      focus: String(d.focus || '').trim().slice(0, 40),
      weekday: wd >= 1 && wd <= 7 ? wd : null,
      exercises,
    });
  }

  // 周几去重（同日期的保留第一个），没填的按默认分布补到空位
  const used = new Set();
  for (const day of out) {
    if (day.weekday && !used.has(day.weekday)) used.add(day.weekday);
    else day.weekday = null;
  }
  const slots = DEFAULT_SLOTS[out.length] || DEFAULT_SLOTS[7];
  let cursor = 0;
  for (const day of out) {
    if (day.weekday) continue;
    while (cursor < slots.length && used.has(slots[cursor])) cursor++;
    if (cursor < slots.length) { day.weekday = slots[cursor]; used.add(slots[cursor]); }
  }
  return out;
}

function rowToPlan(r, withContent = true) {
  const content = (() => { try { return JSON.parse(r.content); } catch { return {}; } })();
  const days = Array.isArray(content.days) ? content.days : [];
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    level: r.level,
    daysPerWeek: r.days_per_week,
    weeks: r.weeks,
    summary: r.summary,
    source: r.source,
    active: !!r.active,
    createdAt: r.created_at,
    weekdays: days.filter(d => d.weekday).map(d => d.weekday),
    ...(withContent ? { days } : {}),
  };
}

const readPlan = (id, userId) =>
  db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(Number(id), userId);

/* 列表 */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY active DESC, created_at DESC').all(req.user.id);
  res.json(rows.map(r => rowToPlan(r)));
});

/* 今天该练什么（按当前计划的周几安排） */
router.get('/today', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : localDate();
  const weekday = isoWeekday(date);
  const plan = db.prepare('SELECT * FROM plans WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  const workout = db.prepare('SELECT id, title, finished_at FROM workouts WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1').get(req.user.id, date);

  if (!plan) {
    return res.json({
      date, weekday, weekdayLabel: WEEKDAY_LABELS[weekday - 1],
      plan: null, dayIndex: null, day: null, workout: workout || null,
      next: null, week: [],
    });
  }

  const { days } = rowToPlan(plan);
  const dayIndex = days.findIndex(d => Number(d.weekday) === weekday);
  const day = dayIndex >= 0 ? days[dayIndex] : null;

  // 下一个训练日
  let next = null;
  if (days.length) {
    for (let step = 1; step <= 7; step++) {
      const wd = ((weekday - 1 + step) % 7) + 1;
      const idx = days.findIndex(d => Number(d.weekday) === wd);
      if (idx >= 0) {
        next = { weekday: wd, weekdayLabel: WEEKDAY_LABELS[wd - 1], dayIndex: idx, name: days[idx].name, focus: days[idx].focus, inDays: step };
        break;
      }
    }
  }

  const week = [1, 2, 3, 4, 5, 6, 7].map(wd => {
    const idx = days.findIndex(d => Number(d.weekday) === wd);
    return {
      weekday: wd,
      label: WEEKDAY_LABELS[wd - 1].replace('周', ''),
      isToday: wd === weekday,
      dayIndex: idx >= 0 ? idx : null,
      name: idx >= 0 ? days[idx].name : null,
      focus: idx >= 0 ? days[idx].focus : null,
    };
  });

  res.json({
    date, weekday, weekdayLabel: WEEKDAY_LABELS[weekday - 1],
    plan: { id: plan.id, title: plan.title, goal: plan.goal, daysPerWeek: plan.days_per_week, weeks: plan.weeks },
    dayIndex: dayIndex >= 0 ? dayIndex : null,
    day,
    workout: workout || null,
    next,
    week,
  });
});

/* 详情 */
router.get('/:id', (req, res) => {
  const r = readPlan(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: '计划不存在' });
  const today = localDate();
  const data = rowToPlan(r);
  data.todayWeekday = isoWeekday(today);
  data.todayIndex = data.days.findIndex(d => Number(d.weekday) === data.todayWeekday);
  res.json(data);
});

/* 手动创建 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '请填写计划标题' });
  const days = sanitizeDays(b.days);
  if (!days.length) return res.status(400).json({ error: '请至少添加一天训练内容' });

  const info = db.prepare(`INSERT INTO plans (user_id, title, goal, level, days_per_week, weeks, summary, content, source, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 0, ?)`).run(
    req.user.id, String(b.title).trim().slice(0, 40), b.goal || null, b.level || null,
    days.length, clamp(Number(b.weeks) || 8, 1, 52),
    String(b.summary || '').slice(0, 400) || null,
    JSON.stringify({ days }),
    nowISO(),
  );
  res.status(201).json(rowToPlan(readPlan(info.lastInsertRowid, req.user.id)));
});

/* 手动编辑 */
router.put('/:id', (req, res) => {
  const r = readPlan(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: '计划不存在' });
  const b = req.body || {};
  const days = sanitizeDays(b.days !== undefined ? b.days : rowToPlan(r).days);
  if (!days.length) return res.status(400).json({ error: '请至少添加一天训练内容' });

  db.prepare(`UPDATE plans SET title = ?, goal = ?, level = ?, days_per_week = ?, weeks = ?, summary = ?, content = ? WHERE id = ?`)
    .run(
      String(b.title || r.title).trim().slice(0, 40), b.goal ?? r.goal, b.level ?? r.level,
      days.length, clamp(Number(b.weeks) || r.weeks || 8, 1, 52),
      b.summary !== undefined ? (String(b.summary).slice(0, 400) || null) : r.summary,
      JSON.stringify({ days }), r.id,
    );
  res.json(rowToPlan(readPlan(r.id, req.user.id)));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM plans WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: '计划不存在' });
  // 删掉的正好是当前计划时，自动把该用户最近创建的计划设为当前，避免首页没有可用计划
  const hasActive = db.prepare('SELECT 1 FROM plans WHERE user_id = ? AND active = 1 LIMIT 1').get(req.user.id);
  if (!hasActive) {
    const fallback = db.prepare('SELECT id FROM plans WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(req.user.id);
    if (fallback) db.prepare('UPDATE plans SET active = 1 WHERE id = ?').run(fallback.id);
  }
  res.json({ ok: true });
});

router.post('/:id/activate', (req, res) => {
  const id = Number(req.params.id);
  if (!readPlan(id, req.user.id)) return res.status(404).json({ error: '计划不存在' });
  db.prepare('UPDATE plans SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?').run(id, req.user.id);
  res.json({ ok: true, plan: rowToPlan(readPlan(id, req.user.id)) });
});

/* 候选动作集：按器械过滤，压缩成极简行以减少 token */
function candidates(equipmentLabels, limit = 320) {
  const keys = [];
  for (const label of equipmentLabels || []) {
    if (EQUIP_MAP[label]) keys.push(...EQUIP_MAP[label]);
  }
  const useAll = keys.length === 0;
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, zh, equip_zh, target_zh, cat_zh FROM exercises
    ${useAll ? '' : `WHERE equip IN (${placeholders})`}
    ORDER BY popularity DESC, length(zh) ASC
    LIMIT ?
  `).all(...(useAll ? [] : keys), limit);
}

const SYSTEM_PROMPT = `你是一位持证体能教练（NSCA-CSCS），擅长为普通健身者制定可执行的力量训练计划。
你必须只输出合法 JSON，不要输出 Markdown、注释或多余文字。
所有动作必须从用户提供的动作库中选取，并使用给定的 exerciseId，不得编造 ID。`;

function buildUserPrompt({ goal, level, daysPerWeek, weeks, sessionMinutes, equipment, notes, cands }) {
  const lib = cands.map(c => `${c.id}|${c.zh}|${c.equip_zh}|${c.target_zh}`).join('\n');
  return `请为一位健身者设计训练计划。

【用户信息】
训练目标：${goal || '增肌'}
训练水平：${level || '初级'}
每周训练天数：${daysPerWeek || 4} 天
计划周期：${weeks || 8} 周
每次训练时长：${sessionMinutes || 60} 分钟
可用器械：${(equipment && equipment.length ? equipment : ['自重']).join('、')}
补充说明：${notes || '无'}

【动作库】（格式：ID|中文名|器械|目标肌群）
${lib}

【编排要求】
1. 每个训练日 4-7 个动作，先复合动作（深蹲/硬拉/卧推/划船/推举类），后孤立动作。
2. 组数与次数遵循目标：力量 3-5 组 × 3-6 次；增肌 3-4 组 × 8-12 次；减脂/耐力 2-3 组 × 12-15 次。
3. 同一肌群 48 小时内不重复高强度训练；每周覆盖胸、背、肩、腿、核心。
4. 只能使用上面动作库中的 ID，动作名称必须与库中中文名一致。
5. 每个动作给出 rest（组间休息，如 "90s"）和一句中文技术要点 note。

【输出 JSON 结构】
{
  "title": "计划名称，12 字以内",
  "summary": "3 句话说明周期安排与进阶思路",
  "goal": "增肌",
  "level": "初级",
  "weeks": 8,
  "daysPerWeek": 4,
  "days": [
    {
      "name": "Day 1 · 上肢推",
      "focus": "胸 / 肩 / 肱三头",
      "exercises": [
        {"exerciseId": "0025", "name": "杠铃卧推", "sets": 4, "reps": "6-8", "rest": "120s", "note": "肩胛后收，杠铃触胸后推起"}
      ]
    }
  ]
}`;
}

/* DeepSeek 生成计划 */
router.post('/generate', async (req, res, next) => {
  try {
    const { key } = deepseekConfig(req.user.id);
    if (!key) return res.status(400).json({ error: '尚未配置 DeepSeek API Key，请先在「我的」页面填写' });

    const b = req.body || {};
    const cands = candidates(b.equipment, 320);
    if (!cands.length) return res.status(400).json({ error: '动作库为空，请先初始化数据' });

    const content = await chat({
      userId: req.user.id,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ ...b, cands }) },
      ],
      temperature: Number(b.temperature) || 0.6,
      maxTokens: 8000,
    });

    let parsed;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return res.status(502).json({ error: 'AI 返回格式无法解析，请重试' });
      parsed = JSON.parse(m[0]);
    }

    const allEx = db.prepare('SELECT id, zh, target_zh, equip_zh FROM exercises').all();
    const byName = new Map(allEx.map(e => [e.zh, e]));
    const idSet = new Set(allEx.map(e => e.id));

    let dropped = 0;
    const rawDays = (Array.isArray(parsed.days) ? parsed.days : []).map((d, i) => ({
      name: d.name || `Day ${i + 1}`,
      focus: d.focus || '',
      exercises: (Array.isArray(d.exercises) ? d.exercises : []).map(it => {
        let id = String(it.exerciseId || '').trim();
        let name = it.name || '';
        if (!idSet.has(id)) {
          const hit = byName.get(name) || allEx.find(e => e.zh && name && (e.zh.includes(name) || name.includes(e.zh)));
          if (hit) { id = hit.id; name = hit.zh; } else { id = ''; }
        }
        if (!id) { dropped++; return null; }
        const meta = allEx.find(e => e.id === id);
        return {
          exerciseId: id,
          name: meta?.zh || name,
          targetZh: meta?.target_zh || '',
          equipZh: meta?.equip_zh || '',
          sets: clamp(Number(it.sets) || 3, 1, 12),
          reps: String(it.reps || '8-12').slice(0, 12),
          rest: String(it.rest || '90s').slice(0, 12),
          note: String(it.note || '').slice(0, 120),
        };
      }).filter(Boolean),
    })).filter(d => d.exercises.length > 0);

    const days = sanitizeDays(rawDays);
    if (!days.length) return res.status(502).json({ error: 'AI 生成的计划为空，请重试或调整条件' });

    const title = (parsed.title || `${b.goal || '增肌'}计划`).slice(0, 30);
    const info = db.prepare(`INSERT INTO plans (user_id, title, goal, level, days_per_week, weeks, summary, content, source, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deepseek', 0, ?)`).run(
      req.user.id, title, parsed.goal || b.goal || null, parsed.level || b.level || null,
      days.length, clamp(Number(parsed.weeks) || Number(b.weeks) || 8, 1, 52),
      parsed.summary || null,
      JSON.stringify({ days }),
      nowISO(),
    );
    res.status(201).json({
      ...rowToPlan(readPlan(info.lastInsertRowid, req.user.id)),
      dropped,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
