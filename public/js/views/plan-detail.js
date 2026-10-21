import { esc, icon, toast, confirmSheet, dateLabel } from '../core.js';
import { api } from '../api.js';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default async function planDetailView({ el, params, nav }) {
  const id = Number(params[0]);
  let plan;
  try {
    plan = await api.plan(id);
  } catch (e) {
    el.innerHTML = `<div class="empty">${icon('x')}<h3>计划不存在</h3><p>${esc(e.message)}</p>
      <button class="btn btn-secondary btn-sm" data-nav="/plans">返回列表</button></div>`;
    return;
  }

  const days = plan.days || [];
  const todayIdx = typeof plan.todayIndex === 'number' ? plan.todayIndex : -1;
  const todayWeekday = plan.todayWeekday;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 14px">
      <button class="icon-btn" data-nav="/plans" aria-label="返回">${icon('arrowLeft')}</button>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" data-edit>${icon('note')} 编辑</button>
        <button class="icon-btn" data-del-plan aria-label="删除计划">${icon('trash')}</button>
      </div>
    </div>

    <div class="ex-tags" style="margin-bottom:10px">
      ${plan.active ? `<span class="badge badge-live">${icon('flame')} 当前计划</span>` : ''}
      <span class="badge ${plan.source === 'deepseek' ? 'badge-ai' : ''}">${plan.source === 'deepseek' ? 'AI 生成' : '手动编排'}</span>
    </div>
    <h1 class="display" style="margin-bottom:10px">${esc(plan.title)}</h1>
    <p class="sub">${esc(plan.summary || '')}</p>

    <div class="grid-3" style="margin-top:20px">
      <div class="card stat-card"><div class="k">目标</div><div class="v" style="font-size:18px">${esc(plan.goal || '综合')}</div></div>
      <div class="card stat-card"><div class="k">频率</div><div class="v" style="font-size:18px">每周 ${plan.daysPerWeek} 天</div></div>
      <div class="card stat-card"><div class="k">周期</div><div class="v" style="font-size:18px">${plan.weeks || 8} 周</div></div>
    </div>

    <section class="section" style="margin-top:22px">
      <div class="section-head" style="margin-bottom:10px"><h2 style="font-size:17px">每周安排</h2>
        <span class="muted">${todayIdx >= 0 ? `今天：${WEEKDAYS[todayWeekday - 1]}` : '今天休息'}</span></div>
      <div class="card" style="padding:16px 18px">
        <div class="week-strip">
          ${WEEKDAYS.map((w, i) => {
            const d = days.find(x => Number(x.weekday) === i + 1);
            return `<span class="week-cell ${d ? 'on' : ''} ${i + 1 === todayWeekday ? 'today' : ''}" ${d ? `data-jump="${days.indexOf(d)}"` : ''}>
              <span class="wd-label">${w.replace('周', '')}</span>
              <span class="wd-dot"></span>
            </span>`;
          }).join('')}
        </div>
      </div>
    </section>

    <div class="btn-row" style="margin-top:16px">
      ${plan.active ? `<button class="btn btn-secondary" disabled>${icon('check')} 当前计划</button>`
        : `<button class="btn" id="activate">${icon('flame')} 设为当前计划</button>`}
      ${todayIdx >= 0 ? `<button class="btn btn-secondary" id="start-today">${icon('play')} 开始今天的训练</button>` : ''}
    </div>

    <section class="section">
      <div class="section-head"><h2>训练日安排</h2><span class="muted">${days.length} 天</span></div>
      ${days.length ? days.map((d, i) => `
        <div class="card day-card ${i === todayIdx ? 'day-today' : ''}" data-dayblock="${i}" style="margin-bottom:12px">
          <div class="day-head">
            <div style="min-width:0">
              <div class="ex-tags" style="margin:0 0 6px">
                ${d.weekday ? `<span class="tag tag-accent">${WEEKDAYS[d.weekday - 1]}</span>` : `<span class="tag">不固定</span>`}
                ${i === todayIdx ? `<span class="badge badge-live">今天</span>` : ''}
              </div>
              <h3 class="title" style="font-size:17px">${esc(d.name || `第 ${i + 1} 天`)}</h3>
              <div class="muted" style="margin-top:2px">${esc(d.focus || '')} · ${(d.exercises || []).length} 个动作</div>
            </div>
            <button class="btn btn-secondary btn-sm" data-start="${i}">${icon('play')} 开始</button>
          </div>
          <div style="margin-top:10px">
            ${(d.exercises || []).map(ex => `
              <button class="ex-line ex-line-btn" data-ex="${esc(ex.exerciseId)}" style="width:100%;background:none;border:none;text-align:left;cursor:pointer">
                <span class="n">${esc(String(ex.sets))} × ${esc(String(ex.reps))}</span>
                <span class="nm">
                  <span style="display:block">${esc(ex.name)}</span>
                  ${ex.note ? `<span class="note">${esc(ex.note)}</span>` : ''}
                </span>
                <span class="muted" style="white-space:nowrap">${esc(ex.rest || '')}</span>
              </button>`).join('')}
          </div>
        </div>`).join('') : `<div class="card empty">${icon('calendar')}<h3>还没有训练日</h3><p>点右上角「编辑」添加。</p></div>`}
    </section>

    <p class="muted" style="margin-top:22px;text-align:center">
      ${plan.source === 'deepseek' ? 'AI 生成的计划仅供参考，请根据身体反馈调整强度' : '计划可以随时编辑，改完第二天就按新安排显示'}
    </p>`;

  el.querySelector('[data-edit]').addEventListener('click', () => nav(`/plans/${plan.id}/edit`));

  el.querySelector('#activate')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api.activatePlan(plan.id);
      toast('已设为当前计划');
      nav('/');
    } catch (err) { toast(err.message); btn.disabled = false; }
  });

  el.querySelector('[data-del-plan]').addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: '删除这份计划？',
      message: '已记录的训练不会受影响。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try { await api.deletePlan(plan.id); toast('已删除'); nav('/plans'); }
    catch (err) { toast(err.message); }
  });

  el.querySelector('#start-today')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      const w = await api.workoutFromPlan(plan.id, todayIdx);
      nav(`/log/${w.id}`);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.innerHTML = `${icon('play')} 开始今天的训练`;
    }
  });

  el.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.start);
      btn.disabled = true;
      btn.textContent = '创建中…';
      try {
        const w = await api.workoutFromPlan(plan.id, idx);
        nav(`/log/${w.id}`);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.innerHTML = `${icon('play')} 开始`;
      }
    });
  });

  el.querySelectorAll('[data-ex]').forEach(btn => {
    btn.addEventListener('click', () => nav(`/exercises/${btn.dataset.ex}`));
  });

  el.querySelectorAll('[data-jump]').forEach(cell => {
    cell.addEventListener('click', () => {
      el.querySelector(`[data-dayblock="${cell.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}
