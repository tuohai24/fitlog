import { $, esc, icon, openSheet, closeSheet, toast, dateLabel, todayStr } from '../core.js';
import { api } from '../api.js';

const EQUIPMENT = ['杠铃', '哑铃', '固定器械', '绳索', '自重', '弹力带', '壶铃', '瑞士球/药球'];
const GOALS = ['增肌', '力量', '减脂', '塑形'];
const LEVELS = ['初级', '中级', '高级'];
const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

export default async function plansView({ el, nav }) {
  el.innerHTML = `
    <div style="margin:6px 0 18px">
      <div class="eyebrow">训练编排</div>
      <h1 class="display" style="margin-top:8px">计划</h1>
      <p class="sub" style="margin-top:10px">自己排一份每周计划，或让 DeepSeek 生成。设为当前计划后，首页会按今天周几显示该练什么。</p>
    </div>

    <button class="btn btn-block btn-lg" id="new-btn">${icon('plus')} 自己创建计划</button>
    <button class="btn btn-secondary btn-block" id="gen-btn" style="margin-top:10px">${icon('sparkles')} AI 生成训练计划</button>

    <div id="plan-list" style="margin-top:24px"></div>`;

  const listEl = $('#plan-list', el);
  $('#new-btn', el).addEventListener('click', () => nav('/plans/new'));
  $('#gen-btn', el).addEventListener('click', () => openGenerateSheet(nav));

  try {
    const plans = await api.plans();
    if (!plans.length) {
      listEl.innerHTML = `
        <div class="card empty">
          ${icon('calendar')}
          <h3>还没有训练计划</h3>
          <p>点上面「自己创建计划」，选好每周练哪几天、每天练什么。</p>
        </div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="section-head" style="margin-top:0"><h2>我的计划</h2><span class="muted">${plans.length} 份</span></div>
      ${plans.map(p => `
        <div class="card plan-card" data-nav="/plans/${p.id}" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div style="min-width:0">
              <div class="ex-tags" style="margin:0 0 8px">
                ${p.active ? `<span class="badge badge-live">${icon('flame')} 进行中</span>` : ''}
                <span class="badge ${p.source === 'deepseek' ? 'badge-ai' : ''}">${p.source === 'deepseek' ? 'AI 生成' : '手动编排'}</span>
              </div>
              <h3 class="title">${esc(p.title)}</h3>
              <div class="muted" style="margin-top:6px">
                ${esc(p.goal || '综合')} · 每周 ${p.daysPerWeek} 天 · ${p.weeks || 8} 周
              </div>
            </div>
            ${icon('chevronRight', 'chevron')}
          </div>
          ${(p.weekdays || []).length ? `
            <div class="week-pills" style="margin-top:14px">
              ${WEEKDAY_SHORT.map((w, i) => `
                <span class="week-pill ${p.weekdays.includes(i + 1) ? 'on' : ''}">${w}</span>`).join('')}
            </div>` : ''}
          ${p.summary ? `<p class="sub" style="margin-top:12px;font-size:14px">${esc(p.summary)}</p>` : ''}
        </div>`).join('')}`;
  } catch (e) {
    listEl.innerHTML = `<div class="empty">${icon('x')}<h3>读取失败</h3><p>${esc(e.message)}</p></div>`;
  }
}

/* =========================== AI 生成表单 =========================== */
function openGenerateSheet(nav) {
  const cfg = { goal: '增肌', level: '初级', daysPerWeek: 4, sessionMinutes: 60, equipment: ['杠铃', '哑铃', '固定器械', '自重'], notes: '' };

  openSheet({
    title: 'AI 生成训练计划',
    content: `
      <div id="gen-form">
        <div class="field" style="margin-bottom:18px">
          <label>训练目标</label>
          <div class="segmented" data-group="goal">
            ${GOALS.map(g => `<button data-v="${g}" class="${g === cfg.goal ? 'active' : ''}">${g}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:18px">
          <label>训练水平</label>
          <div class="segmented" data-group="level">
            ${LEVELS.map(l => `<button data-v="${l}" class="${l === cfg.level ? 'active' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:18px">
          <label>每周训练天数</label>
          <div class="chips" data-group="daysPerWeek" style="padding-bottom:0">
            ${[2, 3, 4, 5, 6].map(d => `<button class="chip ${d === cfg.daysPerWeek ? 'active' : ''}" data-v="${d}">${d} 天</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:18px">
          <label>单次训练时长</label>
          <div class="chips" data-group="sessionMinutes" style="padding-bottom:0">
            ${[30, 45, 60, 90].map(m => `<button class="chip ${m === cfg.sessionMinutes ? 'active' : ''}" data-v="${m}">${m} 分钟</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:18px">
          <label>可用器械（可多选）</label>
          <div class="chips" data-group="equipment" data-multi="1" style="flex-wrap:wrap;padding-bottom:0">
            ${EQUIPMENT.map(eq => `<button class="chip ${cfg.equipment.includes(eq) ? 'active' : ''}" data-v="${eq}">${eq}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:20px">
          <label>补充说明（可选）</label>
          <textarea class="textarea" id="gen-notes" placeholder="例如：想重点练背和肩，右膝不适避免跳跃动作，每周只能练 3 次…"></textarea>
        </div>
        <button class="btn btn-block btn-lg" id="gen-submit">${icon('sparkles')} 开始生成</button>
        <p class="muted" style="text-align:center;margin-top:12px">由 DeepSeek 生成，约需 10-30 秒</p>
      </div>
      <div id="gen-loading" style="display:none">
        <div class="generating">
          <div class="spinner"></div>
          <h3 class="title">正在编排计划…</h3>
          <p>AI 正在挑选动作、安排组数与强度</p>
          <p class="hint" id="gen-hint">读取你的训练目标…</p>
        </div>
      </div>`,
    onMount(sheet) {
      // 单选/多选交互
      sheet.querySelectorAll('[data-group]').forEach(group => {
        const key = group.dataset.group;
        const multi = group.dataset.multi === '1';
        group.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-v]');
          if (!btn) return;
          const val = btn.dataset.v;
          if (multi) {
            const set = new Set(cfg[key]);
            const v = EQUIPMENT.includes(val) ? val : val;
            if (set.has(v)) set.delete(v); else set.add(v);
            cfg[key] = [...set];
            btn.classList.toggle('active', cfg[key].includes(v));
          } else {
            cfg[key] = key === 'daysPerWeek' || key === 'sessionMinutes' ? Number(val) : val;
            group.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('active', b === btn));
          }
        });
      });

      const hints = ['读取你的训练目标…', '从动作库挑选复合动作…', '安排每日训练量与组数…', '计算组间休息与进阶节奏…', '整理成可执行的计划…'];
      let hintTimer;

      sheet.querySelector('#gen-submit').addEventListener('click', async () => {
        cfg.notes = sheet.querySelector('#gen-notes').value.trim();
        if (!cfg.equipment.length) { toast('请至少选择一种器械'); return; }

        sheet.querySelector('#gen-form').style.display = 'none';
        sheet.querySelector('#gen-loading').style.display = 'block';
        let hi = 0;
        hintTimer = setInterval(() => {
          const hintEl = sheet.querySelector('#gen-hint');
          if (hintEl) hintEl.textContent = hints[++hi % hints.length];
        }, 2600);

        try {
          const plan = await api.generatePlan(cfg);
          clearInterval(hintTimer);
          closeSheet();
          toast('计划已生成');
          nav(`/plans/${plan.id}`);
        } catch (e) {
          clearInterval(hintTimer);
          sheet.querySelector('#gen-loading').style.display = 'none';
          sheet.querySelector('#gen-form').style.display = 'block';
          toast(e.message);
        }
      });
    },
  });
}
