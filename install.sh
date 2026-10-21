#!/usr/bin/env bash
#
# FitLog 一键安装 / 管理脚本
#
#   ./install.sh              打开菜单（推荐）
#   ./install.sh install      安装并启动（缺 Node、编译工具链会自动装）
#   ./install.sh update       拉取新版本并重启
#   ./install.sh status       查看运行状态
#   ./install.sh restart      重启
#   ./install.sh port [端口]  换端口（不填则自动挑一个空闲高位端口）
#   ./install.sh backup       备份数据库与配置
#   ./install.sh log          查看日志
#   ./install.sh probe        运行时预检（Node / 原生模块 / 数据库 WAL 能否跑通）
#   ./install.sh doctor       环境自检（装不上时先跑这个）
#   ./install.sh uninstall    卸载（默认保留数据）
#
# 可选参数：
#   --yes                 跳过所有确认
#   --purge               卸载时连同数据一起删除
#   --no-system-install   只报告缺什么，不自动装系统包（无网/无权限时用）
#
# 环境变量：
#   FITLOG_DIR            安装目录，默认脚本所在目录
#   PORT / ADMIN_USERNAME / ADMIN_PASSWORD   首次生成 .env 时使用
#   HIGH_PORT_BASE        端口冲突时自动改用高位端口的起点，默认 18473
#   NODE_VERSION          自动安装 Node 的大版本，默认 22
#   NODE_MIRROR           逗号或空格分隔的 Node 下载镜像
#   NPM_MIRROR            官方 npm 源失败后使用的镜像，默认 registry.npmmirror.com
#
# 自动补装清单：curl/tar（下载工具）、Node.js ≥ 22、python3 + make + g++（原生模块编译）
#
# 注意 Node 最低版本是 22，不是 20：better-sqlite3 13 的原生二进制按 N-API 10 编译，
# 而 N-API 10 从 Node 22 才开始提供。Node 20 装上不会报错（npm 只给一条 EBADENGINE 警告），
# 但服务启动时 require 直接段错误（systemd 里就是 status=11/SEGV），日志里一个字都没有。
#
set -uo pipefail

APP_NAME="FitLog"
SERVICE_NAME="fitlog"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT="${DEFAULT_PORT:-8080}"   # 兜底端口；用户传的 PORT 单独处理，避免两者混淆
# 8080 常被 NAS / 面板 / 其它容器占用，冲突时从这里开始找空闲高位端口
HIGH_PORT_BASE="${HIGH_PORT_BASE:-18473}"

# 脚本所在目录即安装目录（支持从任意位置调用）
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALL_DIR="${FITLOG_DIR:-$SRC_DIR}"

ASSUME_YES=0
PURGE=0
COMMAND=""
NO_SYSTEM_INSTALL=0      # --no-system-install：只报告缺失，不动系统
# better-sqlite3 13 的预编译产物定义了 NAPI_VERSION=10，只有 Node 22+ 才支持。
# 这条线不能放宽，否则装得进去、跑不起来（启动即 SIGSEGV）。
NODE_MIN_MAJOR=22
NODE_MIN_NAPI=10
NODE_VERSION="${NODE_VERSION:-22}"                       # 自动装 Node 时装哪个大版本
NPM_MIRROR="${NPM_MIRROR:-https://registry.npmmirror.com}" # 官方源失败时的备用镜像
NODE_MIRRORS="${NODE_MIRROR:-https://nodejs.org/dist https://npmmirror.com/mirrors/node}"

# 记录本次自动补装了什么，最后统一汇报
AUTO_INSTALLED=""
note_installed() { AUTO_INSTALLED="${AUTO_INSTALLED}${AUTO_INSTALLED:+、}$1"; }

# ---------------------------------------------------------------- 输出
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
title(){ printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; printf '%s\n' "────────────────────────────────────────"; }

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  local answer
  printf '%s [y/N] ' "$1"
  read -r answer || answer=""
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- 环境探测
HAS_SYSTEMD=0
if need_cmd systemctl && [ -d /run/systemd/system ]; then HAS_SYSTEMD=1; fi
IS_ROOT=0
[ "$(id -u 2>/dev/null || echo 1)" = "0" ] && IS_ROOT=1

# root 或 sudo 封装
as_root() {
  if [ "$IS_ROOT" -eq 1 ]; then "$@"; else sudo "$@"; fi
}

env_value() {
  # 从 .env 里读一个值（找不到就返回默认值）
  local key="$1" fallback="${2:-}"
  local file="$INSTALL_DIR/.env"
  [ -f "$file" ] || { printf '%s' "$fallback"; return; }
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  if [ -z "$line" ]; then printf '%s' "$fallback"; return; fi
  local val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  printf '%s' "${val:-$fallback}"
}

# 端口取值顺序要和 node --env-file 保持一致：命令行环境变量 > .env > 默认值
app_port() {
  if [ -n "${PORT:-}" ]; then printf '%s' "$PORT"; else env_value PORT "$DEFAULT_PORT"; fi
}

port_in_use() {   # $1=端口；有东西在监听就返回 0
  local port="$1"
  if need_cmd curl && curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    return 0
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1 && return 0
  return 1
}

is_fitlog_on() {   # $1=端口；该端口上跑的是不是 FitLog
  need_cmd curl || return 1
  curl -fsS --max-time 3 "http://127.0.0.1:${1}/api/health" 2>/dev/null | grep -q '"ok"'
}

# 从 HIGH_PORT_BASE 起找一个没人监听的端口（最多往后试 30 个）
free_high_port() {
  local p="$HIGH_PORT_BASE" i=0
  while [ "$i" -lt 30 ]; do
    port_in_use "$p" || { printf '%s' "$p"; return 0; }
    p=$((p + 1)); i=$((i + 1))
  done
  return 1
}

set_env_port() {   # $1=新端口：写回 .env（systemd / 重启后都生效）
  local file="$INSTALL_DIR/.env" p="$1"
  mkdir -p "$INSTALL_DIR"
  [ -f "$file" ] || : > "$file"
  if grep -qE '^[[:space:]]*PORT=' "$file"; then
    sed -i.bak "s|^[[:space:]]*PORT=.*|PORT=${p}|" "$file" && rm -f "$file.bak"
  else
    printf '\nPORT=%s\n' "$p" >> "$file"
  fi
  chmod 600 "$file" 2>/dev/null || true
  PORT="$p"          # 让本次运行的 app_port 立刻读到新值
}

# 最近日志（systemd 走 journal，否则读 data/fitlog.log）
recent_log() {   # $1=行数
  local n="${1:-20}" out=""
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    out="$(as_root journalctl -u "$SERVICE_NAME" -n "$n" --no-pager 2>/dev/null)"
  fi
  if [ -z "$out" ] && [ -f "$INSTALL_DIR/data/fitlog.log" ]; then
    out="$(tail -n "$n" "$INSTALL_DIR/data/fitlog.log" 2>/dev/null)"
  fi
  printf '%s' "$out"
}

# 从日志文本里认出「被信号打死」这类崩溃（Node 在这类崩溃里一个字都不会输出）
journal_crash_reason() {   # 读 stdin
  local text; text="$(cat 2>/dev/null || true)"
  case "$text" in
    *status=11/SEGV*|*signal=SEGV*|*"signal=11"*) printf 'segv'; return ;;
    *status=7/BUS*|*signal=BUS*|*"signal=7"*)     printf 'sigbus'; return ;;
    *status=6/ABRT*|*signal=ABRT*|*"signal=6"*)   printf 'abort'; return ;;
    *status=9/KILL*|*"signal=9"*)                 printf 'killed'; return ;;
  esac
  printf ''
}

# 启动/重启失败时，把「为什么」直接摆出来，而不是只留一句「没等到响应」
DIAG_RETRIED=0
diagnose_start_failure() {
  local port="$1"
  title "启动失败的原因"

  if port_in_use "$port"; then
    if is_fitlog_on "$port"; then
      warn "端口 $port 上仍有 FitLog 在响应（可能是重复进程 / 旧实例没退干净）"
    else
      warn "端口 $port 被其它程序占用，FitLog 大概率是启动即退出（EADDRINUSE）"
    fi
    if need_cmd ss; then
      ss -lntp 2>/dev/null | grep -E "[:.]${port}[[:space:]]" | head -n 3 | sed 's/^/    /'
    fi
  else
    warn "端口 $port 没有任何进程在监听 —— 进程启动后就退出了"
  fi

  local jtext; jtext="$(recent_log 25)"
  local crash; crash="$(printf '%s\n' "$jtext" | journal_crash_reason)"

  # status=11/SEGV 这类信号：不是「起得慢」，是启动瞬间就崩了，先定位再修
  if [ -n "$crash" ]; then
    say ""
    warn "进程被信号打死：$(describe_probe "$crash")"
    say "  ${C_DIM}这种情况 Node 来不及写任何日志，所以上面只有 systemd 的几行。${C_RESET}"
    if [ "$DIAG_RETRIED" -eq 0 ]; then
      say "  ${C_DIM}用探针逐段跑一遍启动链路，定位到底死在哪一步：${C_RESET}"
      if ! probe_runtime fast; then
        say ""
        say "  ${C_BOLD}失败点：${PROBE_FAILED_STEP:-未知} → $(describe_probe "${PROBE_FAILED_WHY:-error}")${C_RESET}"
        advise_probe "${PROBE_FAILED_WHY:-error}"
        DIAG_RETRIED=1
        say ""
        if confirm "现在就自动修复并重启一次？"; then
          if repair_native_modules ""; then
            if start_app && wait_health; then
              print_access
              return 0
            fi
            warn "修复后仍然启动失败"
          else
            explain_native_failure
          fi
        fi
      else
        warn "预检各项都通过 —— 说明差异在 systemd 环境（.env / 权限 / 资源限制）"
        say "  ${C_DIM}对比一下：su -s /bin/sh -c 'cd $INSTALL_DIR && $(command -v node) --env-file=.env server/index.js'${C_RESET}"
      fi
    fi
  fi

  say ""
  say "  ${C_DIM}最近日志：${C_RESET}"
  printf '%s\n' "$jtext" | sed 's/^/    /'

  say ""
  say "  下一步："
  say "    ${C_BOLD}./install.sh doctor${C_RESET}         # 环境 + 运行时全量自检（含 N-API / C 库 / 数据目录）"
  say "    ${C_BOLD}./install.sh port${C_RESET}           # 自动挑一个空闲高位端口再试"
  say "    ${C_BOLD}./install.sh port 18473${C_RESET}     # 或者自己指定端口"
}

