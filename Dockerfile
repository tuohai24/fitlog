# FitLog 镜像（多阶段）
#   构建：docker build -t fitlog:latest .
#   运行：docker run -d -p 18473:8080 -e ADMIN_PASSWORD='xxx' -v $PWD/data-store:/data fitlog:latest
#
# 为什么要多阶段：better-sqlite3 是原生模块，可能要在本机源码编译，
# 但编译用的 python3/make/g++ 有 300MB+，运行期一点用不上。
# 在 builder 里装依赖，只把 node_modules 拷进运行镜像，镜像从 1.18GB 降到 300MB 左右。

# ---------------------------------------------------------------- 构建阶段
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# 编译 better-sqlite3 需要的工具链（预编译包可用时其实用不到，但得兜住）
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# 装完必须真 new 一个库再跑条查询：better-sqlite3 13 的 .node 是懒加载的，
# 只 require 会让不兼容的二进制「假通过」，容器一启动就 SIGSEGV。
# 构建阶段就把这条卡住，不让坏镜像流出去。
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.prepare('select 1').get();db.close();console.log('better-sqlite3 OK | node', process.versions.node, '| N-API', process.versions.napi)"

# ---------------------------------------------------------------- 运行阶段
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai

# 运行期只需要 ca-certificates（下载动作图）和 tzdata（时区）
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data

COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
COPY assets ./assets
# 动作库种子数据（首次启动导入 1285 个动作）
COPY data/exercises.json ./data/exercises.json

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
