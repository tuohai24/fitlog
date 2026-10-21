#!/usr/bin/env bash
#
# FitLog 一键安装 / 管理脚本
#
#   ./install.sh              打开菜单（推荐）
#   ./install.sh install      安装并启动（缺 Node、编译工具链会自动装）
#   ./install.sh update       拉取新版本并重启
#   ./install.sh status       查看运行状态
#   ./install.sh restart      重启
#   ./install.sh backup       备份数据库与配置
#   ./install.sh log          查看日志
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
#   NODE_VERSION          自动安装 Node 的大版本，默认 22
#   NODE_MIRROR           逗号或空格分隔的 Node 下载镜像
#   NPM_MIRROR            官方 npm 源失败后使用的镜像，默认 registry.npmmirror.com
#
# 自动补装清单：curl/tar（下载工具）、Node.js ≥ 20、python3 + make + g++（原生模块编译）
#
set -uo pipefail

APP_NAME="FitLog"
SERVICE_NAME="fitlog"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT="${DEFAULT_PORT:-8080}"   # 兜底端口；用户传的 PORT 单独处理，避免两者混淆

# 脚本所在目录即安装目录（支持从任意位置调用）
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALL_DIR="${FITLOG_DIR:-$SRC_DIR}"

ASSUME_YES=0
PURGE=0
COMMAND=""
NO_SYSTEM_INSTALL=0      # --no-system-install：只报告缺失，不动系统
NODE_MIN_MAJOR=20
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
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
node_minor() { node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0; }

node_ok() {
  need_cmd node || return 1
  [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null || return 1
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
    warn "当前 Node $(node -v) 低于 ${NODE_MIN_MAJOR}，需要升级"
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
# better-sqlite3 装完能不能用，取决于二进制的 ABI 是否匹配当前 Node
check_native_modules() {
  local dir="$INSTALL_DIR/node_modules/better-sqlite3"
  [ -d "$dir" ] || { warn "node_modules 里没有 better-sqlite3"; return 1; }
  if ( cd "$INSTALL_DIR" && node -e 'require("better-sqlite3")' >/dev/null 2>&1 ); then
    ok "原生模块可正常加载（better-sqlite3）"
    return 0
  fi
  warn "better-sqlite3 存在但加载失败（多半是编译产物与当前 Node 不匹配）"
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
    check_native_modules || rebuild_native "$log"
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
      check_native_modules || rebuild_native "$log"
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
      check_native_modules || rebuild_native "$log"
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
rebuild_native() {
  local log="${1:-$INSTALL_DIR/data/.npm-install.log}"
  [ -d "$INSTALL_DIR/node_modules/better-sqlite3" ] || return 1
  warn "单独重编 better-sqlite3（--build-from-source）"
  if ( cd "$INSTALL_DIR" && npm rebuild better-sqlite3 --build-from-source ) >>"$log" 2>&1; then
    if check_native_modules; then
      note_installed "better-sqlite3（本地编译）"
      return 0
    fi
  fi
  tail -n 20 "$log" 2>/dev/null | sed 's/^/    /'
  return 1
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
  local env_args node_bin
  env_args="$(node_env_args)"
  node_bin="$(command -v node)"
  as_root tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} 健身训练记录
Documentation=https://github.com/tuohai24/fitlog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${node_bin} ${env_args} server/index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
  as_root systemctl daemon-reload
  ok "已写入 systemd 服务：$SERVICE_FILE"
}

start_app() {
  cd "$INSTALL_DIR" || die "无法进入 $INSTALL_DIR"
  if [ "$HAS_SYSTEMD" -eq 1 ]; then
    write_unit
    as_root systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    as_root systemctl restart "$SERVICE_NAME" || die "启动失败，执行 journalctl -u $SERVICE_NAME -n 50 查看原因"
    ok "已通过 systemd 启动：$SERVICE_NAME"
    return
  fi

  # 没有 systemd（macOS / 容器）：nohup 后台运行
  local pid; pid="$(running_pid)" && { warn "已在运行（PID $pid），先停止"; stop_app; }
  local env_args; env_args="$(node_env_args)"
  nohup node $env_args server/index.js >>"$INSTALL_DIR/data/fitlog.log" 2>&1 &
  local new_pid=$!
  printf '%s' "$new_pid" > "$(pid_file)"
  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    ok "已后台启动（PID $new_pid），日志：data/fitlog.log"
  else
    die "启动失败，查看 $INSTALL_DIR/data/fitlog.log"
  fi
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
  if [ "$HAS_SYSTEMD" -eq 1 ] && [ -f "$SERVICE_FILE" ]; then
    as_root systemctl restart "$SERVICE_NAME" || die "重启失败"
    ok "已重启"
  else
    stop_app
    start_app
  fi
  wait_health
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
      say "  换端口重跑：PORT=9000 ./install.sh install --yes"
      say "  或先停掉占用 ${port} 的程序（./install.sh status 可看当前状态）"
      die "端口冲突，安装中止"
    fi
  fi

  install_deps
  prepare_data
  start_app
  if wait_health; then print_access; fi
  title "完成"
  if [ -n "$AUTO_INSTALLED" ]; then
    say "本次自动补装：${AUTO_INSTALLED}"
  fi
  say "常用命令： ./install.sh update | restart | status | backup | log | doctor"
}

cmd_update() {
  title "${APP_NAME} 更新"
  check_node
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
  restart_app
  print_access
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
  check_node
  restart_app
  print_access
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
  say "包管理器： $(detect_pkg_mgr)"
  if [ "$IS_ROOT" -eq 1 ]; then say "权限：     root"
  elif need_cmd sudo; then say "权限：     普通用户（有 sudo）"
  else say "权限：     普通用户（无 sudo）"; fi
  say "安装目录： $INSTALL_DIR"

  # Node / npm
  if node_ok; then
    ok "Node.js $(node -v)  ($(command -v node))"
    if [ "$(node_major)" -eq 20 ] && [ "$(node_minor)" -lt 6 ]; then
      warn "Node 20.6 以下不支持 --env-file，脚本会改用兼容模式启动"
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
      check_native_modules || problems=$((problems + 1))
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
  7) 环境自检            ${C_DIM}装不上时先跑这个，逐项告诉你缺什么${C_RESET}
  8) 卸载
  0) 退出
EOF
    printf '请选择 [0-8]: '
    local choice
    read -r choice || choice="0"
    case "$choice" in
      1) cmd_install ;;
      2) cmd_update ;;
      3) cmd_status ;;
      4) cmd_restart ;;
      5) cmd_backup ;;
      6) cmd_log ;;
      7) cmd_doctor ;;
      8) cmd_uninstall ;;
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
    install|update|status|restart|backup|log|logs|doctor|uninstall|menu) COMMAND="$arg" ;;
    -h|--help)
      sed -n '2,28p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "未知参数：$arg（用 --help 查看用法）" ;;
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
  doctor) cmd_doctor ;;
  uninstall) cmd_uninstall ;;
  menu|"") menu ;;
esac
