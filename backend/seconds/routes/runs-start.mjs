import { randomUUID } from 'node:crypto';
import { requireUser } from '../../lib/auth.mjs';
import { getSql } from '../../lib/db.mjs';
import { assertSameOrigin, errorResponse, json, readJson } from '../../lib/http.mjs';
import { validateStartShape } from '../score.mjs';
import { shanghaiDate } from '../../lib/time.mjs';

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson(request);
    const mode = ['daily', 'replay', 'custom'].includes(body.mode) ? body.mode : 'daily';
    const shape = validateStartShape(mode, body.targets, body.roundsPerTarget);
    const date = shanghaiDate();
    const id = randomUUID();
    await getSql()`
      INSERT INTO ts_runs (id, user_id, mode, targets, rounds_per_target, run_date)
      VALUES (${id}, ${user.id}, ${mode}, ${shape.targets}, ${shape.roundsPerTarget}, ${date})
    `;
    return json({ runId: id, date });
  } catch (error) {
    return errorResponse(error);
  }
}
