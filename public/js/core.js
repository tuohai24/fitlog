/* 通用工具：DOM、格式化、图标、Toast、Sheet */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function dateLabel(s, withYear = false) {
  if (!s) return '';
  const d = parseDate(s);
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日 ${DOW[d.getDay()]}`;
}

export function shortDate(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtNum(n, digits = 0) {
  const v = Number(n) || 0;
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** 容量：小于 1 万显示 kg，否则显示吨 */
export function fmtVolume(kg) {
  const v = Number(kg) || 0;
  if (v >= 10000) return { value: (v / 1000).toFixed(1), unit: '吨' };
  return { value: fmtNum(v), unit: 'kg' };
}

export function relativeDay(s) {
  const t = todayStr();
  if (s === t) return '今天';
  const diff = Math.round((parseDate(t) - parseDate(s)) / 86400000);
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff > 0 && diff < 7) return `${diff} 天前`;
  return dateLabel(s);
}

/** ISO 时间戳 → “3 小时前” 之类的相对说法 */
export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  const days = Math.floor(diff / 86400e3);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/* ---------------- 图标（SF Symbols 风格线性图标） ---------------- */const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  dumbbell: '<path d="M6.5 9v6M3.5 10v4M17.5 9v6M20.5 10v4M6.5 12h11"/>',
  chart: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 8.4 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.04 15a1.7 1.7 0 0 0-1.56-1.03H2a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 3.6 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8 4.58 1.7 1.7 0 0 0 9 3.02V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4.5 12.5l5 5 9.5-11"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13"/>',
  flame: '<path d="M12 3s5 4.2 5 8.5A5 5 0 0 1 7 12c0-1.4.5-2.6 1.3-3.7C9.6 6.7 12 3 12 3z"/><path d="M12 21a4 4 0 0 0 4-4c0-2-2-3.5-4-6-2 2.5-4 4-4 6a4 4 0 0 0 4 4z"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.6 6"/><path d="M20 5v6h-6"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  ellipsis: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/>',
  logout: '<path d="M15 4h3.5A2.5 2.5 0 0 1 21 6.5v11A2.5 2.5 0 0 1 18.5 20H15"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  community: '<circle cx="9" cy="8" r="3.1"/><path d="M3.4 19.2c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2"/><path d="M16.2 6.3a2.9 2.9 0 0 1 0 5.4"/><path d="M17.4 14.6c2.2.6 3.6 2.3 3.6 4.4"/>',
  chat: '<path d="M20.5 11.8a7.9 7.9 0 0 1-11.4 7L4 20l1.3-4.8A7.9 7.9 0 1 1 20.5 11.8z"/>',
  send: '<path d="M20.5 3.5 3.8 10.4l6.4 2.5 2.5 6.4 7.8-15.8z"/><path d="M10.2 12.9 20.5 3.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>',
};

export function icon(name, cls = '') {
  const p = ICONS[name] || '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---------------- Toast ---------------- */
let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- Sheet 弹层 ---------------- */
let openSheetCleanup = null;

export function openSheet({ title, content, onMount, full = false, actions = '' }) {
  closeSheet(true);
  const root = $('#overlay-root');
  root.innerHTML = `
    <div class="overlay" data-close="1"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
      <div class="sheet-grab"></div>
      <header class="sheet-head">
        <h3>${esc(title || '')}</h3>
        <div style="display:flex;align-items:center;gap:4px">
          ${actions}
          <button class="icon-btn" data-close="1" aria-label="关闭">${icon('x')}</button>
        </div>
      </header>
      <div class="sheet-body ${full ? 'no-pad' : ''}">${content || ''}</div>
    </section>`;

  document.body.classList.add('modal-open');
  const sheet = $('.sheet', root);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });

  openSheetCleanup = () => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
  };

  if (onMount) onMount(sheet);
  return sheet;
}

export function closeSheet(immediate = false) {
  const root = $('#overlay-root');
  const sheet = $('.sheet', root);
  if (!sheet) return;
  if (openSheetCleanup) { openSheetCleanup(); openSheetCleanup = null; }
  if (immediate) { root.innerHTML = ''; return; }
  sheet.classList.add('closing');
  $('.overlay', root)?.style.setProperty('opacity', '0');
  setTimeout(() => { root.innerHTML = ''; }, 240);
}

/* ---------------- 确认框 ---------------- */
export function confirmSheet({ title, message, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const sheet = openSheet({
      title,
      content: `
        <p class="sub" style="margin-bottom:20px">${esc(message || '')}</p>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary btn-block" data-no>取消</button>
          <button class="btn btn-block ${danger ? '' : ''}" data-yes
            style="${danger ? 'background:var(--danger)' : ''}">${esc(confirmText)}</button>
        </div>`,
      onMount(el) {
        el.querySelector('[data-no]').onclick = () => { closeSheet(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { closeSheet(); resolve(true); };
      },
    });
    if (!sheet) resolve(false);
  });
}

/* ---------------- 图片 ---------------- */
export function thumb(ex, cls = 'thumb') {
  if (!ex || !ex.img) return `<div class="${cls} thumb-fallback">${icon('dumbbell')}</div>`;
  return `<img class="${cls}" src="/media/thumbs/${esc(ex.img)}" alt="${esc(ex.zh || '')}"
    loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/icon.svg'">`;
}

/* ---------------- 迷你柱状图 ---------------- */
export function barChart(data, { height = 110 } = {}) {
  const max = Math.max(1, ...data.map(d => d.value));
  const n = data.length || 1;
  const gap = n > 60 ? 1 : n > 20 ? 3 : 8;
  const bars = data.map((d, i) => {
    const pct = d.value > 0 ? Math.max(3, (d.value / max) * 100) : 1.5;
    const isLast = i === n - 1;
    return `<div class="bar ${d.value > 0 ? '' : 'zero'} ${isLast ? 'last' : ''}"
      style="height:${pct}%" title="${d.value}"></div>`;
  }).join('');
  return `<div class="bars" style="height:${height}px;gap:${gap}px" role="img" aria-label="训练容量趋势">${bars}</div>`;
}
