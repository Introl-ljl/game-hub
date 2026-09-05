import { randomUUID } from 'node:crypto';
import { requireUser } from '../../lib/auth.mjs';
import { getSql } from '../../lib/db.mjs';
import { assertSameOrigin, errorResponse, json, readJson } from '../../lib/http.mjs';
import { validateRunStart } from '../scores.mjs';
import { shanghaiDate } from '../../lib/time.mjs';

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const date = shanghaiDate();
    const run = validateRunStart(await readJson(request), date);
    const sql = getSql();
    const id = randomUUID();
    await sql`
      INSERT INTO game_runs (id, user_id, mode, grid_size, run_date, level_id, rules_version)
      VALUES (${id}, ${user.id}, ${run.mode}, ${run.gridSize}, ${date}, ${run.levelId}, ${run.rulesVersion})
    `;
    return json({ runId: id, date }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
