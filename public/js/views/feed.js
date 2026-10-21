import { $, esc, icon, toast, fmtVolume, timeAgo, dateLabel } from '../core.js';
import { api } from '../api.js';

/**
 * 训练动态列表：所有人分享出来的训练
 * 点击卡片进入 /feed/:id 查看明细与留言
 */
export default async function feedView({ el, nav }) {
  let scope = 'all';
  let items = [];

  el.innerHTML = `
    <div style="margin:6px 0 18px">
      <div class="eyebrow">训练动态</div>
      <h1 class="display" style="margin-top:8px">动态</h1>
      <p class="muted" style="margin-top:8px;font-size:14px">
        练完把成果发出来，看看别人今天练了什么，顺手留句话。
      </p>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px">
      <div class="segmented" id="scope">
        <button data-scope="all" class="active">全部</button>
        <button data-scope="mine">我分享的</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="refresh">${icon('refresh')} 刷新</button>
    </div>

    <div id="feed-list" class="feed-list"></div>
  `;

  const listEl = $('#feed-list', el);

  function skeleton() {
    listEl.innerHTML = Array.from({ length: 3 }, () => `
      <div class="card feed-card">
        <div class="feed-head">
          <div class="skeleton" style="width:36px;height:36px;border-radius:50%"></div>
          <div style="flex:1">
            <div class="skeleton" style="width:96px;height:13px;border-radius:6px"></div>
            <div class="skeleton" style="width:64px;height:11px;border-radius:6px;margin-top:6px"></div>
          </div>
        </div>
        <div class="skeleton" style="height:16px;width:52%;border-radius:6px;margin:16px 0 12px"></div>
        <div class="skeleton" style="height:34px;border-radius:10px"></div>
      </div>`).join('');
  }

  function emptyHTML() {
    if (scope === 'mine') {
      return `
        <div class="card empty">
          ${icon('community')}
          <h3>你还没有分享过训练</h3>
          <p>练完点「完成训练」，勾上「公开到训练动态」，其他人就能看到并留言。</p>
          <button class="btn btn-sm" data-nav="/">去练一场</button>
        </div>`;
    }
    return `
      <div class="card empty">
        ${icon('community')}
        <h3>还没有人分享训练</h3>
        <p>完成一次训练后选择公开，这里就会出现你的训练成果。</p>
        <button class="btn btn-sm" data-nav="/">去练一场</button>
      </div>`;
  }

  function render() {
    if (!items.length) { listEl.innerHTML = emptyHTML(); return; }

    listEl.innerHTML = items.map((p) => {
      const vol = fmtVolume(p.stats.volume);
      const comments = (p.lastComments || []).map(c => `
        <div class="feed-cmt"><b>${esc(c.author.displayName)}</b>${esc(c.content)}</div>`).join('');

      return `
        <article class="card feed-card" data-post="${p.id}">
          <header class="feed-head">
            <div class="user-avatar sm">${esc(p.author.initial)}</div>
            <div class="user-meta">
              <div class="user-name">
                ${esc(p.author.displayName)}
                ${p.isMine ? '<span class="tag" style="margin-left:6px">我</span>' : ''}
                ${p.author.isAdmin && !p.isMine ? '<span class="tag" style="margin-left:6px">Admin</span>' : ''}
              </div>
              <div class="user-sub">${esc(timeAgo(p.sharedAt))} · ${esc(dateLabel(p.date))}</div>
            </div>
            <button class="icon-btn" aria-label="查看详情">${icon('chevronRight')}</button>
          </header>

          <h3 class="feed-title">${esc(p.title)}</h3>

          <div class="feed-stats">
            <div class="feed-stat"><b class="mono-num">${vol.value}</b><span>${vol.unit} 容量</span></div>
            <div class="feed-stat"><b class="mono-num">${p.stats.doneSets}</b><span>组完成</span></div>
            <div class="feed-stat"><b class="mono-num">${p.stats.exerciseCount}</b><span>个动作</span></div>
          </div>

          ${p.exercises.length ? `<div class="ex-tags" style="margin-top:12px">
            ${p.exercises.map(x => `<span class="tag">${esc(x.name)}${x.doneSets ? ` ×${x.doneSets}` : ''}</span>`).join('')}
          </div>` : ''}

          ${comments ? `<div class="feed-cmts">${comments}</div>` : ''}

          <footer class="feed-foot">
            <span>${icon('chat')} ${p.commentCount ? `${p.commentCount} 条留言` : '还没有留言'}</span>
            <span class="feed-more">查看训练明细 ${icon('chevronRight')}</span>
          </footer>
        </article>`;
    }).join('');
  }

  async function load() {
    skeleton();
    try {
      items = await api.feed({ scope, limit: 30 });
      render();
    } catch (e) {
      listEl.innerHTML = `<div class="card empty">${icon('x')}<h3>加载失败</h3><p>${esc(e.message)}</p></div>`;
      toast(e.message);
    }
  }

  el.addEventListener('click', (e) => {
    const scopeBtn = e.target.closest('[data-scope]');
    if (scopeBtn) {
      scope = scopeBtn.dataset.scope;
      el.querySelectorAll('[data-scope]').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
      load();
      return;
    }
    const post = e.target.closest('[data-post]');
    if (post) nav(`/feed/${post.dataset.post}`);
  });

  $('#refresh', el).addEventListener('click', load);

  await load();
}
