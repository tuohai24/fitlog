import { $, icon } from '../core.js';
import { api } from '../api.js';

const LAST_USER_KEY = 'fitlog:lastUser';

export default async function loginView({ el, onSuccess }) {
  let status = { hasUsers: true, signup: { open: false, needsCode: false, isFirst: false } };
  try { status = await api.authStatus(); } catch { /* 用默认值 */ }

  // 一个账号都没有：直接进入「创建管理员」流程
  let mode = status.hasUsers ? 'login' : 'register';
  const canRegister = status.signup?.open;

  el.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">${icon('dumbbell')}</div>
        <h1 class="title-lg">FitLog</h1>
        <p class="sub" id="login-hint" style="margin-top:8px;margin-bottom:22px">
          ${status.hasUsers ? '记录每一次训练，见证每一点进步。' : '还没有账号，先创建你的管理员账号。'}
        </p>

        ${status.hasUsers && canRegister ? `
        <div class="segmented" id="mode-switch" style="margin-bottom:18px">
          <button data-mode="login" class="active">登录</button>
          <button data-mode="register">注册</button>
        </div>` : ''}

        <form id="auth-form" class="field" style="gap:14px">
          <div class="field">
            <label for="username">用户名</label>
            <input class="input" id="username" type="text" inputmode="text" autocomplete="username"
              placeholder="3-20 位字母或数字" required />
          </div>

          <div class="field" id="name-field" style="display:none">
            <label for="display-name">昵称 <span class="muted">（可选）</span></label>
            <input class="input" id="display-name" type="text" autocomplete="nickname" placeholder="显示在首页的名字" maxlength="24" />
          </div>

          <div class="field">
            <label for="pwd">密码</label>
            <input class="input" id="pwd" type="password" autocomplete="current-password" placeholder="请输入密码" required />
          </div>

          <div class="field" id="pwd2-field" style="display:none">
            <label for="pwd2">确认密码</label>
            <input class="input" id="pwd2" type="password" autocomplete="new-password" placeholder="再输入一次" />
          </div>

          <div class="field" id="code-field" style="display:none">
            <label for="code">邀请码</label>
            <input class="input" id="code" type="text" autocomplete="off" placeholder="向管理员索取" />
          </div>

          <div id="login-error" class="error-text" style="min-height:18px"></div>
          <button class="btn btn-block btn-lg" type="submit" id="auth-submit">进入</button>
        </form>

        <p class="muted" id="login-foot" style="margin-top:18px;text-align:center">
          ${status.hasUsers && !canRegister ? '如需新账号，请联系管理员创建' : '服务器部署，数据仅存于你自己的机器'}
        </p>
      </div>
    </div>`;

  const form = $('#auth-form', el);
  const usernameEl = $('#username', el);
  const pwdEl = $('#pwd', el);
  const pwd2El = $('#pwd2', el);
  const nameEl = $('#display-name', el);
  const codeEl = $('#code', el);
  const errBox = $('#login-error', el);
  const submitBtn = $('#auth-submit', el);
  const hintEl = $('#login-hint', el);

  const savedUser = localStorage.getItem(LAST_USER_KEY);
  usernameEl.value = savedUser || (status.hasUsers ? 'admin' : '');

  function applyMode(next) {
    mode = next;
    const registering = mode === 'register';
    $('#name-field', el).style.display = registering ? '' : 'none';
    $('#pwd2-field', el).style.display = registering ? '' : 'none';
    $('#code-field', el).style.display = registering && status.signup?.needsCode ? '' : 'none';
    pwdEl.autocomplete = registering ? 'new-password' : 'current-password';
    pwdEl.placeholder = registering ? '至少 6 位' : '请输入密码';
    submitBtn.textContent = registering ? '创建并进入' : '进入';
    hintEl.textContent = registering
      ? (status.signup?.isFirst ? '创建第一个账号后，你就是管理员。' : '注册后数据与其他人完全隔离。')
      : '记录每一次训练，见证每一点进步。';
    errBox.textContent = '';
    el.querySelectorAll('#mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  $('#mode-switch', el)?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    applyMode(btn.dataset.mode);
    (btn.dataset.mode === 'register' ? nameEl : pwdEl).focus();
  });

  applyMode(mode);
  setTimeout(() => (mode === 'register' ? usernameEl : pwdEl).focus(), 120);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.textContent = '';

    const username = usernameEl.value.trim();
    const password = pwdEl.value;
    if (!username) { errBox.textContent = '请填写用户名'; usernameEl.focus(); return; }
    if (!password) { errBox.textContent = '请填写密码'; pwdEl.focus(); return; }

    if (mode === 'register') {
      if (password !== pwd2El.value) { errBox.textContent = '两次输入的密码不一致'; pwd2El.focus(); return; }
      if (status.signup?.needsCode && !codeEl.value.trim()) { errBox.textContent = '请填写邀请码'; codeEl.focus(); return; }
    }

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = mode === 'register' ? '创建中…' : '验证中…';
    try {
      if (mode === 'register') {
        await api.register({
          username, password,
          displayName: nameEl.value.trim(),
          code: codeEl.value.trim(),
        });
      } else {
        await api.login(username, password);
      }
      localStorage.setItem(LAST_USER_KEY, username);
      onSuccess();
    } catch (err) {
      errBox.textContent = err.message || (mode === 'register' ? '注册失败' : '登录失败');
      if (/密码/.test(errBox.textContent)) pwdEl.select();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
}

/* 供「我的」页面退出登录后复用 */
export function forgetLastUser() {
  localStorage.removeItem(LAST_USER_KEY);
}
