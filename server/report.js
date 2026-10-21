/**
 * 导出数据装配与各格式渲染
 * ------------------------------------------------------------------
 * 统一先从数据库取出一份「按用户隔离」的结构化数据，再按格式渲染：
 *   json / csv / xlsx / md / pdf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { db, safeJSON } from './db.js';
import { buildXlsx } from './xlsx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = process.env.PDF_FONT_PATH || path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf');

export const FORMATS = [
  { key: 'json', label: 'JSON', ext: 'json', desc: '完整结构化备份，可在其他工具中解析或再导入', mime: 'application/json; charset=utf-8' },
  { key: 'xlsx', label: 'Excel', ext: 'xlsx', desc: '多个工作表：训练记录、组明细、训练计划', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { key: 'pdf', label: 'PDF', ext: 'pdf', desc: '排版好的训练报告，适合打印或存档', mime: 'application/pdf' },
  { key: 'md', label: 'Markdown', ext: 'md', desc: '纯文本报告，方便放进笔记软件', mime: 'text/markdown; charset=utf-8' },
  { key: 'csv', label: 'CSV', ext: 'csv', desc: '逐组明细表格，通用性强（Excel 可直接打开）', mime: 'text/csv; charset=utf-8' },
];

/* ---------------- 数据装配 ---------------- */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

export function loadExportData(user, { from = null, to = null, scope = 'all' } = {}) {
  const userId = user.id;
  const where = ['w.user_id = @uid'];
  const params = { uid: userId };
  if (from) { where.push('w.date >= @from'); params.from = from; }
  if (to) { where.push('w.date <= @to'); params.to = to; }

  const rows = db.prepare(`
    SELECT w.* FROM workouts w
    WHERE ${where.join(' AND ')}
    ORDER BY w.date ASC, w.id ASC
  `).all(params);

  const exStmt = db.prepare(`
    SELECT we.id, we.exercise_id, we.note, we.position,
           e.zh, e.en, e.equip_zh, e.target_zh, e.cat_zh
    FROM workout_exercises we LEFT JOIN exercises e ON e.id = we.exercise_id
    WHERE we.workout_id = ? ORDER BY we.position ASC, we.id ASC
  `);
  const setStmt = db.prepare('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position ASC, id ASC');

  let totalSets = 0;
  let totalVolume = 0;
  let totalReps = 0;
  const exerciseIds = new Set();

  const workouts = rows.map(w => {
    let volume = 0;
    let doneSets = 0;
    let reps = 0;

    const exercises = exStmt.all(w.id).map(we => {
      const sets = setStmt.all(we.id).map((s, i) => ({
        index: i + 1,
        weight: num(s.weight),
        reps: num(s.reps),
        done: !!s.done,
        kind: s.kind || 'normal',
        note: s.note || '',
      }));
      for (const s of sets) {
        if (!s.done) continue;
        volume += s.weight * s.reps;
        doneSets += 1;
        reps += s.reps;
      }
      if (we.exercise_id) exerciseIds.add(we.exercise_id);
      return {
        exerciseId: we.exercise_id,
        name: we.zh || we.exercise_id,
        en: we.en || '',
        equipment: we.equip_zh || '',
        target: we.target_zh || '',
        category: we.cat_zh || '',
        note: we.note || '',
        sets,
      };
    });

    totalSets += doneSets;
    totalVolume += volume;
    totalReps += reps;

    return {
      id: w.id,
      date: w.date,
      title: w.title || '',
      notes: w.notes || '',
      startedAt: w.started_at,
      finishedAt: w.finished_at,
      durationMin: minutesBetween(w.started_at, w.finished_at),
      planId: w.plan_id,
      planDay: w.plan_day,
      stats: { volume: Math.round(volume), doneSets, reps, exerciseCount: exercises.length },
      exercises,
    };
  });

  const plans = scope === 'workouts' ? [] : db.prepare(`
    SELECT * FROM plans WHERE user_id = ? ORDER BY active DESC, created_at DESC
  `).all(userId).map(p => {
    const content = safeJSON(p.content, {});
    return {
      id: p.id,
      title: p.title,
      goal: p.goal,
      level: p.level,
      weeks: p.weeks,
      daysPerWeek: p.days_per_week,
      summary: p.summary,
      source: p.source,
      active: !!p.active,
      createdAt: p.created_at,
      days: Array.isArray(content.days) ? content.days : [],
    };
  });

  const dates = workouts.map(w => w.date).sort();
  return {
    app: 'FitLog',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { username: user.username, displayName: user.display_name || user.username },
    range: { from: from || dates[0] || null, to: to || dates[dates.length - 1] || null, scope },
    summary: {
      workouts: workouts.length,
      doneSets: totalSets,
      volume: Math.round(totalVolume),
      reps: totalReps,
      exerciseCount: exerciseIds.size,
      plans: plans.length,
      avgVolumePerWorkout: workouts.length ? Math.round(totalVolume / workouts.length) : 0,
    },
    workouts,
    plans,
  };
}

