#!/usr/bin/env node
/**
 * 生成 PWA / iOS 主屏幕图标（零依赖：手写 PNG 编码 + 超采样光栅化）
 *
 * 为什么不直接从 public/icon.svg 转：本机没有 ImageMagick / sharp / Pillow。
 * 图形本身是纯几何（圆角矩形 + 5 条圆头线段），自己光栅化反而更可控。
 *
 * 关键差异（踩过的坑）：
 *   1. iOS 会**用自己的圆角蒙版**裁主屏幕图标。如果 apple-touch-icon 自带圆角，
 *      会出现「圆角套圆角」的双层黑边。所以 iOS 用的图标必须满幅铺满。
 *   2. Android 的 maskable 图标会被裁成任意形状（圆形/方形/水滴），
 *      前景必须缩进安全区（约 80%），否则哑铃两头会被切掉。
 *   3. 归档用的 1024 图标要去掉 alpha 通道（App Store 明确拒收带透明的图标）。
 *
 * 用法：node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');
const OUT_ROOT = path.join(ROOT, 'public');

// ---------------------------------------------------------------- 图形定义
// 坐标系固定 512×512，渲染时再缩放，保证所有尺寸比例一致
const BG = [17, 17, 17]; // #111111
const FG = [255, 255, 255];
const RADIUS = 112;      // 圆角半径（512 空间）
const STROKE = 26;       // 线条粗细（圆头）
const SEGS = [
  [150, 196, 150, 316], // 内侧竖杆
  [104, 216, 104, 296], // 外侧竖杆（左）
  [362, 196, 362, 316],
  [408, 216, 408, 296], // 外侧竖杆（右）
  [150, 256, 362, 256], // 横杠
];

/** 点是否落在圆角矩形内：等价于「内缩矩形 + 半径 r 的膨胀」 */
function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 点到线段的距离（配合圆头 cap 就是按半径判定的胶囊形） */
function distSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((px - x1) * vx + (py - y1) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (x1 + t * vx);
  const dy = py - (y1 + t * vy);
  return Math.hypot(dx, dy);
}

/**
 * 渲染一张图标。
 * @param {number} size   输出边长（像素）
 * @param {object} opt
 * @param {number} opt.radius  圆角半径（512 空间；0 = 满幅直角，给 iOS / maskable 用）
 * @param {number} opt.mark    图形缩放（1 = 原尺寸，0.8 = 缩到 80%，留安全区）
 * @param {number} opt.ss      每像素超采样倍数（抗锯齿质量）
 */
function render(size, { radius = RADIUS, mark = 1, ss = 4 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const k = size / 512;          // 512 空间 → 像素
  const step = 1 / ss;
  const total = ss * ss;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // 像素内子采样 → 回到 512 坐标系
          let px = (x + (sx + 0.5) * step) / k;
          let py = (y + (sy + 0.5) * step) / k;

          if (!inRoundRect(px, py, 0, 0, 512, 512, radius)) continue;

          // 图形缩放：屏幕上一点 px 对应内容空间的 256 + (px-256)/mark
          if (mark !== 1) {
            px = 256 + (px - 256) / mark;
            py = 256 + (py - 256) / mark;
          }

          let onMark = false;
          for (const [x1, y1, x2, y2] of SEGS) {
            if (distSeg(px, py, x1, y1, x2, y2) <= STROKE / 2) { onMark = true; break; }
          }
          const c = onMark ? FG : BG;
          r += c[0]; g += c[1]; b += c[2]; hits++;
        }
      }

      const i = (y * size + x) * 4;
      if (hits > 0) {
        const alpha = hits / total;            // 覆盖率
        buf[i] = Math.round(r / hits);         // 平均颜色
        buf[i + 1] = Math.round(g / hits);
        buf[i + 2] = Math.round(b / hits);
        buf[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return buf;
}

/** 手写 PNG 编码。colorType 6 = RGBA，2 = RGB（无 alpha） */
function encodePng(w, h, rgba, { alpha = true } = {}) {
  const colorType = alpha ? 6 : 2;
  const channels = alpha ? 4 : 3;
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);

  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (stride + 1) + 1 + x * channels;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (alpha) raw[d + 3] = rgba[s + 3];
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;          // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;         // compression
  ihdr[11] = 0;         // filter
  ihdr[12] = 0;         // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 输出清单
const JOBS = [
  // 文件名                  尺寸   圆角   图形   超采样  说明
  ['icons/icon-192.png',      192,  RADIUS, 1,   6, 'manifest any'],
  ['icons/icon-512.png',      512,  RADIUS, 1,   4, 'manifest any / 安装弹窗'],
  ['icons/icon-maskable-512.png', 512, 0,  0.8, 4, 'Android 自适应（安全区）'],
  ['apple-touch-icon.png',    180,  0,      1,   6, 'iOS 主屏幕（满幅，系统自己裁圆角）'],
  ['icons/icon-1024.png',     1024, 0,      1,   2, 'Capacitor / App Store'],
];

fs.mkdirSync(OUT, { recursive: true });

for (const [rel, size, radius, mark, ss, note] of JOBS) {
  const file = path.join(OUT_ROOT, rel);
  const rgba = render(size, { radius, mark, ss });
  // App Store 图标不能带 alpha 通道
  const png = encodePng(size, size, rgba, { alpha: !rel.includes('1024') });
  fs.writeFileSync(file, png);
  const kb = (png.length / 1024).toFixed(1);
  console.log(`  ${String(size).padStart(4)}×${String(size).padEnd(4)}  ${kb.padStart(6)} KB  ${rel.padEnd(30)} ${note}`);
}

console.log('\n图标已生成到 public/');