# 端口被别的程序占着就自动挪到高位端口；返回 1 表示挪不了
move_to_free_port() {
  local port="$1" candidate
  if ! port_in_use "$port"; then return 0; fi
  if is_fitlog_on "$port"; then
    # 端口上是 FitLog：可能是刚停还没释放，等一下再看
    sleep 1
    port_in_use "$port" || return 0
    warn "端口 $port 上仍有 FitLog 在响应，先尝试强制停掉旧实例"
    if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
      as_root systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
    local stale; stale="$(running_pid || true)"
    [ -n "$stale" ] && kill -9 "$stale" 2>/dev/null || true
    sleep 1
    port_in_use "$port" || return 0
  fi
  candidate="$(free_high_port)" || {
    warn "高位端口 ${HIGH_PORT_BASE}–$((HIGH_PORT_BASE + 29)) 全被占用"
    return 1
  }
  warn "端口 $port 被占用，自动改用高位端口 $candidate"
  set_env_port "$candidate"
  ok "已写入 .env：PORT=$candidate"
  return 0
}

# ---------------------------------------------------------------- 系统组件自动补装
# npm install 失败的绝大多数原因都在这一段：
#   · 没有 Node，或 Node 版本过低（< 20 不支持 --env-file）
#   · 没有 python3 / make / g++，better-sqlite3 这类原生模块编译不了
#   · 没有 curl / tar / xz，连 Node 都下载不了
# 所以安装流程改成「缺什么装什么」，而不是看到缺失就退出。
PKG_MGR=""
detect_pkg_mgr() {
  if [ -z "$PKG_MGR" ]; then
    if need_cmd apt-get; then PKG_MGR=apt
    elif need_cmd dnf; then PKG_MGR=dnf
    elif need_cmd yum; then PKG_MGR=yum
    elif need_cmd zypper; then PKG_MGR=zypper
    elif need_cmd pacman; then PKG_MGR=pacman
    elif need_cmd apk; then PKG_MGR=apk
    elif need_cmd brew; then PKG_MGR=brew
    else PKG_MGR=none; fi
  fi
  printf '%s' "$PKG_MGR"
}

can_root() { [ "$IS_ROOT" -eq 1 ] || need_cmd sudo; }
root_prefix() { if [ "$IS_ROOT" -eq 1 ]; then printf ''; elif need_cmd sudo; then printf 'sudo'; fi; }

pkg_names() {
  local mgr; mgr="$(detect_pkg_mgr)"
  case "$1" in
    base)
      case "$mgr" in
        apt) printf 'curl ca-certificates tar xz-utils' ;;
        brew) printf 'curl' ;;
        none) printf '' ;;
        *) printf 'curl ca-certificates tar xz' ;;
      esac ;;
    build)
      case "$mgr" in
        apt) printf 'python3 make g++' ;;
        dnf|yum|zypper) printf 'python3 make gcc-c++' ;;
        pacman) printf 'python3 make gcc' ;;
        apk) printf 'python3 make g++' ;;
        brew) printf 'python3' ;;
        none) printf '' ;;
      esac ;;
    node)
      case "$mgr" in
        apt|dnf|yum|zypper) printf 'nodejs' ;;
        pacman|apk) printf 'nodejs npm' ;;
        brew) printf 'node' ;;
        none) printf '' ;;
      esac ;;
  esac
}

pkg_install() {   # $1 = base | build | node
  local group="$1" mgr names
  mgr="$(detect_pkg_mgr)"
  names="$(pkg_names "$group")"
  if [ -z "$names" ]; then
    warn "没识别出包管理器（支持 apt / dnf / yum / zypper / pacman / apk / brew）"
    case "$group" in
      build) say "  ${C_DIM}请手动安装：python3、make、g++（或同等的 C++ 编译工具）${C_RESET}" ;;
      base)  say "  ${C_DIM}请手动安装：curl、tar${C_RESET}" ;;
      node)  say "  ${C_DIM}请手动安装 Node.js ${NODE_MIN_MAJOR}+：https://nodejs.org/zh-cn/download${C_RESET}" ;;
    esac
    return 1
  fi
  if [ "$NO_SYSTEM_INSTALL" -eq 1 ]; then
    warn "已指定 --no-system-install，跳过安装：$names"
    say "  ${C_DIM}手动执行：$(root_prefix) ${mgr} install $names${C_RESET}"
    return 1
  fi
  if ! can_root; then
    warn "安装系统组件需要 root（当前既不是 root，也没有 sudo）"
    say "  ${C_DIM}请用 root 重跑，或手动执行：${mgr} install $names${C_RESET}"
    return 1
  fi

  say "  ${C_DIM}正在安装：$names${C_RESET}"
  local log="$INSTALL_DIR/data/.pkg-install.log" rc=0
  mkdir -p "$INSTALL_DIR/data" 2>/dev/null || log="/dev/null"
  case "$mgr" in
    apt)
      as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >"$log" 2>&1 || true
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $names >>"$log" 2>&1 || rc=$?
      ;;
    dnf)    as_root dnf install -y $names >>"$log" 2>&1 || rc=$? ;;
    yum)    as_root yum install -y $names >>"$log" 2>&1 || rc=$? ;;
    zypper) as_root zypper --non-interactive install $names >>"$log" 2>&1 || rc=$? ;;
    pacman) as_root pacman -Sy --noconfirm --needed $names >>"$log" 2>&1 || rc=$? ;;
    apk)    as_root apk add --no-cache $names >>"$log" 2>&1 || rc=$? ;;
    brew)   brew install $names >>"$log" 2>&1 || rc=$? ;;
  esac
  if [ "$rc" -ne 0 ]; then
    warn "安装失败（$mgr $names），日志最后 10 行："
    tail -n 10 "$log" 2>/dev/null | sed 's/^/    /'
    return 1
  fi
  note_installed "$names"
  return 0
}

# curl 优先，退 wget；两者都没有时由 ensure_base_tools 负责补
fetch_file() {   # $1=url $2=输出文件
  if need_cmd curl; then
    curl -fL --retry 2 --connect-timeout 15 --max-time 900 -o "$2" "$1" >/dev/null 2>&1
  elif need_cmd wget; then
    wget -q -T 30 -O "$2" "$1"
  else
    return 1
  fi
}

ensure_base_tools() {
  local missing=""
  need_cmd curl || need_cmd wget || missing="$missing curl"
  need_cmd tar || missing="$missing tar"
  [ -z "$missing" ] && return 0
  title "补齐基础工具"
  say "  缺少：${missing# }"
  pkg_install base || die "缺少 curl / tar，无法继续；请先手动安装后重试"
  ok "基础工具已就绪"
}

has_python() { need_cmd python3 || need_cmd python; }
has_cc() { need_cmd g++ || need_cmd c++ || need_cmd clang++ || need_cmd gcc; }
has_build_tools() { has_python && need_cmd make && has_cc; }

build_tools_desc() {
  local out="" p m c
  p="$(command -v python3 || command -v python || true)"; [ -n "$p" ] && out="$out python"
  m="$(command -v make || true)"; [ -n "$m" ] && out="$out make"
  c="$(command -v g++ || command -v c++ || command -v clang++ || command -v gcc || true)"; [ -n "$c" ] && out="$out ${c##*/}"
  printf '%s' "${out# }"
}

ensure_build_tools() {
  if has_build_tools; then
    ok "编译工具链就绪（$(build_tools_desc)）"
    return 0
  fi
  title "补齐编译工具链"
  say "  better-sqlite3 是原生模块，没有预编译包时要用 python3 + make + g++ 现场编译"
  if pkg_install build && has_build_tools; then
    ok "编译工具链已装好（$(build_tools_desc)）"
    return 0
  fi
  warn "编译工具链仍不完整（已有：$(build_tools_desc || echo '无')）"
  say "  ${C_DIM}如果待会儿 npm install 报 gyp / python / make 错误，就是这里缺的${C_RESET}"
  return 1
}

# ---------------------------------------------------------------- Node
num_or_zero() { case "${1:-}" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$1" ;; esac; }
node_major() { num_or_zero "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"; }
node_minor() { num_or_zero "$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null)"; }
node_napi()  { num_or_zero "$(node -p 'process.versions.napi || 0' 2>/dev/null)"; }

# 原生模块能不能加载，只取决于 Node 的 N-API 版本，与 ABI（NODE_MODULE_VERSION）无关
node_napi_ok() { [ "$(node_napi)" -ge "$NODE_MIN_NAPI" ] 2>/dev/null; }

node_ok() {
  need_cmd node || return 1
  [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null || return 1
  return 0
}

node_arch() {
  case "$(uname -m 2>/dev/null)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    armv7l|armv6l) printf 'armv7l' ;;
    ppc64le) printf 'ppc64le' ;;
    s390x) printf 's390x' ;;
    *) printf '' ;;
  esac
}

