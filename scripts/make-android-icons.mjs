/**
 * 生成安卓启动图标与启动画面（黑底白哑铃，跟 Web/PWA 一套视觉）。
 *
 * 用 Playwright 的 Chromium 做光栅化：本地没有 ImageMagick / sharp，
 * 但 canvas 画 SVG 是浏览器原生能力，等比缩放和抗锯齿都不用自己写。
 *
 * 产物直接覆盖 android/app/src/main/res 下的模板图。
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

if (!existsSync(RES)) {
  console.error('[icons] 找不到 android/app/src/main/res，先跑 npx cap add android');
  process.exit(1);
}

const INK = '#111111';
const MARK_BOX = 330; // 哑铃在 512 视窗里的实际宽度（含描边）
const VIEW = 512;

const svgFull = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}">
  <rect width="${VIEW}" height="${VIEW}" rx="112" fill="${INK}"/>
  <g fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round">
    <path d="M150 196v120M104 216v80M362 196v120M408 216v80"/>
    <path d="M150 256h212"/>
  </g>
</svg>`;

const svgMark = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}">
  <g fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round">
    <path d="M150 196v120M104 216v80M362 196v120M408 216v80"/>
    <path d="M150 256h212"/>
  </g>
</svg>`;

const MIPMAP = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

/* 启动画面按模板里已有尺寸生成，避免手写密度表写错 */
function splashTargets() {
  const found = [];
  for (const dir of readdirSync(RES)) {
    if (!dir.startsWith('drawable')) continue;
    const p = join(RES, dir, 'splash.png');
    if (!existsSync(p)) continue;
    const b = readFileSync(p);
    found.push({ key: `${dir}/splash.png`, w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
  }
  return found;
}

const jobs = [];
for (const [density, size] of Object.entries(MIPMAP)) {
  jobs.push({ key: `mipmap-${density}/ic_launcher.png`, mode: 'icon', w: size, h: size });
  jobs.push({ key: `mipmap-${density}/ic_launcher_round.png`, mode: 'round', w: size, h: size });
}
for (const [density, size] of Object.entries(FOREGROUND)) {
  jobs.push({ key: `mipmap-${density}/ic_launcher_foreground.png`, mode: 'fg', w: size, h: size });
}
for (const s of splashTargets()) {
  jobs.push({ key: s.key, mode: 'splash', w: s.w, h: s.h });
}

const browser = await chromium.launch();
const page = await browser.newPage();

const rendered = await page.evaluate(
  async ({ jobs, svgFull, svgMark, MARK_BOX, VIEW, INK }) => {
    function load(svg) {
      return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('SVG 解码失败'));
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const icon = await load(svgFull);
    const mark = await load(svgMark);

    // 哑铃在正方形视窗里居中，按目标宽度反推绘制边长，保证等比
    function drawMark(w, h, boxWidth) {
      const side = (boxWidth * VIEW) / MARK_BOX;
      ctx.drawImage(mark, (w - side) / 2, (h - side) / 2, side, side);
    }

    const out = {};
    for (const j of jobs) {
      canvas.width = j.w;
      canvas.height = j.h;
      ctx.clearRect(0, 0, j.w, j.h);

      if (j.mode === 'icon') {
        ctx.drawImage(icon, 0, 0, j.w, j.h);
      } else if (j.mode === 'round') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(j.w / 2, j.h / 2, j.w / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, j.w, j.h);
        drawMark(j.w, j.h, j.w * 0.6);
        ctx.restore();
      } else if (j.mode === 'fg') {
        // 自适应图标：内容必须落在中心 66/108 的安全区内
        drawMark(j.w, j.h, j.w * 0.66);
      } else if (j.mode === 'splash') {
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, j.w, j.h);
        drawMark(j.w, j.h, Math.min(j.w, j.h) * 0.3);
      }
      out[j.key] = canvas.toDataURL('image/png');
    }
    return out;
  },
  { jobs, svgFull, svgMark, MARK_BOX, VIEW, INK }
);

await browser.close();

let bytes = 0;
for (const [rel, dataUrl] of Object.entries(rendered)) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  writeFileSync(join(RES, rel), buf);
  bytes += buf.length;
}
console.log(`[icons] 已生成 ${Object.keys(rendered).length} 个图（${(bytes / 1024).toFixed(0)} KB）`);
