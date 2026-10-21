#!/usr/bin/env bash
#
# install.sh「环境自动补装」逻辑的离线回归测试
#
# 特点：不碰真实系统——need_cmd / as_root / npm 全部被 stub，
#      只验证「缺什么 → 走哪个分支 → 执行了哪条命令」。
#
# 用法：bash scripts/test-install-env.sh
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
WORK="$ROOT/data/.test-install-env"
FUNCS="$ROOT/data/.test-install-funcs.sh"

rm -rf "$WORK"; mkdir -p "$WORK"
trap 'rm -rf "$WORK" "$FUNCS"' EXIT

# 把 install.sh 的函数与变量定义截出来（到「入口」注释为止），不执行 case 分支
sed '/--------------- 入口/,$d' install.sh > "$FUNCS"

PASS=0; FAIL=0
check() {  # $1=用例名 $2=实际 $3=期望
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  ✗ %s\n     期望：%s\n     实际：%s\n' "$1" "$3" "$2"
  fi
}
contains() {  # $1=用例名 $2=文件 $3=子串
  # 用 -e 传模式：子串可能是 --registry=... 这种以 - 开头的内容
  if grep -qF -e "$3" "$2" 2>/dev/null; then
    PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  ✗ %s\n     没在 %s 里找到：%s\n' "$1" "$2" "$3"
    [ -f "$2" ] && sed 's/^/     | /' "$2" | head -n 8
  fi
}

# 载入被测函数 + 关掉彩色输出
load() {
  # shellcheck disable=SC1090
  . "$FUNCS"
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
  INSTALL_DIR="$WORK"
  ASSUME_YES=1
  NO_SYSTEM_INSTALL=0
  AUTO_INSTALLED=""
}

printf '\n== install.sh 环境补装逻辑测试 ==\n\n'

# ---------------------------------------------------------------- 包名映射
printf '[1] 包名映射（不同发行版）\n'
check "apt 编译工具链"   "$( ( load; PKG_MGR=apt;    pkg_names build ) )" "python3 make g++"
check "dnf 编译工具链"   "$( ( load; PKG_MGR=dnf;    pkg_names build ) )" "python3 make gcc-c++"
check "apk 编译工具链"   "$( ( load; PKG_MGR=apk;    pkg_names build ) )" "python3 make g++"
check "pacman 编译工具链" "$( ( load; PKG_MGR=pacman; pkg_names build ) )" "python3 make gcc"
check "apt 基础工具含 xz" "$( ( load; PKG_MGR=apt;    pkg_names base ) )" "curl ca-certificates tar xz-utils"
check "无包管理器时为空"  "$( ( load; PKG_MGR=none;   pkg_names build ) )" ""

# ---------------------------------------------------------------- 安装分支
printf '\n[2] pkg_install 分支\n'
check "没有包管理器 → 失败" \
  "$( ( load; PKG_MGR=none; pkg_install build >/dev/null 2>&1; echo $? ) )" "1"
check "无 root 无 sudo → 失败" \
  "$( ( load; PKG_MGR=apt; IS_ROOT=0; need_cmd() { return 1; }; pkg_install build >/dev/null 2>&1; echo $? ) )" "1"
check "--no-system-install → 跳过" \
  "$( ( load; PKG_MGR=apt; IS_ROOT=1; NO_SYSTEM_INSTALL=1; as_root() { :; }; pkg_install build >/dev/null 2>&1; echo $? ) )" "1"

# 有 root：应该真的调用 apt-get，并把包名记进 AUTO_INSTALLED
( load
  PKG_MGR=apt; IS_ROOT=1
  CALLS="$WORK/apt-calls.log"; : > "$CALLS"
  as_root() { printf '%s\n' "$*" >> "$CALLS"; return 0; }
  pkg_install build >/dev/null 2>&1
  printf '%s' "$AUTO_INSTALLED" > "$WORK/auto-installed.txt"
)
contains "apt 收到正确的安装命令" "$WORK/apt-calls.log" "apt-get install -y --no-install-recommends python3 make g++"
check    "记下了本次补装的包"      "$(cat "$WORK/auto-installed.txt")" "python3 make g++"