# 官方二进制安装：不依赖发行版仓库，版本可控，也不需要编译
install_node_tarball() {
  local arch; arch="$(node_arch)"
  if [ -z "$arch" ]; then
    warn "无法识别的 CPU 架构：$(uname -m 2>/dev/null)"
    return 1
  fi

  local prefix="/usr/local"
  if ! can_root; then prefix="$HOME/.local"; fi   # 没 root 就装到用户目录

  local tmp="$INSTALL_DIR/data/.node-dl"
  rm -rf "$tmp"; mkdir -p "$tmp" || return 1

  local mirror base file ext dirname
  for mirror in $(printf '%s' "$NODE_MIRRORS" | tr ',' ' '); do
    base="${mirror%/}/latest-v${NODE_VERSION}.x"
    fetch_file "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || continue

    # 优先 .tar.xz（体积约一半），系统没有 xz 时退 .tar.gz
    file=""
    if need_cmd xz; then
      file="$(grep -oE "node-v[0-9.]+-linux-${arch}\.tar\.xz" "$tmp/SHASUMS256.txt" 2>/dev/null | head -n 1)"
    fi
    [ -z "$file" ] && \
      file="$(grep -oE "node-v[0-9.]+-linux-${arch}\.tar\.(xz|gz)" "$tmp/SHASUMS256.txt" 2>/dev/null | head -n 1)"
    [ -z "$file" ] && continue

    ext="${file##*.}"
    say "  ${C_DIM}下载 $file（$mirror）${C_RESET}"
    fetch_file "$base/$file" "$tmp/$file" || continue

    if need_cmd sha256sum && grep -qE " $file\$" "$tmp/SHASUMS256.txt" 2>/dev/null; then
      ( cd "$tmp" && grep -E " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null 2>&1 ) \
        || warn "校验和不匹配，仍继续（请留意下载源）"
    fi

    dirname="${file%.tar.*}"
    as_root mkdir -p "$prefix/lib/nodejs"
    if [ "$ext" = "xz" ]; then
      as_root tar -xJf "$tmp/$file" -C "$prefix/lib/nodejs" || continue
    else
      as_root tar -xzf "$tmp/$file" -C "$prefix/lib/nodejs" || continue
    fi

    as_root mkdir -p "$prefix/bin"
    local b
    for b in node npm npx corepack; do
      [ -e "$prefix/lib/nodejs/$dirname/bin/$b" ] \
        && as_root ln -sfn "$prefix/lib/nodejs/$dirname/bin/$b" "$prefix/bin/$b"
    done
    rm -rf "$tmp"
    hash -r 2>/dev/null || true
    case ":$PATH:" in
      *":$prefix/bin:"*) ;;
      *) export PATH="$prefix/bin:$PATH" ;;
    esac
    return 0
  done
  rm -rf "$tmp"
  return 1
}

ensure_npm() {
  if need_cmd npm; then
    ok "npm $(npm -v 2>/dev/null)"
    return 0
  fi
  warn "没有 npm，尝试补装"
  pkg_install node >/dev/null 2>&1 || true
  if need_cmd npm; then ok "npm $(npm -v 2>/dev/null)"; return 0; fi
  return 1
}

# 服务器上常见的坑：装过 nvm，但非登录 shell 的 PATH 里没有它
try_nvm_path() {
  local d
  for d in "$HOME"/.nvm/versions/node/*/bin /usr/local/nvm/versions/node/*/bin; do
    [ -x "$d/node" ] || continue
    case ":$PATH:" in *":$d:"*) ;; *) export PATH="$d:$PATH"; hash -r 2>/dev/null || true ;; esac
    return 0
  done
  return 1
}

ensure_node() {
  try_nvm_path || true   # 先把已有的 nvm 版本捞进 PATH，避免重复安装

  if node_ok; then
    ok "Node.js $(node -v)"
    ensure_npm || die "有 node 但没有 npm，请重装 Node.js"
    return 0
  fi

  if need_cmd node; then
    warn "当前 Node $(node -v) 低于 ${NODE_MIN_MAJOR}（N-API $(node_napi) < ${NODE_MIN_NAPI}），必须升级"
    say "  ${C_DIM}better-sqlite3 13 的原生二进制按 N-API ${NODE_MIN_NAPI} 编译，Node 20 装上就会启动即段错误${C_RESET}"
  else
    warn "没有找到 Node.js"
  fi

  title "安装 Node.js"

  # macOS：优先 Homebrew
  if [ "$(uname -s 2>/dev/null)" = "Darwin" ] && need_cmd brew; then
    say "  ${C_DIM}brew install node${C_RESET}"
    if brew install node >/dev/null 2>&1 && node_ok; then
      note_installed "node（brew）"
      ok "Node.js $(node -v)"
      ensure_npm || die "npm 不可用"
      return 0
    fi
  fi

  # Linux：官方二进制，快且版本可控
  if [ "$(uname -s 2>/dev/null)" = "Linux" ]; then
    if install_node_tarball && node_ok; then
      note_installed "node（官方二进制）"
      ok "Node.js $(node -v) → $(command -v node)"
      ensure_npm || die "npm 不可用"
      return 0
    fi
    warn "官方二进制没装上，改用包管理器"
  fi

  # 兜底：发行版仓库（版本可能偏低，装完再校验）
  if pkg_install node; then
    if node_ok; then
      note_installed "node（$(detect_pkg_mgr)）"
      ok "Node.js $(node -v)"
      ensure_npm || die "npm 不可用"
      return 0
    fi
    warn "包管理器给的 Node $(node -v 2>/dev/null || echo '?') 版本不够（需要 ≥ ${NODE_MIN_MAJOR}）"
  fi

  say ""
  say "  自动安装没成功，请手动装 Node.js ${NODE_MIN_MAJOR}+："
  say "    · 官方下载页：https://nodejs.org/zh-cn/download"
  say "    · Debian/Ubuntu：curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - && sudo apt install -y nodejs"
  say "    · macOS：brew install node"
  say "  装好后重跑：./install.sh install"
  die "缺少可用的 Node.js"
}

# 只校验不安装（restart / status / log 这些命令用它）
check_node() {
  if ! node_ok; then
    die "Node.js 不可用或版本过低（需要 ≥ ${NODE_MIN_MAJOR}）：执行 ./install.sh install 会自动装好"
  fi
  ok "Node.js $(node -v)"
  need_cmd npm || die "缺少 npm，请重装 Node.js"
}

# ---------------------------------------------------------------- 配置
rand_str() {
  # 生成随机密码：优先 openssl，其次 /dev/urandom，最后时间戳
  if need_cmd openssl; then openssl rand -hex "$1" | cut -c1-"$(( $1 * 2 ))"; return; fi
  if [ -r /dev/urandom ]; then LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; return; fi
  date +%s%N | head -c "$1"
}

ensure_env() {
  local file="$INSTALL_DIR/.env"
  if [ -f "$file" ]; then
    ok "配置文件已存在：.env（保留原有设置）"
    # 命令行传了 PORT 但 .env 里是别的值（或根本没有 PORT）：systemd 只读 .env，
    # 不对齐会出现「脚本健康检查通过，重启后又回旧端口」
    local env_port effective_env
    env_port="$(env_value PORT '')"
    effective_env="${env_port:-$DEFAULT_PORT}"
    if [ -n "${PORT:-}" ] && [ "$PORT" != "$effective_env" ]; then
      warn "环境变量 PORT=$PORT，但 .env 里是 ${env_port:-未设置（默认 $DEFAULT_PORT）}"
      if confirm "把 .env 的 PORT 改成 ${PORT}？"; then
        if grep -qE '^[[:space:]]*PORT=' "$file"; then
          sed -i.bak "s|^[[:space:]]*PORT=.*|PORT=${PORT}|" "$file" && rm -f "$file.bak"
        else
          printf '\nPORT=%s\n' "$PORT" >> "$file"
        fi
        ok "已更新 .env：PORT=$PORT"
      else
        say "  ${C_DIM}本次以环境变量为准，重启后会回到 .env 里的 ${env_port}${C_RESET}"
      fi
    fi
    return
  fi

  local port="${PORT:-$DEFAULT_PORT}"
  local admin_user="${ADMIN_USERNAME:-admin}"
  local admin_pw="${ADMIN_PASSWORD:-$(rand_str 6)}"
  local signup="${SIGNUP_CODE:-}"

  cat > "$file" <<EOF
# FitLog 运行配置（由 install.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')）
# 修改后执行 ./install.sh restart 生效

# 监听端口与地址
PORT=$port
HOST=0.0.0.0

# 初始管理员账号（首次启动时创建，之后改密码请到网页「我的」）
ADMIN_USERNAME=$admin_user
ADMIN_PASSWORD=$admin_pw

# 时区偏移（小时），中国为 8
TZ_OFFSET=8

# 可选：设置后允许用邀请码自助注册；留空则只能由管理员创建账号
SIGNUP_CODE=$signup

# 可选：数据目录（默认 ./data）
# DATA_DIR=/var/lib/fitlog

# 可选：DeepSeek 也可以在网页「我的 → DeepSeek」里配置，这里留空即可
# DEEPSEEK_API_KEY=
EOF
  chmod 600 "$file" 2>/dev/null || true
  ok "已生成 .env"
  say "  管理员账号：${C_BOLD}${admin_user}${C_RESET}"
  say "  初始密码：  ${C_BOLD}${admin_pw}${C_RESET}  ${C_DIM}（登录后请尽快修改）${C_RESET}"
}

# ---------------------------------------------------------------- 依赖与数据
# 探针日志目录（临时文件，每次预检前清空）
probe_dir() {
  local d="$INSTALL_DIR/data/.probe"
  mkdir -p "$d" 2>/dev/null || d="/tmp/fitlog-probe-$$"
  mkdir -p "$d" 2>/dev/null || true
  printf '%s' "$d"
}

