import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { closeSql, getSql } from './lib/db.mjs';
import { migrate } from '../scripts/migrate.mjs';
import * as users from './routes/users.mjs';
import * as session from './routes/session.mjs';
import * as secondsLeaderboard from './seconds/routes/leaderboard.mjs';
import * as secondsRunsStart from './seconds/routes/runs-start.mjs';
import * as secondsRunsFinish from './seconds/routes/runs-finish.mjs';
import * as schulteLeaderboard from './schulte/routes/leaderboard.mjs';
import * as schulteRunsStart from './schulte/routes/runs-start.mjs';
import * as schulteRunsFinish from './schulte/routes/runs-finish.mjs';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || 'https://games.introl.me';
// 共享用户系统 + 两个游戏各自的玩法接口（/api/seconds/* 每日秒感，/api/schulte/* 每日方格）
const routes = new Map([
  ['/api/users', users],
  ['/api/session', session],
  ['/api/seconds/leaderboard', secondsLeaderboard],
  ['/api/seconds/runs/start', secondsRunsStart],
  ['/api/seconds/runs/finish', secondsRunsFinish],
  ['/api/schulte/leaderboard', schulteLeaderboard],
  ['/api/schulte/runs/start', schulteRunsStart],
  ['/api/schulte/runs/finish', schulteRunsFinish]
]);
// 兼容旧前端（game.introl.me / time-sense-ten.vercel.app）的无命名空间路径：
// 按隧道转发来的 Host 头路由到对应游戏（timetest.introl.me → 秒感，其余 → 方格）
const legacyPaths = ['/api/runs/start', '/api/runs/finish', '/api/leaderboard'];
function resolveLegacyRoute(pathname, host) {
  if (!legacyPaths.includes(pathname)) return null;
  const isTimetest = String(host || '').toLowerCase().includes('timetest');
  return {
    '/api/runs/start': isTimetest ? secondsRunsStart : schulteRunsStart,
    '/api/runs/finish': isTimetest ? secondsRunsFinish : schulteRunsFinish,
    '/api/leaderboard': isTimetest ? secondsLeaderboard : schulteLeaderboard
  }[pathname];
}

if (!process.env.PROXY_SECRET) throw new Error('PROXY_SECRET is not configured');
await migrate();

const server = createServer(async (incoming, outgoing) => {
  const startedAt = Date.now();
  const url = new URL(incoming.url || '/', PUBLIC_BACKEND_URL);
  try {
    if (url.pathname === '/healthz' && incoming.method === 'GET') {
      await getSql()`SELECT 1 AS healthy`;
      return send(outgoing, Response.json({ ok: true, service: 'game-hub-api' }, { headers: { 'Cache-Control': 'no-store' } }), startedAt, incoming.method, url.pathname);
    }
    // Vercel 项目 trailingSlash:true 会把 /api/x 补成 /api/x/ 再进函数，这里统一剥掉再匹配
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const route = routes.get(pathname) || resolveLegacyRoute(pathname, incoming.headers.host);
    const handler = route?.[incoming.method || ''];
    if (!handler) {
      const status = route ? 405 : 404;
      return send(outgoing, Response.json({ error: status === 405 ? '请求方法不支持' : '接口不存在' }, { status }), startedAt, incoming.method, pathname);
    }
    if (!validProxySecret(incoming.headers)) {
      return send(outgoing, Response.json({ error: 'Unauthorized', code: 'INVALID_PROXY' }, { status: 401 }), startedAt, incoming.method, url.pathname);
    }
    const body = ['GET', 'HEAD'].includes(incoming.method || '') ? undefined : await readBody(incoming);
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body
    });
    const response = await handler(request);
    return send(outgoing, response, startedAt, incoming.method, url.pathname);
  } catch (error) {
    console.error('Backend request failed', { method: incoming.method, path: url.pathname, error });
    return send(outgoing, Response.json({ error: '服务器暂时不可用', code: 'INTERNAL_ERROR' }, { status: 500 }), startedAt, incoming.method, url.pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game Hub API listening on 0.0.0.0:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    server.close();
    await closeSql();
    process.exit(0);
  });
}

function validProxySecret(headers) {
  // 新枢纽密钥 + 两个旧项目的密钥（旧 Vercel Functions 仍在用各自的头与密钥）
  const candidates = [
    [headers['x-gamehub-proxy-secret'], process.env.PROXY_SECRET],
    [headers['x-schulte-proxy-secret'], process.env.SCHULTE_LEGACY_PROXY_SECRET],
    [headers['x-timesense-proxy-secret'], process.env.TIMETEST_LEGACY_PROXY_SECRET]
  ];
  return candidates.some(([value, expected]) => {
    if (typeof value !== 'string' || typeof expected !== 'string' || !expected) return false;
    const actual = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  });
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function send(outgoing, response, startedAt, method, path) {
  outgoing.statusCode = response.status;
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== 'set-cookie') outgoing.setHeader(name, value);
  }
  if (setCookies.length) outgoing.setHeader('Set-Cookie', setCookies);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
  if (path !== '/healthz') console.log(JSON.stringify({ method, path, status: response.status, durationMs: Date.now() - startedAt }));
}
