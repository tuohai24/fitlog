#!/usr/bin/env bash
#
# FitLog 一键安装 / 管理脚本
#
#   ./install.sh              打开菜单（推荐）
#   ./install.sh install      安装并启动
#   ./install.sh update       拉取新版本并重启
#   ./install.sh status       查看运行状态
#   ./install.sh restart      重启
#   ./install.sh backup       备份数据库与配置
#   ./install.sh log          查看日志
#   ./install.sh uninstall    卸载（默认保留数据）
#
# 可选参数：--yes 跳过确认；--purge 卸载时连同数据一起删除
# 环境变量：FITLOG_DIR（安装目录，默认脚本所在目录）、PORT、ADMIN_USERNAME、ADMIN_PASSWORD
#
set -uo pipefail

APP_NAME="FitLog"
SERVICE_NAME="fitlog"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT="${PORT:-8080}"

# 脚本所在目录即安装目录（支持从任意位置调用）
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALL_DIR="${FITLOG_DIR:-$SRC_DIR}"

ASSUME_YES=0
PURGE=0
COMMAND=""

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

app_port() { env_value PORT "$DEFAULT_PORT"; }

# ---------------------------------------------------------------- Node 检查
node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}
node_minor() {
  node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0
}

check_node() {
  if ! need_cmd node; then
    warn "没有找到 Node.js"
    say "  请先安装 Node.js 20 或更高版本："
    say "    · 官方安装包：https://nodejs.org/zh-cn/download"
    say "    · 或使用 nvm： curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 20"
    say "    · Debian/Ubuntu：curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    die "缺少 Node.js，已中止"
  fi
  local major minor
  major="$(node_major)"; minor="$(node_minor)"
  if [ "$major" -lt 20 ]; then
    die "Node.js 版本过低（当前 $(node -v)），需要 20 或更高"
  fi
  if [ "$major" -eq 20 ] && [ "$minor" -lt 6 ]; then
    warn "Node $(node -v) 低于 20.6，--env-file 不可用，将改用兼容方式加载配置"
  fi
  ok "Node.js $(node -v)"
  if ! need_cmd npm; then die "缺少 npm，请重新安装 Node.js"; fi
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
install_deps() {
  cd "$INSTALL_DIR" || die "无法进入安装目录 $INSTALL_DIR"
  if [ ! -f package.json ]; then
    die "当前目录不像 FitLog 项目（缺少 package.json）：$INSTALL_DIR"
  fi
  title "安装依赖"
  local log="$INSTALL_DIR/data/.npm-install.log"
  mkdir -p "$INSTALL_DIR/data"
  if npm install --omit=dev --no-audit --no-fund >"$log" 2>&1; then
    ok "依赖安装完成"
  else
    warn "npm install 失败，最后 30 行日志（$log）："
    tail -n 30 "$log"
    die "依赖安装失败"
  fi
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
  check_node
  ensure_env
  install_deps
  prepare_data
  start_app
  if wait_health; then print_access; fi
  title "完成"
  say "常用命令： ./install.sh update | restart | status | backup | log"
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
  1) 安装 / 首次部署
  2) 更新到最新版本
  3) 查看运行状态
  4) 重启服务
  5) 备份数据
  6) 查看日志
  7) 卸载
  0) 退出
EOF
    printf '请选择 [0-7]: '
    local choice
    read -r choice || choice="0"
    case "$choice" in
      1) cmd_install ;;
      2) cmd_update ;;
      3) cmd_status ;;
      4) cmd_restart ;;
      5) cmd_backup ;;
      6) cmd_log ;;
      7) cmd_uninstall ;;
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
    install|update|status|restart|backup|log|logs|uninstall|menu) COMMAND="$arg" ;;
    -h|--help)
      sed -n '2,17p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
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
  uninstall) cmd_uninstall ;;
  menu|"") menu ;;
esac