# 把「退出码 + 输出」翻译成可读的原因码。
# 这一段是整个诊断的核心：SIGSEGV 这类崩溃在日志里没有任何文字，
# 只能靠退出码（128+信号值）和几条特征串来区分。
#   $1=退出码  $2=输出文件
classify_probe() {
  local rc="${1:-0}" log="${2:-}"
  if [ "$rc" -eq 0 ]; then printf 'ok'; return; fi
  if [ "$rc" -eq 124 ]; then printf 'timeout'; return; fi
  if [ "$rc" -gt 128 ]; then
    case $((rc - 128)) in
      11) printf 'segv' ;;
      7)  printf 'sigbus' ;;
      6)  printf 'abort' ;;
      9)  printf 'killed' ;;
      *)  printf 'signal' ;;
    esac
    return
  fi
  [ -f "$log" ] || { printf 'error'; return; }
  if grep -qiE 'NODE_MODULE_VERSION|was compiled against a different Node' "$log" 2>/dev/null; then printf 'abi'; return; fi
  if grep -qiE 'GLIBC_[0-9]|GLIBCXX_[0-9]|libstdc\+\+' "$log" 2>/dev/null; then printf 'glibc'; return; fi
  if grep -qiE 'invalid ELF header|wrong ELF class|cannot open shared object|undefined symbol' "$log" 2>/dev/null; then printf 'elf'; return; fi
  if grep -qiE 'Cannot find module|MODULE_NOT_FOUND' "$log" 2>/dev/null; then printf 'missing'; return; fi
  if grep -qiE 'EADDRINUSE' "$log" 2>/dev/null; then printf 'eaddrinuse'; return; fi
  if grep -qiE 'SQLITE_BUSY|database is locked' "$log" 2>/dev/null; then printf 'busy'; return; fi
  if grep -qiE 'SQLITE_|file is not a database|database disk image is malformed' "$log" 2>/dev/null; then printf 'sqlite'; return; fi
  if grep -qiE 'EACCES|EPERM|permission denied' "$log" 2>/dev/null; then printf 'perm'; return; fi
  printf 'error'
}

# 原因码 → 人话（含下一步怎么做）
describe_probe() {
  case "$1" in
    ok)        printf '正常' ;;
    segv)      printf 'SIGSEGV 段错误（exit 139）' ;;
    sigbus)    printf 'SIGBUS（exit 135，常见于 mmap 失败：数据目录在网络盘 / FUSE 上）' ;;
    abort)     printf 'SIGABRT 主动崩溃（exit 134）' ;;
    killed)    printf '被 SIGKILL 杀掉（exit 137，多半是内存不足）' ;;
    timeout)   printf '超时未退出' ;;
    signal)    printf '被信号终止' ;;
    abi)       printf 'ABI 不匹配（原生模块与当前 Node 版本不一致）' ;;
    glibc)     printf 'C 库版本不满足（缺 GLIBC / GLIBCXX 符号）' ;;
    elf)       printf '二进制与当前平台/架构不匹配' ;;
    missing)   printf '模块没装上（Cannot find module）' ;;
    eaddrinuse) printf '端口已被占用（EADDRINUSE）' ;;
    busy)      printf '数据库被锁（SQLITE_BUSY，多半是同一份 data/ 被两个后端同时打开）' ;;
    sqlite)    printf '数据库文件损坏或不是有效数据库' ;;
    perm)      printf '权限不足' ;;
    *)         printf '未知错误' ;;
  esac
}

# 原因码 → 修复建议
advise_probe() {
  case "$1" in
    segv|abi|missing|elf)
      say "  ${C_DIM}原生模块 better-sqlite3 与当前 Node 不兼容。最常见的原因：${C_RESET}"
      say "  ${C_DIM}better-sqlite3 13 的原生二进制按 N-API 10 编译，需要 Node 22+；${C_RESET}"
      say "  ${C_DIM}Node 20 装得上、跑不起来，启动瞬间就是段错误。${C_RESET}"
      say "  ${C_DIM}执行 ./install.sh install 会自动把 Node 升到 22 并重编原生模块。${C_RESET}" ;;
    glibc)
      say "  ${C_DIM}系统 C 库太老，官方预编译包跑不了；需要在本机源码编译：${C_RESET}"
      say "  ${C_DIM}./install.sh install 会尝试（要 python3 + make + g++）${C_RESET}" ;;
    sigbus|busy)
      say "  ${C_DIM}数据目录必须放在本地磁盘。放进 NAS 同步目录 / 网盘 / FUSE 挂载点时，${C_RESET}"
      say "  ${C_DIM}SQLite 的 WAL 共享内存无法工作，进程会崩或被锁住。${C_RESET}" ;;
    sqlite)
      say "  ${C_DIM}先备份 data/ 再让 SQLite 自检：./install.sh backup，然后删除损坏的 fitlog.db-wal${C_RESET}" ;;
    perm)
      say "  ${C_DIM}确认运行用户对 $INSTALL_DIR/data 有读写权限${C_RESET}" ;;
    eaddrinuse)
      say "  ${C_DIM}换端口：./install.sh port${C_RESET}" ;;
  esac
}

# better-sqlite3 能不能被「真正会运行服务的那个 node」加载
# 注意两个坑：
#   1. 不能只看 npm 的退出码 —— npm 对 engines 不匹配只给一条 EBADENGINE 警告；
#   2. 不能只 require —— better-sqlite3 13 的 .node 是懒加载的，
#      require 只是拿到一个包装函数，真正 dlopen 发生在第一次 new Database() 时。
#      所以必须真的建一个库，否则 ABI/N-API 不兼容时这里会「假通过」，服务启动才段错误。
check_native_modules() {
  local dir="$INSTALL_DIR/node_modules/better-sqlite3"
  NATIVE_FAIL_REASON=""
  [ -d "$dir" ] || { warn "node_modules 里没有 better-sqlite3"; NATIVE_FAIL_REASON="missing"; return 1; }

  local log rc
  log="$(probe_dir)/native-load.log"
  ( cd "$INSTALL_DIR" && node -e 'const D=require("better-sqlite3");const db=new D(":memory:");db.prepare("select 1 as n").get();db.close()' ) >"$log" 2>&1
  rc=$?
  local why; why="$(classify_probe "$rc" "$log")"
  if [ "$why" = "ok" ]; then
    ok "原生模块可正常加载（better-sqlite3，Node $(node -v) / N-API $(node_napi)）"
    return 0
  fi
  NATIVE_FAIL_REASON="$why"
  warn "better-sqlite3 存在但加载失败：$(describe_probe "$why")"
  if [ -s "$log" ]; then tail -n 6 "$log" | sed 's/^/    /'; fi
  return 1
}

npm_install() {   # $1=日志文件，其余参数透传给 npm
  local log="$1"; shift
  ( cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund "$@" ) >"$log" 2>&1
}

install_deps() {
  cd "$INSTALL_DIR" || die "无法进入安装目录 $INSTALL_DIR"
  if [ ! -f package.json ]; then
    die "当前目录不像 FitLog 项目（缺少 package.json）：$INSTALL_DIR"
  fi
  title "安装依赖"
  local log="$INSTALL_DIR/data/.npm-install.log"
  mkdir -p "$INSTALL_DIR/data"

  # 1) 默认源
  if npm_install "$log"; then
    ok "依赖安装完成"
    verify_native_or_die "$log" || die "原生模块不可用，安装中止"
    return 0
  fi
  warn "第一次 npm install 失败，日志最后 15 行（$log）："
  tail -n 15 "$log" | sed 's/^/    /'

  # 日志里已经是编译类错误：换镜像没用（预编译包在 GitHub 上，不是 registry 的事），
  # 直接进源码编译，省一次几十秒的无效重试
  local build_error=0
  grep -qiE 'gyp|node-pre-gyp|prebuild|not found: python|not found: make' "$log" 2>/dev/null && build_error=1

  # 2) 换国内镜像重试（官方源超时在国内非常常见）
  if [ "$build_error" -eq 0 ] && [ -n "$NPM_MIRROR" ]; then
    warn "改用镜像源重试：$NPM_MIRROR"
    if npm_install "$log" --registry="$NPM_MIRROR"; then
      ok "依赖安装完成（镜像源）"
      note_installed "npm 依赖（镜像源）"
      verify_native_or_die "$log" || die "原生模块不可用，安装中止"
      return 0
    fi
    tail -n 15 "$log" | sed 's/^/    /'
    grep -qiE 'gyp|node-pre-gyp|prebuild|not found: python|not found: make' "$log" 2>/dev/null && build_error=1
  fi

  # 3) 原生模块编译失败 → 补齐工具链后强制源码编译
  if [ "$build_error" -eq 1 ]; then
    warn "看起来是原生模块编译失败，补齐工具链后重试"
    ensure_build_tools || true
    if ( cd "$INSTALL_DIR" && npm_config_build_from_source=true npm install --omit=dev --no-audit --no-fund \
          --registry="${NPM_MIRROR:-https://registry.npmjs.org}" ) >"$log" 2>&1; then
      ok "依赖安装完成（源码编译）"
      note_installed "npm 依赖（源码编译）"
      verify_native_or_die "$log" || die "原生模块不可用，安装中止"
      return 0
    fi
    tail -n 25 "$log" | sed 's/^/    /'
  fi

  rebuild_native "$log" || true
  explain_npm_failure "$log"
  die "依赖安装失败。可执行 ./install.sh doctor 看环境缺什么，或手动排查：$log"
}