# ---------------------------------------------------------------- Node
printf '\n[3] Node 版本判断\n'
check "x86_64 → x64" "$( ( load; uname() { echo x86_64; }; node_arch ) )" "x64"
check "arm64 → arm64" "$( ( load; uname() { echo aarch64; }; node_arch ) )" "arm64"
check "未知架构 → 空" "$( ( load; uname() { echo mips; }; node_arch ) )" ""
check "Node 17 不算合格" \
  "$( ( load; node() { if [ "$1" = "-p" ]; then echo 17; else echo v17.9.0; fi; }; need_cmd() { return 0; }; node_ok; echo $? ) )" "1"
check "Node 22 合格" \
  "$( ( load; node() { if [ "$1" = "-p" ]; then echo 22; else echo v22.11.0; fi; }; need_cmd() { return 0; }; node_ok; echo $? ) )" "0"

# 已有合规 Node 时不应触发任何安装
( load
  node() { if [ "$1" = "-p" ]; then echo 22; else echo v22.11.0; fi; }
  need_cmd() { [ "$1" = "node" ] || [ "$1" = "npm" ]; }
  CALLS="$WORK/node-calls.log"; : > "$CALLS"
  pkg_install() { echo "pkg_install $*" >> "$CALLS"; return 0; }
  install_node_tarball() { echo "tarball" >> "$CALLS"; return 0; }
  ensure_node >/dev/null 2>&1
)
check "已有 Node 时不重复安装" "$(wc -l < "$WORK/node-calls.log" | tr -d ' ')" "0"

# ---------------------------------------------------------------- 编译工具链
printf '\n[4] 编译工具链\n'
check "工具链齐全 → 通过" \
  "$( ( load; has_python() { return 0; }; has_cc() { return 0; }; need_cmd() { return 0; }; has_build_tools; echo $? ) )" "0"
check "缺 make → 不通过" \
  "$( ( load; has_python() { return 0; }; has_cc() { return 0; }; need_cmd() { [ "$1" != make ]; }; has_build_tools; echo $? ) )" "1"
check "补装失败 → ensure 返回 1" \
  "$( ( load; has_build_tools() { return 1; }; pkg_install() { return 1; }; ensure_build_tools >/dev/null 2>&1; echo $? ) )" "1"
check "补装成功 → ensure 返回 0" \
  "$( ( load; has_build_tools() { [ -f "$WORK/bt" ]; }; pkg_install() { : > "$WORK/bt"; return 0; }; ensure_build_tools >/dev/null 2>&1; echo $? ) )" "0"

# ---------------------------------------------------------------- npm 重试
printf '\n[5] npm install 重试阶梯\n'
NPM_LOG="$WORK/npm-calls.log"

# 5.1 第一次失败，换镜像后成功
( load
  mkdir -p "$WORK/app1"; : > "$WORK/app1/package.json"
  INSTALL_DIR="$WORK/app1"
  : > "$NPM_LOG"
  npm() { printf '%s\n' "$*" >> "$NPM_LOG"; case " $* " in *--registry=*) return 0 ;; *) return 1 ;; esac; }
  check_native_modules() { return 0; }
  install_deps >/dev/null 2>&1
  echo $? > "$WORK/rc1"
)
check "镜像重试后返回成功" "$(cat "$WORK/rc1")" "0"
check "第一次用默认源"     "$(sed -n '1p' "$NPM_LOG" | grep -c 'install --omit=dev')" "1"
contains "第二次带上镜像参数" "$NPM_LOG" "--registry=https://registry.npmmirror.com"

