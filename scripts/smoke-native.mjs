/**
 * 安卓壳的浏览器侧验证。
 *
 * 没有真机也能验证壳里最关键的三件事：跨域能不能通、会话靠不靠 Bearer、导出会不会落到原生插件。
 * 做法是把页面当成 WebView：注入一个 window.Capacitor 桩，让 platform.js 走 native 分支，
 * 再把接口地址指向另一个 origin（模拟壳里 https://localhost → 服务器域名 的跨域）。
 *
 * 跑之前服务要带白名单，例如：
 *   PORT=8080 APP_ORIGINS=http://localhost:8080 node --env-file=.env server/index.js
 * 然后：
 *   BASE=http://localhost:8080 API_BASE=http://127.0.0.1:8080 node scripts/smoke-native.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080';
const API = process.env.API_BASE || 'http://127.0.0.1:8080';
const USER = process.env.USER_NAME || 'admin';
const PASS = process.env.USER_PASS || 'fitlog';

let pass = 0;
let fail = 0;
function check(ok, msg) {
  if (ok) { pass++; console.log(`PASS  ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// 记录发出的 Authorization，验证会话确实走请求头
const authHeaders = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) authHeaders.push(r.headers().authorization || '');
});

await page.addInitScript(
  ({ apiBase }) => {
    window.__FITLOG_API_BASE__ = apiBase;
    window.__FS_WRITES__ = [];
    window.__SHARES__ = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {},
      registerPlugin(name) {
        if (name === 'Filesystem') {
          return {
            writeFile: async (opts) => {
              window.__FS_WRITES__.push({ path: opts.path, bytes: String(opts.data || '').length, directory: opts.directory });
              return { uri: `file:///data/user/0/cn.kjsa.fitlog/cache/${opts.path}` };
            },
          };
        }
        if (name === 'Share') {
          return {
            share: async (opts) => {
              window.__SHARES__.push({ files: opts.files, title: opts.title });
              return {};
            },
          };
        }
        return {};
      },
    };
  },
  { apiBase: API }
);

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. 平台判定
const isNative = await page.evaluate(async () => (await import('/js/platform.js')).isNative);
check(isNative === true, '注入 Capacitor 后 isNative 判定为 true');

const baseUsed = await page.evaluate(async () => (await import('/js/platform.js')).apiBase());
check(baseUsed === API, `接口地址走绝对路径（${baseUsed}）`);

// 2. 登录
if (await page.locator('#auth-submit').count()) {
  await page.fill('#username', USER);
  await page.fill('#pwd', PASS);
  await page.click('#auth-submit');
}
await page.waitForSelector('.topbar', { timeout: 15000 });
check(true, '壳内登录成功，进入首页');

const token = await page.evaluate(() => localStorage.getItem('fitlog.token'));
check(!!token && token.length > 20, `登录后 token 已落地（${String(token).slice(0, 8)}…）`);

const cookieCount = await page.evaluate(() => document.cookie.split(';').filter(Boolean).length);
check(cookieCount === 0, '没有依赖 Cookie（跨站 Cookie 会被 SameSite 拦掉）');

const withAuth = authHeaders.filter((h) => h.startsWith('Bearer '));
check(withAuth.length > 0, `${withAuth.length} 个接口请求带上了 Authorization`);

// 3. Service Worker 不应注册
const swCount = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.() || []).length);
check(swCount === 0, '壳内没有注册 Service Worker');

// 4. 导出走原生插件
await page.goto(BASE + '/#/me', { waitUntil: 'networkidle' });
await page.waitForSelector('#export-btn', { timeout: 10000 });
await page.click('#export-btn');
await page.waitForFunction(() => window.__SHARES__.length > 0 || window.__FS_WRITES__.length > 0, { timeout: 30000 }).catch(() => {});

const writes = await page.evaluate(() => window.__FS_WRITES__);
const shares = await page.evaluate(() => window.__SHARES__);
check(writes.length > 0, `导出文件写入了 Filesystem（${writes[0]?.path || '无'}）`);
check(writes.every((w) => w.directory === 'CACHE'), '写入目录为 CACHE（无需存储权限）');
check(shares.length > 0 && Array.isArray(shares[0]?.files), '写入后拉起系统分享（files 传参）');

const note = await page.locator('#export-note').textContent().catch(() => '');
check(/已生成|已导出/.test(note || ''), `界面给出了导出结果提示（${(note || '').slice(0, 40)}）`);

// 5. 无脚本错误
const realErrors = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
check(realErrors.length === 0, `无脚本错误（${realErrors.length}）`);
realErrors.slice(0, 5).forEach((e) => console.log('   !', e));

await browser.close();
console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
