import { $, esc, icon, fmtVolume, dateLabel, todayStr, parseDate, toast } from '../core.js';
import { api } from '../api.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['一', '二', '三', '四', '五', '六', '日'];

export default async function historyView({ el, nav }) {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();
  let selected = todayStr();

  const monthRange = () => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { from: iso(start), to: iso(end), days: end.getDate(), firstDow: (start.getDay() + 6) % 7 };
  };

  el.innerHTML = `
    <div style="margin:6px 0 18px">
      <div class="eyebrow">训练日志</div>
      <h1 class="display" style="margin-top:8px">历史</h1>
    </div>
    <div class="card" id="cal-card" style="padding:16px 14px"></div>
    <div class="section" id="day-detail"></div>
    <div class="section" id="month-list"></div>
  `;

  const calCard = $('#cal-card', el);
  const dayDetail = $('#day-detail', el);
  const monthList = $('#month-list', el);

  async function load() {
    const { from, to } = monthRange();
    calCard.innerHTML = `<div class="cal-grid">${Array.from({ length: 35 }, () =>
      `<div class="skeleton" style="aspect-ratio:1;border-radius:12px"></div>`).join('')}</div>`;

    let workouts = [];
    try {
      workouts = await api.workouts({ from, to, limit: 200 });
    } catch (e) { toast(e.message); }

    renderCalendar(workouts);
    renderDayDetail(workouts);
    renderMonthList(workouts);
  }

  function renderCalendar(workouts) {
    const { days, firstDow } = monthRange();
    const byDate = new Map();
    for (const w of workouts) {
      if (!byDate.has(w.date)) byDate.set(w.date, []);
      byDate.get(w.date).push(w);
    }
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = 1; d <= days; d++) {
      const date = `${year}-${pad(month + 1)}-${pad(d)}`;
      const trained = byDate.has(date);
      const isToday = date === todayStr();
      cells.push(`
        <button class="cal-day ${trained ? 'trained' : ''} ${isToday ? 'today' : ''} ${date === selected ? 'selected' : ''}"
          data-date="${date}">
          ${d}${trained ? '<span class="dot"></span>' : ''}
        </button>`);
    }

    const monthVolume = workouts.reduce((a, w) => a + w.volume, 0);
    calCard.innerHTML = `
      <div class="cal-head">
        <button class="icon-btn" data-month="-1" aria-label="上个月">${icon('chevronLeft')}</button>
        <div style="text-align:center">
          <div style="font-weight:600;font-size:16px">${year} 年 ${month + 1} 月</div>
          <div class="muted">${workouts.length} 次训练 · ${fmtVolume(monthVolume).value}${fmtVolume(monthVolume).unit}</div>
        </div>
        <button class="icon-btn" data-month="1" aria-label="下个月">${icon('chevronRight')}</button>
      </div>
      <div class="cal-grid" style="margin-bottom:2px">
        ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells.join('')}</div>`;

    calCard.querySelectorAll('[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = btn.dataset.date;
        calCard.querySelectorAll('.cal-day').forEach(b => b.classList.toggle('selected', b.dataset.date === selected));
        renderDayDetail(workouts);
      });
    });
    calCard.querySelector('[data-month="-1"]').addEventListener('click', () => shiftMonth(-1));
    calCard.querySelector('[data-month="1"]').addEventListener('click', () => shiftMonth(1));
  }

  function renderDayDetail(workouts) {
    const list = workouts.filter(w => w.date === selected);
    if (!list.length) {
      dayDetail.innerHTML = `
        <div class="section-head"><h2>${dateLabel(selected)}</h2></div>
        <div class="card empty" style="padding:28px">
          <p style="font-size:14px">这天没有训练记录</p>
        </div>`;
      return;
    }
    dayDetail.innerHTML = `
      <div class="section-head"><h2>${dateLabel(selected)}</h2>
        <button class="link" data-open-today>查看</button></div>
      ${list.map(w => `
        <div class="card" style="margin-bottom:12px;cursor:pointer" data-nav="/log/${w.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <h3 class="title">${esc(w.title || '训练')}</h3>
              <div class="muted" style="margin-top:4px">${w.exerciseCount} 个动作 · ${w.doneSets} 组完成</div>
            </div>
            <div style="text-align:right">
              <div class="mono-num" style="font-size:20px;font-weight:600">${fmtVolume(w.volume).value}</div>
              <div class="muted">${fmtVolume(w.volume).unit}</div>
            </div>
          </div>
          <div class="ex-tags" style="margin-top:12px">
            ${(w.exercises || []).map(x => `<span class="tag">${esc(x.name)}</span>`).join('')}
          </div>
        </div>`).join('')}`;
    dayDetail.querySelector('[data-open-today]')?.addEventListener('click', () => {
      nav(`/log/${list[0].id}`);
    });
  }

  function renderMonthList(workouts) {
    if (!workouts.length) { monthList.innerHTML = ''; return; }
    monthList.innerHTML = `
      <div class="section-head"><h2>本月全部</h2><span class="muted">${workouts.length} 次</span></div>
      <div class="card" style="padding:6px 18px">
        <div class="list">
          ${workouts.map(w => `
            <button class="row" data-nav="/log/${w.id}">
              <div class="row-main">
                <div class="row-title">${esc(w.title || '训练')}</div>
                <div class="row-sub">${parseDate(w.date).getMonth() + 1}月${parseDate(w.date).getDate()}日 · ${w.doneSets} 组</div>
              </div>
              <div class="row-end mono-num">${fmtVolume(w.volume).value}${fmtVolume(w.volume).unit}${icon('chevronRight', 'chevron')}</div>
            </button>`).join('')}
        </div>
      </div>`;
  }

  function shiftMonth(delta) {
    const d = new Date(year, month + delta, 1);
    year = d.getFullYear();
    month = d.getMonth();
    selected = '';
    load();
  }

  await load();
}
