import { $, esc, icon, toast, confirmSheet, openSheet, closeSheet } from '../core.js';
import { api } from '../api.js';

const RANGES = [
  { key: 'all', label: '全部' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: '365', label: '近一年' },
];

function isoShift(days) {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

export default async function meView({ el, nav }) {
  let settings = {};
  let formats = { formats: [], range: {}, planCount: 0 };
  try { settings = await api.settings(); } catch (e) { toast(e.message); }
  try { formats = await api.exportFormats(); } catch { /* 忽略 */ }

  const user = settings.user || { username: '', displayName: '', isAdmin: false };
  const initial = (user.displayName || user.username || '?').slice(0, 1).toUpperCase();

  el.innerHTML = `
    <div style="margin:6px 0 18px">
      <div class="eyebrow">账户与设置</div>
      <h1 class="display" style="margin-top:8px">我的</h1>
    </div>

    <div class="card user-card">
      <div class="user-avatar">${esc(initial)}</div>
      <div class="user-meta">
        <div class="user-name">${esc(user.displayName || user.username)}
          ${user.isAdmin ? '<span class="badge badge-ai" style="margin-left:6px">Admin</span>' : ''}
        </div>
        <div class="user-sub">@${esc(user.username)}</div>
      </div>
      <button class="icon-btn" id="edit-profile" aria-label="修改昵称">${icon('note')}</button>
    </div>

    <div class="grid-2" style="margin-top:14px">
      <div class="card stat-card">
        <div class="k">我的训练</div>
        <div class="v">${settings.workoutCount || 0}<span class="unit">次</span></div>
      </div>
      <div class="card stat-card">
        <div class="k">我的计划</div>
        <div class="v">${settings.planCount ?? 0}<span class="unit">份</span></div>
      </div>
    </div>

    <section class="section">
      <div class="section-head"><h2>导出数据</h2>
        <span class="muted">${formats.range?.count ? `共 ${formats.range.count} 次训练` : '暂无训练记录'}</span>
      </div>
      <div class="card">
        <div class="export-formats" id="export-formats">
          ${(formats.formats || []).map((f, i) => `
            <button class="fmt ${i === 0 ? 'active' : ''}" data-format="${f.key}">
              <span class="fmt-key">${esc(f.ext.toUpperCase())}</span>
              <span class="fmt-name">${esc(f.label)}</span>
              <span class="fmt-desc">${esc(f.desc)}</span>
            </button>`).join('')}
        </div>
        <div class="export-range" id="export-range">
          ${RANGES.map((r, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-range="${r.key}">${r.label}</button>`).join('')}
        </div>
        <button class="btn btn-block" id="export-btn" style="margin-top:14px">导出</button>
        <p class="muted" id="export-note" style="margin-top:10px">
          ${formats.range?.first ? `数据区间 ${formats.range.first} ~ ${formats.range.last}，按当前账号导出，不影响其他账号。` : '先记录几次训练再导出吧。'}
        </p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>DeepSeek</h2>
        <span class="badge ${settings.deepseekConfigured ? 'badge-live' : ''}">
          ${settings.deepseekConfigured ? '已连接' : '未配置'}
        </span>
      </div>
      <div class="card">
        <p class="sub" style="font-size:14px;margin-bottom:16px">
          用于生成训练计划。Key 只保存在服务端数据库中，每个账号各自独立。
        </p>
        <div class="field" style="margin-bottom:14px">
          <label>API Key</label>
          <input class="input" id="ds-key" type="password" autocomplete="off"
            placeholder="${settings.deepseekConfigured ? esc(settings.deepseekKeyMasked) : 'sk-...'}" />
          ${settings.deepseekFromEnv ? `<span class="muted">当前使用环境变量 DEEPSEEK_API_KEY</span>` : ''}
        </div>
        <div class="field" style="margin-bottom:16px">
          <label>模型</label>
          <select class="select" id="ds-model">
            <option value="deepseek-chat" ${settings.model === 'deepseek-chat' ? 'selected' : ''}>deepseek-chat（通用，速度快）</option>
            <option value="deepseek-reasoner" ${settings.model === 'deepseek-reasoner' ? 'selected' : ''}>deepseek-reasoner（推理更强，较慢）</option>
          </select>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="ds-save">保存</button>
          <button class="btn btn-secondary btn-sm" id="ds-test">测试连接</button>
          ${settings.deepseekConfigured ? `<button class="btn btn-ghost btn-sm" id="ds-clear" style="color:var(--danger)">清除 Key</button>` : ''}
        </div>
        <p class="muted" id="ds-status" style="margin-top:12px"></p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>账号</h2></div>
      <div class="card" style="padding:6px 18px">
        <div class="list">
          <button class="row" id="change-password">
            <div class="row-main">
              <div class="row-title">修改密码</div>
              <div class="row-sub">修改后其他设备需要重新登录</div>
            </div>
            ${icon('chevronRight', 'chevron')}
          </button>
          ${user.isAdmin ? `
          <button class="row" id="manage-users">
            <div class="row-main">
              <div class="row-title">用户管理</div>
              <div class="row-sub">添加账号、重置密码、删除账号</div>
            </div>
            ${icon('chevronRight', 'chevron')}
          </button>` : ''}
          <button class="row" id="logout">
            <div class="row-main"><div class="row-title">退出登录</div></div>
            ${icon('logout', 'chevron')}
          </button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>关于</h2></div>
      <div class="card">
        <p class="sub" style="font-size:14px;line-height:1.7">
          <strong style="color:var(--text)">动作库数据</strong>：1,324 个动作的中文名称、步骤讲解、目标肌群与器械信息，
          来自开源项目 <a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noreferrer">hasaneyldrm/exercises-dataset</a>（MIT License）。
        </p>
        <p class="sub" style="font-size:14px;line-height:1.7;margin-top:10px">
          <strong style="color:var(--text)">肌肉示意图</strong>：<a href="https://github.com/Jsplice/MuscleMap" target="_blank" rel="noreferrer">MuscleMap</a>（MIT License）；
          <strong style="color:var(--text)">动作图片</strong>：© <a href="https://gymvisual.com/" target="_blank" rel="noreferrer">Gym visual</a>。
        </p>
        <p class="muted" style="margin-top:12px">FitLog v1.1 · 多用户 · 自托管 · SQLite</p>
      </div>
    </section>

    <p class="muted" style="text-align:center;margin-top:26px">训练建议仅供参考，量力而行。</p>
  `;

  /* ---------- 修改昵称 ---------- */
  $('#edit-profile', el).addEventListener('click', () => {
    openSheet({
      title: '修改昵称',
      content: `
        <div class="field">
          <label>昵称</label>
          <input class="input" id="profile-name" value="${esc(user.displayName || user.username)}" maxlength="24" />
        </div>
        <button class="btn btn-block" id="profile-save" style="margin-top:18px">保存</button>`,
      onMount: (sheet) => {
        const input = $('#profile-name', sheet);
        input.focus();
        $('#profile-save', sheet).addEventListener('click', async (e) => {
          const name = input.value.trim();
          if (!name) return toast('昵称不能为空');
          e.target.disabled = true;
          try {
            await api.updateProfile(name);
            closeSheet();
            toast('已保存');
            nav('/me');
          } catch (err) {
            toast(err.message);
            e.target.disabled = false;
          }
        });
      },
    });
  });

  /* ---------- 修改密码 ---------- */
  $('#change-password', el).addEventListener('click', () => {
    openSheet({
      title: '修改密码',
      content: `
        <div class="field" style="margin-bottom:14px">
          <label>当前密码</label>
          <input class="input" id="pw-old" type="password" autocomplete="current-password" />
        </div>
        <div class="field" style="margin-bottom:14px">
          <label>新密码</label>
          <input class="input" id="pw-new" type="password" autocomplete="new-password" placeholder="至少 6 位" />
        </div>
        <div class="field">
          <label>确认新密码</label>
          <input class="input" id="pw-new2" type="password" autocomplete="new-password" />
        </div>
        <div class="error-text" id="pw-err" style="min-height:18px"></div>
        <button class="btn btn-block" id="pw-save">保存</button>`,
      onMount: (sheet) => {
        $('#pw-old', sheet).focus();
        $('#pw-save', sheet).addEventListener('click', async (e) => {
          const oldPw = $('#pw-old', sheet).value;
          const newPw = $('#pw-new', sheet).value;
          const err = $('#pw-err', sheet);
          if (newPw.length < 6) { err.textContent = '新密码至少 6 位'; return; }
          if (newPw !== $('#pw-new2', sheet).value) { err.textContent = '两次输入不一致'; return; }
          e.target.disabled = true;
          try {
            await api.changePassword(oldPw, newPw);
            closeSheet();
            toast('密码已更新');
          } catch (error) {
            err.textContent = error.message;
            e.target.disabled = false;
          }
        });
      },
    });
  });

  /* ---------- 用户管理（管理员） ---------- */
  $('#manage-users', el)?.addEventListener('click', () => openUsersSheet(user));

  /* ---------- 导出 ---------- */
  let format = (formats.formats?.[0]?.key) || 'json';
  let range = 'all';

  el.querySelector('#export-formats')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    format = btn.dataset.format;
    el.querySelectorAll('#export-formats .fmt').forEach(b => b.classList.toggle('active', b === btn));
  });

  el.querySelector('#export-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    range = btn.dataset.range;
    el.querySelectorAll('#export-range .chip').forEach(b => b.classList.toggle('active', b === btn));
  });

  $('#export-btn', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const note = $('#export-note', el);
    btn.disabled = true;
    note.textContent = '正在生成文件…';
    try {
      const params = new URLSearchParams({ format });
      if (range !== 'all') params.set('from', isoShift(Number(range)));
      if (settings.workoutCount === 0) note.textContent = '暂无训练记录，导出的文件里只有计划与概览。';

      const res = await fetch(`/api/export?${params.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `导出失败 (${res.status})`);
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const name = /filename="([^"]+)"/.exec(disp)?.[1] || `fitlog.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      const spec = formats.formats.find(f => f.key === format);
      note.textContent = `已导出 ${spec ? spec.label : format} · ${(blob.size / 1024).toFixed(0)} KB · ${name}`;
      toast('导出完成');
    } catch (err) {
      note.textContent = err.message;
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- DeepSeek ---------- */
  const statusEl = $('#ds-status', el);

  $('#ds-save', el).addEventListener('click', async (e) => {
    const key = $('#ds-key', el).value.trim();
    const model = $('#ds-model', el).value;
    e.target.disabled = true;
    try {
      await api.saveSettings({ ...(key ? { deepseekApiKey: key } : {}), model });
      toast('已保存');
      statusEl.textContent = '设置已更新' + (key ? '，可点击「测试连接」验证' : '');
      $('#ds-key', el).value = '';
      const s = await api.settings();
      if (s.deepseekConfigured) statusEl.textContent = `已配置：${s.deepseekKeyMasked}`;
    } catch (err) { toast(err.message); }
    finally { e.target.disabled = false; }
  });

  $('#ds-test', el).addEventListener('click', async (e) => {
    e.target.disabled = true;
    statusEl.textContent = '正在连接 DeepSeek…';
    try {
      await api.testDeepseek();
      statusEl.textContent = '连接成功 ✓';
      statusEl.style.color = 'var(--success)';
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.style.color = 'var(--danger)';
    } finally { e.target.disabled = false; }
  });

  $('#ds-clear', el)?.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: '清除 API Key？', message: '清除后将无法使用 AI 生成计划。', confirmText: '清除', danger: true });
    if (!ok) return;
    try { await api.saveSettings({ clearKey: true }); toast('已清除'); nav('/me'); }
    catch (err) { toast(err.message); }
  });

  /* ---------- 退出 ---------- */
  $('#logout', el).addEventListener('click', async () => {
    const ok = await confirmSheet({ title: '退出登录？', message: '下次访问需要重新登录。', confirmText: '退出' });
    if (!ok) return;
    try { await api.logout(); location.reload(); } catch (err) { toast(err.message); }
  });
}