# 失败后按日志给针对性建议，别只丢一句「失败」
explain_npm_failure() {
  local log="$1"
  [ -f "$log" ] || return 0
  local uid_gid; uid_gid="$(id -u 2>/dev/null):$(id -g 2>/dev/null)"

  if grep -qE 'EACCES|EPERM' "$log" 2>/dev/null; then
    warn "像是权限问题（node_modules / npm 缓存属主不对）"
    say "  ${C_DIM}sudo chown -R ${uid_gid} \"$INSTALL_DIR/node_modules\" \"$INSTALL_DIR/data\" \"\$HOME/.npm\"${C_RESET}"
  fi
  if grep -qE 'ENOSPC' "$log" 2>/dev/null; then
    warn "磁盘空间不足，先清理空间再重试（见 ./install.sh doctor 的剩余空间）"
  fi
  if grep -qE 'ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED|ERR_SOCKET|proxy' "$log" 2>/dev/null; then
    warn "像是网络问题"
    say "  ${C_DIM}指定镜像重跑：NPM_MIRROR=https://registry.npmmirror.com ./install.sh install${C_RESET}"
  fi
  if grep -qiE 'gyp|node-gyp|not found: python|not found: make|g\+\+' "$log" 2>/dev/null; then
    warn "原生模块编译失败：确认 python3 / make / g++ 都在（./install.sh doctor 可查）"
    say "  ${C_DIM}手动补：apt install -y python3 make g++ / dnf install -y python3 make gcc-c++${C_RESET}"
  fi
}

# 单独重编原生模块（比整包重装快很多）
# better-sqlite3 13 装的是「预编译包」：prebuilds/<平台>-<架构>.node。
# 只要这个文件在，lib/binding.js 就优先加载它，源码编译出来的 build/Release 根本不会被用到。
# 所以「源码重编」必须先把它移走，否则编了也白编（这正是之前明明重编过、启动仍段错误的原因）。
native_dir() { printf '%s/node_modules/better-sqlite3' "$INSTALL_DIR"; }

node_gyp() {   # npm 自带的 node-gyp 都能用，不依赖全局安装
  if need_cmd node-gyp; then node-gyp "$@"; return $?; fi
  local gyp npm_bin
  npm_bin="$(readlink -f "$(command -v npm 2>/dev/null)" 2>/dev/null || command -v npm 2>/dev/null)"
  if [ -n "$npm_bin" ]; then
    gyp="$(dirname "$npm_bin")/../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
    if [ -f "$gyp" ]; then node "$gyp" "$@"; return $?; fi
  fi
  gyp="$(npm root -g 2>/dev/null)/npm/node_modules/node-gyp/bin/node-gyp.js"
  if [ -f "$gyp" ]; then node "$gyp" "$@"; return $?; fi
  return 127
}

node_prefix() {   # Node 安装前缀（官方二进制包里带 include/node 头文件）
  local real
  real="$(readlink -f "$(command -v node 2>/dev/null)" 2>/dev/null || command -v node 2>/dev/null)"
  [ -n "$real" ] && dirname "$(dirname "$real")"
}

rebuild_native() {
  local log="${1:-$INSTALL_DIR/data/.npm-install.log}"
  local dir; dir="$(native_dir)"
  [ -d "$dir" ] || return 1

  local pre="$dir/prebuilds"
  if [ -d "$pre" ] && [ ! -d "${pre}.bak" ]; then
    mv "$pre" "${pre}.bak" 2>/dev/null \
      && say "  ${C_DIM}已把预编译包改名（prebuilds → prebuilds.bak），让源码编译真正生效${C_RESET}"
  fi

  warn "在本机源码编译 better-sqlite3（需要 python3 + make + g++）"
  if ( cd "$dir" && node_gyp rebuild ) >>"$log" 2>&1; then
    if check_native_modules; then
      note_installed "better-sqlite3（本地编译）"
      return 0
    fi
  fi

  # 官方二进制安装的 Node 自带头文件，离线也能编：指定 --nodedir 再试一次
  local prefix; prefix="$(node_prefix)"
  if [ -n "$prefix" ] && [ -d "$prefix/include/node" ]; then
    say "  ${C_DIM}再试一次，用本地头文件：--nodedir=$prefix${C_RESET}"
    if ( cd "$dir" && node_gyp rebuild --nodedir="$prefix" ) >>"$log" 2>&1; then
      if check_native_modules; then
        note_installed "better-sqlite3（本地编译，本地头文件）"
        return 0
      fi
    fi
  fi

  # 编译不成，把预编译包放回去，别留下半残状态
  if [ -d "${pre}.bak" ] && [ ! -d "$pre" ]; then mv "${pre}.bak" "$pre" 2>/dev/null || true; fi
  tail -n 20 "$log" 2>/dev/null | sed 's/^/    /'
  return 1
}

# ---------------------------------------------------------------- 运行时预检
# 为什么需要这一节：
#   npm install 成功 ≠ 服务能跑。原生模块加载失败时 npm 只给一条 EBADENGINE 警告，
#   进程则在 require 那一刻被信号打死（SIGSEGV），systemd 只留下 status=11/SEGV，
#   日志里一个字都没有，看起来就像「端口没监听」。
# 所以安装 / 更新 / 重启之前，都用「服务真正会用的那个 node」把启动链路逐段跑一遍。

# $1=超时秒 $2=日志文件；其余=要执行的命令（必须是外部命令，不能是 shell 函数）
run_capped() {
  local secs="$1" log="$2"; shift 2
  if need_cmd timeout; then
    timeout -k 2 "$secs" "$@" >"$log" 2>&1
    return $?
  fi
  "$@" >"$log" 2>&1 &
  local pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid"; local rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return $rc
}

# 在安装目录里跑一条命令（等价于 systemd 的 WorkingDirectory）
in_dir() {   # $1=超时 $2=日志；其余=命令
  local secs="$1" log="$2"; shift 2
  ( cd "$INSTALL_DIR" || exit 1; run_capped "$secs" "$log" "$@" )
}

PROBE_FAILED_STEP=""
PROBE_FAILED_WHY=""

# 执行一个探针并把结果打出来；失败时记住是哪一步
probe_check() {   # $1=名称 $2=超时 $3=日志名；其余=命令
  local name="$1" secs="$2" tag="$3"; shift 3
  local log; log="$(probe_dir)/${tag}.log"
  local rc=0
  in_dir "$secs" "$log" "$@" || rc=$?
  local why; why="$(classify_probe "$rc" "$log")"
  if [ "$why" = "ok" ]; then
    printf '  %s✓%s %s：%s\n' "$C_GREEN" "$C_RESET" "$name" "正常"
    return 0
  fi
  printf '  %s✗%s %s：%s\n' "$C_RED" "$C_RESET" "$name" "$(describe_probe "$why")"
  if [ -s "$log" ]; then tail -n 8 "$log" | sed 's/^/      /'; fi
  PROBE_FAILED_STEP="$name"
  PROBE_FAILED_WHY="$why"
  return 1
}

