import {
  $, $$, esc, icon, toast, thumb, dateLabel, todayStr, openSheet, closeSheet, confirmSheet, fmtNum,
} from '../core.js';
import { api } from '../api.js';
import { openExercisePicker } from '../picker.js';
import { openExerciseGuideSheet } from './exercise-detail.js';

/* =========================== 状态 =========================== */
let state = null;
let saveTimer = null;
let saving = false;

const normalize = (w) => ({
  id: w.id,
  date: w.date,
  title: w.title || '',
  notes: w.notes || '',
  finishedAt: w.finishedAt || null,
  shared: !!w.shared,
  sharedAt: w.sharedAt || null,
  commentCount: w.commentCount || 0,
  exercises: (w.exercises || []).map(e => ({
    id: e.id,
    exerciseId: e.exerciseId,
    exercise: e.exercise,
    note: e.note || '',
    lastHint: '',
    sets: (e.sets || []).map(s => ({ weight: s.weight, reps: s.reps, done: !!s.done, kind: s.kind || 'normal' })),
  })),
});

export default async function logView({ el, params, nav }) {
  const id = Number(params[0]);
  const data = await api.workout(id);
  state = normalize(data);
  document.title = `${state.title || '训练'} · FitLog`;

  render(el);
  bind(el, nav);
  loadHints(el);
}

