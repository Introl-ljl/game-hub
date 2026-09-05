# 项目说明（AGENTS.md）

每日游戏中心：由 timetest（每日秒感，`/seconds/`）与 schulte-grid（每日方格，`/schulte/`）合并。`/` 为游戏导航页。统一用户系统：两个游戏共用 `users` / `sessions` / `auth_events` 表与 `gamehub_session` 会话 cookie（兼容读取旧 `timesense_session` / `schulte_session`）。

## 技术栈

- 前端：原生 HTML/CSS/JS，无框架无打包。`public/index.html` 导航页、`public/seconds/`、`public/schulte/` 各自独立，资产引用全部使用相对路径。
- 后端：`backend/server.mjs`，Node 原生 http，路由按路径名注册到模块（`module[METHOD]`）。
- 数据库：PostgreSQL 16（Docker Compose 服务 `postgres`），驱动 `postgres`，迁移 `db/*.sql` 按文件名顺序执行，启动时自动跑 `scripts/migrate.mjs`。
- 静态层：`server.js`（零依赖）—— 托管三个页面并把 `/api/*` 反代到后端，`/api/health` 改写到 `/healthz`。
- Vercel：`api/**/*.mjs` 是薄代理，环境变量 `BACKEND_ORIGIN` + `BACKEND_PROXY_SECRET`；`trailingSlash: true` 保证 `/seconds/` 相对资产可用。

## 路由约定

- 共享用户系统：`/api/users`（注册）、`/api/session`（GET/POST/DELETE）。
- 玩法接口必须带游戏命名空间：`/api/seconds/*` 与 `/api/schulte/*`，两侧代码互不引用（`backend/seconds/`、`backend/schulte/`），共享逻辑放 `backend/lib/`。
- 代理密钥 header：`x-gamehub-proxy-secret`；客户端 IP header：`x-gamehub-client-ip`。

## 常用命令

- `npm run build`：生成 `public/schulte/data/daily-levels.json`（`LEVEL_START_DATE`、`LEVEL_DAYS` 可覆盖）。
- `npm run db:migrate`：执行迁移。
- `HUB_BASE=http://127.0.0.1:4173 npm test`：端到端冒烟测试（注册/登录/两个游戏 start→finish→排行榜/登出/未登录 401）。
- `docker compose up -d --build`：生产 API + PostgreSQL（API 绑定 `192.168.1.104:3050`）。
- `npm start`：静态层，`PORT` 默认 4173。

## 关键约定

- 两游戏设计语言一致：纸色 `--background: #fbf8f1` + 墨线 `--line` + 硬偏移阴影 `4px 4px 0` + Rajdhani 字体；导航页 `public/hub.css` 沿用同一套变量，深色模式跟随任一游戏的本地设置。
- 两游戏 localStorage key 不同（`time-sense-v1` / `schulte-daily-v2`），同源共存无冲突，勿混用。
- 每日方格 SW 缓存名 `schulte-daily-v27` 与 `index.html` 的 `?v=27` 需同步升版；改动秒感/方格静态资源时也相应升 `?v=`。
- 榜单口径：秒感每日榜按总偏差 total_ms（含复战，可开关），自由榜按平均偏差 average_ms；方格每日/复战按 total_ms + 错误数。榜单 Top 20，基准线（today/overall fastest、median）动态计算，不持久化。
- PostgreSQL 不映射宿主机端口；`PROXY_SECRET` 缺失时后端拒绝启动。
- 数据导入：`scripts/import-timesense.mjs` 读 `import/db.json`（原 timetest JSON 存储），保留原用户 UUID 与旧会话 token；同名同 PIN 合并、同名异 PIN 加「·秒感」后缀。方格数据用 pg_dump 直迁（表结构一致）。
- 原两项目目录（`../timetest`、`../schulte-grid`）保留未动，待新项目上线验证后再下线。
- 字体自托管：Rajdhani（500/600/700，latin 子集，来自 @fontsource/rajdhani）放在 `public/fonts/`，三个页面统一引用 `/fonts/fonts.css`。不得改回 fonts.googleapis.com——大陆网络不稳定，加载失败会让整站回退系统字体、布局走样。方格 SW（v28）已把字体文件加入预缓存。

- 游戏内返回导航：两个游戏顶栏字标（每日秒感/每日方格 Logo）`href="/"` 指向导航页（合并时新增，无 `data-action`）；游戏内部视图的返回仍靠各自的按钮（排行榜 ← = 游戏首页、结算页"返回首页"）。顶栏不要再加按钮——390px 宽度下会挤压换行破坏原布局。
