/* Web / 安卓原生壳（Capacitor）的差异全部收敛在这个文件里 */

const API_BASE_STORE = 'fitlog.apiBase';
const TOKEN_STORE = 'fitlog.token';

/* 原生壳里前端是本地 assets，接口在远端，必须带绝对地址 */
const DEFAULT_API_BASE = String(window.__FITLOG_API_BASE__ || 'https://fit.kjsa.cn').replace(/\/+$/, '');

export const isNative = Boolean(
  window.__FITLOG_NATIVE__ ||
  (window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true)) ||
  location.protocol === 'capacitor:'
);

function lsGet(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* 隐私模式忽略 */ }
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/* ---------------- 接口地址 ---------------- */
/** Web 端返回空串（同源），原生壳返回远端域名；localStorage 可覆盖以便连自建服务器 */
export function apiBase() {
  const saved = lsGet(API_BASE_STORE).trim();
  if (saved) return saved.replace(/\/+$/, '');
  return isNative ? DEFAULT_API_BASE : '';
}

export function setApiBase(base) {
  const v = String(base || '').trim().replace(/\/+$/, '');
  if (v) lsSet(API_BASE_STORE, v); else lsDel(API_BASE_STORE);
  // 换服务器后旧 token 一定无效
  token.clear();
}

/** 拼接口地址：传入不含 /api 的路径，如 '/workouts?page=1' */
export function apiUrl(path) {
  return `${apiBase()}/api${path}`;
}

/** 拼静态资源地址：传入以 / 开头的路径，如 '/media/thumbs/x.jpg' */
export function assetUrl(path) {
  return `${apiBase()}${path}`;
}

/* ---------------- 会话 ---------------- */
export const token = {
  get: () => (isNative ? lsGet(TOKEN_STORE) : ''),
  set(t) { if (isNative && t) lsSet(TOKEN_STORE, t); },
  clear() { lsDel(TOKEN_STORE); },
};

/** 原生壳用 Bearer（跨站 Cookie 会被 SameSite 拦掉），Web 端继续用 Cookie */
export function authHeaders(extra) {
  const h = { ...(extra || {}) };
  const t = token.get();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export const fetchCredentials = isNative ? 'omit' : 'same-origin';

/* ---------------- 文件保存 ---------------- */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => {
      const s = String(reader.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function webDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * 保存导出的文件。
 * Web：走 a[download]。原生壳：WebView 不处理 blob 下载，改写进应用缓存再拉起系统分享，
 * 用户可以直接「保存到文件」或发到微信/邮件。
 * 返回 'download' | 'share' | 文件 uri。
 */
export async function saveBlob(blob, filename) {
  if (!isNative) {
    webDownload(blob, filename);
    return 'download';
  }

  const cap = window.Capacitor;
  const Filesystem = (cap.Plugins && cap.Plugins.Filesystem) || cap.registerPlugin('Filesystem');
  const Share = (cap.Plugins && cap.Plugins.Share) || cap.registerPlugin('Share');
  if (!Filesystem || typeof Filesystem.writeFile !== 'function') {
    webDownload(blob, filename); // 插件缺失时的兜底，不阻断导出
    return 'download';
  }

  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data,
    directory: 'CACHE',
    recursive: true,
  });

  if (Share && typeof Share.share === 'function') {
    try {
      await Share.share({ files: [uri], title: filename, dialogTitle: '保存或分享导出文件' });
      return 'share';
    } catch (e) {
      // 用户点了返回/取消不算失败：文件已经写进应用缓存了
      if (/cancel/i.test(String(e && e.message))) return 'canceled';
      throw e;
    }
  }
  return uri;
}
