import { getSql } from '../lib/db.mjs';
import { HttpError } from '../lib/http.mjs';
import { shanghaiDate } from '../lib/time.mjs';

export const LEADERBOARD_LIMIT = 20;

// 排行榜口径与原每日秒感一致：
// daily 榜 = 当日挑战 + 复战（可开关），按总偏差 total_ms 升序；
// custom 榜 = 自由模式单一目标，按平均偏差 average_ms 升序。
export async function getBoard({ mode, target = null, timeframe = 'today', includeReplay = true, currentUserId = null }) {
  if (!['daily', 'custom'].includes(mode)) throw new HttpError(400, 'INVALID_MODE', '排行榜模式无效');
  if (!['today', 'all'].includes(timeframe)) throw new HttpError(400, 'INVALID_TIMEFRAME', '排行榜时间范围无效');
  if (mode === 'custom' && (!Number.isInteger(target) || target < 1 || target > 60)) {
    throw new HttpError(400, 'BAD_TARGET', '目标秒数不合法');
  }
  const today = shanghaiDate();
  const sql = getSql();
  const daily = mode === 'daily';
  const modeFilter = daily
    ? (includeReplay ? sql`s.mode IN ('daily', 'replay')` : sql`s.mode = 'daily'`)
    : sql`(s.mode = 'custom' AND s.target = ${target})`;
  const timeframeFilter = timeframe === 'today' ? sql` AND s.score_date = ${today}` : sql``;
  const valueExpr = daily ? sql`s.total_ms` : sql`s.average_ms`;

  const [entryRows, todayTotalRows, overallTotalRows, todayStageRows, overallStageRows, participantRows] = await Promise.all([
    sql`
      SELECT s.id, s.user_id, u.display_name AS username, s.mode, s.score_date,
        s.total_ms, s.average_ms, s.best_ms, s.rounds_count, s.stages, s.completed_at
      FROM ts_scores s
      JOIN users u ON u.id = s.user_id
      WHERE ${modeFilter}${timeframeFilter}
      ORDER BY ${valueExpr}, s.completed_at
      LIMIT ${LEADERBOARD_LIMIT}
    `,
    sql`
      SELECT min(${valueExpr})::double precision AS fastest, percentile_cont(0.5) WITHIN GROUP (ORDER BY ${valueExpr}) AS median
      FROM ts_scores s WHERE ${modeFilter} AND s.score_date = ${today}
    `,
    sql`SELECT min(${valueExpr})::double precision AS fastest FROM ts_scores s WHERE ${modeFilter}${timeframeFilter}`,
    daily
      ? sql`
        SELECT ordinality::int - 1 AS stage_index,
          min((stage->>'averageMs')::double precision) AS fastest,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY (stage->>'averageMs')::double precision) AS median
        FROM ts_scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE ${modeFilter} AND s.score_date = ${today}
        GROUP BY ordinality ORDER BY ordinality
      `
      : Promise.resolve([]),
    daily
      ? sql`
        SELECT ordinality::int - 1 AS stage_index, min((stage->>'averageMs')::double precision) AS fastest
        FROM ts_scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE ${modeFilter}${timeframeFilter}
        GROUP BY ordinality ORDER BY ordinality
      `
      : Promise.resolve([]),
    sql`SELECT count(DISTINCT s.user_id)::int AS total FROM ts_scores s WHERE ${modeFilter}${timeframeFilter}`
  ]);

  const benchmarks = {
    total: {
      todayFastestMs: numberOrNull(todayTotalRows[0]?.fastest),
      todayMedianMs: numberOrNull(todayTotalRows[0]?.median),
      overallFastestMs: numberOrNull(overallTotalRows[0]?.fastest)
    },
    stages: daily ? buildStageBenchmarks(todayStageRows, overallStageRows) : []
  };

  const entries = entryRows.map((row, index) => {
    const stages = Array.isArray(row.stages) ? row.stages : JSON.parse(row.stages || '[]');
    const value = daily ? Number(row.total_ms) : Number(row.average_ms);
    return {
      id: row.id,
      rank: index + 1,
      username: row.username,
      mode: row.mode,
      value,
      bestMs: Number(row.best_ms),
      rounds: Number(row.rounds_count),
      scoreDate: dateOrNull(row.score_date),
      isMe: Boolean(currentUserId && row.user_id === currentUserId),
      tier: tierFor(value, benchmarks.total),
      stages: stages.map((stage, stageIndex) => ({
        target: stage.target,
        value: Number(stage.averageMs),
        tier: tierFor(Number(stage.averageMs), benchmarks.stages[stageIndex])
      }))
    };
  });

  return {
    mode,
    target,
    timeframe,
    entries,
    benchmarks,
    participantCount: Number(participantRows[0]?.total || 0)
  };
}

// 与原实现一致：取完整“今日池”中严格更小的成绩数 + 1，并列时取最小名次
export async function todayRank({ mode, target = null, totalMs, averageMs }) {
  const sql = getSql();
  const daily = mode === 'daily';
  const modeFilter = daily
    ? sql`s.mode IN ('daily', 'replay')`
    : sql`(s.mode = 'custom' AND s.target = ${target})`;
  const valueExpr = daily ? sql`s.total_ms` : sql`s.average_ms`;
  const value = daily ? totalMs : averageMs;
  const [row] = await sql`
    SELECT count(*)::int AS smaller
    FROM ts_scores s
    WHERE ${modeFilter} AND s.score_date = ${shanghaiDate()} AND ${valueExpr} < ${value}
  `;
  return Number(row?.smaller || 0) + 1;
}

export function tierFor(value, benchmark) {
  if (value == null || !benchmark) return 'normal';
  if (benchmark.overallFastestMs != null && value <= benchmark.overallFastestMs) return 'overall-fastest';
  if (benchmark.todayFastestMs != null && value <= benchmark.todayFastestMs) return 'today-fastest';
  if (benchmark.todayMedianMs != null && value > benchmark.todayMedianMs * 1.1) return 'slower';
  return 'normal';
}

function buildStageBenchmarks(todayRows, overallRows) {
  const stageIndexes = [...new Set([...todayRows, ...overallRows].map((row) => Number(row.stage_index)))].sort((a, b) => a - b);
  return stageIndexes.map((stageIndex) => {
    const todayStage = todayRows.find((row) => Number(row.stage_index) === stageIndex);
    const overallStage = overallRows.find((row) => Number(row.stage_index) === stageIndex);
    return {
      todayFastestMs: numberOrNull(todayStage?.fastest),
      todayMedianMs: numberOrNull(todayStage?.median),
      overallFastestMs: numberOrNull(overallStage?.fastest)
    };
  });
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function dateOrNull(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