# 5.2 全部失败 → 退出码非 0，且尝试过源码编译
#     注意：install_deps 里最后会 die（exit），所以退出码要在子 shell 外面取
( load
  mkdir -p "$WORK/app2"; : > "$WORK/app2/package.json"
  INSTALL_DIR="$WORK/app2"
  : > "$NPM_LOG"
  npm() {
    # 记录参数 + 是否处于「源码编译」模式（环境变量前缀）
    printf '%s [build_from_source=%s]\n' "$*" "${npm_config_build_from_source:-}" >> "$NPM_LOG"
    # 模拟 gyp 报错，触发「补工具链 + 源码编译」分支
    if [ "${1:-}" = "install" ]; then
      echo "gyp ERR! stack Error: not found: make" >> "$WORK/app2/data/.npm-install.log"
    fi
    return 1
  }
  check_native_modules() { return 1; }
  pkg_install() { return 0; }
  ensure_build_tools() { return 0; }
  rebuild_native() { return 1; }
  install_deps >/dev/null 2>&1
)
RC2=$?
check "全失败时退出码非 0" "$RC2" "1"
contains "尝试过源码编译" "$NPM_LOG" "[build_from_source=true]"

# ---------------------------------------------------------------- 原生模块
printf '\n[6] 原生模块校验\n'
( load
  mkdir -p "$WORK/app3/node_modules/better-sqlite3"
  INSTALL_DIR="$WORK/app3"
  node() { return 1; }
  check_native_modules >/dev/null 2>&1
  echo $? > "$WORK/rc3"
)
check "加载失败时能识别" "$(cat "$WORK/rc3")" "1"

( load
  mkdir -p "$WORK/app4/node_modules/better-sqlite3"
  INSTALL_DIR="$WORK/app4"
  node() { return 0; }
  check_native_modules >/dev/null 2>&1
  echo $? > "$WORK/rc4"
)
check "加载成功时返回 0" "$(cat "$WORK/rc4")" "0"

# ---------------------------------------------------------------- .env 端口同步
printf '\n[7] PORT 与 .env 对齐\n'
( load
  mkdir -p "$WORK/env1"; INSTALL_DIR="$WORK/env1"
  printf 'PORT=8080\nHOST=0.0.0.0\n' > "$INSTALL_DIR/.env"
  PORT=9000
  ensure_env >/dev/null 2>&1
  grep -c '^PORT=9000$' "$INSTALL_DIR/.env" > "$WORK/env1.txt"
)
check "PORT 环境变量同步进 .env" "$(cat "$WORK/env1.txt")" "1"

( load
  mkdir -p "$WORK/env2"; INSTALL_DIR="$WORK/env2"
  printf 'HOST=0.0.0.0\n' > "$INSTALL_DIR/.env"
  PORT=9100
  ensure_env >/dev/null 2>&1
  grep -c '^PORT=9100$' "$INSTALL_DIR/.env" > "$WORK/env2.txt"
)
check ".env 没有 PORT 时追加进去" "$(cat "$WORK/env2.txt")" "1"

# ---------------------------------------------------------------- 端口迁移
printf '\n[8] 端口冲突与高位端口\n'
check "跳过被占端口" \
  "$( ( load; HIGH_PORT_BASE=18473; port_in_use() { [ "$1" = "18473" ]; }; free_high_port ) )" "18474"
check "连续被占时往后找" \
  "$( ( load; HIGH_PORT_BASE=19000; port_in_use() { case "$1" in 19000|19001|19002) return 0;; *) return 1;; esac; }; free_high_port ) )" "19003"
check "整段被占 → 失败" \
  "$( ( load; HIGH_PORT_BASE=19100; port_in_use() { return 0; }; free_high_port >/dev/null; echo $? ) )" "1"

( load
  mkdir -p "$WORK/port1"; INSTALL_DIR="$WORK/port1"
  printf 'PORT=8080\nHOST=127.0.0.1\n' > "$INSTALL_DIR/.env"
  set_env_port 18473
  grep -c '^PORT=18473$' "$INSTALL_DIR/.env" > "$WORK/port1.txt"
  printf '%s' "$PORT" > "$WORK/port1-var.txt"
)
check "set_env_port 改写 .env"   "$(cat "$WORK/port1.txt")" "1"
check "set_env_port 同步变量"    "$(cat "$WORK/port1-var.txt")" "18473"

