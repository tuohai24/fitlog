/**
 * 生成安卓壳要打包的 Web 资源。
 *
 * 为什么不直接把 public 当 webDir：public/media 是 134MB 的动作动图与缩略图，
 * 全塞进 APK 会让安装包膨胀到 150MB+，而这些图本来就是从服务器按需加载的。
 * 这里复制时跳过 media，其它文件原样带走。
 */
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public');
const OUT = join(ROOT, 'dist', 'native');

/* 不打包进 APK 的路径（相对 public） */
const SKIP = new Set(['media']);

function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

if (!existsSync(join(SRC, 'index.html'))) {
  console.error(`[native] 找不到 ${join(SRC, 'index.html')}，先检查 public 目录`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(SRC, OUT, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(SRC.length + 1).split('\\').join('/');
    return !SKIP.has(rel.split('/')[0]);
  },
});

// 去掉 sw.js 之外不需要的东西；sw.js 保留，Web 端还要用同一份源码
if (!existsSync(join(OUT, 'index.html'))) {
  console.error('[native] 复制后缺少 index.html');
  process.exit(1);
}

const size = dirSize(OUT);
console.log(`[native] 已生成 ${OUT}`);
console.log(`[native] 体积 ${mb(size)}（已跳过 media/，原 public 为 ${mb(dirSize(SRC))}）`);

if (size > 12 * 1024 * 1024) {
  console.warn('[native] 警告：前端资源超过 12MB，APK 会偏大，检查是否有大文件被误打包');
}