/* =========================== 渲染 =========================== */
function render(el) {
  const totalVolume = state.exercises.reduce((acc, ex) =>
    acc + ex.sets.reduce((a, s) => a + (s.done ? s.weight * s.reps : 0), 0), 0);
  const doneSets = state.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 6px">
      <button class="icon-btn" data-back aria-label="返回">${icon('arrowLeft')}</button>
      <div style="text-align:center;flex:1">
        <button class="eyebrow" data-edit-date
          style="position:relative;top:2px;border:none;background:none;cursor:pointer;color:var(--text-2)">
          ${dateLabel(state.date, true)}
        </button>
      </div>
      <div id="save-state" class="muted" style="min-width:56px;text-align:right">${state.finishedAt ? '已完成' : '未保存'}</div>
    </div>

    <input id="w-title" class="input" value="${esc(state.title)}" placeholder="训练名称，如：胸 + 三头"
      style="border:none;background:transparent;font-size:26px;font-weight:600;letter-spacing:-0.03em;padding:8px 0;margin-bottom:4px" />
    <div class="muted" style="margin-bottom:18px;padding-left:2px">
      ${state.exercises.length} 个动作 · ${doneSets} 组完成 · ${fmtNum(totalVolume)} kg 容量
    </div>

    ${state.shared ? `
      <button class="share-chip" data-open-post>
        ${icon('community')}
        <span>已分享到训练动态</span>
        <span class="share-chip-count">${state.commentCount} 条留言</span>
        ${icon('chevronRight', 'chevron')}
      </button>` : `
      <button class="share-chip quiet" data-toggle-share>
        ${icon('lock')}
        <span>这次训练只有你自己可见</span>
        <span class="share-chip-count">点这里分享</span>
      </button>`}

    <div id="ex-list">
      ${state.exercises.length ? state.exercises.map((ex, i) => exerciseCard(ex, i)).join('') : `
        <div class="card empty" style="margin-bottom:14px">
          ${icon('dumbbell')}
          <h3>还没有动作</h3>
          <p>从 1,324 个动作中挑选，或直接搜索名称。</p>
        </div>`}
    </div>

    <button class="btn btn-secondary btn-block" data-add-ex style="margin-top:4px">
      ${icon('plus')} 添加动作
    </button>

    <div class="card" style="margin-top:16px;padding:14px 16px">
      <div class="eyebrow" style="margin-bottom:8px">训练备注</div>
      <textarea id="w-notes" class="textarea" placeholder="今天状态如何？动作感受、注意事项…"
        style="border:none;background:transparent;padding:0;min-height:60px">${esc(state.notes)}</textarea>
    </div>

    <div style="height:12px"></div>

    <div class="action-bar">
      <button class="btn btn-block btn-lg" data-finish>完成训练</button>
      ${state.exercises.length ? `<button class="icon-btn" data-del-workout aria-label="删除训练" style="width:52px;height:52px">${icon('trash')}</button>` : ''}
    </div>
  `;
}

function exerciseCard(ex, i) {
  const name = ex.exercise?.zh || ex.exerciseId;
  const tags = [ex.exercise?.equipZh, ex.exercise?.targetZh].filter(Boolean);
  const hint = ex.lastHint
    || (ex.exercise?.equip === 'body weight' ? '自重动作，重量填 0 即可' : '');

  return `
    <div class="card ex-card" data-ex="${i}" style="margin-bottom:12px">
      <div class="ex-head">
        ${thumb(ex.exercise)}
        <div style="flex:1;min-width:0">
          <div class="row-title" style="display:flex;align-items:center;gap:6px">
            <span data-detail="${ex.exerciseId}" style="cursor:pointer">${esc(name)}</span>
          </div>
          <div class="ex-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          ${hint ? `<div class="muted" style="margin-top:5px">${esc(hint)}</div>` : ''}
        </div>
        <button class="icon-btn" data-menu="${i}" aria-label="更多">${icon('ellipsis')}</button>
      </div>

      <div class="set-head"><span>组</span><span>重量 kg</span><span>次数</span><span>完成</span></div>
      ${ex.sets.map((s, j) => setRow(s, i, j)).join('')}

      <div class="set-tools">
        <button class="btn btn-ghost btn-sm" data-add-set="${i}">${icon('plus')} 加一组</button>
        <div style="display:flex;gap:2px">
          ${ex.sets.length > 1 ? `<button class="btn btn-ghost btn-sm" data-del-set="${i}">删除末组</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-copy-set="${i}">复制上一组</button>
        </div>
      </div>
    </div>`;
}

function setRow(s, i, j) {
  return `
    <div class="set-row ${s.done ? 'done' : ''}" data-row="${i}-${j}">
      <button class="set-index ${s.kind === 'normal' ? '' : s.kind}" data-kind="${i}-${j}"
        title="点击切换 普通/热身/力竭">${s.kind === 'warmup' ? 'W' : s.kind === 'failure' ? 'F' : j + 1}</button>
      <input class="set-input" type="number" inputmode="decimal" step="2.5" min="0" enterkeyhint="next"
        value="${s.weight ? s.weight : ''}" placeholder="0" data-field="weight" data-pos="${i}-${j}" aria-label="重量" />
      <input class="set-input" type="number" inputmode="numeric" step="1" min="0" enterkeyhint="done"
        value="${s.reps ? s.reps : ''}" placeholder="0" data-field="reps" data-pos="${i}-${j}" aria-label="次数" />
      <button class="set-check ${s.done ? 'on' : ''}" data-done="${i}-${j}" aria-label="标记完成">${icon('check')}</button>
    </div>`;
}

/* =========================== 事件 =========================== */
function openDateSheet(el, nav) {
  openSheet({
    title: '修改训练日期',
    content: `
      <input class="input" type="date" id="date-input" value="${state.date}" max="${todayStr()}" />
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-secondary btn-block" id="date-today">回到今天</button>
        <button class="btn btn-block" id="date-save">保存</button>
      </div>`,
    onMount(sheet) {
      const input = sheet.querySelector('#date-input');
      sheet.querySelector('#date-today').addEventListener('click', () => { input.value = todayStr(); });
      sheet.querySelector('#date-save').addEventListener('click', () => {
        if (!input.value) return;
        state.date = input.value;
        markDirty();
        closeSheet();
        render(el);
        loadHints(el);
      });
    },
  });
}

/* 用属性赋值而不是 addEventListener：局部重渲染后可以安全地重复调用 */
function bind(el, nav) {
  el.oninput = (e) => {
    if (e.target.id === 'w-title') { state.title = e.target.value; markDirty(); return; }
    if (e.target.id === 'w-notes') { state.notes = e.target.value; markDirty(); return; }

    const pos = e.target.dataset.pos;
    if (!pos || !e.target.dataset.field) return;
    const [i, j] = pos.split('-').map(Number);
    const v = e.target.value === '' ? 0 : Number(e.target.value);
    state.exercises[i].sets[j][e.target.dataset.field] = Number.isFinite(v) ? v : 0;
    markDirty();
    updateSummary(el);
  };

  el.onclick = async (e) => {
    if (e.target.closest('[data-back]')) return nav('/');
    if (e.target.closest('[data-edit-date]')) return openDateSheet(el, nav);

    const addEx = e.target.closest('[data-add-ex]');
    if (addEx) {
      return openExercisePicker({
        title: '选择动作',
        excludeIds: state.exercises.map(x => x.exerciseId),
        onConfirm: async (list) => {
          try {
            for (const ex of list) await addExercise(ex, el);
            render(el);
            loadHints(el);
            toast(`已添加 ${list.length} 个动作`);
          } catch (err) { toast(err.message); }
        },
      });
    }

    const detailId = e.target.closest('[data-detail]')?.dataset.detail;
    if (detailId) return openExerciseGuideSheet(detailId, {});

    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) return openExerciseMenu(Number(menuBtn.dataset.menu), el);

    const addSet = e.target.closest('[data-add-set]');
    if (addSet) {
      const i = Number(addSet.dataset.addSet);
      const sets = state.exercises[i].sets;
      const last = sets[sets.length - 1] || { weight: 0, reps: 10 };
      sets.push({ weight: last.weight, reps: last.reps, done: false, kind: 'normal' });
      markDirty(); render(el); return;
    }

    const delSet = e.target.closest('[data-del-set]');
    if (delSet) {
      const i = Number(delSet.dataset.delSet);
      state.exercises[i].sets.pop();
      markDirty(); render(el); return;
    }

    const copySet = e.target.closest('[data-copy-set]');
    if (copySet) {
      const i = Number(copySet.dataset.copySet);
      const sets = state.exercises[i].sets;
      const last = sets[sets.length - 1];
      if (last) sets.push({ ...last, done: false });
      markDirty(); render(el); return;
    }

    const kindBtn = e.target.closest('[data-kind]');
    if (kindBtn) {
      const [i, j] = kindBtn.dataset.kind.split('-').map(Number);
      const order = ['normal', 'warmup', 'failure'];
      const cur = state.exercises[i].sets[j].kind || 'normal';
      state.exercises[i].sets[j].kind = order[(order.indexOf(cur) + 1) % order.length];
      markDirty(); render(el); return;
    }

    const doneBtn = e.target.closest('[data-done]');
    if (doneBtn) {
      const [i, j] = doneBtn.dataset.done.split('-').map(Number);
      const s = state.exercises[i].sets[j];
      s.done = !s.done;
      // 完成时若次数为空，默认沿用上一组
      if (s.done && !s.reps) {
        const prev = state.exercises[i].sets[j - 1] || state.exercises[i].sets[0];
        s.reps = prev?.reps || 10;
      }
      markDirty(); render(el);
      if (navigator.vibrate) navigator.vibrate(8);
      return;
    }

    if (e.target.closest('[data-finish]')) {
      openFinishSheet(el, nav);
      return;
    }

    const openPost = e.target.closest('[data-open-post]');
    if (openPost) return nav(`/feed/${state.id}`);

    const toggleShare = e.target.closest('[data-toggle-share]');
    if (toggleShare) {
      toggleShare.disabled = true;
      try {
        const res = await api.shareWorkout(state.id, !state.shared);
        state.shared = res.shared;
        state.sharedAt = res.sharedAt;
        state.commentCount = res.commentCount;
        toast(res.shared ? '已分享到动态' : '已取消分享');
        render(el);
        bind(el, nav);
        loadHints(el);
      } catch (err) {
        toast(err.message);
        toggleShare.disabled = false;
      }
      return;
    }

    if (e.target.closest('[data-del-workout]')) {
      const ok = await confirmSheet({
        title: '删除这次训练？',
        message: '删除后无法恢复，所有组数记录都会一起清除。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteWorkout(state.id);
        toast('已删除');
        nav('/');
      } catch (err) { toast(err.message); }
    }
  };
}

/* =========================== 完成训练 =========================== */
function openFinishSheet(el, nav) {
  const totalVolume = state.exercises.reduce((acc, ex) =>
    acc + ex.sets.reduce((a, s) => a + (s.done ? s.weight * s.reps : 0), 0), 0);
  const doneSets = state.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  let share = state.shared;

  openSheet({
    title: '完成训练',
    content: `
      <div class="finish-summary">
        <div class="feed-stat"><b class="mono-num">${fmtNum(totalVolume)}</b><span>kg 容量</span></div>
        <div class="feed-stat"><b class="mono-num">${doneSets}</b><span>组完成</span></div>
        <div class="feed-stat"><b class="mono-num">${state.exercises.length}</b><span>个动作</span></div>
      </div>

      <button class="finish-share" data-share-row>
        <div class="row-main" style="text-align:left">
          <div class="row-title">公开到训练动态</div>
          <div class="row-sub">其他账号能看到这次训练，并给你留言</div>
        </div>
        <span class="switch ${share ? 'on' : ''}"><i></i></span>
      </button>

      <p class="muted" style="font-size:13px;margin-top:12px">保存后也能在训练记录里随时改。</p>

      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-secondary btn-block" data-cancel>再练一会儿</button>
        <button class="btn btn-block" data-confirm>完成并保存</button>
      </div>`,
    onMount(sheet) {
      const sw = sheet.querySelector('.switch');
      sheet.querySelector('[data-share-row]').addEventListener('click', () => {
        share = !share;
        sw.classList.toggle('on', share);
      });
      sheet.querySelector('[data-cancel]').addEventListener('click', () => closeSheet());
      sheet.querySelector('[data-confirm]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = '保存中…';
        try {
          state.finishedAt = new Date().toISOString();
          await save(true);
          const res = await api.finishWorkout(state.id, share);
          state.shared = res.shared;
          state.sharedAt = res.sharedAt;
          state.commentCount = res.commentCount;
          closeSheet();
          toast(share ? '已完成，并分享到动态' : '训练已保存');
          setTimeout(() => nav(share ? '/feed' : '/'), 240);
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          btn.textContent = '完成并保存';
        }
      });
    },
  });
}