( load
  mkdir -p "$WORK/port2"; INSTALL_DIR="$WORK/port2"
  printf 'HOST=127.0.0.1\n' > "$INSTALL_DIR/.env"
  set_env_port 18480
  grep -c '^PORT=18480$' "$INSTALL_DIR/.env" > "$WORK/port2.txt"
)
check "没有 PORT 行时追加" "$(cat "$WORK/port2.txt")" "1"

( load
  mkdir -p "$WORK/port3"; INSTALL_DIR="$WORK/port3"
  printf 'PORT=19400\n' > "$INSTALL_DIR/.env"
  PORT=19400; HIGH_PORT_BASE=19400
  port_in_use() { return 1; }
  move_to_free_port 19400 >/dev/null 2>&1
  echo $? > "$WORK/port3-rc.txt"
  cp "$INSTALL_DIR/.env" "$WORK/port3-env.txt"
)
check "端口空闲 → 不迁移" "$(cat "$WORK/port3-rc.txt")" "0"
check ".env 保持原端口"   "$(grep -c '^PORT=19400$' "$WORK/port3-env.txt")" "1"

( load
  mkdir -p "$WORK/port4"; INSTALL_DIR="$WORK/port4"
  printf 'PORT=19500\n' > "$INSTALL_DIR/.env"
  PORT=19500; HIGH_PORT_BASE=19501
  port_in_use() { [ "$1" = "19500" ]; }   # 只有 19500 被占
  is_fitlog_on() { return 1; }            # 占用者不是 FitLog
  move_to_free_port 19500 >/dev/null 2>&1
  echo $? > "$WORK/port4-rc.txt"
  if grep -q '^PORT=19501$' "$INSTALL_DIR/.env"; then echo 1; else echo 0; fi > "$WORK/port4-env.txt"
)
check "被占用 → 自动换端口" "$(cat "$WORK/port4-rc.txt")" "0"
check "新端口写回 .env"     "$(cat "$WORK/port4-env.txt")" "1"


# ---------------------------------------------------------------- Node 22 硬门槛
printf '\n[9] Node 22 / N-API 10 硬门槛\n'
check "Node 20 不再算合格（better-sqlite3 需要 N-API 10）" \
  "$( ( load; node() { if [ "$1" = "-p" ]; then echo 20; else echo v20.19.0; fi; }; need_cmd() { return 0; }; node_ok; echo $? ) )" "1"
check "Node 22 合格" \
  "$( ( load; node() { if [ "$1" = "-p" ]; then echo 22; else echo v22.11.0; fi; }; need_cmd() { return 0; }; node_ok; echo $? ) )" "0"
check "N-API 9 → 不满足" \
  "$( ( load; node() { echo 9; }; node_napi_ok; echo $? ) )" "1"
check "N-API 10 → 满足" \
  "$( ( load; node() { echo 10; }; node_napi_ok; echo $? ) )" "0"
check "node -p 没输出时按 0 处理（不炸）" \
  "$( ( load; node() { return 0; }; node_napi ) )" "0"

# ---------------------------------------------------------------- 崩溃分类
printf '\n[10] 崩溃 / 错误分类（classify_probe）\n'
LOGX="$WORK/classify.log"; : > "$LOGX"
check "退出码 0 → ok"        "$( ( load; classify_probe 0 "$LOGX" ) )" "ok"
check "超时 124"             "$( ( load; classify_probe 124 "$LOGX" ) )" "timeout"
check "139 → SIGSEGV"        "$( ( load; classify_probe 139 "$LOGX" ) )" "segv"
check "134 → SIGABRT"        "$( ( load; classify_probe 134 "$LOGX" ) )" "abort"
check "135 → SIGBUS"         "$( ( load; classify_probe 135 "$LOGX" ) )" "sigbus"
check "137 → SIGKILL"        "$( ( load; classify_probe 137 "$LOGX" ) )" "killed"
check "空输出 + 退出码 1"    "$( ( load; classify_probe 1 "$LOGX" ) )" "error"