# 完整启动一次（用临时数据目录 + 随机端口，不碰真实数据库）
# 看到「已启动」就立刻收工，不必等到超时
probe_boot() {
  local log; log="$(probe_dir)/boot.log"
  local tmp; tmp="$(probe_dir)/bootapp"
  mkdir -p "$tmp" 2>/dev/null || true

  ( cd "$INSTALL_DIR" && exec env DATA_DIR="$tmp" PORT=0 node $(node_env_args) server/index.js ) >"$log" 2>&1 &
  local pid=$!
  local i=0 booted=0
  # 首次启动要建库 + 导入动作库，慢一点的 NAS 可能要十几秒，给到 30 秒
  while [ "$i" -lt 30 ]; do
    if grep -q '已启动' "$log" 2>/dev/null; then booted=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1; i=$((i + 1))
  done

  if [ "$booted" -eq 1 ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    printf '  %s✓%s %s：%s\n' "$C_GREEN" "$C_RESET" "完整启动" "正常"
    return 0
  fi

  local rc=0
  kill -0 "$pid" 2>/dev/null && { kill -9 "$pid" 2>/dev/null || true; }
  wait "$pid" 2>/dev/null || rc=$?
  local why; why="$(classify_probe "$rc" "$log")"
  printf '  %s✗%s %s：%s\n' "$C_RED" "$C_RESET" "完整启动" "$(describe_probe "$why")"
  if [ -s "$log" ]; then tail -n 8 "$log" | sed 's/^/      /'; fi
  PROBE_FAILED_STEP="完整启动"
  PROBE_FAILED_WHY="$why"
  return 1
}

# $1=fast（只查模块）| full（连完整启动一起查）
probe_runtime() {
  local mode="${1:-fast}"
  title "运行时预检"
  local dir; dir="$(probe_dir)"; rm -rf "$dir"/* 2>/dev/null || true
  PROBE_FAILED_STEP=""; PROBE_FAILED_WHY=""

  say "  Node：$(node -v 2>/dev/null)  ·  N-API $(node_napi)  ·  ABI $(node -p 'process.versions.modules' 2>/dev/null)  ·  $(command -v node)"

  # N-API 是最硬的限制：better-sqlite3 13 的二进制按 N-API 10 编译，Node 22 才有
  if ! node_napi_ok; then
    printf '  %s✗%s %s：%s\n' "$C_RED" "$C_RESET" "Node 的 N-API 版本" \
      "$(node_napi)（需要 ≥ ${NODE_MIN_NAPI}，即 Node ${NODE_MIN_MAJOR}+）"
    PROBE_FAILED_STEP="N-API"; PROBE_FAILED_WHY="napi"
    return 1
  fi

  # 必须真的 new 一个库：better-sqlite3 13 在 require 阶段不加载 .node，
  # 只 require 会让不兼容的二进制「假通过」，服务启动时才段错误
  probe_check "原生模块 / SQLite" 20 native-load \
    node -e 'const D=require("better-sqlite3");const db=new D(":memory:");db.pragma("journal_mode = WAL");db.exec("create table t(x)");db.prepare("insert into t values (1)").run();if(db.prepare("select count(*) as n from t").get().n!==1)process.exit(5);db.close()' || return 1

  # 数据目录必须支持 WAL 的共享内存（mmap）。NAS 同步目录 / 网盘 / FUSE 挂载点在这一步会崩。
  probe_check "数据目录 WAL" 20 wal-dir \
    env PROBE_DB="$INSTALL_DIR/data/.probe-wal.db" node -e 'const fs=require("fs"),D=require("better-sqlite3"),f=process.env.PROBE_DB;for(const s of ["","-wal","-shm"]){try{fs.rmSync(f+s,{force:true})}catch(e){}}const db=new D(f);const mode=db.pragma("journal_mode = WAL",{simple:true});db.exec("create table t(x)");db.prepare("insert into t values (1)").run();db.pragma("wal_checkpoint(TRUNCATE)");db.close();for(const s of ["","-wal","-shm"]){try{fs.rmSync(f+s,{force:true})}catch(e){}}if(String(mode).toLowerCase()!=="wal"){console.error("journal_mode="+mode);process.exit(3)}console.log("journal_mode=wal")' || return 1

  # 真实数据库能不能打开、有没有损坏（不存在就跳过）
  if [ -f "$INSTALL_DIR/data/fitlog.db" ]; then
    probe_check "现有数据库可读" 20 db-check \
      env PROBE_DB="$INSTALL_DIR/data/fitlog.db" node -e 'const D=require("better-sqlite3"),f=process.env.PROBE_DB;const db=new D(f,{readonly:true,fileMustExist:true});const r=db.pragma("quick_check",{simple:true});if(String(r).toLowerCase()!=="ok"){console.error("quick_check="+r);process.exit(4)}console.log("quick_check=ok")' || return 1
  fi

  if [ "$mode" = "full" ]; then
    probe_boot || return 1
  fi

  ok "预检通过：当前环境可以正常启动"
  return 0
}

# 修复原生模块：先解决 Node 版本，再源码重编，最后整包重装
repair_native_modules() {
  local log="${1:-$INSTALL_DIR/data/.npm-install.log}"
  title "修复原生模块"

  # 1) N-API 不够：怎么重编都没用，必须先把 Node 升级
  if ! node_napi_ok; then
    warn "当前 Node $(node -v) 的 N-API 是 $(node_napi)，better-sqlite3 需要 ≥ ${NODE_MIN_NAPI}"
    say "  ${C_DIM}N-API ${NODE_MIN_NAPI} 从 Node ${NODE_MIN_MAJOR} 开始提供（Node 20 只有 9），先升级 Node${C_RESET}"
    ensure_node || return 1
    if check_native_modules; then
      ok "换成 Node $(node -v) 之后原生模块已可用（预编译包本身就是 N-API ${NODE_MIN_NAPI}）"
      return 0
    fi
  fi

  # 2) 本机源码重编（会先把预编译包移开）
  ensure_build_tools || true
  if rebuild_native "$log"; then
    ok "better-sqlite3 已用本机工具链重编并通过加载测试"
    return 0
  fi

  # 3) 整包重装（换镜像）
  warn "重装依赖再试一次"
  if npm_install "$log" --registry="${NPM_MIRROR:-https://registry.npmjs.org}"; then
    check_native_modules && return 0
  fi
  return 1
}

# 装完/更新完的硬闸门：原生模块加载不了，就别假装装成功了
verify_native_or_die() {
  check_native_modules && return 0
  repair_native_modules "${1:-}" && return 0
  check_native_modules && return 0
  explain_native_failure
  die "原生模块无法加载（$(describe_probe "${NATIVE_FAIL_REASON:-error}")），服务必然启动失败。完整报告：./install.sh doctor"
}

explain_native_failure() {
  local why="${NATIVE_FAIL_REASON:-error}"
  say ""
  warn "原生模块 better-sqlite3 加载失败：$(describe_probe "$why")"
  advise_probe "$why"
  say "  ${C_DIM}详细环境：./install.sh doctor（Node / N-API / C 库 / 二进制文件 / 文件系统 全在里面）${C_RESET}"
}

prepare_data() {
  mkdir -p "$INSTALL_DIR/data"
  if [ ! -f "$INSTALL_DIR/data/exercises.json" ] && [ -f "$INSTALL_DIR/scripts/build-data.mjs" ]; then
    title "生成动作库数据"
    if (cd "$INSTALL_DIR" && node scripts/build-data.mjs >/dev/null 2>&1); then
      ok "动作库数据已生成"
    else
      warn "动作库数据生成失败，可稍后手动执行 npm run build:data"
    fi
  fi
}

# ---------------------------------------------------------------- 启动方式
node_env_args() {
  # Node 20.6+ 原生支持 --env-file；更老的版本用 shell 注入
  local major minor
  major="$(node_major)"; minor="$(node_minor)"
  if [ "$major" -gt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -ge 6 ]; }; then
    printf '%s' "--env-file=.env"
  fi
}

pid_file() { printf '%s/.fitlog.pid' "$INSTALL_DIR"; }

running_pid() {
  local f; f="$(pid_file)"
  [ -f "$f" ] || return 1
  local pid; pid="$(cat "$f" 2>/dev/null || echo '')"
  [ -n "$pid" ] || return 1
  if kill -0 "$pid" 2>/dev/null; then printf '%s' "$pid"; return 0; fi
  rm -f "$f"; return 1
}

write_unit() {
  local env_args node_bin node_dir
  env_args="$(node_env_args)"
  node_bin="$(command -v node)"
  node_dir="$(dirname "$node_bin")"
  # systemd 的 PATH 极简（可能没有 /usr/local/bin），把 Node 目录明确加进去，
  # 避免服务里的子进程找不到 node / npm
  as_root tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} 健身训练记录
Documentation=https://github.com/tuohai24/fitlog
# 由 install.sh 生成 · Node $(node -v 2>/dev/null) · N-API $(node_napi)
After=network-online.target
Wants=network-online.target
# 连续崩溃 6 次就停下，别无限重启刷日志（失败原因用 ./install.sh doctor 看）
StartLimitIntervalSec=120
StartLimitBurst=6

[Service]
Type=simple
WorkingDirectory="${INSTALL_DIR}"
ExecStart="${node_bin}" ${env_args} server/index.js
Environment=NODE_ENV=production
Environment="PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Restart=always
RestartSec=5
LimitNOFILE=65535
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
  as_root systemctl daemon-reload
  ok "已写入 systemd 服务：$SERVICE_FILE"
}

start_app() {
  cd "$INSTALL_DIR" || { warn "无法进入 $INSTALL_DIR"; return 1; }
  if [ "$HAS_SYSTEMD" -eq 1 ]; then
    write_unit
    as_root systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    as_root systemctl restart "$SERVICE_NAME" || { warn "systemctl 启动失败"; return 1; }
    ok "已通过 systemd 启动：$SERVICE_NAME"
    return 0
  fi

  # 没有 systemd（macOS / 容器）：nohup 后台运行
  local pid; pid="$(running_pid)" && { warn "已在运行（PID $pid），先停止"; stop_app; }
  local env_args; env_args="$(node_env_args)"
  nohup node $env_args server/index.js >>"$INSTALL_DIR/data/fitlog.log" 2>&1 &
  local new_pid=$!
  printf '%s' "$new_pid" > "$(pid_file)"
  sleep 2
  if kill -0 "$new_pid" 2>/dev/null; then
    ok "已后台启动（PID $new_pid），日志：data/fitlog.log"
    return 0
  fi
  rm -f "$(pid_file)"
  warn "进程启动后立刻退出了（PID $new_pid）"
  return 1
}

stop_app() {
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    as_root systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    ok "已停止 systemd 服务"
    return
  fi
  local pid; pid="$(running_pid)" || { warn "当前没有运行中的进程"; return; }
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  rm -f "$(pid_file)"
  ok "已停止（PID $pid）"
}

restart_app() {
  title "重启服务"
  stop_app
  start_and_verify fast
}

# 统一入口：先预检（原生模块能不能加载），再启动，再健康检查；
# 起不来就诊断，必要时自动修一次再重试。
# $1=full（连完整启动一起预检）| fast（只查原生模块）
start_and_verify() {
  local mode="${1:-fast}"
  PROBE_FAILED_STEP=""; PROBE_FAILED_WHY=""

  if ! probe_runtime "$mode"; then
    warn "预检没通过（失败点：${PROBE_FAILED_STEP:-未知}），先修再启动"
    if repair_native_modules ""; then
      probe_runtime "$mode" || { diagnose_start_failure "$(app_port)"; return 1; }
    else
      explain_native_failure
      diagnose_start_failure "$(app_port)"
      return 1
    fi
  fi

  # 旧实例退干净后端口仍被别的程序占着 → 自动换高位端口（写回 .env，systemd 也生效）
  move_to_free_port "$(app_port)" || return 1
  if ! start_app; then
    diagnose_start_failure "$(app_port)"
    return 1
  fi
  wait_health && return 0
  diagnose_start_failure "$(app_port)"
  return 1
}

wait_health() {
  local port; port="$(app_port)"
  local tries=0
  while [ "$tries" -lt 20 ]; do
    if need_cmd curl && curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      ok "健康检查通过：http://127.0.0.1:${port}/api/health"
      return 0
    fi
    if need_cmd curl && curl -fsS "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
      ok "服务已响应：http://127.0.0.1:${port}/"
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  warn "20 秒内没等到服务响应，可能是端口被占用或启动报错"
  return 1
}

detect_ip() {
  local ip=""
  if need_cmd hostname; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || ip=""
  fi
  if [ -z "$ip" ] && [ "$(uname -s 2>/dev/null)" = "Darwin" ] && need_cmd ipconfig; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  fi
  # 只认 IPv4，避免把命令报错当成地址
  case "$ip" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) printf '%s' "$ip" ;;
    *) printf '' ;;
  esac
}

print_access() {
  local port; port="$(app_port)"
  local ip; ip="$(detect_ip)"
  title "访问地址"
  say "  本机：  http://localhost:${port}"
  [ -n "$ip" ] && say "  局域网：http://${ip}:${port}"
  say "  ${C_DIM}首页底部「我的 → 导出」可备份全部训练数据${C_RESET}"
}

# ---------------------------------------------------------------- 子命令
cmd_install() {
  title "${APP_NAME} 安装"
  say "安装目录：$INSTALL_DIR"
  say "启动方式：$([ "$HAS_SYSTEMD" -eq 1 ] && echo 'systemd 服务' || echo 'nohup 后台进程')"

  # 环境准备：缺什么装什么（Node / curl / python3 / make / g++）
  title "环境准备"
  ensure_base_tools
  ensure_node
  ensure_build_tools || true   # 有预编译包时没工具链也能装，所以不中断

  ensure_env

  # 端口被占时不要假装装好了：先分清是「自己已经在跑」还是「别人占着」
  local port; port="$(app_port)"
  if port_in_use "$port"; then
    local running; running="$(running_pid || true)"
    if [ -n "$running" ]; then
      warn "服务已在运行（PID $running，端口 $port），继续安装会重启它"
    elif [ "$HAS_SYSTEMD" -eq 1 ] && as_root systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      warn "systemd 服务已在运行，继续安装会重启它"
    else
      warn "端口 ${port} 已被其它程序占用"
      move_to_free_port "$port" || die "端口冲突且找不到空闲高位端口，请手动指定：PORT=18473 ./install.sh install --yes"
      ok "安装将使用端口 $(app_port)"
    fi
  fi

  install_deps
  prepare_data
  stop_app                       # 清掉可能的旧实例，保证端口和进程都是干净的
  if start_and_verify full; then
    print_access
  fi
  title "完成"
  if [ -n "${AUTO_INSTALLED:-}" ]; then
    say "本次自动补装：${AUTO_INSTALLED}"
  fi
  say "常用命令： ./install.sh update | restart | status | port | backup | log | doctor"
}

cmd_update() {
  title "${APP_NAME} 更新"
  # 这里用 ensure_node 而不是 check_node：老部署很可能是 Node 20，
  # 直接退出会让用户卡在「想更新却被版本检查挡住」的死胡同里
  ensure_node
  cd "$INSTALL_DIR" || die "无法进入 $INSTALL_DIR"

  if [ -d .git ]; then
    say "当前是 Git 仓库，使用 git pull 更新"
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      warn "本地有未提交的改动，更新可能冲突："
      git status --short | head -n 10
      confirm "仍然继续？" || die "已取消"
    fi
    if ! git pull --ff-only; then
      die "git pull 失败，请先手动处理冲突"
    fi
  else
    warn "当前目录不是 Git 仓库，跳过代码拉取（请自行覆盖文件后重新执行 update）"
  fi

  ensure_build_tools || true
  install_deps
  prepare_data
  restart_app && print_access
}

cmd_status() {
  title "${APP_NAME} 状态"
  local port; port="$(app_port)"
  say "安装目录：$INSTALL_DIR"
  say "端口：    $port"

  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    as_root systemctl status "$SERVICE_NAME" --no-pager -l 2>/dev/null | head -n 12 || warn "服务未安装到 systemd"
  else
    local pid
    if pid="$(running_pid)"; then
      ok "后台进程运行中（PID $pid）"
    else
      warn "没有检测到运行中的进程"
    fi
  fi

  if need_cmd curl && curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    ok "健康检查通过"
  else
    warn "健康检查失败（服务未启动或端口不对）"
  fi

  if [ -f "$INSTALL_DIR/data/fitlog.db" ]; then
    local size; size="$(du -h "$INSTALL_DIR/data/fitlog.db" 2>/dev/null | cut -f1)"
    ok "数据库：data/fitlog.db（${size:-未知大小}）"
  else
    warn "还没有数据库文件（首次启动后生成）"
  fi

  if need_cmd node && [ -f "$INSTALL_DIR/data/fitlog.db" ]; then
    local counts
    counts="$(cd "$INSTALL_DIR" && node -e '
      import("better-sqlite3").then((m) => {
        try {
          const db = new m.default("data/fitlog.db", { readonly: true });
          const one = (sql) => db.prepare(sql).get().n;
          console.log("账号 " + one("SELECT COUNT(*) n FROM users") +
            " · 训练 " + one("SELECT COUNT(*) n FROM workouts") +
            " · 动态 " + one("SELECT COUNT(*) n FROM workouts WHERE shared = 1") +
            " · 留言 " + one("SELECT COUNT(*) n FROM workout_comments"));
        } catch (e) { console.log("读取失败: " + e.message); }
      });
    ' 2>/dev/null)" || counts=""
    [ -n "$counts" ] && say "数据统计：$counts"
  fi
}

cmd_restart() {
  need_cmd node || die "没有 Node.js，先执行 ./install.sh install"
  # 版本不够不在这里挡：交给 start_and_verify 的预检去定位并自动修复
  restart_app && print_access
}

cmd_port() {
  local target="${1:-}"
  title "修改端口"

  if [ -z "$target" ]; then
    target="$(free_high_port)" || die "找不到空闲的高位端口，请手动指定：./install.sh port 18473"
    say "自动挑选空闲高位端口：$target"
  fi
  case "$target" in
    ''|*[!0-9]*) die "端口必须是数字：$target" ;;
  esac
  if [ "$target" -lt 1024 ]; then
    die "1024 以下的端口需要 root 权限，请用 1024 以上（推荐 18473 这类高位端口）"
  fi
  if [ "$target" -gt 65535 ]; then
    die "端口不能超过 65535"
  fi
  if port_in_use "$target"; then
    warn "端口 $target 已有程序在监听"
    say "  试试不带参数让它自己找：./install.sh port"
    die "端口不可用"
  fi

  local old; old="$(app_port)"
  set_env_port "$target"
  ok "端口 $old → $target（已写入 .env，重启后不会回退）"

  if restart_app; then
    print_access
    say "  ${C_DIM}用了 nginx / Caddy 反代的话，把 proxy_pass 改成 127.0.0.1:${target} 再 reload${C_RESET}"
  fi
}

cmd_backup() {
  title "备份数据"
  local dir="$INSTALL_DIR/backups"
  mkdir -p "$dir"
  local stamp; stamp="$(date '+%Y%m%d-%H%M%S')"
  local out="$dir/fitlog-backup-${stamp}.tar.gz"
  local files=()
  [ -d "$INSTALL_DIR/data" ] && files+=("data")
  [ -f "$INSTALL_DIR/.env" ] && files+=(".env")
  if [ ${#files[@]} -eq 0 ]; then die "没有可备份的数据"; fi

  ( cd "$INSTALL_DIR" && tar -czf "$out" "${files[@]}" 2>/dev/null )
  if [ -f "$out" ]; then
    local size; size="$(du -h "$out" | cut -f1)"
    ok "已备份到 backups/$(basename "$out")（$size）"
    say "  ${C_DIM}恢复：停止服务后把 data/ 与 .env 解压回安装目录${C_RESET}"
  else
    die "备份失败"
  fi
}

cmd_log() {
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    as_root journalctl -u "$SERVICE_NAME" -n 60 --no-pager
  elif [ -f "$INSTALL_DIR/data/fitlog.log" ]; then
    tail -n 60 "$INSTALL_DIR/data/fitlog.log"
  else
    warn "没有找到日志"
  fi
}

cmd_probe() {
  title "${APP_NAME} 运行时预检"
  say "安装目录：$INSTALL_DIR"
  local okall=0
  probe_runtime full || okall=1
  if [ "$okall" -ne 0 ]; then
    say ""
    warn "预检没通过：${PROBE_FAILED_STEP:-未知} → $(describe_probe "${PROBE_FAILED_WHY:-error}")"
    advise_probe "${PROBE_FAILED_WHY:-error}"
    say ""
    say "  自动修复并重启：${C_BOLD}./install.sh install${C_RESET}"
    return 1
  fi
  say ""
  ok "这套环境可以直接跑起服务"
}

cmd_doctor() {
  title "${APP_NAME} 环境自检"
  local problems=0

  # 系统
  local os; os="$(uname -s 2>/dev/null || echo unknown)"
  local arch; arch="$(uname -m 2>/dev/null || echo unknown)"
  say "系统：     ${os} ${arch}"
  if [ -r /etc/os-release ]; then
    local pretty; pretty="$(grep -E '^PRETTY_NAME=' /etc/os-release | head -n 1 | cut -d= -f2- | tr -d '"')"
    [ -n "$pretty" ] && say "发行版：   ${pretty}"
  fi
  if need_cmd ldd; then say "C 库：     $(ldd --version 2>&1 | head -n 1)"; fi
  say "包管理器： $(detect_pkg_mgr)"
  if [ "$IS_ROOT" -eq 1 ]; then say "权限：     root"
  elif need_cmd sudo; then say "权限：     普通用户（有 sudo）"
  else say "权限：     普通用户（无 sudo）"; fi
  say "安装目录： $INSTALL_DIR"

  # Node / npm
  if node_ok; then
    ok "Node.js $(node -v)  ($(command -v node))"
    say "运行信息： N-API $(node_napi) · ABI $(node -p 'process.versions.modules' 2>/dev/null) · V8 $(node -p 'process.versions.v8' 2>/dev/null)"
    if ! node_napi_ok; then
      warn "N-API 版本不足：$(node_napi) < ${NODE_MIN_NAPI}"
      say "  ${C_DIM}better-sqlite3 13 的原生二进制按 N-API ${NODE_MIN_NAPI} 编译，只有 Node ${NODE_MIN_MAJOR}+ 支持。${C_RESET}"
      say "  ${C_DIM}Node 20 能装上、跑不起来，启动瞬间就是 SIGSEGV（systemd 日志 status=11/SEGV）。${C_RESET}"
      problems=$((problems + 1))
    fi
  else
    problems=$((problems + 1))
    if need_cmd node; then
      warn "Node.js 版本过低：$(node -v)（需要 ≥ ${NODE_MIN_MAJOR}）"
    else
      warn "没有 Node.js（执行 ./install.sh install 会自动安装）"
    fi
  fi
  if need_cmd npm; then ok "npm $(npm -v 2>/dev/null)"; else warn "没有 npm"; problems=$((problems + 1)); fi

  # 编译工具链
  if has_build_tools; then
    ok "编译工具链（$(build_tools_desc)）"
  else
    warn "编译工具链不完整（已有：$(build_tools_desc || echo '无')）"
    say "  ${C_DIM}会导致 better-sqlite3 编译失败；执行 ./install.sh install 会自动补装${C_RESET}"
    problems=$((problems + 1))
  fi

  # 下载工具
  if need_cmd curl; then ok "curl $(curl --version 2>/dev/null | head -n 1 | awk '{print $2}')"
  elif need_cmd wget; then ok "wget（没有 curl）"
  else warn "curl / wget 都没有"; problems=$((problems + 1)); fi

  # 运行状态
  local port; port="$(app_port)"
  say "端口：     ${port}"
  if need_cmd curl && curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    ok "服务在跑，健康检查通过"
  else
    warn "服务没有响应（未启动 / 端口不对 / 启动报错）"
  fi

  # 依赖与数据
  if [ -d "$INSTALL_DIR/node_modules" ]; then
    ok "node_modules 已存在"
    if [ -d "$INSTALL_DIR/node_modules/better-sqlite3" ]; then
      local bsq_ver bsq_engines
      bsq_ver="$(grep -m1 '"version"' "$(native_dir)/package.json" 2>/dev/null | sed 's/.*"version"[^"]*"\([^"]*\)".*/\1/')"
      bsq_engines="$(grep -A2 '"engines"' "$(native_dir)/package.json" 2>/dev/null | grep -oE '"node"[^,}]*' | sed 's/.*"\s*:\s*"\([^"]*\)"/\1/')"
      say "better-sqlite3：${bsq_ver:-未知}${bsq_engines:+（要求 Node ${bsq_engines}）}"

      # 实际会被加载的那个原生二进制：预编译包 > 本机源码编译
      local bind
      bind="$( ( cd "$INSTALL_DIR" && node -e 'const p=require("path");try{const b=require(p.join(process.cwd(),"node_modules/better-sqlite3/lib/binding.js"));process.stdout.write(b.getPrebuildPath()||"")}catch(e){process.stdout.write("")}' ) 2>/dev/null )"
      if [ -z "$bind" ]; then bind="$(native_dir)/build/Release/better_sqlite3.node"; fi
      if [ -f "$bind" ]; then
        say "原生二进制：${bind#"$INSTALL_DIR"/}（$(du -h "$bind" 2>/dev/null | cut -f1)）"
      else
        warn "找不到可用的原生二进制（$bind）"
        problems=$((problems + 1))
      fi
    else
      warn "缺少 better-sqlite3，重新执行 ./install.sh install"
      problems=$((problems + 1))
    fi
  else
    warn "还没装依赖（./install.sh install）"
    problems=$((problems + 1))
  fi

  if [ -f "$INSTALL_DIR/data/fitlog.db" ]; then
    local db_size; db_size="$(du -h "$INSTALL_DIR/data/fitlog.db" 2>/dev/null | cut -f1)"
    ok "数据库 data/fitlog.db（${db_size:-未知}）"
  else
    say "数据库：   还没有（首次启动时生成）"
  fi

  if [ -f "$INSTALL_DIR/.env" ]; then
    local perm; perm="$(ls -l "$INSTALL_DIR/.env" 2>/dev/null | cut -c1-10)"
    ok ".env 存在（权限 $perm）"
  else
    warn ".env 不存在，执行 ./install.sh install 会生成"
    problems=$((problems + 1))
  fi

  # 磁盘
  local avail; avail="$(df -h "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$avail" ] && say "磁盘剩余： ${avail}"

  # 数据目录的文件系统：SQLite 的 WAL 需要本地磁盘（共享内存 + mmap）
  local fstype; fstype="$(stat -f -c %T "$INSTALL_DIR/data" 2>/dev/null || true)"
  if [ -n "$fstype" ]; then
    say "数据目录FS：${fstype}"
    case "$fstype" in
      nfs*|cifs|smb*|fuse*|fuseblk|9p|glusterfs|ceph)
        warn "数据目录在共享/网络文件系统上，SQLite 的 WAL 无法可靠工作"
        say "  ${C_DIM}把安装目录换到本地磁盘（例如 /opt/fitlog），数据搬过去即可${C_RESET}"
        problems=$((problems + 1)) ;;
    esac
  fi

  # 运行时预检：真的把启动链路跑一遍（这才是「能不能起来」的判据）
  if need_cmd node && [ -d "$INSTALL_DIR/node_modules/better-sqlite3" ]; then
    if ! probe_runtime fast; then
      problems=$((problems + 1))
      say "  ${C_DIM}↑ 这一项就是启动失败的直接原因；./install.sh install 会自动修复${C_RESET}"
    fi
  fi

  title "结论"
  if [ "$problems" -eq 0 ]; then
    ok "环境没问题"
  else
    warn "发现 ${problems} 项问题，逐条见上"
    if [ "$NO_SYSTEM_INSTALL" -eq 1 ]; then
      say "  ${C_DIM}（当前是 --no-system-install，不会自动安装）${C_RESET}"
    elif [ "$(detect_pkg_mgr)" = "none" ]; then
      say "  ${C_DIM}当前系统没有可用的包管理器，缺的组件需要手动安装${C_RESET}"
    else
      say "  ${C_DIM}执行 ./install.sh install 会自动补齐缺的组件${C_RESET}"
    fi
  fi
}

