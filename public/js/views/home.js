import { esc, icon, dateLabel, todayStr, fmtVolume, relativeDay, barChart, toast, openSheet } from '../core.js';
import { api } from '../api.js';

export async function startWorkout(nav, { title = '', planId = null, planDay = null } = {}) {
  const w = await api.createWorkout({ date: todayStr(), title, planId, planDay, exercises: [] });
  nav(`/log/${w.id}`);
}

export default async function homeView({ el, nav }) {
  const [overview, daily, workouts, todayWorkout, plans, planToday] = await Promise.all([
    api.overview(7).catch(() => null),
    api.daily(7).catch(() => ({ series: [] })),
    api.workouts({ limit: 3 }).catch(() => []),
    api.workoutToday().catch(() => null),
    api.plans().catch(() => []),
    api.planToday().catch(() => null),
  ]);

  const activePlan = plans.find(p => p.active) || null;
  const series = daily.series || [];
  const week = overview?.current || { workouts: 0, volume: 0, sets: 0 };
  const streak = overview?.streak || 0;
  const vol = fmtVolume(week.volume);

  const todayDay = planToday?.day || null;
  const todayIndex = planToday?.dayIndex;
  const planInfo = planToday?.plan || null;

  // 今日计划的总组数与预估时长（组内 35 秒 + 组间休息）
  const dayExs = todayDay?.exercises || [];
  const daySets = dayExs.reduce((s, e) => s + (Number(e.sets) || 0), 0);
  const daySeconds = dayExs.reduce((s, e) => s + (Number(e.sets) || 0) * (35 + (parseInt(e.rest, 10) || 90)), 0);
  const dayMinutes = Math.max(0, Math.round(daySeconds / 60 / 5) * 5);

  const dowLabels = series.map(d => {
    const dt = new Date(`${d.date}T00:00:00`);
    return ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  });

  const heroStats = todayWorkout
    ? [
        { v: todayWorkout.stats.exerciseCount, k: '动作' },
        { v: todayWorkout.stats.doneSets, k: '已完成组数' },
        { v: fmtVolume(todayWorkout.stats.volume).value, k: '完成容量' },
      ]
    : [
        { v: week.workouts, k: '本周训练' },
        { v: vol.value, k: '本周容量' },
        { v: streak, k: '连续天数' },
      ];

  const planCTA = todayWorkout
    ? '继续今天的训练'
    : todayDay ? '开始今天的训练' : (activePlan ? '按计划训练' : '创建训练计划');
  const planPrimary = !todayWorkout && !!todayDay;

  el.innerHTML = `
    <div style="margin:6px 0 20px">
      <div class="eyebrow">${dateLabel(todayStr(), true)}</div>
      <h1 class="display" style="margin-top:8px">${todayWorkout ? '今天，继续' : (todayDay ? todayDay.name : '今天练点什么？')}</h1>
      ${todayDay && !todayWorkout ? `<p class="sub" style="margin-top:10px">${esc(todayDay.focus || '按计划完成今天的训练')}</p>` : ''}
    </div>

    <section class="hero">
      <div class="eyebrow">${todayWorkout ? '进行中的训练' : '本周概览'}</div>
      <h2 style="font-size:26px;margin-top:8px;letter-spacing:-0.03em">
        ${todayWorkout ? esc(todayWorkout.title || '今日训练') : (week.workouts > 0 ? '保持节奏' : '从第一次开始')}
      </h2>
      <p style="margin-top:6px">${todayWorkout
        ? `已记录 ${todayWorkout.stats.doneSets} 组，${todayWorkout.stats.exerciseCount} 个动作`
        : (week.workouts > 0 ? '训练是复利，今天继续累积。' : '选几个动作，记下重量，剩下的交给时间。')}</p>
      <div class="hero-stats">
        ${heroStats.map(s => `<div class="hero-stat"><span class="v">${s.v}</span><span class="k">${s.k}</span></div>`).join('')}
      </div>
      <div style="margin-top:22px">
        ${planPrimary
          ? `<button class="btn btn-block btn-hero" data-plan-start>${icon('play')} ${planCTA}</button>
             <button class="hero-alt" data-start>不按计划，自由训练</button>`
          : `<button class="btn btn-block btn-hero" data-start>${todayWorkout ? '继续训练' : '开始训练'}</button>
             ${!todayWorkout ? `<button class="hero-alt" data-plan-start>${planCTA}</button>` : ''}`}
      </div>
    </section>

    ${planInfo ? `
      <section class="section">
        <div class="section-head">
          <h2>今日计划</h2>
          <button class="link" data-nav="/plans/${planInfo.id}">计划详情</button>
        </div>
        ${todayDay ? `
          <div class="card today-plan">
            <div class="ex-tags" style="margin:0">
              <span class="badge badge-live">${esc(planToday.weekdayLabel)}</span>
              <span class="badge">${(todayDay.exercises || []).length} 个动作</span>
              ${todayWorkout ? `<span class="badge badge-ai">${icon('check')} 已记录</span>` : ''}
            </div>
            <h3 class="title" style="margin-top:12px">${esc(todayDay.name)}</h3>
            <p class="muted" style="margin-top:4px">${esc(todayDay.focus || '')} · ${(todayDay.exercises || []).length} 个动作</p>
            <div class="plan-preview">
              ${(todayDay.exercises || []).slice(0, 5).map(ex => `
                <div class="plan-preview-row">
                  <span class="n">${esc(String(ex.sets))} × ${esc(String(ex.reps))}</span>
                  <span class="nm">${esc(ex.name)}</span>
                  <span class="muted">${esc(ex.rest || '')}</span>
                </div>`).join('')}
              ${(todayDay.exercises || []).length > 5 ? `<p class="muted" style="padding-top:8px">还有 ${(todayDay.exercises || []).length - 5} 个动作…</p>` : ''}
            </div>
            <div class="plan-sum">
              <span class="muted">共 ${daySets} 组${dayMinutes ? ` · 预计 ${dayMinutes} 分钟` : ''}</span>
              <span class="muted">${todayWorkout ? '已开始记录' : '从上方按钮开始'}</span>
            </div>
          </div>` : `
          <div class="card today-plan rest">
            <div class="ex-tags" style="margin:0">
              <span class="badge">${esc(planToday.weekdayLabel)}</span>
              <span class="badge">休息日</span>
            </div>
            <h3 class="title" style="margin-top:12px">今天休息，恢复也是训练</h3>
            <p class="muted" style="margin-top:6px">
              ${planToday.next
                ? `下次训练：${esc(planToday.next.weekdayLabel)} · ${esc(planToday.next.name)}（${planToday.next.inDays} 天后）`
                : '这份计划还没安排训练日'}
            </p>
            <div class="btn-row" style="margin-top:16px">
              <button class="btn btn-secondary btn-block" data-nav="/plans/${planInfo.id}">查看计划</button>
              <button class="btn btn-block" data-start>随便练练</button>
            </div>
          </div>`}

        <div class="card" style="margin-top:12px;padding:14px 16px">
          <div class="week-strip">
            ${(planToday.week || []).map(w => `
              <span class="week-cell ${w.name ? 'on' : ''} ${w.isToday ? 'today' : ''}">
                <span class="wd-label">${w.label}</span>
                <span class="wd-dot"></span>
              </span>`).join('')}
          </div>
        </div>
      </section>` : `
      <section class="section">
        <div class="section-head"><h2>训练计划</h2></div>
        <button class="card plan-cta" data-nav="/plans">
          <span class="plan-cta-icon">${icon('calendar')}</span>
          <span style="flex:1;text-align:left">
            <span style="display:block;font-weight:500">创建每周训练计划</span>
            <span class="muted">选好周几练什么，每天打开就知道该练哪套</span>
          </span>
          ${icon('chevronRight', 'chevron')}
        </button>
      </section>`}

    <section class="section">
      <div class="section-head">
        <h2>近 7 天</h2>
        <button class="link" data-nav="/stats">查看统计</button>
      </div>
      <div class="card" style="padding:16px 18px 10px">
        <div class="chart-wrap">${barChart(series.map(d => ({ value: d.volume })), { height: 110 })}</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          ${dowLabels.map((d, i) => `<span class="muted" style="flex:1;text-align:center${i === dowLabels.length - 1 ? ';color:var(--accent);font-weight:600' : ''}">${d}</span>`).join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>最近训练</h2>
        <button class="link" data-nav="/history">全部</button>
      </div>
      ${workouts.length ? `
        <div class="card" style="padding:6px 18px">
          <div class="list">
            ${workouts.map(w => `
              <button class="row" data-nav="/log/${w.id}">
                <div class="row-main">
                  <div class="row-title">${esc(w.title || '训练')}</div>
                  <div class="row-sub">${relativeDay(w.date)} · ${w.exerciseCount} 个动作 · ${w.doneSets} 组</div>
                </div>
                <div class="row-end mono-num">${fmtVolume(w.volume).value}<span class="muted" style="margin-left:2px">${fmtVolume(w.volume).unit}</span>
                  ${icon('chevronRight', 'chevron')}</div>
              </button>`).join('')}
          </div>
        </div>` : `
        <div class="card empty">
          ${icon('dumbbell')}
          <h3>还没有训练记录</h3>
          <p>点击上方「开始训练」，添加第一个动作吧。</p>
        </div>`}
    </section>

    <section class="section">
      <div class="grid-2">
        <button class="card quick-link" data-nav="/exercises">
          <span class="quick-icon">${icon('dumbbell')}</span>
          <span class="quick-title">动作库</span>
          <span class="muted">动图 + 讲解</span>
        </button>
        <button class="card quick-link" data-nav="/plans">
          <span class="quick-icon">${icon('sparkles')}</span>
          <span class="quick-title">训练计划</span>
          <span class="muted">自己排或 AI 生成</span>
        </button>
      </div>
    </section>
  `;

  /* 交互 */
  el.querySelectorAll('[data-start]').forEach((startBtn) => {
    startBtn.addEventListener('click', async () => {
      if (todayWorkout) return nav(`/log/${todayWorkout.id}`);
      startBtn.disabled = true;
      try { await startWorkout(nav); } catch (e) { toast(e.message); startBtn.disabled = false; }
    });
  });

  el.querySelector('[data-plan-start]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (todayDay && planInfo && todayIndex != null) {
      btn.disabled = true;
      try {
        const w = await api.workoutFromPlan(planInfo.id, todayIndex);
        nav(`/log/${w.id}`);
      } catch (err) { toast(err.message); btn.disabled = false; }
      return;
    }
    if (!activePlan) return nav('/plans');
    pickPlanDay(activePlan, nav);
  });
}
function pickPlanDay(plan, nav) {
  openSheet({
    title: '选择训练日',
    content: `<div class="list">
      ${(plan.days || []).map((d, i) => `
        <button class="row" data-pick="${i}">
          <div class="row-main">
            <div class="row-title">${esc(d.name || `第 ${i + 1} 天`)}</div>
            <div class="row-sub">${esc(d.focus || '')} · ${(d.exercises || []).length} 个动作</div>
          </div>
          ${icon('chevronRight', 'chevron')}
        </button>`).join('')}
    </div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-pick]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const w = await api.workoutFromPlan(plan.id, Number(btn.dataset.pick));
            nav(`/log/${w.id}`);
          } catch (e) { toast(e.message); btn.disabled = false; }
        });
      });
    },
  });
}
