import { randomUUID } from 'node:crypto';
import { requireUser } from '../../lib/auth.mjs';
import { getSql } from '../../lib/db.mjs';
import { assertSameOrigin, errorResponse, HttpError, json, readJson } from '../../lib/http.mjs';
import { getLeaderboard, tierFor } from '../leaderboard.mjs';
import { validateScore } from '../scores.mjs';

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const body = await readJson(request);
    const runId = String(body.runId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) throw new HttpError(400, 'INVALID_RUN', '竞赛运行编号无效');
    const sql = getSql();
    const rows = await sql`
      SELECT r.*, s.id AS score_id, s.total_ms AS score_total_ms, s.stages AS score_stages
      FROM game_runs r LEFT JOIN scores s ON s.run_id = r.id
      WHERE r.id = ${runId} AND r.user_id = ${user.id}
      LIMIT 1
    `;
    if (!rows.length) throw new HttpError(404, 'RUN_NOT_FOUND', '找不到本次竞赛运行');
    const run = rows[0];
    if (run.score_id) {
      const boardMode = (run.mode === 'daily' || run.mode === 'replay') ? 'daily' : run.mode;
      const leaderboard = await getLeaderboard({ mode: boardMode, gridSize: run.grid_size, timeframe: 'today', includeReplay: true, userId: user.id });
      const ranked = leaderboard.entries.find((entry) => entry.id === run.score_id) || null;
      const stages = Array.isArray(run.score_stages) ? run.score_stages : JSON.parse(run.score_stages || '[]');
      return json({
        accepted: true,
        duplicate: true,
        recorded: true,
        leaderboard,
        ranking: {
          scoreId: run.score_id,
          rank: ranked?.rank || null,
          totalTier: tierFor(Number(run.score_total_ms), leaderboard.benchmarks.total),
          stageTiers: stages.map((stage, index) => tierFor(Number(stage.durationMs), leaderboard.benchmarks.stages[index]))
        }
      });
    }
    const score = validateScore(body, run);
    const scoreId = randomUUID();
    const inserted = await sql.begin(async (transaction) => {
      const finished = await transaction`
        UPDATE game_runs SET finished_at = now()
        WHERE id = ${runId} AND user_id = ${user.id} AND finished_at IS NULL
        RETURNING *
      `;
      if (!finished.length) return [];
      return transaction`
        INSERT INTO scores (
          id, run_id, user_id, mode, grid_size, score_date, level_id, rules_version,
          total_ms, total_errors, stages, completed_at
        ) VALUES (
          ${scoreId}, ${runId}, ${user.id}, ${run.mode}, ${run.grid_size}, ${run.run_date}, ${run.level_id}, ${run.rules_version},
          ${score.totalMs}, ${score.totalErrors}, ${transaction.json(score.stages)}, now()
        ) RETURNING id
      `;
    });
    if (!inserted.length) throw new HttpError(409, 'RUN_ALREADY_FINISHED', '本次竞赛运行已经结束');
    const boardMode = (run.mode === 'daily' || run.mode === 'replay') ? 'daily' : run.mode;
    const leaderboard = await getLeaderboard({ mode: boardMode, gridSize: run.grid_size, timeframe: 'today', includeReplay: true, userId: user.id });
    const ranked = leaderboard.entries.find((entry) => entry.id === scoreId) || null;
    return json({
      accepted: true,
      duplicate: false,
      recorded: true,
      leaderboard,
      ranking: {
        scoreId,
        rank: ranked?.rank || null,
        totalTier: tierFor(score.totalMs, leaderboard.benchmarks.total),
        stageTiers: score.stages.map((stage, index) => tierFor(stage.durationMs, leaderboard.benchmarks.stages[index]))
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
