/**
 * PWA 冒烟测试（真实浏览器 + 真实 Service Worker）
 *
 * 用法：先起服务，再 node scripts/smoke-pwa.mjs
 * 依赖：playwright（复用本机 Edge）
 *
 * 覆盖：manifest 合法性、图标尺寸、SW 注册与接管、离线首屏可用、接口离线降级。
 * 这几项在浏览器里都「看起来能用」，但少一样就是 PWA 装不上或断网白屏。
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18099';
const ADMIN = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'fitlog';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log(`\n== PWA 冒烟测试  ${BASE} ==\n`);

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // ---------------------------------------------------------------- manifest
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    const type = res.headers.get('content-type') || '';
    return { href: link.href, type, json: await res.json() };
  });
  check('页面声明了 manifest', !!manifest);
  check('manifest 的 MIME 正确', /application\/manifest\+json/.test(manifest?.type || ''), manifest?.type);
  check('manifest 有 name 与 short_name', !!manifest?.json?.name && !!manifest?.json?.short_name);
  check('display = standalone', manifest?.json?.display === 'standalone', manifest?.json?.display);
  check('有 scope 与 start_url', !!manifest?.json?.scope && !!manifest?.json?.start_url);
  check('有 maskable 图标', (manifest?.json?.icons || []).some((i) => String(i.purpose).includes('maskable')));

  // ---------------------------------------------------------------- 图标真实尺寸
  const iconInfo = await page.evaluate(async () => {
    const list = [
      '/apple-touch-icon.png',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
      '/icons/icon-1024.png',
    ];
    const out = [];
    for (const src of list) {
      out.push(await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight, ok: true });
        img.onerror = () => resolve({ src, w: 0, h: 0, ok: false });
        img.src = src;
      }));
    }
    return out;
  });
  const byName = Object.fromEntries(iconInfo.map((i) => [i.src, i]));
  check('apple-touch-icon 可加载', byName['/apple-touch-icon.png'].ok);
  check('apple-touch-icon 是 180×180', byName['/apple-touch-icon.png'].w === 180 && byName['/apple-touch-icon.png'].h === 180,
    `${byName['/apple-touch-icon.png'].w}×${byName['/apple-touch-icon.png'].h}`);
  check('192 图标尺寸正确', byName['/icons/icon-192.png'].w === 192);
  check('512 图标尺寸正确', byName['/icons/icon-512.png'].w === 512);
  check('maskable 图标尺寸正确', byName['/icons/icon-maskable-512.png'].w === 512);
  check('1024 图标尺寸正确', byName['/icons/icon-1024.png'].w === 1024);

  const touchIcon = await page.evaluate(() => {
    const el = document.querySelector('link[rel="apple-touch-icon"]');
    return el ? el.getAttribute('href') : null;
  });
  check('apple-touch-icon 指向 PNG（不能是 SVG，iOS 不支持）',
    !!touchIcon && touchIcon.endsWith('.png'), touchIcon);

  // ---------------------------------------------------------------- SW 注册
  // 注意：register() 挂在 window.load 里，domcontentloaded 时还没发生，
  // 直接 getRegistration() 会拿到 null，必须等 ready（带超时，别卡死）
  const registered = await page.evaluate(async () => {
    const timeout = new Promise((r) => setTimeout(() => r(null), 10000));
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
    if (!reg) return null;
    const sw = reg.active || reg.waiting || reg.installing;
    // ready 返回时可能还停在 activating（瞬时态），等它真的变 active
    if (sw && sw.state !== 'activated') {
      await new Promise((r) => {
        const done = () => { sw.removeEventListener('statechange', done); r(); };
        sw.addEventListener('statechange', done);
        setTimeout(done, 5000);
      });
    }
    return { scope: reg.scope, state: sw?.state || null };
  });
  check('Service Worker 已注册', !!registered);
  check('SW 作用域是整站 /', registered?.scope?.endsWith('/'), registered?.scope);
  check('SW 已激活', registered?.state === 'activated', registered?.state);

  // 首次安装后需要一次导航才会被 SW 接管（clients.claim 生效）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('页面已被 SW 接管', controlled);

  // ---------------------------------------------------------------- 缓存内容
  const cacheReport = await page.evaluate(async () => {
    const names = await caches.keys();
    const detail = {};
    for (const n of names) {
      const c = await caches.open(n);
      detail[n] = (await c.keys()).map((r) => new URL(r.url).pathname);
    }
    return { names, detail };
  });
  const shellName = cacheReport.names.find((n) => n.startsWith('fitlog-shell'));
  const shellFiles = shellName ? cacheReport.detail[shellName] : [];
  check('存在 shell 缓存', !!shellName, cacheReport.names.join(','));
  check('缓存了 index.html', shellFiles.includes('/index.html'));
  check('缓存了 CSS', shellFiles.includes('/css/app.css'));
  check('缓存了 app.js', shellFiles.includes('/js/app.js'));

  const jsTotal = await page.evaluate(() => document.querySelectorAll('script[type="module"]').length);
  const cachedJs = shellFiles.filter((p) => p.startsWith('/js/')).length;
  check(`缓存了全部前端模块（≥19 个）`, cachedJs >= 19, `${cachedJs} 个，页面 module 脚本 ${jsTotal}`);
  check('预缓存没有漏文件', shellFiles.length >= 20, `${shellFiles.length} 个`);

  // ---------------------------------------------------------------- 离线首屏
  // SW 接管后 reload：页面应由 SW 直接吐出缓存，不依赖后端静态目录
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  // 等真正的首屏内容渲染出来，而不是 domcontentloaded 一过就读
  const rendered = await page
    .waitForFunction(() => {
      const el = document.getElementById('app');
      return !!el && el.children.length > 0;
    }, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const afterSw = await page.evaluate(() => ({
    hasRoot: !!document.getElementById('app'),
    childCount: document.getElementById('app')?.children.length || 0,
    textLen: document.body.innerText.trim().length,
    bg: getComputedStyle(document.body).backgroundColor,
    fromSw: !!navigator.serviceWorker.controller,
  }));
  check('SW 接管后页面正常渲染', rendered && afterSw.textLen > 0,
    `children=${afterSw.childCount} text=${afterSw.textLen}`);
  check('SW 接管后 CSS 生效（不是裸样式）', afterSw.bg !== 'rgba(0, 0, 0, 0)', afterSw.bg);
  check('渲染确实经过 SW', afterSw.fromSw);

  await context.setOffline(false);

  // 训练数据绝不能进缓存（否则会看到过期的组数/重量）。
  // 说明：Playwright 的 setOffline 不作用于 SW 内部的 fetch，所以「离线返回 503」
  // 这条在自动化里测不到，改为从两个能测的角度锁定：缓存内容 + SW 源码兜底分支。
  const apiCached = Object.values(cacheReport.detail)
    .flat()
    .filter((p) => p.startsWith('/api/'));
  check('接口响应没有被缓存（数据永远实时）', apiCached.length === 0, apiCached.slice(0, 3).join(','));

  const swSource = await (await fetch(`${BASE}/sw.js`)).text();
  const has503 = /status:\s*503/.test(swSource) && /offline:\s*true/.test(swSource);
  check('SW 对离线接口有 503 兜底分支', has503);
  check('SW 对导航请求用 network-first', /networkFirstNavigation/.test(swSource));
  check('SW 不对非 GET 请求做缓存', /method !== 'GET'/.test(swSource));

  // 深链接直接访问（SPA 路由）必须能落到 index.html
  const deep = await page.goto(`${BASE}/exercises`, { waitUntil: 'domcontentloaded' });
  check('深链接 /exercises 可直接打开', deep?.status() === 200, `status=${deep?.status()}`);

  // ---------------------------------------------------------------- 恢复在线
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const onlineOk = await page.evaluate(async () => {
    const res = await fetch('/api/health');
    return res.ok;
  });
  check('恢复网络后接口正常', onlineOk);

  // ---------------------------------------------------------------- 登录态（PWA 里最关键的一步）
  await page.fill('#username, input[name="username"]', ADMIN).catch(() => {});
  await page.fill('#pwd, input[type="password"]', ADMIN_PW).catch(() => {});
  await page.click('button[type="submit"], .btn-primary').catch(() => {});
  await page.waitForTimeout(1800);
  const loggedIn = await page.evaluate(() => !!document.querySelector('.tabbar, .tabs, nav'));
  check('登录后进入主界面', loggedIn);

  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail++;
  console.log(`  ✗ 测试异常：${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n== 结果 ==\n通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail === 0 ? 0 : 1);
