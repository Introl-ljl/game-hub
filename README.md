# 每日游戏 · Game Hub

由 `timetest`（每日秒感）与 `schulte-grid`（每日方格）合并而成的单项目小游戏中心：

- **`/`** —— 游戏导航页（显示两个游戏的今日参与人数、实时北京时间时钟、统一账号登录入口）
- **`/seconds/`** —— 每日秒感：默数 3s / 5s / 10s，考验时间直觉
- **`/schulte/`** —— 每日方格：3×3 → 1-50 每日四关 + 无限模式
- **统一用户系统**：两个游戏共用 `users` / `sessions` / `auth_events` 表和同一个 `gamehub_session` 会话 cookie，注册一次、两个游戏都能上榜。旧的 `timesense_session` / `schulte_session` cookie 在导入旧会话后依然有效，老用户不会被登出。

## 技术栈与结构

原生 HTML/CSS/JS 前端（无框架无打包），Node 原生 `http` 后端 + PostgreSQL 16（驱动 `postgres`），零框架依赖。

```
server.js               # 静态层：/ 导航页、/seconds/、/schulte/ 两游戏静态资源，/api/* 反代到后端
backend/
  server.mjs            # 统一 API：共享路由 + 每游戏命名空间路由
  lib/                  # db / http / auth（统一会话）/ time
  routes/               # 共享用户系统：/api/users、/api/session
  seconds/              # 每日秒感：成绩校验、排行榜（SQL 版）、runs/leaderboard 路由
  schulte/              # 每日方格：成绩校验、排行榜、runs/leaderboard 路由（逻辑同原项目）
public/
  index.html + hub.*    # 导航页
  seconds/              # 每日秒感前端（原 timetest/public）
  schulte/              # 每日方格前端（原 schulte-grid/public，含每日关卡与 sw.js）
api/                    # Vercel Functions 薄代理（与 server.js 同一套 PROXY_SECRET）
db/001_initial.sql      # 统一数据库 schema
scripts/
  migrate.mjs           # 建表迁移（后端启动时也会自动执行）
  import-timesense.mjs  # 原 timetest JSON 存储导入脚本
  generate-levels.js    # 每日方格关卡生成（输出 public/schulte/data/daily-levels.json）
  test-hub.mjs          # 端到端冒烟测试（需先起服务）
```

API 路由约定：

| 路由 | 说明 |
| --- | --- |
| `GET/POST/DELETE /api/session` | 登录 / 查询 / 退出（两游戏共用） |
| `POST /api/users` | 注册（两游戏共用） |
| `GET /api/seconds/leaderboard`、`POST /api/seconds/runs/start|finish` | 每日秒感 |
| `GET /api/schulte/leaderboard`、`POST /api/schulte/runs/start|finish` | 每日方格 |
| `GET /api/health`（本地代理改写到 `/healthz`） | 健康检查 |

## 本地开发

```bash
npm install
# 起一个本地 Postgres（或直接用 docker compose 里的）
docker run -d --name gamehub-pg -e POSTGRES_USER=gamehub -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=gamehub -p 127.0.0.1:5432:5432 postgres:16-alpine

DATABASE_URL=postgresql://gamehub:dev@127.0.0.1:5432/gamehub AUTH_PEPPER=dev PROXY_SECRET=dev node backend/server.mjs   # API :3000
PORT=4173 BACKEND_ORIGIN=http://127.0.0.1:3000 PROXY_SECRET=dev npm start                                              # 静态层 :4173
npm run generate      # 生成每日方格关卡（build 也会自动执行）
HUB_BASE=http://127.0.0.1:4173 npm test   # 端到端冒烟测试
```

打开 `http://localhost:4173`。

## 生产部署（本机 192.168.1.104，已上线）

当前生产架构（复用舒尔特同款模式）：

| 组件 | 地址 | 说明 |
| --- | --- | --- |
| PostgreSQL | `gamehub-postgres` 容器（内网） | 不映射宿主机端口 |
| API | `192.168.1.104:3030` + `:3040` | `gamehub-api` 容器，**复用原两项目的端口**，已有隧道路由无需改动 |
| 静态层 | `192.168.1.104:4173` | `gamehub-web` 容器（导航页 + 双游戏 + `/api` 反代） |
| 公网主站 | `https://games.introl.me` | Vercel 项目 `game-hub`（DNS only CNAME → cname.vercel-dns.com） |
| 旧域名兼容 | `schulte.introl.me` / `timetest.introl.me` | 隧道原路由不变，直接打在新 API 上 |

