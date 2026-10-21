/**
 * 下载 PDF 导出所需的中文字体（Noto Sans SC，SIL OFL 1.1）
 *
 * 正常情况仓库里已内置 assets/fonts/NotoSansSC-Regular.ttf，
 * 只有在重新克隆/清理过 assets 时才需要执行：npm run fetch:font
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT_DIR = path.join(process.cwd(), 'assets', 'fonts');
const TARGET = path.join(OUT_DIR, 'NotoSansSC-Regular.ttf');
const PKG = '@expo-google-fonts/noto-sans-sc';
const SRC = `node_modules/${PKG}/400Regular/NotoSansSC_400Regular.ttf`;

if (fs.existsSync(TARGET) && fs.statSync(TARGET).size > 1e6) {
  console.log(`字体已存在：${path.relative(process.cwd(), TARGET)}（${(fs.statSync(TARGET).size / 1048576).toFixed(1)} MB）`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`安装 ${PKG} …`);
execFileSync('npm', ['install', PKG, '--no-save', '--no-audit', '--no-fund'], { stdio: 'inherit' });

if (!fs.existsSync(SRC)) {
  console.error(`未找到字体文件：${SRC}`);
  process.exit(1);
}
fs.copyFileSync(SRC, TARGET);
const license = `node_modules/${PKG}/LICENSE_FONT`;
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(OUT_DIR, 'LICENSE-NotoSansSC.txt'));
console.log(`已保存到 ${path.relative(process.cwd(), TARGET)}（${(fs.statSync(TARGET).size / 1048576).toFixed(1)} MB）`);
console.log('提示：也可以设置 PDF_FONT_PATH 指向系统里已有的中文字体（.ttf/.otf）。');