/* =========================== 保存 =========================== */
function markDirty() {
  setSaveState('未保存');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false).catch(() => {}), 900);
}

function setSaveState(text, color) {
  const box = $('#save-state');
  if (!box) return;
  box.textContent = text;
  box.style.color = color || '';
}

async function save(finish = false) {
  if (saving) return;
  saving = true;
  clearTimeout(saveTimer);
  setSaveState('保存中…', 'var(--text-3)');
  try {
    const payload = {
      date: state.date,
      title: state.title,
      notes: state.notes,
      finishedAt: state.finishedAt,
      exercises: state.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        note: ex.note || null,
        sets: ex.sets.map(s => ({ weight: s.weight, reps: s.reps, done: s.done, kind: s.kind })),
      })),
    };
    await api.updateWorkout(state.id, payload);
    setSaveState(finish ? '已完成' : '已保存', 'var(--success)');
  } catch (e) {
    setSaveState('保存失败', 'var(--danger)');
    throw e;
  } finally {
    saving = false;
  }
}

function updateSummary(el) {
  const totalVolume = state.exercises.reduce((acc, ex) =>
    acc + ex.sets.reduce((a, s) => a + (s.done ? s.weight * s.reps : 0), 0), 0);
  const doneSets = state.exercises.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const sub = el.querySelector('.muted');
  if (sub && sub.textContent.includes('个动作')) {
    sub.textContent = `${state.exercises.length} 个动作 · ${doneSets} 组完成 · ${fmtNum(totalVolume)} kg 容量`;
  }
}

