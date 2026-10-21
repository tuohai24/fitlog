/**
 * 训练动态 / 留言 端到端测试（真实浏览器 + 真实后端）
 *
 * 用法：先 node server/index.js 起服务，再 node scripts/e2e-social.mjs
 * 依赖：playwright（复用本机 Edge）
 *
 * 覆盖：网页端「完成训练 → 分享 → 另一账号看到 → 留言 → 作者看到 → 删留言」，
 *      以及浅色/深色两套主题下的渲染与横向溢出检查。
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'fitlog';
const TEST_USER = `e2e_${Date.now().toString(36)}`;
const TEST_PW = 'e2e-pass-123';

let pass = 0;
let fail = 0;
const log = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; log.push(`  ✓ ${name}`); }
  else { fail++; log.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(page, username, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  if (await page.$('#pwd')) {
    if (await page.$('#username')) await page.fill('#username', username);
    await page.fill('#pwd', password);
    await page.click('#auth-submit');
  }
  await page.waitForSelector('.topbar', { timeout: 15000 });
}

/** 强制重新渲染指定路由：仅改 hash 时浏览器的同文档跳转不会触发重新渲染 */
async function go(page, hashPath) {
  await page.goto(`${BASE}/#${hashPath}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar', { timeout: 15000 });
}

async function main() {
  const adminLogin = await api('/auth/login', { method: 'POST', body: { username: ADMIN, password: ADMIN_PW } });
  const adminTok = adminLogin.data?.token;
  if (!adminTok) throw new Error('管理员登录失败');

  const list = await api('/workouts?limit=20', { token: adminTok });
  const workout = (list.data || []).find(w => w.doneSets > 0);
  if (!workout) throw new Error('没有可用的训练记录，先跑 npm run seed:demo');
  const wid = workout.id;

  const created = await api('/users', {
    method: 'POST', token: adminTok,
    body: { username: TEST_USER, password: TEST_PW, displayName: '测试同学' },
  });
  if (created.status !== 201) throw new Error(`创建测试账号失败：${JSON.stringify(created.data)}`);

  const browser = await chromium.launch({ channel: 'msedge' });
  const errors = [];
  // 取消分享后访问别人的动态本来就该 404，属于预期行为，不计入报错
  const flags = { allow404: false };
  const newPage = async (colorScheme = 'light') => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
      colorScheme,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${colorScheme}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (flags.allow404 && /Failed to load resource.*404/.test(m.text())) return;
      errors.push(`${colorScheme}: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() < 400) return;
      if (flags.allow404 && r.status() === 404) return;
      errors.push(`${colorScheme}: HTTP ${r.status()} ${r.url()}`);
    });
    return page;
  };

  try {
    /* ---------- 1. 作者：完成训练并分享 ---------- */
    const author = await newPage('light');
    await login(author, ADMIN, ADMIN_PW);
    await go(author, `/log/${wid}`);
    await author.waitForSelector('[data-finish]');
    await author.click('[data-finish]');
    await author.waitForSelector('.sheet [data-confirm]');

    const switchOn = await author.$eval('.finish-share .switch', el => el.classList.contains('on'));
    if (!switchOn) await author.click('[data-share-row]');
    await author.click('[data-confirm]');
    await author.waitForFunction(() => location.hash === '#/feed', null, { timeout: 15000 });
    check('完成后跳转到动态页', true);

    await author.waitForSelector(`.feed-card[data-post="${wid}"]`, { timeout: 10000 });
    check('动态列表出现这次训练', true);

    const authorName = await author.$eval(`.feed-card[data-post="${wid}"] .user-name`, el => el.textContent.trim());
    check('动态卡片显示作者名', authorName.includes('管理员') || authorName.length > 0, authorName);

    /* ---------- 2. 另一位用户：看到动态并留言 ---------- */
    const guest = await newPage('light');
    await login(guest, TEST_USER, TEST_PW);

    const tabs = await guest.$$eval('.tabbar .tab', els => els.map(e => e.textContent.trim()));
    check('底部导航含「动态」入口', tabs.includes('动态'), tabs.join(' / '));
    await guest.click('.tabbar .tab:nth-child(2)');
    await guest.waitForFunction(() => location.hash === '#/feed', null, { timeout: 10000 });
    check('点「动态」tab 进入动态页', true);

    await go(guest, '/feed');
    await guest.waitForSelector(`.feed-card[data-post="${wid}"]`, { timeout: 10000 });
    check('另一账号能看到别人的训练', true);

    const guestName = await guest.$eval(`.feed-card[data-post="${wid}"] .user-name`, el => el.textContent.trim());
    check('不是自己的训练不显示「我」标签', !guestName.includes('我'), guestName);

    await guest.click(`.feed-card[data-post="${wid}"]`);
    await guest.waitForSelector('.composer #cmt-input', { timeout: 10000 });
    check('进入动态详情', (await guest.$('.post-title')) !== null);

    const setsSummary = await guest.$eval('.list .row-sub', el => el.textContent.trim());
    check('详情里有组数明细', /×/.test(setsSummary), setsSummary);

    await guest.fill('#cmt-input', '这容量太顶了，下次带我一起练');
    await guest.click('#cmt-send');
    await guest.waitForSelector('.cmt-text', { timeout: 10000 });
    const cmtText = await guest.$eval('.cmt-text', el => el.textContent.trim());
    check('留言发表成功', cmtText.includes('下次带我一起练'), cmtText);

    const overflow1 = await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('详情页无横向溢出', overflow1 <= 1, `溢出 ${overflow1}px`);

    /* ---------- 3. 作者：看到留言并删除 ---------- */
    await go(author, '/feed');
    await author.waitForSelector(`.feed-card[data-post="${wid}"]`);
    const feedText = await author.$eval(`.feed-card[data-post="${wid}"]`, el => el.textContent);
    check('作者在列表里看到留言预览', feedText.includes('下次带我一起练'));
    const footerMatch = feedText.match(/(\d+)\s*条留言/);
    check('列表显示留言条数', !!footerMatch && Number(footerMatch[1]) >= 1, footerMatch ? footerMatch[0] : feedText.slice(0, 80));

    await author.click(`.feed-card[data-post="${wid}"]`);
    await author.waitForSelector('.cmt', { timeout: 10000 });
    const commentAuthor = await author.$eval('.cmt .cmt-head b', el => el.textContent.trim());
    check('留言显示作者名', commentAuthor.includes('测试同学'), commentAuthor);

    const canDelete = await author.$$('.cmt [data-del]');
    check('动态作者可以管理自己动态下的留言', canDelete.length === 1, `按钮数 ${canDelete.length}`);

    // 切换到留言者视角删除自己的留言
    await go(guest, `/feed/${wid}`);
    await guest.waitForSelector('.cmt [data-del]', { timeout: 10000 });
    await guest.click('.cmt [data-del]');
    await guest.waitForSelector('.sheet [data-yes]');
    await guest.click('[data-yes]');
    await guest.waitForFunction(() => !document.querySelector('.cmt'), null, { timeout: 10000 });
    check('留言者可以删除自己的留言', true);

    /* ---------- 4. 作者取消分享后对方看不到 ---------- */
    await go(author, `/feed/${wid}`);
    await author.waitForSelector('[data-toggle-share]');
    await author.click('[data-toggle-share]');
    await author.waitForSelector('.post-banner', { timeout: 10000 });
    check('作者可以取消分享', true);

    flags.allow404 = true;
    await go(guest, `/feed/${wid}`);
    await guest.waitForSelector('.empty', { timeout: 10000 });
    const hidden = await guest.$eval('.empty h3', el => el.textContent.trim());
    check('取消分享后对方看不到详情', hidden.includes('看不到'), hidden);
    flags.allow404 = false;

    const overflow2 = await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('无权页面无横向溢出', overflow2 <= 1, `溢出 ${overflow2}px`);

    /* ---------- 5. 深色模式渲染 ---------- */
    const dark = await newPage('dark');
    await login(dark, ADMIN, ADMIN_PW);
    await go(dark, '/feed');
    await dark.waitForSelector('#feed-list');
    const darkBg = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('深色模式背景为黑', /rgb\(0, 0, 0\)|rgba\(0, 0, 0/.test(darkBg), darkBg);
    const overflow3 = await dark.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('深色模式无横向溢出', overflow3 <= 1, `溢出 ${overflow3}px`);

    check('全流程 0 意外报错（含网络）', errors.length === 0, errors.slice(0, 3).join(' | '));

    await author.context().close();
    await guest.context().close();
    await dark.context().close();
  } finally {
    await browser.close();
    // 还原：取消分享并删除测试账号
    await api(`/workouts/${wid}/share`, { method: 'PATCH', token: adminTok, body: { shared: false } });
    await api(`/users/${created.data.id}`, { method: 'DELETE', token: adminTok });
  }

  console.log(log.join('\n'));
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E 中断：', e.message);
  process.exitCode = 1;
});