/* ---------------- 用户管理弹层 ---------------- */
async function openUsersSheet(currentUser) {
  const sheet = openSheet({
    title: '用户管理',
    content: `<div class="users-body"><p class="muted">加载中…</p></div>`,
    onMount: (el) => bindUsersSheet(el, currentUser),
  });
  return sheet;
}

async function bindUsersSheet(sheet, currentUser) {
  const body = sheet.querySelector('.users-body');

  const load = async () => {
    let users = [];
    try {
      users = await api.users();
    } catch (e) {
      body.innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
      return;
    }

    body.innerHTML = `
      <div class="user-list">
        ${users.map(u => `
          <div class="user-row" data-user="${u.id}">
            <div class="user-avatar sm">${esc((u.displayName || u.username).slice(0, 1).toUpperCase())}</div>
            <div class="row-main">
              <div class="row-title">${esc(u.displayName || u.username)}
                ${u.isAdmin ? '<span class="badge badge-ai" style="margin-left:6px">Admin</span>' : ''}
                ${u.id === currentUser.id ? '<span class="muted" style="margin-left:6px">当前</span>' : ''}
              </div>
              <div class="row-sub">@${esc(u.username)} · ${u.workoutCount} 次训练 · ${u.planCount} 份计划</div>
            </div>
            ${u.id === currentUser.id ? '' : `
              <button class="icon-btn" data-reset="${u.id}" data-name="${esc(u.displayName || u.username)}" aria-label="重置密码">${icon('refresh')}</button>
              <button class="icon-btn" data-del="${u.id}" data-name="${esc(u.displayName || u.username)}" aria-label="删除账号" style="color:var(--danger)">${icon('trash')}</button>`}
          </div>`).join('')}
      </div>
      <button class="btn btn-block" id="add-user" style="margin-top:16px">${icon('plus')} 添加账号</button>
      <p class="muted" style="margin-top:12px">新账号的数据与现有账号完全隔离，互不可见。删除账号会一并删除其训练记录。</p>`;

    body.querySelector('#add-user')?.addEventListener('click', () => {
      openCreateUserSheet(currentUser);
    });

    body.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', () => openResetPasswordSheet(Number(btn.dataset.reset), btn.dataset.name, currentUser));
    });

    body.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.del);
        const ok = await confirmSheet({
          title: `删除账号「${btn.dataset.name}」？`,
          message: '该账号的全部训练记录、计划与设置都会被永久删除，无法恢复。',
          confirmText: '删除', danger: true,
        });
        if (!ok) { openUsersSheet(currentUser); return; }
        try {
          await api.deleteUser(id);
          toast('已删除');
        } catch (err) {
          toast(err.message);
        }
        openUsersSheet(currentUser);
      });
    });
  };

  await load();
}

