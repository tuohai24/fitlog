import { $, $$, esc, icon, toast, todayStr } from './core.js';
import { api, onUnauthorized } from './api.js';
import homeView from './views/home.js';
import logView from './views/log.js';
import historyView from './views/history.js';
import statsView from './views/stats.js';
import exercisesView from './views/exercises.js';
import exerciseDetailView from './views/exercise-detail.js';
import plansView from './views/plans.js';
import planDetailView from './views/plan-detail.js';
import planEditorView from './views/plan-editor.js';
import meView from './views/me.js';
import feedView from './views/feed.js';
import postView from './views/post.js';
import loginView from './views/login.js';

const TABS = [
  { key: 'home', label: '今日', icon: 'home', path: '/' },
  { key: 'feed', label: '动态', icon: 'community', path: '/feed' },
  { key: 'exercises', label: '动作库', icon: 'dumbbell', path: '/exercises' },
  { key: 'history', label: '历史', icon: 'calendar', path: '/history' },
  { key: 'stats', label: '统计', icon: 'chart', path: '/stats' },
  { key: 'plans', label: '计划', icon: 'sparkles', path: '/plans' },
  { key: 'me', label: '我的', icon: 'gear', path: '/me' },
];

const ROUTES = [
  { re: /^\/$/, view: homeView, tab: 'home', title: '今日' },
  { re: /^\/log\/(\d+)$/, view: logView, tab: 'home', title: '训练记录' },
  { re: /^\/exercises$/, view: exercisesView, tab: 'exercises', title: '动作库' },
  { re: /^\/exercises\/([^/]+)$/, view: exerciseDetailView, tab: 'exercises', title: '动作讲解' },
  { re: /^\/history$/, view: historyView, tab: 'history', title: '历史' },
  { re: /^\/stats$/, view: statsView, tab: 'stats', title: '统计' },
  { re: /^\/plans$/, view: plansView, tab: 'plans', title: '训练计划' },
  { re: /^\/plans\/new$/, view: planEditorView, tab: 'plans', title: '新建计划' },
  { re: /^\/plans\/(\d+)\/edit$/, view: planEditorView, tab: 'plans', title: '编辑计划' },
  { re: /^\/plans\/(\d+)$/, view: planDetailView, tab: 'plans', title: '计划详情' },
  { re: /^\/feed$/, view: feedView, tab: 'feed', title: '训练动态' },
  { re: /^\/feed\/(\d+)$/, view: postView, tab: 'feed', title: '动态详情' },
  { re: /^\/me$/, view: meView, tab: 'me', title: '我的' },
];

const appEl = $('#app');
let authed = false;

export function nav(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { renderRoute(); return; }
  if (replace) location.replace(target);
  else location.hash = target;
}

function shellHTML(activeTab) {
  return `
    <header class="topbar" id="topbar">
      <div class="wrap topbar-inner">
        <button class="brand" data-nav="/" aria-label="回到首页">
          ${icon('dumbbell')}<span>FitLog</span>
        </button>
        <nav class="nav-desktop">
          ${TABS.map(t => `<button class="nav-link ${t.key === activeTab ? 'active' : ''}" data-nav="${t.path}">${t.label}</button>`).join('')}
        </nav>
        <div style="display:flex;align-items:center;gap:2px">
          <button class="icon-btn" data-nav="/me" aria-label="设置">${icon('gear')}</button>
        </div>
      </div>
    </header>
    <main id="view" class="wrap page"></main>
    <nav class="tabbar" role="tablist">
      ${TABS.map(t => `
        <button class="tab ${t.key === activeTab ? 'active' : ''}" data-nav="${t.path}" role="tab"
          aria-selected="${t.key === activeTab}">
          ${icon(t.icon)}<span>${t.label}</span>
        </button>`).join('')}
    </nav>`;
}

async function renderRoute() {
  if (!authed) return;

  const path = (location.hash.replace(/^#/, '') || '/');
  const match = ROUTES.find(r => r.re.test(path)) || ROUTES[0];
  const params = path.match(match.re)?.slice(1) || [];

  appEl.innerHTML = shellHTML(match.tab);
  document.title = `${match.title} · FitLog`;

  const viewEl = $('#view');
  try {
    await match.view({ el: viewEl, params, nav });
  } catch (e) {
    if (e.message === '请先登录') return;
    console.error(e);
    viewEl.innerHTML = `<div class="empty">${icon('x')}<h3>加载失败</h3><p>${esc(e.message)}</p>
      <button class="btn btn-secondary btn-sm" onclick="location.reload()">重新加载</button></div>`;
  }
}

/* ---------------- 登录 ---------------- */
async function boot() {
  try {
    const { authed: isAuthed } = await api.me();
    authed = isAuthed;
  } catch {
    authed = false;
  }

  if (!authed) {
    await loginView({ el: appEl, nav, onSuccess: () => { authed = true; nav('/', { replace: true }); renderRoute(); } });
    return;
  }
  renderRoute();
}

onUnauthorized(() => {
  authed = false;
  loginView({ el: appEl, nav, onSuccess: () => { authed = true; renderRoute(); } });
});

/* ---------------- 全局事件代理 ---------------- */
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    e.preventDefault();
    nav(navBtn.dataset.nav);
  }
});

window.addEventListener('hashchange', () => {
  window.scrollTo({ top: 0 });
  renderRoute();
});

window.addEventListener('scroll', () => {
  $('#topbar')?.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

boot();
