// game-hub 端到端冒烟测试：需要一个正在运行的静态层（含 /api 代理）。
// 用法：HUB_BASE=http://127.0.0.1:4111 node scripts/test-hub.mjs
import { createHash } from 'node:crypto';

const BASE = process.env.HUB_BASE || 'http://127.0.0.1:4111';
let cookie = '';
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok - ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL - ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (cookie && !options.noCookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const item of setCookie) {
    const [pair] = item.split(';');
    const [name, value] = pair.split('=');
    if (value === '' || /Max-Age=0/.test(item)) {
      if (cookie.includes(`${name}=`)) cookie = cookie.split('; ').filter((part) => !part.startsWith(`${name}=`)).join('; ');
    } else {
      cookie = cookie ? `${cookie.split('; ').filter((part) => !part.startsWith(`${name}=`)).join('; ')}; ${pair}` : pair;
    }
  }
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function todayShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const username = `冒烟${Date.now() % 100000}`;

console.log('== 健康检查 ==');
{
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check('api/health 返回 ok', health.ok === true);
  const session = await request('/api/session');
  check('未登录 session 为空', session.status === 200 && session.payload.user === null);
}

console.log('== 注册与登录（共享用户系统） ==');
{
  const register = await request('/api/users', { method: 'POST', body: { username, pin: '2468' }, noCookie: true });
  check('注册成功 201', register.status === 201, JSON.stringify(register.payload));
  check('注册返回用户名', register.payload.user?.username === username);
  check('下发了统一会话 cookie', /gamehub_session=/.test(cookie));
  const me = await request('/api/session');
  check('注册后 session 生效', me.payload.user?.username === username);
  const wrongPin = await request('/api/session', { method: 'POST', body: { username, pin: '0000' }, noCookie: true });
  check('错误 PIN 返回 401', wrongPin.status === 401 && wrongPin.payload.code === 'WRONG_CREDENTIALS');
}

console.log('== 每日秒感：开始 → 提交 → 排行榜 ==');
{
  const start = await request('/api/seconds/runs/start', {
    method: 'POST',
    body: { mode: 'daily', targets: [3, 5, 10], roundsPerTarget: 3 }
  });
  check('runs/start 成功', start.status === 200 && Boolean(start.payload.runId), JSON.stringify(start.payload));
  const stages = [3, 5, 10].map((target) => ({
    target,
    rounds: [1, 2, 3].map((round) => ({ actualMs: target * 1000 + 100 * round }))
  }));
  const finish = await request('/api/seconds/runs/finish', { method: 'POST', body: { runId: start.payload.runId, stages } });
  check('runs/finish 记录成绩', finish.status === 200 && finish.payload.recorded === true, JSON.stringify(finish.payload));
  check('返回名次与评级', Number.isInteger(finish.payload.ranking?.rank) && Boolean(finish.payload.ranking?.totalTier));
  check('返回今日榜单', finish.payload.leaderboard?.entries?.some((entry) => entry.isMe));
  const board = await request('/api/seconds/leaderboard?mode=daily&timeframe=today');
  check('秒感今日榜包含我的成绩', board.payload.entries?.some((entry) => entry.username === username));
  check('参与人数 ≥ 1', (board.payload.participantCount || 0) >= 1);
  const customBoard = await request('/api/seconds/leaderboard?mode=custom&target=5&timeframe=all');
  check('秒感自由榜可查询', customBoard.status === 200 && Array.isArray(customBoard.payload.entries));
  const replay = await request('/api/seconds/runs/finish', { method: 'POST', body: { runId: start.payload.runId, stages } });
  check('重复提交返回 409', replay.status === 409);
}

console.log('== 每日方格：开始 → 提交 → 排行榜 ==');
{
  const date = todayShanghai().replaceAll('-', '');
  const start = await request('/api/schulte/runs/start', {
    method: 'POST',
    body: { mode: 'daily', levelId: date, rulesVersion: 3 }
  });
  check('runs/start 成功', start.status === 201 && Boolean(start.payload.runId), JSON.stringify(start.payload));
  const stages = [
    { type: 'classic', size: 3, durationMs: 1230, errors: 0 },
    { type: 'classic', size: 4, durationMs: 2230, errors: 1 },
    { type: 'classic', size: 5, durationMs: 3230, errors: 0 },
    { type: 'fifty', size: 5, durationMs: 5230, errors: 2 }
  ];
  const finish = await request('/api/schulte/runs/finish', {
    method: 'POST',
    body: { runId: start.payload.runId, stages, totalMs: stages.reduce((sum, stage) => sum + stage.durationMs, 0), totalErrors: 3 }
  });
  check('runs/finish 记录成绩', finish.status === 200 && finish.payload.recorded === true, JSON.stringify(finish.payload));
  check('返回今日榜单', finish.payload.leaderboard?.entries?.some((entry) => entry.isMe));
  const board = await request('/api/schulte/leaderboard?mode=daily&timeframe=today');
  check('方格今日榜包含我的成绩', board.payload.entries?.some((entry) => entry.username === username));
  const wrongLevel = await request('/api/schulte/runs/start', {
    method: 'POST',
    body: { mode: 'daily', levelId: '19990101', rulesVersion: 3 }
  });
  check('旧关卡拒绝开始', wrongLevel.status === 409 && wrongLevel.payload.code === 'STALE_DAILY_LEVEL');
}

console.log('== 会话互通 ==');
{
  const schulteBoard = await request('/api/schulte/leaderboard?mode=daily&timeframe=today');
  check('同一会话可访问两个游戏接口', schulteBoard.status === 200 && schulteBoard.payload.entries.some((entry) => entry.username === username));
  const logout = await request('/api/session', { method: 'DELETE' });
  check('退出登录', logout.status === 200);
  const me = await request('/api/session');
  check('退出后 session 清空', me.payload.user === null);
}

console.log('== 未登录访问受保护接口 ==');
{
  const start = await request('/api/seconds/runs/start', { method: 'POST', body: { mode: 'daily', targets: [3, 5, 10], roundsPerTarget: 3 }, noCookie: true });
  check('未登录开始挑战返回 401', start.status === 401 && start.payload.code === 'AUTH_REQUIRED');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