cmd_uninstall() {
  title "卸载 ${APP_NAME}"
  warn "将停止服务并移除启动项"
  [ "$PURGE" -eq 1 ] && warn "同时会删除 data/ 与 .env（训练数据不可恢复！）"
  confirm "确认卸载？" || die "已取消"

  stop_app
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    as_root systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    as_root rm -f "$SERVICE_FILE"
    as_root systemctl daemon-reload
    ok "已移除 systemd 服务"
  fi

  if [ "$PURGE" -eq 1 ]; then
    confirm "再确认一次：删除数据与配置？" || { ok "已保留数据"; return; }
    rm -rf "$INSTALL_DIR/data" "$INSTALL_DIR/.env" "$(pid_file)"
    ok "已删除数据与配置"
  else
    ok "数据已保留在 $INSTALL_DIR/data"
  fi

  say "代码目录仍在：$INSTALL_DIR（可手动删除）"
  say "依赖目录：$INSTALL_DIR/node_modules"
}

menu() {
  while true; do
    cat <<EOF

${C_BOLD}${APP_NAME} 管理菜单${C_RESET}   ${C_DIM}${INSTALL_DIR}${C_RESET}
────────────────────────────────────────
  1) 安装 / 首次部署     ${C_DIM}自动补齐 Node、编译工具链等依赖${C_RESET}
  2) 更新到最新版本
  3) 查看运行状态
  4) 重启服务
  5) 备份数据
  6) 查看日志
  7) 修改端口            ${C_DIM}端口被占用时换到不常用的高位端口${C_RESET}
  8) 环境自检            ${C_DIM}装不上时先跑这个，逐项告诉你缺什么${C_RESET}
  p) 运行时预检          ${C_DIM}原生模块 / 数据库能否真的跑起来（启动失败先跑这个）${C_RESET}
  9) 卸载
  0) 退出
