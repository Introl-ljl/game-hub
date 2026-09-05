import { randomUUID } from 'node:crypto';
import { requireUser } from '../../lib/auth.mjs';
import { getSql } from '../../lib/db.mjs';
import { assertSameOrigin, errorResponse, HttpError, json, readJson } from '../../lib/http.mjs';
import { computeScore, validateFinishStages } from '../score.mjs';
import { getBoard, tierFor, todayRank } from '../board.mjs';
import { shanghaiDate } from '../../lib/time.mjs';

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson(request);
    const runId = String(body.runId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) throw new HttpError(404, 'RUN_NOT_FOUND', '没有找到对应的挑战记录');
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM ts_runs
      WHERE id = ${runId} AND user_id = ${user.id}
      LIMIT 1
    `;
    if (!rows.length) throw new HttpError(404, 'RUN_NOT_FOUND', '没有找到对应的挑战记录');
    const run = rows[0];
    if (run.finished_at) throw new HttpError(409, 'ALREADY_FINISHED', '该挑战已经提交过成绩');
    const ageLimit = run.mode === 'custom' ? 6 * 3600000 : 26 * 3600000;
    if (Date.now() - new Date(run.started_at).getTime() > ageLimit) throw new HttpError(409, 'STALE_RUN', '挑战已超时，成绩无效');
    if (run.mode !== 'custom' && dateOrNull(run.run_date) !== shanghaiDate()) {
      throw new HttpError(409, 'STALE_DAILY_LEVEL', '每日挑战已更新，今天的成绩请在今天的挑战中提交');
    }
    const runShape = { mode: run.mode, targets: run.targets, roundsPerTarget: run.rounds_per_target };
    validateFinishStages(runShape, body.stages || []);
    const computed = computeScore(runShape, body.stages);

    const scoreId = randomUUID();
    const inserted = await sql.begin(async (transaction) => {
      const finished = await transaction`
        UPDATE ts_runs SET finished_at = now()
        WHERE id = ${runId} AND user_id = ${user.id} AND finished_at IS NULL
        RETURNING id
      `;
      if (!finished.length) return [];
      return transaction`
        INSERT INTO ts_scores (
          id, run_id, user_id, mode, target, score_date,
          total_ms, average_ms, best_ms, rounds_count, stages, completed_at
        ) VALUES (
          ${scoreId}, ${runId}, ${user.id}, ${run.mode}, ${run.mode === 'custom' ? run.targets[0] : null}, ${run.run_date},
          ${computed.totalMs}, ${computed.averageMs}, ${computed.bestMs}, ${computed.roundsCount},
          ${transaction.json(computed.stages)}, now()
        ) RETURNING id
      `;
    });
    if (!inserted.length) throw new HttpError(409, 'ALREADY_FINISHED', '该挑战已经提交过成绩');

    const board = run.mode === 'custom'
      ? await getBoard({ mode: 'custom', target: run.targets[0], timeframe: 'today', includeReplay: true, currentUserId: user.id })
      : await getBoard({ mode: 'daily', timeframe: 'today', includeReplay: true, currentUserId: user.id });
    const rank = await todayRank({
      mode: board.mode,
      target: board.mode === 'custom' ? run.targets[0] : null,
      totalMs: computed.totalMs,
      averageMs: computed.averageMs
    });
    const stageTiers = computed.stages.map((stage, index) => tierFor(stage.averageMs, board.benchmarks.stages[index] || null));
    const totalValue = board.mode === 'daily' ? computed.totalMs : computed.averageMs;
    return json({
      recorded: true,
      ranking: {
        scoreId,
        rank,
        totalTier: tierFor(totalValue, board.benchmarks.total),
        stageTiers
      },
      leaderboard: board
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function dateOrNull(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
