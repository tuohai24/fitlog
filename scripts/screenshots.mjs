/**
 * 生成 README 用的界面截图到 docs/screenshots/
 *
 * 依赖：npm i -D playwright（复用本机 Edge，无需额外下载浏览器）
 * 用法：先启动服务（npm run dev），再 node scripts/screenshots.mjs
 */
import { chromium } from 'playwright';

const OUT = 'docs/screenshots';
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const USERNAME = process.env.SHOT_USER || process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.SHOT_PASSWORD || process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || 'fitlog';

// 整页长截图里，把固定/粘性定位的底栏放回文档流末尾，避免浮在页面中间
const FLATTEN_TABBAR = `
  .tabbar { position: static !important; height: auto !important; padding: 0 !important; }
  .tabbar .tab { padding-top: 8px; padding-bottom: calc(8px + var(--safe-b)); }
  .action-bar { position: static !important; }
  body { padding-bottom: 0 !important; }
`;

const browser = await chromium.launch({ channel: 'msedge' });

async function open({ width, height, colorScheme = 'light', scale = 2 }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: width < 700,
    hasTouch: width < 700,
    locale: 'zh-CN',
    colorScheme,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ! pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  ! console:', m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#pwd')) {
    if (await page.$('#username')) await page.fill('#username', USERNAME);
    await page.fill('#pwd', PASSWORD);
    await page.click('#auth-submit');
    await page.waitForTimeout(1600);
  }
  return page;
}

async function shot(page, name, { full = true } = {}) {
  await page.addStyleTag({ content: FLATTEN_TABBAR });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${name}${full ? ' (full)' : ''}${overflow > 0 ? `  溢出 ${overflow}px!` : ''}`);
}

const go = async (page, hash, wait = 1300) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* ---------------- 手机端（浅色） ---------------- */
// 登录页（未登录状态）
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'zh-CN', colorScheme: 'light',
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/00-login.png` });
  console.log('00-login');
  await ctx.close();
}

const m = await open({ width: 390, height: 844 });

const latestWorkout = await m.evaluate(async () => {
  const r = await fetch('/api/workouts?limit=1', { credentials: 'same-origin' });
  const list = await r.json();
  return list[0]?.id || null;
});

await shot(m, '01-home');

if (latestWorkout) {
  await go(m, `#/log/${latestWorkout}`, 1400);
  await shot(m, '02-log');
  await m.click('[data-add-ex]');
  await m.waitForTimeout(1200);
  await shot(m, '03-picker', { full: false });
  await m.keyboard.press('Escape');
}

await go(m, '#/exercises');
await shot(m, '04-library');
await go(m, '#/exercises/0025', 2200);
await shot(m, '05-exercise');
await go(m, '#/exercises/1461', 2000);
await shot(m, '06-exercise-legs', { full: false });

await go(m, '#/plans', 1200);
await shot(m, '07-plans');

const planId = await m.evaluate(async () => {
  const r = await fetch('/api/plans', { credentials: 'same-origin' });
  const list = await r.json();
  return (list.find((p) => p.active) || list[0])?.id || null;
});
if (planId) {
  await go(m, `#/plans/${planId}`, 1200);
  await shot(m, '08-plan-detail');
}

await go(m, '#/plans/new', 1200);
await shot(m, '09-plan-editor');
await go(m, '#/stats', 1500);
await shot(m, '10-stats');
await go(m, '#/history', 1200);
await shot(m, '11-history');
await go(m, '#/me', 1400);
await shot(m, '14-me');

/* ---------------- 桌面端（深色） ---------------- */
const d = await open({ width: 1440, height: 900, colorScheme: 'dark', scale: 1 });
await shot(d, '12-desktop-dark', { full: false });
await go(d, '#/exercises/0025', 2200);
await shot(d, '13-exercise-dark');
await go(d, '#/me', 1400);
await shot(d, '15-me-dark', { full: false });

await browser.close();
console.log('screenshots done');