EOF
    printf '请选择 [0-9/p]: '
    local choice
    read -r choice || choice="0"
    case "$choice" in
      1) cmd_install ;;
      2) cmd_update ;;
      3) cmd_status ;;
      4) cmd_restart ;;
      5) cmd_backup ;;
      6) cmd_log ;;
      7) cmd_port ;;
      8) cmd_doctor ;;
      p|P) cmd_probe ;;
      9) cmd_uninstall ;;
      0|"") say "已退出"; return 0 ;;
      *) warn "无效选择：$choice" ;;
    esac
    printf '\n%s按回车返回菜单…%s' "$C_DIM" "$C_RESET"
    read -r _ || true
  done
}

# ---------------------------------------------------------------- 入口
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --purge) PURGE=1 ;;
    --no-system-install) NO_SYSTEM_INSTALL=1 ;;
    install|update|status|restart|backup|log|logs|probe|doctor|uninstall|menu) COMMAND="$arg" ;;
    port|set-port) COMMAND="port" ;;
    -h|--help)
      sed -n '2,/^set -uo pipefail/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    '') die "参数为空（用 --help 查看用法）" ;;
    *[!0-9]*) die "未知参数：$arg（用 --help 查看用法）" ;;
    *)  # 纯数字：只允许跟在 port 后面
      if [ "$COMMAND" = "port" ] && [ -z "${PORT_ARG:-}" ]; then PORT_ARG="$arg"
      else die "未知参数：$arg（用 --help 查看用法）"; fi ;;
  esac
done

[ "$COMMAND" = "logs" ] && COMMAND="log"

case "$COMMAND" in
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  restart) cmd_restart ;;
  backup) cmd_backup ;;
  log) cmd_log ;;
  probe) cmd_probe ;;
  doctor) cmd_doctor ;;
  port) cmd_port "${PORT_ARG:-}" ;;
  uninstall) cmd_uninstall ;;
  menu|"") menu ;;
esac
