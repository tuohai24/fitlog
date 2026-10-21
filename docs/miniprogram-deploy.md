# 部署教程：把小程序跑起来，并和网页端共用同一个数据库

> 适用版本：FitLog 后端 ≥ 1.1.1，小程序 `fitlog-mp/` ≥ 1.1.0
> 全流程大约 40 分钟（不含域名备案等待时间）
> 文中示例：域名 `fitlog.example.com`，服务器目录 `/opt/fitlog`，请整体替换成你自己的

---

## 目录

1. [先理解：什么叫「共用同一个数据库」](#1-先理解什么叫共用同一个数据库)
2. [准备清单](#2-准备清单)
3. [部署后端](#3-部署后端)
4. [域名与 HTTPS（小程序的硬门槛）](#4-域名与-https小程序的硬门槛)
5. [微信小程序后台配置](#5-微信小程序后台配置)
6. [修改小程序的两个配置](#6-修改小程序的两个配置)
7. [本地联调](#7-本地联调)
8. [验证两端真的共用一份数据](#8-验证两端真的共用一份数据)
9. [上传、审核、发布](#9-上传审核发布)
10. [日常运维](#10-日常运维)
11. [什么时候需要重新发版](#11-什么时候需要重新发版)
12. [排错速查表](#12-排错速查表)
13. [附录](#13-附录)

---

## 1. 先理解：什么叫「共用同一个数据库」

很多人第一反应是「两个客户端各连一个库，再做数据同步」。**不需要，也不该这么做。**

```
        ┌─────────────────────────────────────────┐
        │   微信小程序 fitlog-mp/                  │
        │   Authorization: Bearer <token>          │
        └───────────────┬─────────────────────────┘
                        │  HTTPS 443
                        ▼
        ┌─────────────────────────────────────────┐
        │   Nginx / Caddy 反向代理（域名 + 证书）    │
        └───────────────┬─────────────────────────┘
                        │  http://127.0.0.1:8080
                        ▼
        ┌─────────────────────────────────────────┐
        │   同一个 Node 进程（Express 5）           │
        │   /api/*  ── 业务逻辑只写一遍             │
        │   /media/* ── 动作图 / 动图               │
        └───────────────┬─────────────────────────┘
                        │  better-sqlite3（WAL）
                        ▼
        ┌─────────────────────────────────────────┐
        │   唯一一份 data/fitlog.db                 │
        └───────────────▲─────────────────────────┘
                        │
        ┌───────────────┴─────────────────────────┐
        │   网页端（同一域名的 / 路径）              │
        │   Cookie: fl_session（HttpOnly）          │
        └─────────────────────────────────────────┘
```

关键事实（这三条决定了整套部署怎么做）：

| 事实 | 含义 |
| --- | --- |
| 小程序只是一个**客户端**，没有自己的数据库 | 它所有读写都走 `/api/*`，和网页端调的是同一组接口 |
| 网页用 HttpOnly Cookie，小程序用 `Authorization: Bearer` | `server/auth.js` 的 `sessionTokenFrom()` 同时接受两者，会话都存 `sessions` 表 |
| 数据按 `user_id` 隔离，同一个账号两端登录看到同一份数据 | 训练、计划、动态、留言全部实时一致，**不需要同步层** |

> ⚠️ **最容易踩的坑**：为了让「两端都能用」，在 NAS 上再启动一份后端、指向同一个 `fitlog.db`。
> better-sqlite3 是**单进程写入模型**，两个进程同时写会产生 `SQLITE_BUSY`，甚至写坏 WAL。
> 正确做法永远是：**一个后端实例，多种客户端连它**。
>
> 判断自己有没有踩坑：小程序里刚分享的训练，网页端「动态」看不到 —— 说明你连的是两套库。

---

## 2. 准备清单

| 需要什么 | 要求 | 说明 |
| --- | --- | --- |
| 服务器 | 1 核 1 GB 起，能跑 Node 20+ | 云服务器 / VPS / 家里的飞牛 NAS 都行，只要能被公网访问 |
| 域名 | 已 ICP 备案（境内主体必需） | 微信 `request` 域名要求已备案；海外主体规则不同，以小程序后台提示为准 |
| HTTPS 证书 | 受信任 CA 签发，TLS 1.2+ | Let's Encrypt 免费证书完全可用，微信不挑 CA，只挑「是否受信任」 |
| 小程序 AppID | 在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册 | 个人主体可以注册，选「工具」或「体育」类目 |
| 微信开发者工具 | 最新稳定版 | 上传代码、真机调试都要用 |
| 磁盘空间 | ≥ 1 GB | 动作图 12 MB + 动图 122 MB + 数据库（很小） |

> 没有公网服务器也想先看效果？可以先用「微信开发者工具 + 内网 IP」跑通全部功能（见 [本地联调](#7-本地联调)），确认功能没问题再买服务器。**真机预览**和**发布**必须走 HTTPS 域名。

---

## 3. 部署后端

后端只需要部署**一次**，网页端和小程序共用它。

### 3.1 上传代码

```bash
# 方式 A：git 克隆（推荐，以后 update 一键升级）
ssh root@你的服务器IP
git clone https://github.com/tuohai24/fitlog.git /opt/fitlog

# 方式 B：本地打包上传（服务器连不上 GitHub 时）
# 本地执行：把 fitlog/ 目录（不含 node_modules）压缩后 scp 上去
# scp fitlog.tar.gz root@服务器IP:/opt/ && ssh root@服务器IP 'cd /opt && tar xf fitlog.tar.gz'
```

> 动作图与动图（`public/media/`，共 134 MB）**不在 git 仓库里**。第一次部署后需要补：
>
> ```bash
> cd /opt/fitlog
> npm install                    # 先装依赖（脚本要用到 node-fetch 之类）
> npm run fetch:media            # 下载 1,285 个动作的缩略图
> npm run fetch:gifs             # 下载动图（122 MB，比较慢，可后台跑）
> ```
>
> 不下载也能用，只是动作库里没有图和 GIF，功能不受影响。

### 3.2 一键安装（推荐）

```bash
cd /opt/fitlog
bash install.sh
```

出现菜单，选 `1) 安装 / 首次部署`：

```
FitLog 管理菜单   /opt/fitlog
────────────────────────────────────────
  1) 安装 / 首次部署     自动补齐 Node、编译工具链等依赖
  2) 更新到最新版本
  3) 查看运行状态
  4) 重启服务
  5) 备份数据
  6) 查看日志
  7) 修改端口            端口被占用时换到不常用的高位端口
  8) 环境自检            装不上时先跑这个，逐项告诉你缺什么
  9) 卸载
  0) 退出
```

脚本会自动完成：

1. **环境准备**：缺 Node 就装（Linux 下官方二进制装到 `/usr/local`，无 root 落到 `~/.local`）；缺 `python3 / make / g++` 也补上（`better-sqlite3` 是原生模块，缺工具链必然编译失败）
2. **依赖安装**：官方源 → 国内镜像 → 源码编译，三级重试；装完用 `require('better-sqlite3')` 真加载一次才算成功
3. **生成 `.env`**：随机管理员密码写入，权限 `600`
4. **装服务**：有 systemd 就装 `fitlog.service` 并 `enable --now`，没有就 `nohup` 后台跑 + `.fitlog.pid`
5. **健康检查**：轮询 `/api/health` 最多 20 秒，最后打印访问地址和密码

装完屏幕最后会显示：

```
完成
  访问地址： http://服务器IP:8080
  管理员：   admin
  密码：     9dc367c4511c      ← 记下来，登录后请立刻改
```

> **注意看端口号**。如果 8080 已被别的程序占用（NAS、宝塔、Docker 面板都很常见），脚本会**自动改用高位端口**并从 `18473` 开始找空闲的，屏幕上的地址会变成 `http://服务器IP:18473` —— 以脚本打印的为准，后面配反代、白名单时也用它。
>
> 想自己指定：`./install.sh port 18473`；想看看换到哪个了：`cat .env | grep PORT`。

### 3.3 验证后端活着

```bash
curl http://127.0.0.1:8080/api/health
# {"ok":true,"time":"2026-10-21T15:20:31.000Z"}
```

顺手确认数据库文件真的建出来了：

```bash
ls -lh /opt/fitlog/data/fitlog.db
```

### 3.4 可选：Docker 部署

```bash
cd /opt/fitlog
cp .env.example .env          # 改 ADMIN_PASSWORD
docker compose up -d --build
```

数据持久化在 `./data-store/fitlog.db`（**和 install.sh 的 `./data/` 不是同一个位置**，两者选一个，别混用）。

### 3.5 安全收口：只让本机监听

反代装好后，后端不应对公网开放。编辑 `.env`：

```bash
HOST=127.0.0.1
```

然后 `bash install.sh restart`，并在云服务器安全组 / 防火墙里**关掉 8080 入站**，只留 80 和 443。

---

## 4. 域名与 HTTPS（小程序的硬门槛）

小程序对服务器域名有硬性限制，**绕不过去**：

| 限制 | 说明 |
| --- | --- |
| 必须 HTTPS | `http://` 仅在开发者工具勾选「不校验合法域名」时可用，真机正式版直接拒绝 |
| 不能带端口 | 只能是 443。写 `https://fitlog.example.com:8443` 是无效域名 |
| 不能是 IP / localhost | 必须是域名 |
| 不能带路径 | `https://fitlog.example.com/api` 无效，只能到域名 |
| 必须备案（境内主体） | 微信会校验域名备案状态 |
| TLS ≥ 1.2 | Let's Encrypt 默认满足 |

### 4.1 DNS 解析

在域名服务商处添加 A 记录：

```
fitlog.example.com  →  你的服务器公网 IP
```

等生效后验证：

```bash
dig +short fitlog.example.com
```

### 4.2 方案 A：Caddy（最省事，证书自动申请自动续期）

```bash
apt install -y caddy          # Debian / Ubuntu
```

`/etc/caddy/Caddyfile`：

```caddyfile
fitlog.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080    # 后端换过端口就改成 127.0.0.1:18473
}
```

```bash
systemctl reload caddy
```

Caddy 会自动申请 Let's Encrypt 证书、自动续期、自动把 80 跳转到 443，也会自动带 `X-Forwarded-Proto`（`server/auth.js` 靠它决定 Cookie 是否加 `Secure`）。

### 4.3 方案 B：Nginx + certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
certbot --nginx -d fitlog.example.com      # 自动申请证书并改写配置
```

如果手动写，`/etc/nginx/conf.d/fitlog.conf`：

```nginx
# 80 跳 443
server {
    listen 80;
    server_name fitlog.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;          # nginx ≥ 1.25.1 的写法；老版本改成 listen 443 ssl http2;
    server_name fitlog.example.com;

    ssl_certificate     /etc/letsencrypt/live/fitlog.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fitlog.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;   # 后端换过端口就改这里
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # 必须：后端靠这个头判断是否给 Cookie 加 Secure
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;   # AI 生成计划可能跑很久
    }

    # 动图 134 MB，交给 nginx 直接读文件，比走 Node 快得多
    location /media/ {
        alias /opt/fitlog/public/media/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

> 用 `alias` 时结尾的 `/` 不能少，否则 `/media/gifs/x.gif` 会被拼成 `/opt/fitlog/public/mediagifs/x.gif`，表现为「图片全部 404」。

### 4.4 验证 HTTPS

```bash
curl https://fitlog.example.com/api/health
# {"ok":true,...}

# 顺便看一眼 TLS 版本
curl -sI https://fitlog.example.com | head -1
```

浏览器打开 `https://fitlog.example.com`，应该能看到网页版登录页 —— **这说明网页端和小程序将来连的是同一个地址、同一个库**。

---

## 5. 微信小程序后台配置

登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 左侧「开发」→「开发管理」→「开发设置」。

### 5.1 服务器域名

在「服务器域名」里填：

| 列表 | 填什么 | 为什么需要 |
| --- | --- | --- |
| **request 合法域名** | `https://fitlog.example.com` | 所有 `/api/*` 接口 |
| **downloadFile 合法域名** | `https://fitlog.example.com` | 导出 PDF / Excel 用 `wx.downloadFile` |
| uploadFile 合法域名 | 不用填 | 本项目不上传文件 |

注意：

- 只填**域名**，不要带 `/api`、不要带端口、不要带结尾斜杠
- 改动次数有限（每月几次，以后台提示为准），配置前先想清楚
- 用「微信开发者工具」联调阶段可以先不配，勾选「不校验合法域名」即可；但**真机正式版必须有**
- 动作图的 `<image src="https://域名/media/...">` **不需要**加白名单，`image` 组件不受服务器域名限制

### 5.2 服务类目

「设置」→「基本设置」→「服务类目」，选一个贴近的：

- `工具 → 效率`
- `体育 → 在线健身 / 运动健身`

个人主体可选类目有限，以当时后台实际可选为准；部分类目需要补充资质（如涉及「医疗健康」会被要求资质，**不要选医疗类**）。

### 5.3 用户隐私保护指引

「设置」→「服务内容声明」→「用户隐私保护指引」，如实填写：

| 收集的信息 | 用途 |
| --- | --- |
| 用户填写的账号（用户名） | 登录与区分数据归属 |
| 健身训练记录（动作、重量、次数） | 核心功能：记录与统计 |

本项目**不获取**微信头像、昵称、手机号、位置、相册，也没有 `wx.login` 静默登录，所以隐私声明可以写得很简单。这一项不填，提交审核会被直接驳回。

### 5.4 成员管理

「管理」→「成员管理」：

- **项目成员**：你自己 + 需要一起开发的人
- **体验成员**：把家人朋友的微信号加进来，他们才能扫码体验

---

## 6. 修改小程序的两个配置

小程序端只有两个文件需要改，**改完就不再动了**。

### 6.1 `config.js` —— 服务地址

```js
// fitlog-mp/config.js
const DEFAULT_BASE = 'https://fitlog.example.com';   // ← 改成你的域名

const FALLBACK_BASE = '';   // 可选：第二个地址，在「我的 → 服务器地址」里能一键切
```

规则：

- 只写到域名，**不要**带 `/api`、不要带结尾斜杠（代码会自己拼 `/api/...`）
- 上线必须是 `https://`
- 本地调试可以写 `http://localhost:8080` 或 `http://192.168.1.20:8080`

### 6.2 `project.config.json` —— AppID

```json
{
  "appid": "wx1234567890abcdef",
  "setting": {
    "urlCheck": false
  }
}
```

- `appid` 换成你自己的（没有就先填 `touristappid` 用测试号，但**测试号不能发布**）
- `urlCheck: false` 只是让开发者工具跳过域名校验，**不影响线上**，可以保留

---

## 7. 本地联调

### 7.1 三种地址场景

| 场景 | `DEFAULT_BASE` | 需要勾「不校验合法域名」 | 后端要做什么 |
| --- | --- | --- | --- |
| 开发者工具（后端在本机） | `http://localhost:8080` | ✅ 要 | 什么都不用改 |
| 开发者工具（后端在服务器） | `http://服务器IP:8080` | ✅ 要 | 安全组放行 8080 |
| 真机预览（同一 WiFi） | `http://192.168.1.20:8080` | ✅ 要 | 电脑防火墙放行 8080 |
| 正式版 | `https://fitlog.example.com` | ❌ 不用 | 反代 + 证书 |

勾选位置：开发者工具右上角「详情」→「本地设置」→ ✅ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**。

### 7.2 导入项目

1. 微信开发者工具 → 导入项目 → 目录选 `fitlog-mp/`
2. AppID 填自己的
3. 编译，用后端账号登录（`install.sh` 打印的 `admin` + 随机密码）

如果登录页提示「连不上服务器」，点登录页底部「服务器地址」，直接改成你的地址再试 —— 这个入口就是为调试准备的，改完存在本地缓存，优先级高于 `config.js`。

### 7.3 真机预览

点「预览」扫码。手机和电脑必须在同一个 WiFi，且：

- Windows：防火墙放行 8080（或临时关掉「专用网络」防火墙）
- macOS：系统设置 → 网络 → 防火墙 → 允许 node 接入
- 手机浏览器先访问 `http://电脑IP:8080/api/health`，能出 JSON 才说明网络通了

---

## 8. 验证两端真的共用一份数据

这一步是整套部署的**验收标准**，务必逐条走一遍。

### 8.1 五条验收用例

| # | 操作 | 期望结果 |
| --- | --- | --- |
| 1 | 网页端登录 `admin`，记录一次训练（加 2 个动作、每组填重量） | 保存成功 |
| 2 | 小程序用**同一个账号**登录 → 「历史」或「今日」 | 立刻看到刚才那条训练，每组的重量次数完全一致 |
| 3 | 小程序打开这条训练，改一组的重量 →「完成训练」→ 选「完成并分享到动态」 | 跳到动态详情页 |
| 4 | 网页端刷新 →「动态」tab | 出现这条动态，容量 / 组数 / 动作数和小程序一致 |
| 5 | 网页端点进动态 → 发一条留言 | 小程序动态详情**下拉刷新**后能看到这条留言 |

反向再验一次隔离性：

| # | 操作 | 期望结果 |
| --- | --- | --- |
| 6 | 网页端新建一个账号 B（「我的 → 用户管理」），用 B 登录 | B 看不到 admin 未分享的训练（历史为空） |
| 7 | B 在 admin 的公开动态下留言 | 成功；admin 在那条动态下能看到 B 的留言，并可以删除它 |
| 8 | admin 点「取消分享」 | B 刷新动态，该条消失（不再是 404 报错，是列表里没有） |

### 8.2 在服务器上直接查库对照

如果怀疑「是不是连了两个库」，在服务器上数一下行数，再和界面比对：

```bash
cd /opt/fitlog
node -e "
const D = require('better-sqlite3');
const db = new D('data/fitlog.db', { readonly: true });
console.log('账号:', db.prepare('select count(*) c from users').get().c);
console.log('训练:', db.prepare('select count(*) c from workouts').get().c);
console.log('动态:', db.prepare('select count(*) c from workouts where shared = 1').get().c);
console.log('留言:', db.prepare('select count(*) c from workout_comments').get().c);
console.log('最近三条:', db.prepare('select id, title, shared from workouts order by id desc limit 3').all());
"
```

界面上加一条训练后立刻再跑一次，`训练` 的数字必须 +1。**如果不变，说明你界面上操作的并不是这个库**（连错地址，或者起了第二个实例）。

### 8.3 确认只有一个后端在跑

```bash
ps aux | grep "server/index.js" | grep -v grep
```

只应该有一行（`install.sh` 的 systemd 模式或 nohup 模式）。出现两行就是重复启动，先 `bash install.sh restart` 收口。

---

## 9. 上传、审核、发布

### 9.1 上传代码

1. 开发者工具右上角「上传」
2. 版本号填 `1.1.0`，项目备注写「动态与留言」
3. 上传后在后台「管理 → 版本管理」能看到「开发版本」

### 9.2 设体验版（可选但强烈建议）

「版本管理」→ 开发版本 → 「选为体验版」→ 生成二维码 → 发给「体验成员」扫码。

体验版走的是**正式域名 + 正式白名单**，能提前暴露所有线上问题，比提审后再发现问题便宜得多。

### 9.3 提交审核

「版本管理」→ 提交审核，重点填这几项：

| 项目 | 怎么填 |
| --- | --- |
| 功能页面 | 选 `pages/home/home`（首页） |
| **测试账号** | ⚠️ **必填**：`admin` / 你在 `.env` 里的密码。本项目打开就要登录，不填审核员进不去，100% 驳回 |
| 测试说明 | 「健身记录工具。请用上方账号登录后，在「今日」页可查看训练计划，在「动态」页可查看公开训练并留言。」 |
| 隐私协议 | 确认已在 5.3 配置 |
| 类目 | 与 5.2 一致 |

审核周期通常 1–2 个工作日。

### 9.4 发布

审核通过后，在「版本管理」点「发布」。可选用「分阶段发布」（先 10% 用户，逐步放量），个人项目直接全量即可。

---

## 10. 日常运维

全部通过 `install.sh` 完成，不用记命令：

```bash
cd /opt/fitlog
bash install.sh          # 菜单
```

| 需求 | 菜单 | 命令行 |
| --- | --- | --- |
| 升级代码 | 2) 更新到最新版本 | `bash install.sh update` |
| 看服务状态 | 3) 查看运行状态 | `bash install.sh status` |
| 重启 | 4) 重启服务 | `bash install.sh restart` |
| 备份 | 5) 备份数据 | `bash install.sh backup` |
| 看日志 | 6) 查看日志 | `bash install.sh log` |
| 换端口 | 7) 修改端口 | `bash install.sh port [端口]` |
| 查环境问题 | 8) 环境自检 | `bash install.sh doctor` |

### 10.1 定时备份

`install.sh backup` 会把 `data/fitlog.db`（WAL 安全方式）和 `.env` 打成 `backups/fitlog-backup-YYYYmmdd-HHMMSS.tar.gz`。加一条 cron：

```bash
crontab -e
# 每天凌晨 3:20 备份
20 3 * * * cd /opt/fitlog && bash install.sh backup --yes >/dev/null 2>&1
```

### 10.2 拉人进来一起用

两种方式：

- **管理员建号**：网页「我的 → 用户管理」→ 添加账号（推荐，可控）
- **邀请码自助注册**：`.env` 里设 `SIGNUP_CODE=你的邀请码`，重启后登录页会出现注册入口

新账号默认看不到任何人的数据；只有对方把训练「分享到动态」，才能在动态流里互相看到并留言。

### 10.3 迁移到新服务器

```bash
# 老服务器
cd /opt/fitlog && bash install.sh backup
scp backups/fitlog-backup-*.tar.gz new-server:/opt/

# 新服务器
cd /opt/fitlog
tar xzf fitlog-backup-*.tar.gz      # 还原 data/ 与 .env
bash install.sh install --yes       # 已存在 .env 会自动保留，不会重置密码
```

然后把 DNS 的 A 记录指向新 IP。**小程序不用重新发版**，域名没变就不需要动白名单。

---

## 11. 什么时候需要重新发版

| 改了什么 | 要重新上传小程序吗 | 说明 |
| --- | --- | --- |
| 后端业务逻辑、数据库结构 | ❌ 不用 | `install.sh update` 搞定，接口不变小程序无感 |
| 后端接口路径 / 字段名变了 | ✅ 要 | 小程序端 `utils/api.js` 也要跟着改 |
| 页面、样式、交互 | ✅ 要 | 纯前端改动 |
| 换域名 | ✅ 要 | `config.js` 改地址 + 后台改白名单 + 重新提审 |
| 加动作库数据、动图 | ❌ 不用 | 小程序只拿接口数据，图走后端 `/media` |

> 有个实用推论：**大部分迭代只需要更新后端**，`install.sh update` 之后网页端和小程序同时生效。这也是「共用一份后端」的最大好处。

---

## 12. 排错速查表

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `request:fail url not in domain list` | 域名没进白名单 / 真机没走正式域名 | 后台加 `request` 白名单；开发阶段勾「不校验合法域名」 |
| `request:fail -2:net::ERR_NAME_NOT_RESOLVED` | DNS 没解析 / 解析到了旧 IP | `dig +short 域名` 确认 |
| 提示「连不上服务器，请确认地址」 | 地址写错、后端没起、防火墙拦了 | `curl https://域名/api/health`；「我的 → 服务器地址」改成正确地址 |
| 登录成功但立刻被踢回登录页 | 后端时间不对导致 token 被判过期 | `.env` 里 `TZ=Asia/Shanghai`，`timedatectl` 校时 |
| 图片 / 动图全 404 | nginx `alias` 路径结尾少了 `/`，或 `/media` 没配 | 见 [4.3](#43-方案-bnginx--certbot)，改成 `alias /opt/fitlog/public/media/;` |
| 导出 PDF 失败，JSON 正常 | `downloadFile` 域名没加，或 nginx 60s 超时 | 加白名单；`proxy_read_timeout 300s` |
| 提交审核被驳回：「无法体验完整功能」 | 没填测试账号（登录墙） | 提审页填 `admin` + 密码，测试说明写清登录方式 |
| 审核被驳回：「类目与内容不符」 | 选了医疗 / 健康类 | 改成「工具 → 效率」或「体育 → 在线健身」 |
| 安装时报 `better-sqlite3` 编译失败 | 缺 python3 / make / g++ | `bash install.sh doctor` 看缺什么；或直接重跑 `install` 让它自动补 |
| 升级后数据「不见了」 | `DATA_DIR` 变了（Docker 用 `data-store/`，脚本用 `data/`） | 统一到一种部署方式，或把 `.env` 的 `DATA_DIR` 指回原路径 |
| `SQLITE_BUSY` / 写不进去 | 启动了第二个后端实例 | `ps aux \| grep server/index.js`，只留一个 |
| 小程序打开白屏，网页正常 | 包内代码报错 | 开发者工具「调试器 → Console」看红字；`node tools/lint.mjs` 先静态检查 |
| 装完提示「20 秒内没等到服务响应」 | 端口被占（进程启动即退出），或进程崩溃 | 脚本现在会自动打印端口占用 + 最近日志；直接 `./install.sh port` 换端口，还不行看日志里的报错 |
| 网页能开，但小程序一直连不上 | 反代 `proxy_pass` 还指着旧端口 | `./install.sh port` 换端口后，记得同步改 Caddy / nginx 再 reload |

环境层的问题，一条命令定位：

```bash
bash install.sh doctor
```

它会逐项检查：系统 / Node / npm / 编译工具链 / curl / 端口 / node_modules / 原生模块 / 数据库 / `.env` 权限 / 磁盘，最后给结论。

---

## 13. 附录

### 13.1 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 后端端口，反代指向它 |
| `HOST` | `0.0.0.0` | 反代装好后建议改 `127.0.0.1` |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的账号 |
| `ADMIN_PASSWORD` | 随机 | 只在首次启动生效，之后在网页「我的」改 |
| `DATA_DIR` | `./data` | SQLite 存放目录，**备份就是备份它** |
| `SIGNUP_CODE` | 空 | 留空则关闭自助注册 |
| `TZ_OFFSET` | 服务器时区 | 「今天练什么」「最近 N 天统计」按它算，中国填 `8` |
| `TZ` | 系统时区 | 影响日志时间与 `TZ_OFFSET` 缺省值，建议 `Asia/Shanghai` |
| `DEEPSEEK_API_KEY` | 空 | AI 生成计划用；也可以在「我的」页面按账号填 |
| `PDF_FONT_PATH` | 内置 | PDF 导出的中文字体 |

### 13.2 需要备份什么

```
/opt/fitlog/
├── data/fitlog.db        ← 全部数据（训练 / 计划 / 账号 / 动态 / 留言）
├── .env                  ← 管理员密码、端口、邀请码
├── public/media/         ← 动作图与动图（134 MB，丢了可以重新 fetch，不必备份）
└── backups/              ← install.sh backup 的产物
```

只备份 `data/fitlog.db` 和 `.env` 就能完整重建。动作库本身（`exercises` 表）在 db 里，媒体文件可重新下载。

### 13.3 上线前检查清单

- [ ] `curl https://你的域名/api/health` 返回 `{"ok":true}`
- [ ] 浏览器能用新域名打开网页版并登录
- [ ] 服务器防火墙只开 80/443，8080 不对外
- [ ] `.env` 权限 `600`，管理员密码不是默认值
- [ ] 小程序后台 `request` + `downloadFile` 白名单都加了域名
- [ ] 隐私保护指引已提交
- [ ] 测试账号（`admin` + 密码）准备好，提审时填进去
- [ ] 走完 [8.1 五条验收用例](#81-五条验收用例)
- [ ] `bash install.sh backup` 能正常出包，cron 已配

### 13.4 安全提醒

- 上线**必须** HTTPS：小程序的 token 走 `Authorization` 头，明文 HTTP 会被中间人拿走
- 不要开放注册就没有 `SIGNUP_CODE`；朋友要用就单独建号
- 定期 `install.sh update` 拿安全修复
- 数据库文件别放进 web 目录暴露出去（默认在 `data/`，不在 `public/` 下）
- 备份文件 `.tar.gz` 里含密码哈希，别随手扔到公开网盘
