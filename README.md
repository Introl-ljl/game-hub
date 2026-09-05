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

## 生产部署（本机 192.168.1.104）

1. **数据库 + API**：`docker compose up -d --build`，API 绑定 `192.168.1.104:3050`（PostgreSQL 不映射宿主机端口）。`.env.backend` 里的 `PUBLIC_ORIGINS` 改成实际对外域名。
2. **静态层**：`PORT=4173 npm start`（读取 `.env.backend` 里的 `BACKEND_ORIGIN` / `PROXY_SECRET`）。
3. **Cloudflare Tunnel**：把一个域名（例如 `games.introl.me`）指到 `192.168.1.104:4173`；旧的 `schulte.introl.me` / `timetest.introl.me` 建议改为 301 到新域名对应路径（或先并存一段时间）。
4. **Vercel（可选，作为公网前端）**：项目 `vercel dev` / 关联仓库即可；Vercel 环境变量需要 `BACKEND_ORIGIN` 与 `BACKEND_PROXY_SECRET`（值与 `.env.backend` 中一致）。
5. 修改后端后重建：`docker compose up -d --build api`，验证 `curl http://192.168.1.104:3050/healthz`。

## 数据迁移

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
