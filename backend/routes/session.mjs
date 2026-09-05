import {
  createSession,
  currentUser,
  deleteSession,
  enforceLoginRateLimit,
  recordAuthEvent,
  requestIpHash,
  normalizeUsername,
  usernameKey,
  validatePin,
  verifyPin
} from '../lib/auth.mjs';
import { getSql } from '../lib/db.mjs';
import { assertSameOrigin, errorResponse, HttpError, json, readJson } from '../lib/http.mjs';

export async function GET(request) {
  try {
    return json({ user: await currentUser(request) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const pin = validatePin(body.pin);
    const ipHash = requestIpHash(request);
    const rows = await getSql()`
      SELECT id, display_name, pin_salt, pin_hash
      FROM users
      WHERE name_key = ${usernameKey(username)}
      LIMIT 1
    `;
    await enforceLoginRateLimit(ipHash, rows[0]?.id || null);
    const valid = rows.length && await verifyPin(pin, rows[0].pin_salt, rows[0].pin_hash);
    await recordAuthEvent('login', ipHash, rows[0]?.id || null, Boolean(valid));
    if (!valid) throw new HttpError(401, 'WRONG_CREDENTIALS', '用户名或 PIN 不正确');
    const cookie = await createSession(request, rows[0].id);
    return json({ user: { id: rows[0].id, username: rows[0].display_name } }, 200, { 'Set-Cookie': cookie });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  try {
    assertSameOrigin(request);
    const cookie = await deleteSession(request);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  } catch (error) {
    return errorResponse(error);
  }
}
