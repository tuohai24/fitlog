import { $, esc, icon, fmtNum, fmtVolume, barChart, toast } from '../core.js';
import { api } from '../api.js';

const RANGES = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
];

export default async function statsView({ el }) {
  let days = 30;

  el.innerHTML = `
    <div style="margin:6px 0 18px">
      <div class="eyebrow">训练分析</div>
      <h1 class="display" style="margin-top:8px">统计</h1>
    </div>
    <div class="segmented" id="range" style="margin-bottom:18px">
      ${RANGES.map(r => `<button data-days="${r.days}" class="${r.days === days ? 'active' : ''}">${r.label}</button>`).join('')}
    </div>
    <div id="stats-body"></div>`;

  const body = $('#stats-body', el);
  el.querySelectorAll('#range button').forEach(btn => {
    btn.addEventListener('click', () => {
      days = Number(btn.dataset.days);
      el.querySelectorAll('#range button').forEach(b => b.classList.toggle('active', b === btn));
      load();
    });
  });

  async function load() {
    body.innerHTML = `<div class="grid-2">
      ${Array.from({ length: 4 }, () => `<div class="card"><div class="skeleton" style="height:12px;width:50%;margin-bottom:10px"></div>
        <div class="skeleton" style="height:26px;width:70%"></div></div>`).join('')}
      </div>`;

    let overview, daily, muscles, prs;
    try {
      [overview, daily, muscles, prs] = await Promise.all([
        api.overview(days), api.daily(days), api.muscles(days), api.prs(6),
      ]);
    } catch (e) {
      body.innerHTML = `<div class="empty">${icon('x')}<h3>读取失败</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    const cur = overview.current;
    const prev = overview.previous;
    const vol = fmtVolume(cur.volume);
    const prevVol = fmtVolume(prev.volume);
    const delta = prev.volume > 0 ? Math.round(((cur.volume - prev.volume) / prev.volume) * 100) : null;

    const series = daily.series;
    const labelRow = days === 7
      ? `<div style="display:flex;margin-top:8px;gap:8px">${series.map((d, i) => {
          const dt = new Date(`${d.date}T00:00:00`);
          const isLast = i === series.length - 1;
          return `<span style="flex:1;min-width:0;text-align:center;font-size:11px;color:${isLast ? 'var(--accent)' : 'var(--text-3)'};font-weight:${isLast ? '600' : '400'}">${['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]}</span>`;
        }).join('')}</div>`
      : `<div style="display:flex;justify-content:space-between;margin-top:8px">
          <span class="muted">${series[0]?.date.slice(5)}</span>
          <span class="muted">${series[series.length - 1]?.date.slice(5)}</span>
        </div>`;

    const totalMuscleSets = muscles.reduce((a, m) => a + m.sets, 0) || 1;

    body.innerHTML = `
      <div class="grid-2">
        <div class="card stat-card">
          <div class="k">训练次数</div>
          <div class="v">${cur.workouts}<span class="unit">次</span></div>
          <div class="muted" style="margin-top:4px">上个周期 ${prev.workouts} 次</div>
        </div>
        <div class="card stat-card">
          <div class="k">训练容量</div>
          <div class="v">${vol.value}<span class="unit">${vol.unit}</span></div>
          <div class="muted" style="margin-top:4px">
            ${delta === null ? `上个周期 ${prevVol.value}${prevVol.unit}` : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% 环比`}
          </div>
        </div>
        <div class="card stat-card">
          <div class="k">完成组数</div>
          <div class="v">${cur.sets}<span class="unit">组</span></div>
          <div class="muted" style="margin-top:4px">共 ${fmtNum(cur.reps)} 次动作</div>
        </div>
        <div class="card stat-card">
          <div class="k">连续训练</div>
          <div class="v">${overview.streak}<span class="unit">天</span></div>
          <div class="muted" style="margin-top:4px">累计 ${overview.totals.workouts} 次训练</div>
        </div>
      </div>

      <section class="section">
        <div class="section-head"><h2>训练容量趋势</h2><span class="muted">单位 kg</span></div>
        <div class="card" style="padding:16px 16px 12px">
          ${barChart(series.map(d => ({ value: d.volume })), { height: 140 })}
          ${labelRow}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>肌群分布</h2><span class="muted">按完成组数</span></div>
        <div class="card">
          ${muscles.length ? muscles.slice(0, 8).map(m => `
            <div class="bar-row">
              <div class="bar-label"><span>${esc(m.label)}</span><span class="n">${m.sets} 组 · ${Math.round((m.sets / totalMuscleSets) * 100)}%</span></div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (m.sets / totalMuscleSets) * 100)}%"></div></div>
            </div>`).join('') : `<p class="muted">还没有足够的数据</p>`}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>个人纪录</h2><span class="muted">按估算 1RM</span></div>
        ${prs.length ? `
          <div class="card" style="padding:6px 18px">
            <div class="list">
              ${prs.map(p => `
                <div class="row" style="cursor:default">
                  <div class="row-main">
                    <div class="row-title">${esc(p.name || p.id)}</div>
                    <div class="row-sub">${esc(p.cat || '')} · ${p.date}</div>
                  </div>
                  <div class="row-end mono-num" style="color:var(--text)">
                    <strong>${p.weight}kg</strong>&nbsp;×&nbsp;${p.reps}
                  </div>
                </div>`).join('')}
            </div>
          </div>` : `<div class="card empty"><p style="font-size:14px">完成带重量的训练后，这里会出现你的纪录</p></div>`}
      </section>

      <p class="muted" style="text-align:center;margin-top:24px">容量 = 重量 × 次数，仅统计已完成的组</p>
    `;
  }

  await load();
}
