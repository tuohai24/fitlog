import { chromium } from 'playwright';
const BASE = 'https://fit.kjsa.cn';
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
page.on('requestfailed', (r) => logs.push(`[failed] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

console.log('=== 控制台 / 失败请求 ===');
logs.slice(0, 25).forEach((l) => console.log(' ', l));

console.log('\n=== 手动 fetch sw.js ===');
console.log(await page.evaluate(async () => {
  const r = await fetch('/sw.js', { cache: 'no-store' });
  const t = await r.text();
  return { status: r.status, type: r.headers.get('content-type'), len: t.length, head: t.slice(0, 60), tail: t.slice(-40) };
}));

console.log('\n=== 手动 register ===');
console.log(await page.evaluate(async () => {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return { ok: true, scope: reg.scope, active: !!reg.active, installing: !!reg.installing };
  } catch (e) { return { ok: false, name: e.name, message: e.message }; }
}));

console.log('\n=== apple-touch-icon 加载 ===');
console.log(await page.evaluate(async () => {
  const direct = await fetch('/apple-touch-icon.png', { cache: 'no-store' });
  const buf = await direct.arrayBuffer();
  const imgRes = await new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res({ ok: false });
    img.src = '/apple-touch-icon.png?t=' + Date.now();
  });
  return { status: direct.status, type: direct.headers.get('content-type'), bytes: buf.byteLength,
           magic: [...new Uint8Array(buf.slice(0, 8))].map((b) => b.toString(16)).join(' '), imgRes };
}));

await browser.close();
