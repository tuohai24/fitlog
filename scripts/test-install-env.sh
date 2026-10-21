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

# ---------------------------------------------------------------- 汇总
printf '\n== 结果 ==\n通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { printf '全部通过 ✓\n\n'; exit 0; }
printf '有失败项 ✗\n\n'; exit 1
