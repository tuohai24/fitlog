import { esc, icon, thumb, toast } from '../core.js';
import { api } from '../api.js';

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

const EQUIPS = [
  { key: '', label: '全部器械' },
  { key: 'barbell', label: '杠铃' },
  { key: 'dumbbell', label: '哑铃' },
  { key: 'cable', label: '绳索' },
  { key: 'leverage machine', label: '固定器械' },
  { key: 'body weight', label: '自重' },
  { key: 'smith machine', label: '史密斯机' },
  { key: 'kettlebell', label: '壶铃' },
  { key: 'band', label: '弹力带' },
];

export default async function exercisesView({ el, nav }) {
  let cat = '';
  let equip = '';
  let query = '';
  let page = 1;
  let items = [];
  let total = 0;
  let loading = false;
  let meta = { total: 0 };

  el.innerHTML = `
    <div style="margin:6px 0 16px">
      <div class="eyebrow">${meta.total || ''}动作讲解 · 动图 · 肌肉部位</div>
      <h1 class="display" style="margin-top:8px">动作库</h1>
      <p class="sub" style="margin-top:10px">搜索或按部位浏览，点开任意动作查看动图示范、肌群示意图与完整讲解。</p>
    </div>

    <div class="search-wrap">
      ${icon('search')}
      <input class="input" id="lib-search" placeholder="搜索动作、目标肌群或器械" autocomplete="off" />
    </div>

    <div class="chips" style="margin-top:12px">
      ${CATS.map(c => `<button class="chip ${c.key === '' ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`).join('')}
    </div>
    <div class="chips" style="margin-top:2px;padding-bottom:4px">
      ${EQUIPS.map(c => `<button class="chip ${c.key === '' ? 'active' : ''}" data-equip="${c.key}">${c.label}</button>`).join('')}
    </div>

    <div id="lib-count" class="muted" style="margin:10px 0 8px"></div>
    <div id="lib-list"></div>
    <div id="lib-more" style="padding:4px 0 8px"></div>`;

  const listEl = el.querySelector('#lib-list');
  const moreEl = el.querySelector('#lib-more');
  const countEl = el.querySelector('#lib-count');

  const skeleton = () => Array.from({ length: 7 }, () => `
    <div style="display:flex;gap:12px;align-items:center;padding:12px 0">
      <div class="skeleton" style="width:44px;height:44px;border-radius:12px"></div>
      <div style="flex:1"><div class="skeleton" style="height:14px;width:55%;margin-bottom:8px"></div>
      <div class="skeleton" style="height:12px;width:30%"></div></div>
    </div>`).join('');

  const render = () => {
    if (loading && !items.length) { listEl.innerHTML = skeleton(); return; }

    if (!items.length) {
      listEl.innerHTML = `<div class="empty">${icon('search')}<h3>没有找到相关动作</h3><p>换个关键词，或切换部位/器械筛选。</p></div>`;
      moreEl.innerHTML = '';
      countEl.textContent = '';
      return;
    }

    countEl.textContent = query || cat || equip ? `找到 ${total} 个动作` : `共 ${total} 个动作`;

    // 前 6 个用大卡片，其余用紧凑行，兼顾浏览效率与视觉节奏
    const featured = page === 1 && !query && !cat && !equip ? items.slice(0, 6) : [];
    const rest = featured.length ? items.slice(6) : items;

    listEl.innerHTML = `
      ${featured.length ? `
        <div class="ex-feature">${featured.map(ex => `
          <button class="ex-tile" data-nav="/exercises/${ex.id}">
            <span class="ex-tile-media">${thumb(ex, 'ex-tile-img')}</span>
            <span class="ex-tile-body">
              <span class="ex-tile-name">${esc(ex.zh)}</span>
              <span class="ex-tile-meta">${esc(ex.targetZh || '')}</span>
            </span>
          </button>`).join('')}
        </div>
        <div class="section-head" style="margin:22px 0 6px"><h2 style="font-size:17px">全部动作</h2></div>` : ''}
      <div class="card" style="padding:4px 18px">
        ${rest.map(ex => `
          <button class="row" data-nav="/exercises/${ex.id}" style="align-items:center">
            ${thumb(ex, 'thumb thumb-sm')}
            <div class="row-main">
              <div class="row-title" style="font-size:15px">${esc(ex.zh)}</div>
              <div class="row-sub">${esc(ex.en)}</div>
            </div>
            <div class="row-end" style="gap:6px">
              <span class="tag">${esc(ex.equipZh || '')}</span>
              ${icon('chevronRight', 'chevron')}
            </div>
          </button>`).join('')}
      </div>`;

    moreEl.innerHTML = items.length < total
      ? `<button class="btn btn-secondary btn-block" id="lib-more-btn">加载更多（${items.length}/${total}）</button>`
      : `<p class="muted" style="text-align:center;padding:10px">已经到底了</p>`;
    moreEl.querySelector('#lib-more-btn')?.addEventListener('click', () => load(true));
  };

  const load = async (append = false) => {
    if (loading) return;
    loading = true;
    if (!append) { page = 1; items = []; }
    render();
    try {
      const res = await api.exercises({ q: query, cat, equip, page, pageSize: 40 });
      total = res.total;
      items = append ? [...items, ...res.items] : res.items;
      render();
    } catch (e) {
      listEl.innerHTML = `<div class="empty">${icon('x')}<h3>加载失败</h3><p>${esc(e.message)}</p></div>`;
    } finally { loading = false; }
  };

  let timer;
  el.querySelector('#lib-search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(() => load(), 260);
  });

  el.addEventListener('click', (e) => {
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      cat = catBtn.dataset.cat;
      el.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b === catBtn));
      load();
      return;
    }
    const equipBtn = e.target.closest('[data-equip]');
    if (equipBtn) {
      equip = equipBtn.dataset.equip;
      el.querySelectorAll('[data-equip]').forEach(b => b.classList.toggle('active', b === equipBtn));
      load();
    }
  });

  // 顶部总数（异步填充，不阻塞首屏）
  api.exerciseMeta()
    .then((m) => {
      meta = m;
      const tag = el.querySelector('.eyebrow');
      if (tag) tag.textContent = `${m.total} 个动作 · 动图 · 肌肉部位 · 中文讲解`;
    })
    .catch(() => toast('动作库统计加载失败'));

  load();
}
