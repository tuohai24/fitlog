/**
 * 启动前置检查（必须作为 server/index.js 的第一个 import）
 *
 * 为什么需要它：better-sqlite3 13 的原生二进制按 N-API 10 编译，N-API 10 是 Node 22
 * 才有的能力。用 Node 20 装上不会报错（npm 只给一条 EBADENGINE 警告），但 db.js 里
 * `new Database()` 触发 dlopen 时进程会被 SIGSEGV 打死 —— 此时 journalctl 里只有
 * `status=11/SEGV`，看不到任何原因，非常难查。
 *
 * ESM 会按 import 语句的顺序求值，所以把这个文件放在最前面，就能在 db.js 碰到原生模块
 * 之前先检查版本，用一条清楚的错误退出（退出码 78 = EX_CONFIG）。
 */
const MIN_NODE_MAJOR = 22;
const MIN_NAPI = 10;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const napi = Number(process.versions.napi || 0);

if (nodeMajor < MIN_NODE_MAJOR || napi < MIN_NAPI) {
  console.error(
    [
      `[preflight] 当前 Node ${process.versions.node}（N-API ${napi}）不满足运行要求`,
      `[preflight] 需要 Node ${MIN_NODE_MAJOR}+（N-API ${MIN_NAPI}+）`,
      `[preflight] better-sqlite3 的原生二进制按 N-API ${MIN_NAPI} 编译；用更老的 Node 会在加载时直接段错误（日志里只有 status=11/SEGV）`,
      '[preflight] 修复：在安装目录执行 ./install.sh install（自动升级 Node 并重编原生模块）',
    ].join('\n'),
  );
  process.exit(78);
}