### 旧域名/旧前端兼容（重要）

原 schulte 与 timetest 的 Vercel 前端仍在运行，它们的函数以旧密钥头（`x-schulte-proxy-secret` / `x-timesense-proxy-secret`）调用**无命名空间的旧路径**（`/api/runs/*`、`/api/leaderboard`）。新后端做了三层兼容（见 `backend/server.mjs`）：

1. 旧路径按隧道转发的 **Host 头**路由：`timetest.introl.me` → 秒感路由，其余 → 方格路由；
2. `validProxySecret` 同时接受新旧三个密钥头（旧密钥通过 `SCHULTE_LEGACY_PROXY_SECRET` / `TIMETEST_LEGACY_PROXY_SECRET` 注入）；
3. 客户端 IP 头兼容 `x-schulte-client-ip` / `x-timesense-client-ip`。

旧前端的登录用户凭已迁移的会话 token 无缝保持登录，新成绩写入统一数据库。

常用运维：

1. 更新/重建：`docker compose up -d --build`（改后端后必须重建）。
2. 健康检查：`curl http://192.168.1.104:3050/healthz`、`curl http://192.168.1.104:4173/api/health`。
3. 局域网访问：`http://192.168.1.104:4173`（导航页 + 双游戏）。
4. `PUBLIC_ORIGINS`（`.env.backend`）已含局域网 4173 与 `games.introl.me`，新增前端来源时需同步。

> Cloudflare Tunnel 为云端托管配置（Zero Trust 控制台管理），本次未新增任何隧道路由：新 API 直接复用 `schulte.introl.me`（:3030）与 `timetest.introl.me`（:3040）两条既有路由。

## 数据迁移（已完成：舒尔特数据已于 2026-09-05 直迁，秒感无历史数据）

迁移后旧容器 `schulte-api` / `time-sense-api` / `schulte-postgres` 已停止（未删除，数据卷保留可回滚）。

### 每日方格（schulte-grid，原 PostgreSQL）

`users` / `sessions` / `auth_events` / `game_runs` / `scores` 表结构完全一致，直接 pg_dump 管道迁移：

```bash
pg_dump -h 127.0.0.1 -U schulte -d schulte --data-only \
  -t users -t sessions -t auth_events -t game_runs -t scores \
  | psql "postgresql://gamehub:...@127.0.0.1:5432/gamehub"
```

（用户、会话、全部成绩原样进入新库；重复执行前先清空对应表。）

### 每日秒感（timetest，原 JSON 存储）

```bash
docker cp time-sense-api:/app/data/db.json ./import/db.json
TIMETENSE_DB_JSON=./import/db.json node scripts/import-timesense.mjs
```

导入规则：

- 用户保留原 UUID（浏览器本地成绩记录按用户 ID 存放，老用户本地历史无缝衔接）；
- 与现有账号同名且 PIN 哈希一致 → 合并为同一账号，秒感成绩归入现有账号；
- 同名但 PIN 不同 → 导出为独立账号，显示名追加「·秒感」后缀；
- 旧会话一并导入，已登录用户无需重新登录（旧 cookie 名仍被识别）。

### 两边都迁移后的效果

一套账号可登录两个游戏；两侧排行榜历史完整保留；在任一游戏中注册/登录，导航页与另一个游戏即刻同步登录态。

## 与原项目的差异备忘

- 会话 cookie 统一为 `gamehub_session`（`timesense_session` / `schulte_session` 作为兼容读取，最长 30 天自然过期）。
- 玩法接口按游戏命名空间：`/api/seconds/*`、`/api/schulte/*`；用户系统接口保持 `/api/users`、`/api/session` 不变。
- 每日秒感排行榜从 JSON 文件存储改为 PostgreSQL（口径与原实现一致：每日榜按总偏差、自由榜按平均偏差，含今日/整体基准线）。
- 每日方格关卡生成输出路径变为 `public/schulte/data/`，缓存版本号 `?v=28`、SW 缓存 `schulte-daily-v28`（SW 预缓存清单需与页面 `?v=` 保持一致）。
- Rajdhani 字体为本地自托管（`public/fonts/`），所有页面通过 `/fonts/fonts.css` 引用，不依赖 Google Fonts。
- 每日秒感前端无 Service Worker；每日方格 SW 作用域为 `/schulte/`，不影响其他页面。
