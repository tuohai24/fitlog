import { esc, icon, thumb, openSheet, closeSheet, toast, todayStr, fmtNum, dateLabel } from '../core.js';
import { api } from '../api.js';
import { muscleMap, muscleLabelList } from '../muscle-map.js';

/* ------------------------------------------------------------------ */
/* 讲解内容（页面与弹层共用）                                           */
/* ------------------------------------------------------------------ */
function gifBlock(ex, cls = 'gif-hero') {
  if (ex.hasGif && ex.gif) {
    return `<div class="${cls}">
      <img src="/media/gifs/${esc(ex.gif)}" alt="${esc(ex.zh)} 动图示范" loading="eager" decoding="async" />
      <span class="gif-badge">动图示范</span>
    </div>`;
  }
  return `<div class="${cls} gif-hero-empty">
    ${thumb(ex, 'thumb-xl')}
    <p class="muted">暂未收录动图，可参考下方动作分解</p>
  </div>`;
}

function section(title, iconName, body, note = '') {
  return `
    <section class="guide-section">
      <h3 class="guide-h">${icon(iconName)}<span>${title}</span></h3>
      ${note ? `<p class="muted" style="margin:-4px 0 10px">${note}</p>` : ''}
      ${body}
    </section>`;
}

function listBlock(items, cls = 'guide-list') {
  return `<ul class="${cls}">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

export function guideHTML(ex) {
  const g = ex.guide || {};
  const muscles = muscleLabelList(ex);
  const dose = g.dose || [];

  return `
    <div class="ex-title-row">
      <div style="min-width:0">
        <h1 class="display" style="font-size:30px">${esc(ex.zh)}</h1>
        <div class="muted" style="margin-top:4px">${esc(ex.en)}</div>
        <div class="ex-tags" style="margin-top:10px">
          ${ex.equipZh ? `<span class="tag tag-accent">${esc(ex.equipZh)}</span>` : ''}
          ${ex.targetZh ? `<span class="tag">${esc(ex.targetZh)}</span>` : ''}
          ${ex.catZh ? `<span class="tag">${esc(ex.catZh)}</span>` : ''}
          ${g.pattern ? `<span class="tag">${esc(g.pattern)}</span>` : ''}
        </div>
      </div>
    </div>

    ${g.summary ? `<p class="sub" style="margin-top:14px">${esc(g.summary)}</p>` : ''}

    ${section('主要刺激肌群', 'chart', `
      <div class="card" style="padding:16px">
        ${muscleMap(ex)}
        <div class="mm-labels">
          ${muscles.primary.length ? `<div><span class="muted">主要</span> ${muscles.primary.map(m => `<span class="tag tag-accent">${esc(m)}</span>`).join('')}</div>` : ''}
          ${muscles.secondary.length ? `<div><span class="muted">协同</span> ${muscles.secondary.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`)}

    ${(g.prepare || []).length ? section('准备姿势', 'check', listBlock(g.prepare)) : ''}
    ${(g.execute || []).length ? section('执行轨迹', 'play', listBlock(g.execute)) : ''}

    ${(g.breathing || g.tempo) ? section('呼吸与节奏', 'clock', `
      <div class="card" style="padding:6px 18px">
        ${g.breathing ? `<div class="kv-row"><span class="k">呼吸</span><span class="v">${esc(g.breathing)}</span></div>` : ''}
        ${g.tempo ? `<div class="kv-row"><span class="k">节奏</span><span class="v">${esc(g.tempo)}</span></div>` : ''}
      </div>`) : ''}

    ${(g.mistakes || []).length ? section('常见错误', 'x', `
      <ul class="guide-list mistakes">
        ${g.mistakes.map(t => `<li>${esc(t)}</li>`).join('')}
      </ul>`) : ''}

    ${(g.tips || []).length ? section('教练提示', 'sparkles', `
      <ul class="guide-list tips">${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`) : ''}

    ${dose.length ? section('组数 · 次数建议', 'chart', `
      <div class="card" style="padding:4px 18px">
        ${dose.map(d => `
          <div class="dose-row">
            <span class="dose-goal">${esc(d.goal)}</span>
            <span class="dose-main"><b>${esc(d.sets)}</b> × ${esc(d.reps)}</span>
            <span class="dose-rest">休息 ${esc(d.rest)}</span>
          </div>`).join('')}
      </div>`, '按当天的训练目标选择一组执行，重量以最后 1–2 次略吃力为准。') : ''}

    ${(ex.steps || []).length ? section('动作分解', 'note', `
      <ol class="step-list">
        ${ex.steps.map((s, i) => `<li><span class="step-n">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}
      </ol>`) : ''}

    ${(g.cautions || []).length ? `
      <div class="callout">
        ${icon('flame')}
        <div>${g.cautions.map(t => `<p>${esc(t)}</p>`).join('')}</div>
      </div>` : ''}

    <p class="muted" style="margin-top:18px">动作演示图 ${esc(ex.attribution || '© Gym visual')}，讲解内容由 FitLog 整理，仅作训练参考。</p>`;
}

/* ------------------------------------------------------------------ */
/* 详情页                                                              */
/* ------------------------------------------------------------------ */
export default async function exerciseDetailView({ el, params, nav }) {
  const id = params[0];
  let ex;
  let history;
  try {
    [ex, history] = await Promise.all([
      api.exercise(id),
      api.exerciseHistory(id, 5).catch(() => null),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('x')}<h3>动作不存在</h3><p>${esc(e.message)}</p>
      <button class="btn btn-secondary btn-sm" data-nav="/exercises">返回动作库</button></div>`;
    return;
  }
  document.title = `${ex.zh} · FitLog`;

  const best = history?.best;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin:2px 0 14px">
      <button class="icon-btn" data-nav="/exercises" aria-label="返回">${icon('arrowLeft')}</button>
      <span class="muted">动作库</span>
    </div>

    ${gifBlock(ex)}

    ${guideHTML(ex)}

    <section class="guide-section">
      <h3 class="guide-h">${icon('chart')}<span>我的记录</span></h3>
      <div class="grid-3">
        <div class="card stat-card" style="padding:14px"><div class="k">最大重量</div>
          <div class="v" style="font-size:20px">${best?.maxWeight || 0}<span class="unit">kg</span></div></div>
        <div class="card stat-card" style="padding:14px"><div class="k">最佳组容量</div>
          <div class="v" style="font-size:20px">${best?.maxVolume || 0}<span class="unit">kg</span></div></div>
        <div class="card stat-card" style="padding:14px"><div class="k">累计组数</div>
          <div class="v" style="font-size:20px">${best?.totalSets || 0}</div></div>
      </div>
      ${history?.items?.length ? `
        <div class="card" style="margin-top:10px;padding:4px 18px">
          ${history.items.map(it => `
            <button class="row" data-nav="/log/${it.workoutId}">
              <div class="row-main">
                <div class="row-title" style="font-size:14px">${esc(dateLabel(it.date))}</div>
                <div class="row-sub">${it.sets.filter(s => s.done).map(s => `${s.weight || '自重'}×${s.reps}`).join(' · ') || '未完成'}</div>
              </div>
              ${icon('chevronRight', 'chevron')}
            </button>`).join('')}
        </div>` : `<p class="muted" style="margin-top:10px">还没有练过这个动作。</p>`}
    </section>

    ${(ex.alternatives || []).length ? `
      <section class="guide-section">
        <h3 class="guide-h">${icon('dumbbell')}<span>同类动作</span></h3>
        <div class="card" style="padding:4px 18px">
          ${ex.alternatives.map(a => `
            <button class="row" data-nav="/exercises/${a.id}" style="align-items:center">
              ${thumb(a, 'thumb thumb-sm')}
              <div class="row-main">
                <div class="row-title" style="font-size:15px">${esc(a.zh)}</div>
                <div class="row-sub">${esc(a.targetZh || '')} · ${esc(a.equipZh || '')}</div>
              </div>
              ${icon('chevronRight', 'chevron')}
            </button>`).join('')}
        </div>
      </section>` : ''}

    <div class="btn-row" style="margin:26px 0 8px">
      <button class="btn btn-block btn-lg" id="log-this">${icon('plus')} 记录这个动作</button>
    </div>
  `;

  el.querySelector('#log-this')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      const w = await api.createWorkout({
        date: todayStr(),
        title: ex.zh,
        exercises: [{
          exerciseId: ex.id,
          sets: [{ weight: 0, reps: 10, done: false }, { weight: 0, reps: 10, done: false }, { weight: 0, reps: 10, done: false }],
        }],
      });
      nav(`/log/${w.id}`);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.innerHTML = `${icon('plus')} 记录这个动作`;
    }
  });
}

/* ------------------------------------------------------------------ */
/* 弹层版（训练记录页使用）                                             */
/* ------------------------------------------------------------------ */
export async function openExerciseGuideSheet(exerciseId, { onPick } = {}) {
  let ex;
  try { ex = await api.exercise(exerciseId); }
  catch (e) { toast(e.message); return null; }

  return openSheet({
    title: '动作讲解',
    full: true,
    content: `
      <div style="padding:0 20px 20px">
        ${gifBlock(ex)}
        ${guideHTML(ex)}
        ${onPick ? `<button class="btn btn-block btn-lg" id="pick-ex" style="margin-top:18px">加入本次训练</button>` : ''}
      </div>`,
    onMount(sheet) {
      sheet.querySelector('#pick-ex')?.addEventListener('click', () => {
        onPick(ex);
        closeSheet();
      });
    },
  });
}
