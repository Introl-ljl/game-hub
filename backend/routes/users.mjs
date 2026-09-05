import { randomUUID } from 'node:crypto';
import {
  createPinHash,
  createSession,
  enforceCreateRateLimit,
  normalizeUsername,
  recordAuthEvent,
  requestIpHash,
  usernameKey,
  validatePin
} from '../lib/auth.mjs';
import { getSql } from '../lib/db.mjs';
import { assertSameOrigin, errorResponse, HttpError, json, readJson } from '../lib/http.mjs';

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const pin = validatePin(body.pin);
    const ipHash = requestIpHash(request);
    await enforceCreateRateLimit(ipHash);
    await recordAuthEvent('create', ipHash, null, false);
    const { salt, hash } = await createPinHash(pin);
    const id = randomUUID();
    try {
      await getSql()`
        INSERT INTO users (id, display_name, name_key, pin_salt, pin_hash)
        VALUES (${id}, ${username}, ${usernameKey(username)}, ${salt}, ${hash})
      `;
    } catch (error) {
      if (error?.code === '23505') throw new HttpError(409, 'USERNAME_TAKEN', '该用户名已被注册');
      throw error;
    }
    const cookie = await createSession(request, id);
    return json({ user: { id, username } }, 201, { 'Set-Cookie': cookie });
  } catch (error) {
    return errorResponse(error);
  }
}