/* ---------------- 格式化助手 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const fmtNum = (n, digits = 0) => Number(n || 0).toLocaleString('zh-CN', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
export const weekdayOf = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEK[d.getDay()];
};
export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const kindLabel = (k) => ({ warmup: '热身', drop: '递减', failure: '力竭', normal: '正式' }[k] || '正式');

/** 动作的重量/次数摘要，如 60×8、62.5×8 */
function setsSummary(sets) {
  const done = sets.filter(s => s.done);
  const list = (done.length ? done : sets).map(s => `${+s.weight.toFixed(1)}×${s.reps}`);
  if (!list.length) return '—';
  const head = list.slice(0, 4).join(' / ');
  return list.length > 4 ? `${head} …（共 ${list.length} 组）` : head;
}

function exerciseVolume(sets) {
  return Math.round(sets.filter(s => s.done).reduce((a, s) => a + s.weight * s.reps, 0));
}

/* ---------------- JSON ---------------- */
export function toJSON(data) {
  return JSON.stringify(data, null, 2);
}

/* ---------------- CSV ---------------- */
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(data) {
  const header = ['日期', '星期', '训练', '动作', '目标肌群', '器械', '组序', '重量(kg)', '次数', '完成', '组类型', '组备注', '动作备注', '训练备注'];
  const lines = [header.join(',')];
  for (const w of data.workouts) {
    for (const ex of w.exercises) {
      if (!ex.sets.length) {
        lines.push([w.date, weekdayOf(w.date), w.title, ex.name, ex.target, ex.equipment, '', '', '', '', '', '', ex.note, w.notes].map(csvCell).join(','));
        continue;
      }
      ex.sets.forEach((s, i) => {
        lines.push([
          w.date, weekdayOf(w.date), w.title, ex.name, ex.target, ex.equipment,
          i + 1, s.weight, s.reps, s.done ? '是' : '否', kindLabel(s.kind), s.note, ex.note, w.notes,
        ].map(csvCell).join(','));
      });
    }
  }
  // BOM 让 Excel 正确识别 UTF-8 中文
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

/* ---------------- Markdown ---------------- */
export function toMarkdown(data) {
  const { user, range, summary, workouts, plans } = data;
  const out = [];
  out.push(`# 训练记录 · ${user.displayName}`);
  out.push('');
  out.push(`> 账号：\`${user.username}\`　统计区间：${range.from || '—'} ~ ${range.to || '—'}　导出时间：${fmtDateTime(data.exportedAt)}`);
  out.push('');
  out.push('## 概览');
  out.push('');
  out.push('| 指标 | 数值 |');
  out.push('| --- | --- |');
  out.push(`| 训练次数 | ${summary.workouts} 次 |`);
  out.push(`| 完成组数 | ${summary.doneSets} 组 |`);
  out.push(`| 总容量 | ${fmtNum(summary.volume)} kg |`);
  out.push(`| 总次数 | ${fmtNum(summary.reps)} 次 |`);
  out.push(`| 涉及动作 | ${summary.exerciseCount} 个 |`);
  if (summary.workouts) out.push(`| 平均每次容量 | ${fmtNum(summary.avgVolumePerWorkout)} kg |`);
  if (plans.length) out.push(`| 训练计划 | ${plans.length} 份 |`);
  out.push('');

  out.push('## 训练记录');
  out.push('');
  if (!workouts.length) out.push('_该区间内没有训练记录。_');
  for (const w of workouts) {
    const extra = [
      w.stats.doneSets ? `${w.stats.doneSets} 组` : null,
      w.stats.volume ? `${fmtNum(w.stats.volume)} kg` : null,
      w.durationMin ? `${w.durationMin} 分钟` : null,
    ].filter(Boolean).join(' · ');
    out.push(`### ${w.date}（${weekdayOf(w.date)}）${w.title ? ` · ${w.title}` : ''}`);
    out.push('');
    if (extra) out.push(`\`${extra}\``);
    if (w.notes) out.push(`\n> ${w.notes.replace(/\n/g, ' ')}`);
    out.push('');
    out.push('| 动作 | 目标肌群 | 组次 | 容量 |');
    out.push('| --- | --- | --- | --- |');
    for (const ex of w.exercises) {
      out.push(`| ${ex.name} | ${ex.target || '—'} | ${setsSummary(ex.sets)} | ${fmtNum(exerciseVolume(ex.sets))} kg |`);
    }
    out.push('');
  }

  if (plans.length) {
    out.push('## 训练计划');
    out.push('');
    for (const p of plans) {
      out.push(`### ${p.title}${p.active ? '（当前计划）' : ''}`);
      out.push('');
      out.push([p.goal, p.level, p.weeks ? `${p.weeks} 周` : null, p.daysPerWeek ? `每周 ${p.daysPerWeek} 练` : null].filter(Boolean).join(' · '));
      if (p.summary) { out.push(''); out.push(p.summary); }
      out.push('');
      for (const d of p.days) {
        const wd = d.weekday ? `（${WEEK[d.weekday % 7]}）` : '';
        out.push(`- **${d.name}**${wd}${d.focus ? ` — ${d.focus}` : ''}`);
        for (const ex of d.exercises || []) {
          out.push(`  - ${ex.name}　${ex.sets} 组 × ${ex.reps}　休息 ${ex.rest}${ex.note ? `　_${ex.note}_` : ''}`);
        }
      }
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push(`由 FitLog 于 ${fmtDateTime(data.exportedAt)} 生成。`);
  out.push('');
  return out.join('\n');
}

/* ---------------- Excel ---------------- */
export function toXlsx(data) {
  const { user, range, summary, workouts, plans } = data;

  const overview = [
    ['账号', user.username],
    ['昵称', user.displayName],
    ['统计区间', `${range.from || '—'} ~ ${range.to || '—'}`],
    ['导出时间', fmtDateTime(data.exportedAt)],
    ['训练次数', summary.workouts],
    ['完成组数', summary.doneSets],
    ['总容量(kg)', summary.volume],
    ['总次数', summary.reps],
    ['涉及动作数', summary.exerciseCount],
  ];

  const workoutRows = [['日期', '星期', '训练', '动作数', '完成组数', '容量(kg)', '总次数', '时长(分钟)', '备注']];
  for (const w of workouts) {
    workoutRows.push([
      w.date, weekdayOf(w.date), w.title || '', w.stats.exerciseCount, w.stats.doneSets,
      w.stats.volume, w.stats.reps, w.durationMin ?? '', w.notes || '',
    ]);
  }

  const setRows = [['日期', '训练', '动作', '目标肌群', '器械', '组', '重量(kg)', '次数', '完成', '类型', '备注']];
  for (const w of workouts) {
    for (const ex of w.exercises) {
      if (!ex.sets.length) {
        setRows.push([w.date, w.title || '', ex.name, ex.target, ex.equipment, '', '', '', '', '', ex.note]);
        continue;
      }
      ex.sets.forEach((s, i) => {
        setRows.push([
          w.date, w.title || '', ex.name, ex.target, ex.equipment, i + 1,
          s.weight, s.reps, s.done ? '是' : '否', kindLabel(s.kind), s.note || '',
        ]);
      });
    }
  }

  const planRows = [['计划', '状态', '目标', '水平', '周期(周)', '每周天数', '周几', '训练日', '重点', '动作', '组数', '次数', '休息', '要点']];
  for (const p of plans) {
    if (!p.days.length) {
      planRows.push([p.title, p.active ? '当前' : '', p.goal || '', p.level || '', p.weeks || '', p.daysPerWeek || '', '', '', '', '', '', '', '', '']);
      continue;
    }
    for (const d of p.days) {
      const wd = d.weekday ? WEEK[d.weekday % 7] : '';
      if (!(d.exercises || []).length) {
        planRows.push([p.title, p.active ? '当前' : '', p.goal || '', p.level || '', p.weeks || '', p.daysPerWeek || '', wd, d.name || '', d.focus || '', '', '', '', '', '']);
        continue;
      }
      for (const ex of d.exercises) {
        planRows.push([
          p.title, p.active ? '当前' : '', p.goal || '', p.level || '', p.weeks || '', p.daysPerWeek || '',
          wd, d.name || '', d.focus || '', ex.name, ex.sets, ex.reps, ex.rest, ex.note || '',
        ]);
      }
    }
  }

  return buildXlsx([
    { name: '概览', rows: overview, widths: [16, 32], freezeHeader: false },
    { name: '训练记录', rows: workoutRows, widths: [12, 8, 22, 8, 10, 12, 10, 12, 30] },
    { name: '组明细', rows: setRows, widths: [12, 20, 26, 14, 12, 6, 10, 8, 6, 8, 26] },
    ...(plans.length ? [{ name: '训练计划', rows: planRows, widths: [22, 8, 8, 8, 8, 10, 8, 18, 18, 24, 6, 10, 8, 30] }] : []),
  ], { title: `训练记录 · ${user.displayName}`, author: user.displayName });
}

/* ---------------- PDF ---------------- */
const INK = '#111111';
const INK_2 = '#5c5c60';
const INK_3 = '#8b8b90';
const LINE = '#e6e6e6';

export function toPDF(data) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FONT_PATH)) {
      const err = new Error('缺少中文 PDF 字体，请运行 npm run fetch:font 或设置 PDF_FONT_PATH');
      err.status = 500;
      return reject(err);
    }

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 62, left: 54, right: 54 },
      bufferPages: true,
      info: { Title: `训练记录 · ${data.user.displayName}`, Author: 'FitLog' },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('cn', FONT_PATH);
      doc.font('cn');

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;
      const bottom = doc.page.height - doc.page.margins.bottom;
      const { user, range, summary, workouts, plans } = data;

      const needSpace = (h) => {
        if (doc.y + h > bottom) doc.addPage();
      };

      /* 页眉 */
      doc.fillColor(INK_3).fontSize(8.5).text('FITLOG · 训练记录', left, doc.y, { characterSpacing: 1.2 });
      doc.moveDown(0.6);
      doc.fillColor(INK).fontSize(24).text(user.displayName, { lineGap: 2 });
      doc.fillColor(INK_2).fontSize(10)
        .text(`账号 ${user.username}　·　${range.from || '—'} 至 ${range.to || '—'}　·　导出于 ${fmtDateTime(data.exportedAt)}`);
      doc.moveDown(1.2);

      /* 概览四格 */
      const stats = [
        ['训练次数', `${summary.workouts}`, '次'],
        ['完成组数', `${summary.doneSets}`, '组'],
        ['总容量', fmtNum(summary.volume), 'kg'],
        ['总次数', fmtNum(summary.reps), '次'],
      ];
      const cellW = width / 4;
      const boxTop = doc.y;
      stats.forEach(([k, v, unit], i) => {
        const x = left + i * cellW;
        doc.fillColor(INK_3).fontSize(8.5).text(k, x, boxTop, { width: cellW - 8, lineBreak: false });
        doc.fillColor(INK).fontSize(19);
        doc.text(v, x, boxTop + 15, { width: cellW - 8, lineBreak: false });
        const w = doc.widthOfString(v);
        doc.fillColor(INK_3).fontSize(9).text(unit, x + w + 4, boxTop + 25, { lineBreak: false });
      });
      doc.y = boxTop + 44;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.moveDown(1.1);

      /* 训练记录 */
      doc.fillColor(INK).fontSize(13).text('训练记录', left, doc.y, { width });
      doc.moveDown(0.7);

      if (!workouts.length) {
        doc.fillColor(INK_3).fontSize(10).text('该区间内没有训练记录。');
      }

      const cols = [
        { key: 'name', w: width * 0.36 },
        { key: 'sets', w: width * 0.32 },
        { key: 'volume', w: width * 0.16, align: 'right' },
        { key: 'target', w: width * 0.16, align: 'right' },
      ];

      for (const w of workouts) {
        needSpace(90);
        doc.fillColor(INK).fontSize(11.5)
          .text(`${w.date}（${weekdayOf(w.date)}）${w.title ? `　${w.title}` : ''}`, left, doc.y);
        doc.fillColor(INK_3).fontSize(8.5)
          .text([
            w.stats.doneSets ? `${w.stats.doneSets} 组` : null,
            w.stats.volume ? `${fmtNum(w.stats.volume)} kg` : null,
            w.durationMin ? `${w.durationMin} 分钟` : null,
          ].filter(Boolean).join(' · '));
        doc.moveDown(0.35);

        // 表头
        let x = left;
        for (const c of cols) {
          doc.fillColor(INK_3).fontSize(8).text(
            { name: '动作', sets: '组次（重量 × 次数）', volume: '容量', target: '目标肌群' }[c.key],
            x, doc.y, { width: c.w - 6, align: c.align || 'left' },
          );
          x += c.w;
        }
        doc.moveDown(0.15);
        const lineY = doc.y + 1;
        doc.moveTo(left, lineY).lineTo(right, lineY).lineWidth(0.6).strokeColor(LINE).stroke();
        doc.moveDown(0.45);

        for (const ex of w.exercises) {
          needSpace(24);
          const rowY = doc.y;
          x = left;
          const cells = [
            { text: ex.name, w: cols[0].w },
            { text: setsSummary(ex.sets), w: cols[1].w },
            { text: `${fmtNum(exerciseVolume(ex.sets))} kg`, w: cols[2].w, align: 'right' },
            { text: ex.target || '—', w: cols[3].w, align: 'right' },
          ];
          let rowH = 12;
          for (const [i, cell] of cells.entries()) {
            doc.fillColor(i === 0 ? INK : INK_2).fontSize(9)
              .text(cell.text, x, rowY, { width: cell.w - 6, align: cell.align || 'left' });
            rowH = Math.max(rowH, doc.heightOfString(cell.text, { width: cell.w - 6, fontSize: 9 }));
            x += cell.w;
          }
          doc.y = rowY + rowH + 4;
          doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.4).strokeColor(LINE).stroke();
          doc.moveDown(0.25);
        }
        if (w.notes) {
          doc.fillColor(INK_3).fontSize(8.5).text(`备注：${w.notes}`, left, doc.y, { width });
        }
        doc.moveDown(0.7);
      }

      /* 训练计划 */
      if (plans.length) {
        needSpace(70);
        doc.fillColor(INK).fontSize(13).text('训练计划', left, doc.y, { width });
        doc.moveDown(0.7);

        for (const p of plans) {
          needSpace(60);
          doc.fillColor(INK).fontSize(11).text(`${p.title}${p.active ? '（当前）' : ''}`);
          doc.fillColor(INK_3).fontSize(8.5).text(
            [p.goal, p.level, p.weeks ? `${p.weeks} 周` : null, p.daysPerWeek ? `每周 ${p.daysPerWeek} 练` : null].filter(Boolean).join(' · '),
          );
          doc.moveDown(0.4);

          for (const d of p.days) {
            needSpace(34);
            doc.fillColor(INK_2).fontSize(9.5)
              .text(`${d.weekday ? `${WEEK[d.weekday % 7]}　` : ''}${d.name}${d.focus ? `　·　${d.focus}` : ''}`);
            const lines = (d.exercises || []).map(ex => `${ex.name}　${ex.sets}×${ex.reps}　${ex.rest}`);
            if (lines.length) {
              doc.fillColor(INK_3).fontSize(8.5).text(lines.join('　|　'), { width: width - 12, indent: 10 });
            }
            doc.moveDown(0.3);
          }
          doc.moveDown(0.8);
        }
      }

      /* 页脚：页码 */
      const range2 = doc.bufferedPageRange();
      for (let i = range2.start; i < range2.start + range2.count; i++) {
        doc.switchToPage(i);
        doc.fillColor(INK_3).fontSize(8)
          .text(`FitLog · ${user.displayName} · 第 ${i + 1} / ${range2.count} 页`,
            left, doc.page.height - 40, { width, align: 'center', lineBreak: false });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
