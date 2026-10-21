import {
  $, esc, icon, toast, fmtVolume, fmtNum, timeAgo, dateLabel, confirmSheet,
} from '../core.js';
import { api } from '../api.js';

/**
 * 训练动态详情：只读的训练明细 + 留言
 * 路由 /feed/:id
 */
export default async function postView({ el, params, nav }) {
  const id = Number(params[0]);
  let post = null;

  el.classList.add('page-with-composer');

  el.innerHTML = `
    <div class="post-top">
      <button class="icon-btn" data-back aria-label="返回">${icon('arrowLeft')}</button>
      <div class="eyebrow">训练动态</div>
      <div style="width:38px"></div>
    </div>
    <div id="post-body">
      <div class="card skeleton-card" style="height:180px"></div>
    </div>
  `;

  const body = $('#post-body', el);
  el.querySelector('[data-back]').addEventListener('click', () => nav('/feed'));

  try {
    post = await api.feedPost(id);
  } catch (e) {
    body.innerHTML = `<div class="card empty">${icon('lock')}<h3>看不到这次训练</h3>
      <p>${esc(e.message)}</p>
      <button class="btn btn-sm" data-nav="/feed">回到动态</button></div>`;
    return;
  }

  document.title = `${post.title} · 动态 · FitLog`;
  render();
  bind();

  function setsText(sets) {
    const done = (sets || []).filter(s => s.done);
    if (!done.length) return '未完成任何组';
    return done.map(s => `${s.weight ? s.weight : '自重'}×${s.reps}`).join(' · ');
  }

  function render() {
    const vol = fmtVolume(post.stats.volume);

    body.innerHTML = `
      <div class="card post-card">
        <header class="feed-head">
          <div class="user-avatar">${esc(post.author.initial)}</div>
          <div class="user-meta">
            <div class="user-name">
              ${esc(post.author.displayName)}
              ${post.isMine ? '<span class="tag" style="margin-left:6px">我</span>' : ''}
              ${post.author.isAdmin && !post.isMine ? '<span class="tag" style="margin-left:6px">Admin</span>' : ''}
            </div>
            <div class="user-sub">${esc(timeAgo(post.sharedAt || post.finishedAt))} · ${esc(dateLabel(post.date))}</div>
          </div>
          ${post.isMine ? `<button class="btn btn-ghost btn-sm" data-toggle-share>
            ${post.shared ? '取消分享' : '分享出去'}</button>` : ''}
        </header>

        <h1 class="post-title">${esc(post.title)}</h1>
        ${post.notes ? `<p class="post-notes">${esc(post.notes)}</p>` : ''}

        <div class="post-stats">
          <div class="feed-stat"><b class="mono-num">${vol.value}</b><span>${vol.unit} 容量</span></div>
          <div class="feed-stat"><b class="mono-num">${post.stats.doneSets}</b><span>组完成</span></div>
          <div class="feed-stat"><b class="mono-num">${post.stats.totalReps}</b><span>总次数</span></div>
          <div class="feed-stat"><b class="mono-num">${post.stats.exerciseCount}</b><span>个动作</span></div>
        </div>

        ${!post.shared ? `<div class="post-banner">${icon('lock')} 这次训练目前只有你自己能看到</div>` : ''}
      </div>

      <div class="section">
        <div class="section-head">
          <h2>动作明细</h2>
          <span class="muted">${post.stats.exerciseCount} 个动作</span>
        </div>
        <div class="card" style="padding:4px 18px">
          <div class="list">
            ${post.exercises.map(ex => `
              <div class="row" style="cursor:default">
                <div class="row-main">
                  <div class="row-title">${esc(ex.name)}</div>
                  <div class="row-sub">${esc(setsText(ex.sets))}</div>
                </div>
                <div class="row-end mono-num">${fmtNum(ex.sets.filter(s => s.done).length)} 组</div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <h2>留言</h2>
          <span class="muted" id="cmt-count">${post.comments.length} 条</span>
        </div>
        <div id="comments"></div>
      </div>

      <div class="composer">
        <input class="input" id="cmt-input" maxlength="500" placeholder="说点什么，给个鼓励…"
          enterkeyhint="send" autocomplete="off" />
        <button class="btn btn-sm" id="cmt-send">${icon('send')} 发送</button>
      </div>
    `;

    renderComments();
  }

  function renderComments() {
    const box = $('#comments', el);
    if (!box) return;
    if (!post.comments.length) {
      box.innerHTML = `<div class="card empty" style="padding:26px">
        ${icon('chat')}<h3>还没有留言</h3><p>第一个来评价这次训练吧。</p></div>`;
      return;
    }
    box.innerHTML = `<div class="card" style="padding:6px 16px">${post.comments.map(c => `
      <div class="cmt" data-cmt="${c.id}">
        <div class="user-avatar sm">${esc(c.author.initial)}</div>
        <div class="cmt-main">
          <div class="cmt-head">
            <b>${esc(c.author.displayName)}</b>
            ${c.author.isAdmin ? '<span class="tag">Admin</span>' : ''}
            <span class="muted">${esc(timeAgo(c.createdAt))}</span>
          </div>
          <div class="cmt-text">${esc(c.content)}</div>
        </div>
        ${c.canDelete ? `<button class="icon-btn" data-del="${c.id}" aria-label="删除留言">${icon('trash')}</button>` : ''}
      </div>`).join('')}</div>`;
    const countEl = $('#cmt-count', el);
    if (countEl) countEl.textContent = `${post.comments.length} 条`;
  }

  function bind() {
    el.addEventListener('click', async (e) => {
      const shareBtn = e.target.closest('[data-toggle-share]');
      if (shareBtn) {
        shareBtn.disabled = true;
        try {
          const updated = await api.shareWorkout(post.id, !post.shared);
          post.shared = updated.shared;
          post.sharedAt = updated.sharedAt;
          toast(updated.shared ? '已分享到动态' : '已取消分享');
          render();
        } catch (err) {
          toast(err.message);
          shareBtn.disabled = false;
        }
        return;
      }

      const sendBtn = e.target.closest('#cmt-send');
      if (sendBtn) return send();

      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const cid = Number(delBtn.dataset.del);
        const ok = await confirmSheet({
          title: '删除这条留言？',
          message: '删除后无法恢复。',
          confirmText: '删除',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteComment(cid);
          post.comments = post.comments.filter(c => c.id !== cid);
          renderComments();
          toast('已删除');
        } catch (err) { toast(err.message); }
      }
    });

    el.addEventListener('keydown', (e) => {
      if (e.target.id === 'cmt-input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  async function send() {
    const input = $('#cmt-input', el);
    const btn = $('#cmt-send', el);
    if (!input || !btn) return;
    const content = input.value.trim();
    if (!content) { input.focus(); return; }

    btn.disabled = true;
    input.disabled = true;
    try {
      const c = await api.addComment(post.id, content);
      post.comments.push(c);
      input.value = '';
      renderComments();
      const countEl = $('#cmt-count', el);
      if (countEl) countEl.textContent = `${post.comments.length} 条`;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }
}