/* =========================== 上次训练提示 =========================== */
async function loadHints(el) {
  await Promise.all(state.exercises.map(async (ex, i) => {
    if (!ex.exerciseId) return;
    try {
      const { items } = await api.exerciseHistory(ex.exerciseId, 1);
      const last = items?.[0];
      if (!last || !last.sets?.length) return;
      const str = last.sets.filter(s => s.done).map(s => `${s.weight ? s.weight : '自重'}×${s.reps}`).slice(0, 4).join(' · ');
      if (!str) return;
      ex.lastHint = `上次 ${last.date.slice(5)}：${str}`;
      const hint = el.querySelector(`[data-ex="${i}"] .ex-tags`);
      if (hint && !hint.parentElement.querySelector('.last-hint')) {
        const div = document.createElement('div');
        div.className = 'muted last-hint';
        div.style.marginTop = '5px';
        div.textContent = ex.lastHint;
        hint.after(div);
      }
    } catch { /* 忽略提示失败 */ }
  }));
}

/* =========================== 动作菜单 =========================== */
function openExerciseMenu(index, el) {
  const ex = state.exercises[index];
  openSheet({
    title: ex.exercise?.zh || '动作',
    content: `
      <div class="list">
        <button class="row" data-act="detail"><div class="row-main"><div class="row-title">查看动作讲解</div></div>${icon('chevronRight', 'chevron')}</button>
        <button class="row" data-act="note"><div class="row-main"><div class="row-title">添加备注</div>
          <div class="row-sub">${esc(ex.note || '动作感受、器械设置…')}</div></div>${icon('chevronRight', 'chevron')}</button>
        <button class="row" data-act="up"><div class="row-main"><div class="row-title">上移</div></div>${icon('chevronRight', 'chevron')}</button>
        <button class="row" data-act="remove" style="color:var(--danger)"><div class="row-main"><div class="row-title" style="color:var(--danger)">从本次训练移除</div></div></button>
      </div>`,
    onMount(sheet) {
      sheet.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'detail') { closeSheet(); setTimeout(() => openExerciseGuideSheet(ex.exerciseId, {}), 240); }
        if (act === 'up') {
          if (index > 0) {
            const arr = state.exercises;
            [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
            markDirty(); closeSheet(); render(el);
          } else { toast('已经在最前面'); }
        }
        if (act === 'remove') {
          state.exercises.splice(index, 1);
          markDirty(); closeSheet(); render(el);
        }
        if (act === 'note') {
          closeSheet();
          setTimeout(() => {
            openSheet({
              title: '动作备注',
              content: `<textarea class="textarea" id="ex-note" placeholder="例如：第 3 组力竭，下次加 2.5kg">${esc(ex.note)}</textarea>
                <button class="btn btn-block" id="save-note" style="margin-top:14px">保存</button>`,
              onMount(s) {
                s.querySelector('#save-note').addEventListener('click', () => {
                  ex.note = s.querySelector('#ex-note').value;
                  markDirty(); closeSheet(); toast('备注已保存');
                });
              },
            });
          }, 260);
        }
      });
    },
  });
}

/* 加入动作：自动沿用上次的重量与次数 */
async function addExercise(ex, el) {
  let sets = [{ weight: 0, reps: 10, done: false, kind: 'normal' },
              { weight: 0, reps: 10, done: false, kind: 'normal' },
              { weight: 0, reps: 10, done: false, kind: 'normal' }];
  try {
    const { items } = await api.exerciseHistory(ex.id, 1);
    const last = items?.[0];
    if (last?.sets?.length) {
      sets = last.sets.filter(s => s.done).map(s => ({
        weight: s.weight || 0,
        reps: s.reps || 10,
        done: false,
        kind: s.kind || 'normal',
      }));
      if (!sets.length) throw new Error('empty');
      // 保持原组数，若上次只有 1-2 组则补齐到 3 组
      while (sets.length < 3) sets.push({ ...sets[sets.length - 1], done: false });
    }
  } catch { /* 首次训练，用默认 */ }

  state.exercises.push({
    id: null,
    exerciseId: ex.id,
    exercise: ex,
    note: '',
    lastHint: '',
    sets,
  });
  markDirty();
}
