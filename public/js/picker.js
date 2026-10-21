/* 动作选择器（训练记录页与计划编辑页共用） */
import { esc, icon, thumb, openSheet, closeSheet, toast } from './core.js';
import { api } from './api.js';

const CATS = [
  { key: '', label: '全部' },
  { key: 'chest', label: '胸部' },
  { key: 'back', label: '背部' },
  { key: 'shoulders', label: '肩部' },
  { key: 'upper arms', label: '手臂' },
  { key: 'upper legs', label: '腿部' },
  { key: 'waist', label: '核心' },
  { key: 'lower legs', label: '小腿' },
  { key: 'cardio', label: '有氧' },
];

/**
 * 打开动作选择器
 * @param {object} opts
 * @param {string}   opts.title      标题
 * @param {boolean}  opts.multiple   是否多选（默认 true；单选点一下即确认）
 * @param {string[]} opts.excludeIds 已选中的动作（置灰）
 * @param {(list: object[]) => void} opts.onConfirm 确认回调
 */
export function openExercisePicker({ title = '选择动作', multiple = true, excludeIds = [], onConfirm }) {
  let cat = '';
  let query = '';
  let page = 1;
  let items = [];
  let total = 0;
  let loading = false;
  const selected = new Map();
  const excluded = new Set(excludeIds);

  return openSheet({
    title,
    full: true,
    content: `
      <div style="padding:12px 20px 0">
        <div class="search-wrap">
          ${icon('search')}
          <input class="input" id="ex-search" placeholder="搜索动作名称，如：卧推 / 深蹲 / 弯举" autocomplete="off" />
        </div>
        <div class="chips" style="margin-top:10px">
          ${CATS.map(c => `<button class="chip ${c.key === '' ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`).join('')}
        </div>
      </div>
      <div id="ex-results" style="padding:0 20px 24px"></div>
      <div id="ex-more-wrap" style="padding:0 20px 16px"></div>
      <div id="pick-bar" style="position:sticky;bottom:0;padding:12px 20px calc(12px + var(--safe-b));background:var(--bg-elevated);backdrop-filter:blur(20px);border-top:1px solid var(--line)">
        <button class="btn btn-block" id="pick-confirm" disabled>请选择动作</button>
      </div>`,
    onMount(s) {
      const search = s.querySelector('#ex-search');
      const results = s.querySelector('#ex-results');
      const moreWrap = s.querySelector('#ex-more-wrap');
      const confirmBtn = s.querySelector('#pick-confirm');

      const confirmText = (n) => (multiple ? (n ? `添加 ${n} 个动作` : '请选择动作') : '选择这个动作');

      const renderList = () => {
        if (loading && !items.length) {
          results.innerHTML = Array.from({ length: 6 }, () => `
            <div style="display:flex;gap:12px;align-items:center;padding:12px 0">
              <div class="skeleton" style="width:44px;height:44px;border-radius:12px"></div>
              <div style="flex:1"><div class="skeleton" style="height:14px;width:60%;margin-bottom:8px"></div>
              <div class="skeleton" style="height:12px;width:35%"></div></div>
            </div>`).join('');
          return;
        }
        if (!items.length) {
          results.innerHTML = `<div class="empty">${icon('search')}<h3>没有找到相关动作</h3><p>换个关键词，或切换部位筛选。</p></div>`;
          moreWrap.innerHTML = '';
          return;
        }
        results.innerHTML = `
          <div class="muted" style="padding:8px 0">${query || cat ? `找到 ${total} 个动作` : `共 ${total} 个动作`}</div>
          <div class="list">
            ${items.map(ex => `
              <button class="row" data-ex-id="${ex.id}" style="align-items:center" ${excluded.has(ex.id) ? 'disabled' : ''}>
                ${thumb(ex, 'thumb thumb-sm')}
                <div class="row-main">
                  <div class="row-title" style="font-size:15px">${esc(ex.zh)}</div>
                  <div class="row-sub">${esc(ex.en)}</div>
                </div>
                <div class="row-end" style="gap:6px">
                  <span class="tag">${esc(ex.equipZh)}</span>
                  ${excluded.has(ex.id)
                    ? '<span class="tag">已添加</span>'
                    : `<span class="pick-mark" data-mark="${ex.id}" style="width:24px;height:24px;border-radius:50%;border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center;color:transparent">
                        ${icon('check')}
                      </span>`}
                </div>
              </button>`).join('')}
          </div>`;
        moreWrap.innerHTML = items.length < total
          ? `<button class="btn btn-secondary btn-block" id="load-more">加载更多（${items.length}/${total}）</button>`
          : `<p class="muted" style="text-align:center;padding:8px">已经到底了</p>`;
        moreWrap.querySelector('#load-more')?.addEventListener('click', () => load(true));
      };

      const syncSelected = () => {
        s.querySelectorAll('[data-ex-id]').forEach(row => {
          const on = selected.has(row.dataset.exId);
          const mark = row.querySelector('[data-mark]');
          if (!mark) return;
          mark.style.background = on ? 'var(--accent)' : 'transparent';
          mark.style.borderColor = on ? 'var(--accent)' : 'var(--line-strong)';
          mark.style.color = on ? '#fff' : 'transparent';
        });
        confirmBtn.disabled = selected.size === 0;
        confirmBtn.textContent = confirmText(selected.size);
      };

      const load = async (append = false) => {
        if (loading) return;
        loading = true;
        if (!append) { page = 1; items = []; }
        renderList();
        try {
          const res = await api.exercises({ q: query, cat, page, pageSize: 30 });
          total = res.total;
          items = append ? [...items, ...res.items] : res.items;
          renderList();
          syncSelected();
        } catch (e) {
          results.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
        } finally { loading = false; }
      };

      let timer;
      search.addEventListener('input', () => {
        query = search.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => load(), 260);
      });

      s.addEventListener('click', async (e) => {
        if (e.target.closest('#load-more')) { page += 1; load(true); return; }

        const chip = e.target.closest('[data-cat]');
        if (chip) {
          cat = chip.dataset.cat;
          s.querySelectorAll('[data-cat]').forEach(c => c.classList.toggle('active', c === chip));
          load();
          return;
        }

        const row = e.target.closest('[data-ex-id]');
        if (!row || row.disabled) return;
        const id = row.dataset.exId;
        const ex = items.find(i => i.id === id);

        if (!multiple) {
          onConfirm([ex]);
          closeSheet();
          return;
        }
        if (selected.has(id)) selected.delete(id);
        else selected.set(id, ex);
        syncSelected();
      });

      confirmBtn.addEventListener('click', () => {
        if (!selected.size) return;
        onConfirm([...selected.values()]);
        closeSheet();
      });

      load();
      setTimeout(() => search.focus(), 320);
    },
  });
}