function openCreateUserSheet(currentUser) {
  openSheet({
    title: '添加账号',
    content: `
      <div class="field" style="margin-bottom:14px">
        <label>用户名</label>
        <input class="input" id="nu-name" placeholder="3-20 位字母、数字、下划线" autocomplete="off" />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>昵称 <span class="muted">（可选）</span></label>
        <input class="input" id="nu-display" placeholder="留空则与用户名相同" maxlength="24" />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>初始密码</label>
        <input class="input" id="nu-pwd" type="text" placeholder="至少 6 位，可稍后让对方修改" autocomplete="off" />
      </div>
      <label class="check-row" style="display:flex;align-items:center;gap:8px;margin:4px 0 14px">
        <input type="checkbox" id="nu-admin" />
        <span class="row-sub" style="margin:0">设为管理员（可管理其他账号）</span>
      </label>
      <div class="error-text" id="nu-err" style="min-height:18px"></div>
      <button class="btn btn-block" id="nu-save">创建</button>`,
    onMount: (sheet) => {
      $('#nu-name', sheet).focus();
      $('#nu-save', sheet).addEventListener('click', async (e) => {
        const username = $('#nu-name', sheet).value.trim();
        const password = $('#nu-pwd', sheet).value;
        const err = $('#nu-err', sheet);
        if (!username) { err.textContent = '请填写用户名'; return; }
        if (password.length < 6) { err.textContent = '密码至少 6 位'; return; }
        e.target.disabled = true;
        try {
          await api.createUser({
            username, password,
            displayName: $('#nu-display', sheet).value.trim(),
            isAdmin: $('#nu-admin', sheet).checked,
          });
          toast('账号已创建');
          openUsersSheet(currentUser);
        } catch (error) {
          err.textContent = error.message;
          e.target.disabled = false;
        }
      });
    },
  });
}

function openResetPasswordSheet(id, name, currentUser) {
  openSheet({
    title: `重置「${name}」的密码`,
    content: `
      <div class="field" style="margin-bottom:14px">
        <label>新密码</label>
        <input class="input" id="rp-pwd" type="text" placeholder="至少 6 位" autocomplete="off" />
      </div>
      <div class="error-text" id="rp-err" style="min-height:18px"></div>
      <button class="btn btn-block" id="rp-save">重置</button>
      <p class="muted" style="margin-top:10px">重置后该账号在所有设备都需要重新登录。</p>`,
    onMount: (sheet) => {
      $('#rp-pwd', sheet).focus();
      $('#rp-save', sheet).addEventListener('click', async (e) => {
        const password = $('#rp-pwd', sheet).value;
        const err = $('#rp-err', sheet);
        if (password.length < 6) { err.textContent = '密码至少 6 位'; return; }
        e.target.disabled = true;
        try {
          await api.resetUserPassword(id, password);
          toast('密码已重置');
          openUsersSheet(currentUser);
        } catch (error) {
          err.textContent = error.message;
          e.target.disabled = false;
        }
      });
    },
  });
}
