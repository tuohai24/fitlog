// 下载动作媒体（缩略图 / GIF）到本地
// 用法: node scripts/fetch-media.mjs [--gifs] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const args = process.argv.slice(2);
const WITH_GIFS = args.includes('--gifs');
const FORCE = args.includes('--force');
const BASE = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main';

const data = JSON.parse(fs.readFileSync('data/exercises.json', 'utf8'));
const tasks = [];
for (const ex of data) {
  if (ex.img) tasks.push({ url: `${BASE}/images/${ex.img}`, out: path.join('public/media/thumbs', ex.img) });
  if (WITH_GIFS && ex.gif) tasks.push({ url: `${BASE}/videos/${ex.gif}`, out: path.join('public/media/gifs', ex.gif) });
}

const todo = tasks.filter(t => FORCE || !fs.existsSync(t.out) || fs.statSync(t.out).size < 500);
console.log(`[media] ${todo.length}/${tasks.length} 待下载`);

let done = 0, failed = 0, cursor = 0;
const CONCURRENCY = 16;

async function worker() {
  while (cursor < todo.length) {
    const t = todo[cursor++];
    fs.mkdirSync(path.dirname(t.out), { recursive: true });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(t.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(t.out));
        if (fs.statSync(t.out).size < 500) throw new Error('文件过小');
        break;
      }
      done++;
    } catch (e) {
      failed++;
      fs.rmSync(t.out, { force: true });
      if (failed < 8) console.warn('[skip]', t.out, e.message);
    }
    if ((done + failed) % 100 === 0) console.log(`  进度 ${done + failed}/${todo.length}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`[media] 完成 ${done}，失败 ${failed}`);
