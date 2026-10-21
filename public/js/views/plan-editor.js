import { esc, icon, toast, todayStr, openSheet, closeSheet, confirmSheet } from '../core.js';
import { api } from '../api.js';
import { openExercisePicker } from '../picker.js';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const GOALS = ['增肌', '力量', '减脂', '塑形', '体态'];
const LEVELS = ['初级', '中级', '高级'];
const WEEK_OPTIONS = [4, 6, 8, 12];

const isoWeekday = () => {
  const d = new Date(`${todayStr()}T00:00:00`);
  return d.getDay() || 7;
};

function emptyDay(weekday) {
  return {
    name: weekday ? `${WEEKDAYS[weekday - 1]}训练` : '训练日',
    focus: '',
    weekday: weekday || null,
    exercises: [],
  };
}

// 仅当名称还是自动生成的（如「周三训练」）时才跟随周几改写，避免覆盖用户自己起的名字
function setAutoName(day) {
  if (/^(周[一二三四五六日]训练|训练日)$/.test(day.name)) {
    day.name = day.weekday ? `${WEEKDAYS[day.weekday - 1]}训练` : '训练日';
  }
}

export default async function planEditorView({ el, params, nav }) {
  const editId = params[0] ? Number(params[0]) : null;
  const model = {
    id: editId,
    title: '',
    goal: '增肌',
    level: '初级',
    weeks: 8,
    summary: '',
    days: [],
  };

  if (editId) {
    try {
      const plan = await api.plan(editId);
      model.title = plan.title || '';
      model.goal = plan.goal || '增肌';
      model.level = plan.level || '初级';
      model.weeks = plan.weeks || 8;
      model.summary = plan.summary || '';
      model.days = (plan.days || []).map(d => ({
        name: d.name || '训练日',
        focus: d.focus || '',
        weekday: d.weekday || null,
        exercises: (d.exercises || []).map(ex => ({
          exerciseId: ex.exerciseId,
          name: ex.name,
          sets: Number(ex.sets) || 3,
          reps: String(ex.reps || '8-12'),
          rest: String(ex.rest || '90s'),
        })),
      }));
    } catch (e) {
      el.innerHTML = `<div class="empty">${icon('x')}<h3>计划不存在</h3><p>${esc(e.message)}</p>
        <button class="btn btn-secondary btn-sm" data-nav="/plans">返回</button></div>`;
      return;
    }
  } else {
    // 默认给一份「一 / 三 / 五」的骨架，直接往里填动作即可
    model.days = [1, 3, 5].map(wd => emptyDay(wd));
  }

  document.title = `${editId ? '编辑计划' : '新建计划'} · FitLog`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin:2px 0 14px">
      <button class="icon-btn" data-back aria-label="返回">${icon('arrowLeft')}</button>
      <span class="muted">${editId ? '编辑训练计划' : '新建训练计划'}</span>
    </div>

    <h1 class="display" style="margin-bottom:6px">${editId ? '编辑计划' : '自己排一份计划'}</h1>
    <p class="sub" style="margin-bottom:20px">选好每周练哪几天、每天练什么，之后打开 App 就会自动显示当天的训练内容。</p>

    <div class="card" style="padding:18px">
      <div class="field" style="margin-bottom:16px">
        <label>计划名称</label>
        <input class="input" id="p-title" value="${esc(model.title)}" placeholder="例如：四分化增肌 · 每周四练" maxlength="40" />
      </div>
      <div class="field" style="margin-bottom:16px">
        <label>训练目标</label>
        <div class="segmented" id="p-goal">
          ${GOALS.map(g => `<button data-v="${g}" class="${g === model.goal ? 'active' : ''}">${g}</button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:16px">
        <label>训练水平</label>
        <div class="segmented" id="p-level">
          ${LEVELS.map(l => `<button data-v="${l}" class="${l === model.level ? 'active' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:16px">
        <label>计划周期</label>
        <div class="chips" style="padding-bottom:0" id="p-weeks">
          ${WEEK_OPTIONS.map(w => `<button class="chip ${w === model.weeks ? 'active' : ''}" data-v="${w}">${w} 周</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>简介（可选）</label>
        <textarea class="textarea" id="p-summary" placeholder="训练思路、进阶方式、注意事项…" style="min-height:66px">${esc(model.summary)}</textarea>
      </div>
    </div>

    <div class="section-head" style="margin-top:26px">
      <h2>每周安排</h2>
      <span class="muted" id="p-day-count">${model.days.length} 天</span>
    </div>
    <div id="p-days"></div>

    <button class="btn btn-secondary btn-block" id="p-add-day" style="margin-top:12px">${icon('plus')} 添加训练日</button>

    <div style="height:16px"></div>
    <div class="action-bar">
      <button class="btn btn-block btn-lg" id="p-save">${editId ? '保存修改' : '创建计划'}</button>
    </div>`;

  /* ---------------- 渲染训练日 ---------------- */
  const daysEl = el.querySelector('#p-days');

  const renderDays = () => {
    el.querySelector('#p-day-count').textContent = `${model.days.length} 天`;
    if (!model.days.length) {
      daysEl.innerHTML = `<div class="card empty">
        ${icon('calendar')}<h3>还没有训练日</h3><p>先添加一天，再选择周几和动作。</p>
      </div>`;
      return;
    }

    daysEl.innerHTML = model.days.map((d, i) => `
      <div class="card plan-day" data-day="${i}" style="margin-bottom:12px">
        <div class="plan-day-head">
          <div class="weekday-picker">
            ${WEEKDAYS.map((w, wi) => `
              <button class="wd ${d.weekday === wi + 1 ? 'active' : ''}" data-weekday="${wi + 1}">${w.replace('周', '')}</button>`).join('')}
          </div>
        </div>

        <div class="plan-day-fields">
          <input class="input" data-day-name="${i}" value="${esc(d.name)}" placeholder="训练日名称，如 上肢推" maxlength="30" />
          <input class="input" data-day-focus="${i}" value="${esc(d.focus)}" placeholder="重点肌群，如 胸 / 肩 / 三头" maxlength="40" />
        </div>

        ${d.exercises.length ? `
          <div class="plan-ex-head"><span>动作</span><span>组</span><span>次数</span><span>休息</span></div>
          ${d.exercises.map((ex, j) => `
            <div class="plan-ex" data-ex="${i}-${j}">
              <div class="plan-ex-name" title="${esc(ex.name)}">
                <span data-open-ex="${esc(ex.exerciseId)}">${esc(ex.name)}</span>
              </div>
              <input class="set-input" type="number" inputmode="numeric" min="1" max="12"
                data-ex-sets="${i}-${j}" value="${ex.sets}" aria-label="组数" />
              <input class="set-input" type="text" data-ex-reps="${i}-${j}" value="${esc(ex.reps)}" aria-label="次数" />
              <input class="set-input" type="text" data-ex-rest="${i}-${j}" value="${esc(ex.rest)}" aria-label="组间休息" />
              <button class="icon-btn plan-ex-del" data-del-ex="${i}-${j}" aria-label="移除">${icon('x')}</button>
            </div>`).join('')}` : `
          <p class="muted" style="margin:12px 0 0">还没有动作，点下面按钮从动作库添加。</p>`}

        <div class="plan-day-foot">
          <button class="btn btn-ghost btn-sm" data-add-ex="${i}">${icon('plus')} 添加动作</button>
          <button class="btn btn-ghost btn-sm" data-del-day="${i}" style="color:var(--danger)">删除这一天</button>
        </div>
      </div>`).join('');
  };

  renderDays();

  /* ---------------- 表单同步 ---------------- */
  el.querySelector('#p-title').addEventListener('input', (e) => { model.title = e.target.value; });
  el.querySelector('#p-summary').addEventListener('input', (e) => { model.summary = e.target.value; });

  el.querySelector('#p-goal').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-v]');
    if (!btn) return;
    model.goal = btn.dataset.v;
    el.querySelectorAll('#p-goal [data-v]').forEach(b => b.classList.toggle('active', b === btn));
  });
  el.querySelector('#p-level').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-v]');
    if (!btn) return;
    model.level = btn.dataset.v;
    el.querySelectorAll('#p-level [data-v]').forEach(b => b.classList.toggle('active', b === btn));
  });
  el.querySelector('#p-weeks').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-v]');
    if (!btn) return;
    model.weeks = Number(btn.dataset.v);
    el.querySelectorAll('#p-weeks [data-v]').forEach(b => b.classList.toggle('active', b === btn));
  });

  daysEl.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.dayName !== undefined) { model.days[Number(t.dataset.dayName)].name = t.value; return; }
    if (t.dataset.dayFocus !== undefined) { model.days[Number(t.dataset.dayFocus)].focus = t.value; return; }
    if (t.dataset.exSets !== undefined) {
      const [i, j] = t.dataset.exSets.split('-').map(Number);
      model.days[i].exercises[j].sets = Math.min(12, Math.max(1, Number(t.value) || 1));
      return;
    }
    if (t.dataset.exReps !== undefined) {
      const [i, j] = t.dataset.exReps.split('-').map(Number);
      model.days[i].exercises[j].reps = t.value;
      return;
    }
    if (t.dataset.exRest !== undefined) {
      const [i, j] = t.dataset.exRest.split('-').map(Number);
      model.days[i].exercises[j].rest = t.value;
    }
  });

  /* ---------------- 交互 ---------------- */
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-back]')) return nav('/plans');

    const wdBtn = e.target.closest('[data-weekday]');
    if (wdBtn) {
      const i = Number(wdBtn.closest('[data-day]').dataset.day);
      const wd = Number(wdBtn.dataset.weekday) || null;
      const prev = model.days[i].weekday;
      // 同一个周几只能排一天：若已被别的训练日占用，交换两者的周几
      const other = wd ? model.days.findIndex((d, k) => k !== i && d.weekday === wd) : -1;
      if (other >= 0) {
        model.days[other].weekday = prev || null;
        setAutoName(model.days[other]);
      }
      model.days[i].weekday = wd;
      setAutoName(model.days[i]);
      renderDays();
      return;
    }

    const delDay = e.target.closest('[data-del-day]');
    if (delDay) {
      const i = Number(delDay.dataset.delDay);
      if (model.days[i].exercises.length) {
        const ok = await confirmSheet({ title: '删除这一天？', message: `「${model.days[i].name}」里的动作会一起移除。`, confirmText: '删除', danger: true });
        if (!ok) return;
      }
      model.days.splice(i, 1);
      renderDays();
      return;
    }

    const addEx = e.target.closest('[data-add-ex]');
    if (addEx) {
      const i = Number(addEx.dataset.addEx);
      const used = model.days[i].exercises.map(x => x.exerciseId);
      openExercisePicker({
        title: '添加到训练日',
        excludeIds: used,
        onConfirm(list) {
          for (const ex of list) {
            model.days[i].exercises.push({
              exerciseId: ex.id, name: ex.zh, sets: 3, reps: '8-12', rest: '90s',
            });
          }
          renderDays();
          toast(`已添加 ${list.length} 个动作`);
        },
      });
      return;
    }

    const delEx = e.target.closest('[data-del-ex]');
    if (delEx) {
      const [i, j] = delEx.dataset.delEx.split('-').map(Number);
      model.days[i].exercises.splice(j, 1);
      renderDays();
      return;
    }

    const openEx = e.target.closest('[data-open-ex]');
    if (openEx) return nav(`/exercises/${openEx.dataset.openEx}`);

    if (e.target.closest('#p-add-day')) {
      const used = new Set(model.days.map(d => d.weekday).filter(Boolean));
      const free = [1, 2, 3, 4, 5, 6, 7].find(w => !used.has(w)) || null;
      model.days.push(emptyDay(free));
      renderDays();
      el.querySelector(`[data-day="${model.days.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (e.target.closest('#p-save')) return savePlan();
  });

  async function savePlan() {
    const btn = el.querySelector('#p-save');
    model.title = el.querySelector('#p-title').value.trim();

    if (!model.title) { toast('请填写计划名称'); el.querySelector('#p-title').focus(); return; }
    const validDays = model.days.filter(d => d.exercises.length);
    if (!validDays.length) { toast('至少给某一天添加动作'); return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '保存中…';
    try {
      const payload = {
        title: model.title,
        goal: model.goal,
        level: model.level,
        weeks: model.weeks,
        summary: el.querySelector('#p-summary').value.trim(),
        days: validDays.map(d => ({
          name: d.name || `${d.weekday ? WEEKDAYS[d.weekday - 1] : '第'}训练`,
          focus: d.focus,
          weekday: d.weekday,
          exercises: d.exercises.map(ex => ({
            exerciseId: ex.exerciseId,
            sets: ex.sets,
            reps: ex.reps,
            rest: ex.rest,
          })),
        })),
      };
      const plan = editId ? await api.updatePlan(editId, payload) : await api.createPlan(payload);
      toast(editId ? '已保存' : '计划已创建');
      nav(`/plans/${plan.id}`);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}
