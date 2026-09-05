import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSql } from './db.mjs';
import { HttpError } from './http.mjs';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'gamehub_session';
// 合并前两个游戏各自的会话 cookie，导入旧会话后继续有效，避免已登录用户被登出
const LEGACY_COOKIE_NAMES = ['schulte_session', 'timesense_session'];
const SESSION_DAYS = 30;

export function normalizeUsername(value) {
  const username = String(value || '').normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(username)) {
    throw new HttpError(400, 'INVALID_USERNAME', '用户名需为 2 到 20 个中文、字母、数字、下划线或连字符');
  }
  return username;
}

export function usernameKey(username) {
  return username.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

export function validatePin(value) {
  const pin = String(value || '');
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'INVALID_PIN', 'PIN 必须是 4 位数字');
  return pin;
}

export async function createPinHash(pin, salt = randomBytes(16).toString('base64url')) {
  const derived = await scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash: Buffer.from(derived).toString('base64url') };
}

export async function verifyPin(pin, salt, expectedHash) {
  const { hash } = await createPinHash(pin, salt);
  const actual = Buffer.from(hash, 'base64url');
  const expected = Buffer.from(expectedHash, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  return user;
}

export async function currentUser(request) {
  const token = readSessionToken(request.headers.get('cookie') || '');
  if (!token) return null;
  const sql = getSql();
  const tokenHash = sha256(token);
  const rows = await sql`
    SELECT u.id, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { id: rows[0].id, username: rows[0].display_name };
}

export async function createSession(request, userId) {
  const sql = getSql();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await sql`DELETE FROM sessions WHERE expires_at <= now()`;
  await sql`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (${randomUUID()}, ${userId}, ${tokenHash}, ${expiresAt.toISOString()})
  `;
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

export async function deleteSession(request) {
  const token = readSessionToken(request.headers.get('cookie') || '');
  if (token) await getSql()`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  return sessionCookie(request, '', 0);
}

export function requestIpHash(request) {
  const pepper = process.env.AUTH_PEPPER;
  if (!pepper) throw new Error('AUTH_PEPPER is not configured');
  const trustedClientIp = request.headers.get('x-gamehub-client-ip')
    || request.headers.get('x-schulte-client-ip')
    || request.headers.get('x-timesense-client-ip');
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = trustedClientIp || forwarded || request.headers.get('x-real-ip') || 'unknown';
  return sha256(`${pepper}:${ip}`);
}

export async function enforceLoginRateLimit(ipHash, userId) {
  const sql = getSql();
  const [[ipRow], userRows] = await Promise.all([
    sql`
      SELECT count(*) FILTER (WHERE success = false)::int AS failures
      FROM auth_events
      WHERE event_type = 'login'
        AND ip_hash = ${ipHash}
        AND created_at > now() - interval '15 minutes'
    `,
    userId
      ? sql`
        SELECT count(*) FILTER (WHERE success = false)::int AS failures
        FROM auth_events
        WHERE event_type = 'login'
          AND ip_hash = ${ipHash}
          AND user_id = ${userId}
          AND created_at > now() - interval '15 minutes'
      `
      : Promise.resolve([{ failures: 0 }])
  ]);
  if ((userRows[0]?.failures || 0) >= 5 || (ipRow?.failures || 0) >= 25) {
    throw new HttpError(429, 'PIN_LOCKED', '登录尝试次数过多，请 15 分钟后再试');
  }
}

export async function enforceCreateRateLimit(ipHash) {
  const [row] = await getSql()`
    SELECT count(*)::int AS attempts
    FROM auth_events
    WHERE event_type = 'create' AND ip_hash = ${ipHash} AND created_at > now() - interval '1 hour'
  `;
  if ((row?.attempts || 0) >= 5) throw new HttpError(429, 'CREATE_LIMIT', '注册过于频繁，请稍后再试');
}

export async function recordAuthEvent(eventType, ipHash, userId, success) {
  const sql = getSql();
  await sql`
    INSERT INTO auth_events (event_type, ip_hash, user_id, success)
    VALUES (${eventType}, ${ipHash}, ${userId || null}, ${success})
  `;
  if (success && eventType === 'login') {
    await sql`
      DELETE FROM auth_events
      WHERE event_type = 'login' AND ip_hash = ${ipHash} AND user_id = ${userId} AND success = false
    `;
  }
  await sql`DELETE FROM auth_events WHERE created_at < now() - interval '24 hours'`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readSessionToken(header) {
  const names = [COOKIE_NAME, ...LEGACY_COOKIE_NAMES];
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (names.includes(key) && value.length) return decodeURIComponent(value.join('='));
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
