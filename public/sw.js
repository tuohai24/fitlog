/* FitLog Service Worker —— 让 PWA 在健身房弱网/无网时也能打开
 *
 * 缓存策略（按优先级）：
 *   导航请求       network-first，3 秒超时回落缓存（保证能拿到新版本，断网也能进）
 *   /api/*        network-only，离线返回 503 给页面提示（绝不缓存训练数据）
 *   /media/*      cache-first，动图 1285 个，看过就存，不预缓存
 *   其它同源 GET  stale-while-revalidate（先给缓存，后台悄悄更新）
 *
 * 更新方式：改 CACHE 版本号 → 新 SW install → skipWaiting 立即接管 → 页面自动刷新一次。
 */

const VERSION = 'v1';
const SHELL_CACHE = `fitlog-shell-${VERSION}`;
const MEDIA_CACHE = `fitlog-media-${VERSION}`;

// 离线首屏必需的文件。ES Module 是运行时 import 的，这里必须手动列全，
// 否则断网时会白屏（模块 404）。新增 js 文件记得同步。
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
  '/js/api.js',
  '/js/app.js',
  '/js/core.js',
  '/js/muscle-map.js',
  '/js/picker.js',
  '/js/vendor/musclemap.js',
  '/js/views/exercise-detail.js',
  '/js/views/exercises.js',
  '/js/views/feed.js',
  '/js/views/history.js',
  '/js/views/home.js',
  '/js/views/log.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/plan-detail.js',
  '/js/views/plan-editor.js',
  '/js/views/plans.js',
  '/js/views/post.js',
  '/js/views/stats.js',
];

// ---------------------------------------------------------------- install
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 逐个预缓存而不是 addAll：addAll 是「全有或全无」，一个 404 就整批失败。
      // 每个文件还带两次重试——首次安装时网络抖一下，缺的那个模块就会在离线时白屏。
      const results = await Promise.allSettled(SHELL.map((url) => precacheOne(cache, url)));
      const failed = SHELL.filter((_, i) => results[i].status !== 'fulfilled' || results[i].value === false);
      if (failed.length) console.warn('[sw] 预缓存失败：', failed.join(', '));
      await self.skipWaiting();
    })(),
  );
});

async function precacheOne(cache, url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res.ok) {
        await cache.put(url, res);
        return true;
      }
      if (res.status === 404 || res.status === 410) return false; // 真不存在，重试没意义
    } catch {
      /* 网络抖动，下面重试 */
    }
    if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

// ---------------------------------------------------------------- activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本的缓存
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('fitlog-') && n !== SHELL_CACHE && n !== MEDIA_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------- fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域（以后的 CDN）交给浏览器

  // 接口：永远走网络。训练数据不做离线缓存，避免看到过期数据。
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: '当前离线，请连上网络后重试', offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      ),
    );
    return;
  }

  // 页面导航：network-first，3 秒拿不到就回缓存（弱网下不要干等）
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 动图：cache-first。1285 个 GIF 不可能预缓存，看过一次就留在本地。
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // 其余静态资源：先给缓存，后台更新
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await withTimeout(fetch(request), 2500);
    // 只有正常响应才更新缓存；5xx / 404 一律回落，别把错误页存下来
    if (fresh && fresh.ok) {
      cache.put('/index.html', fresh.clone());
      return fresh;
    }
    throw new Error(`bad status ${fresh && fresh.status}`);
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) || offlinePage();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || network || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function offlinePage() {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FitLog · 离线</title>
<style>
  html,body{height:100%;margin:0;background:#f6f6f7;color:#111;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;
    display:grid;place-items:center;text-align:center;padding:32px}
  @media (prefers-color-scheme:dark){html,body{background:#000;color:#fff}}
  h1{font-size:20px;margin:0 0 8px}p{margin:0;opacity:.6;font-size:14px}
  button{margin-top:24px;padding:12px 28px;border-radius:999px;border:1px solid currentColor;
    background:transparent;color:inherit;font-size:15px}
</style>
<h1>当前离线</h1>
<p>连上网络后点下面重新加载</p>
<button onclick="location.reload()">重新加载</button>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