printf 'Error: The module was compiled against a different NODE_MODULE_VERSION 127\n' > "$LOGX"
check "ABI 不匹配文案"       "$( ( load; classify_probe 1 "$LOGX" ) )" "abi"
printf '/x/prebuilds/linux-x64.node: version `GLIBC_2.28` not found\n' > "$LOGX"
check "缺 GLIBC 符号"        "$( ( load; classify_probe 1 "$LOGX" ) )" "glibc"
printf 'Error: Cannot find module "/x/better_sqlite3.node"\n' > "$LOGX"
check "找不到模块"           "$( ( load; classify_probe 1 "$LOGX" ) )" "missing"
printf 'Error: listen EADDRINUSE: address already in use 0.0.0.0:18473\n' > "$LOGX"
check "端口占用"             "$( ( load; classify_probe 1 "$LOGX" ) )" "eaddrinuse"
printf 'SqliteError: database is locked\n' > "$LOGX"
check "数据库被锁"           "$( ( load; classify_probe 1 "$LOGX" ) )" "busy"
printf 'SqliteError: file is not a database\n' > "$LOGX"
check "数据库损坏"           "$( ( load; classify_probe 1 "$LOGX" ) )" "sqlite"

check "segv 有人话解释" "$( ( load; describe_probe segv | grep -c SIGSEGV ) )" "1"

# ---------------------------------------------------------------- journal 信号识别
printf '\n[11] systemd 日志里的崩溃信号\n'
SEGV_LOG="$WORK/journal-segv.txt"
cat > "$SEGV_LOG" <<'EOF'
Oct 21 16:13:51 srv systemd[1]: Started fitlog.service - FitLog 健身训练记录.
Oct 21 16:13:51 srv systemd[1]: fitlog.service: Main process exited, code=killed, status=11/SEGV
Oct 21 16:13:51 srv systemd[1]: fitlog.service: Failed with result 'signal'.
EOF
check "status=11/SEGV → segv" "$( ( load; journal_crash_reason < "$SEGV_LOG" ) )" "segv"
printf 'fitlog.service: Main process exited, code=killed, status=7/BUS\n' > "$WORK/j2.txt"
check "status=7/BUS → sigbus"  "$( ( load; journal_crash_reason < "$WORK/j2.txt" ) )" "sigbus"
printf 'fitlog.service: Failed to start FitLog\n' > "$WORK/j3.txt"
check "普通失败 → 空"         "$( ( load; journal_crash_reason < "$WORK/j3.txt" ) )" ""

# ---------------------------------------------------------------- 硬闸门
printf '\n[12] 原生模块硬闸门（不再假装成功）\n'
( load
  check_native_modules() { return 1; }        # 第一次就不行
  repair_native_modules() { return 0; }       # 修复成功
  NATIVE_FAIL_REASON=segv
  verify_native_or_die "$WORK/x.log" >/dev/null 2>&1
  echo $? > "$WORK/g1.txt"
)
check "修复成功 → 放行" "$(cat "$WORK/g1.txt")" "0"

( load
  check_native_modules() { return 1; }
  repair_native_modules() { return 1; }
  NATIVE_FAIL_REASON=segv
  explain_native_failure() { :; }
  die() { return 1; }
  verify_native_or_die "$WORK/x.log" >/dev/null 2>&1
  echo $? > "$WORK/g2.txt"
)
check "修不好 → 不放行" "$(cat "$WORK/g2.txt")" "1"

# 安装依赖成功但原生模块坏掉时，install_deps 必须失败（以前会静默返回 0）
( load
  mkdir -p "$WORK/app5"; : > "$WORK/app5/package.json"
  INSTALL_DIR="$WORK/app5"
  npm_install() { return 0; }
  verify_native_or_die() { return 1; }
  install_deps >/dev/null 2>&1
)
echo $? > "$WORK/g3.txt"
check "依赖坏了 → install_deps 非 0" "$(cat "$WORK/g3.txt")" "1"

# ---------------------------------------------------------------- 汇总
printf '\n== 结果 ==\n通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { printf '全部通过 ✓\n\n'; exit 0; }
printf '有失败项 ✗\n\n'; exit 1
