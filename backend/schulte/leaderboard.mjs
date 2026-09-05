import { getSql } from '../lib/db.mjs';
import { HttpError } from '../lib/http.mjs';
import { shanghaiDate } from '../lib/time.mjs';

export const LEADERBOARD_LIMIT = 20;

export async function getLeaderboard({ mode, gridSize = null, timeframe = 'today', userId = null, includeReplay = false }) {
  if (!['daily', 'replay', 'easy', 'classic', 'fifty'].includes(mode)) throw new HttpError(400, 'INVALID_MODE', '排行榜玩法无效');
  if (!['today', 'all'].includes(timeframe)) throw new HttpError(400, 'INVALID_TIMEFRAME', '排行榜时间范围无效');
  const size = (mode === 'daily' || mode === 'replay') ? null : mode === 'fifty' ? 5 : Number(gridSize);
  if ((mode === 'easy' || mode === 'classic') && ![3, 4, 5, 6].includes(size)) {
    throw new HttpError(400, 'INVALID_SIZE', '排行榜方格规格无效');
  }
  const today = shanghaiDate();
  const sql = getSql();
  const dailyShaped = mode === 'daily' || mode === 'replay';
  const effectiveTimeframe = mode === 'replay' ? 'today' : timeframe;
  const merged = mode === 'daily' && includeReplay;
  const [entries, benchmarks, participantCount] = await Promise.all([
    dailyShaped ? dailyEntries(sql, mode, effectiveTimeframe, today, merged) : infiniteEntries(sql, mode, size, effectiveTimeframe, today),
    loadBenchmarks(sql, mode, size, today, merged),
    loadParticipantCount(sql, mode, size, effectiveTimeframe, today, merged)
  ]);
  return {
    mode,
    gridSize: size,
    timeframe: effectiveTimeframe,
    date: today,
    entries: entries.map((entry) => serializeEntry(entry, benchmarks, userId)),
    benchmarks,
    participantCount
  };
}

async function loadParticipantCount(sql, mode, size, timeframe, date, merged) {
  if (merged) {
    if (timeframe === 'today') {
      const [row] = await sql`SELECT count(*)::int AS total FROM scores WHERE mode IN ('daily', 'replay') AND score_date = ${date}`;
      return Number(row?.total || 0);
    }
    const [row] = await sql`SELECT count(*)::int AS total FROM scores WHERE mode IN ('daily', 'replay')`;
    return Number(row?.total || 0);
  }
  if (mode === 'replay' || (mode === 'daily' && timeframe === 'today')) {
    const [row] = await sql`SELECT count(*)::int AS total FROM scores WHERE mode = ${mode} AND score_date = ${date}`;
    return Number(row?.total || 0);
  }
  if (mode === 'daily') {
    const [row] = await sql`SELECT count(*)::int AS total FROM scores WHERE mode = 'daily'`;
    return Number(row?.total || 0);
  }
  if (timeframe === 'today') {
    const [row] = await sql`
      SELECT count(*)::int AS total FROM scores
      WHERE mode = ${mode} AND grid_size = ${size} AND score_date = ${date}
    `;
    return Number(row?.total || 0);
  }
  const [row] = await sql`
    SELECT count(*)::int AS total FROM scores
    WHERE mode = ${mode} AND grid_size = ${size}
  `;
  return Number(row?.total || 0);
}

async function dailyEntries(sql, mode, timeframe, date, merged) {
  if (merged) {
    if (timeframe === 'all') {
      return sql`
        WITH ordered AS (
          SELECT s.id, s.user_id, u.display_name AS username, s.score_date, s.mode,
            s.total_ms, s.total_errors, s.stages, s.completed_at,
            row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
          FROM scores s
          JOIN users u ON u.id = s.user_id
          WHERE s.mode IN ('daily', 'replay')
        )
        SELECT * FROM ordered
        WHERE rank <= ${LEADERBOARD_LIMIT}
        ORDER BY rank
      `;
    }
    return sql`
      WITH ordered AS (
        SELECT s.id, s.user_id, u.display_name AS username, s.score_date, s.mode,
          s.total_ms, s.total_errors, s.stages, s.completed_at,
          row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
        FROM scores s
        JOIN users u ON u.id = s.user_id
        WHERE s.mode IN ('daily', 'replay') AND s.score_date = ${date}
      )
      SELECT * FROM ordered
      WHERE rank <= ${LEADERBOARD_LIMIT}
      ORDER BY rank
    `;
  }
  if (mode === 'daily' && timeframe === 'all') {
    return sql`
      WITH ordered AS (
        SELECT s.id, s.user_id, u.display_name AS username, s.score_date, s.mode,
          s.total_ms, s.total_errors, s.stages, s.completed_at,
          row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
        FROM scores s
        JOIN users u ON u.id = s.user_id
        WHERE s.mode = 'daily'
      )
      SELECT * FROM ordered
      WHERE rank <= ${LEADERBOARD_LIMIT}
      ORDER BY rank
    `;
  }
  return sql`
    WITH ordered AS (
      SELECT s.id, s.user_id, u.display_name AS username, s.score_date, s.mode,
        s.total_ms, s.total_errors, s.stages, s.completed_at,
        row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
      FROM scores s
      JOIN users u ON u.id = s.user_id
      WHERE s.mode = ${mode} AND s.score_date = ${date}
    )
    SELECT * FROM ordered
    WHERE rank <= ${LEADERBOARD_LIMIT}
    ORDER BY rank
  `;
}

async function infiniteEntries(sql, mode, size, timeframe, date) {
  if (timeframe === 'today') {
    return sql`
      WITH ordered AS (
        SELECT s.id, s.user_id, u.display_name AS username, s.score_date,
          s.total_ms, s.total_errors, s.stages, s.completed_at,
          row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
        FROM scores s
        JOIN users u ON u.id = s.user_id
        WHERE s.mode = ${mode} AND s.grid_size = ${size} AND s.score_date = ${date}
      )
      SELECT * FROM ordered
      WHERE rank <= ${LEADERBOARD_LIMIT}
      ORDER BY rank
    `;
  }
  return sql`
    WITH ordered AS (
      SELECT s.id, s.user_id, u.display_name AS username, s.score_date,
        s.total_ms, s.total_errors, s.stages, s.completed_at,
        row_number() OVER (ORDER BY s.total_ms, s.total_errors, s.completed_at) AS rank
      FROM scores s
      JOIN users u ON u.id = s.user_id
      WHERE s.mode = ${mode} AND s.grid_size = ${size}
    )
    SELECT * FROM ordered
    WHERE rank <= ${LEADERBOARD_LIMIT}
    ORDER BY rank
  `;
}

async function loadBenchmarks(sql, mode, size, date, merged) {
  const dailyShaped = mode === 'daily' || mode === 'replay';
  const wTotal = merged ? sql`mode IN ('daily', 'replay')` : sql`mode = ${mode}`;
  const wStage = merged ? sql`s.mode IN ('daily', 'replay')` : sql`s.mode = ${mode}`;
  const [todayTotal, overallTotal, todayStages, overallStages] = await Promise.all([
    dailyShaped
      ? sql`
        SELECT min(total_ms)::int AS fastest, percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms)::int AS median
        FROM scores WHERE ${wTotal} AND score_date = ${date}
      `
      : sql`
        SELECT min(total_ms)::int AS fastest, percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms)::int AS median
        FROM scores WHERE mode = ${mode} AND grid_size = ${size} AND score_date = ${date}
      `,
    dailyShaped
      ? sql`SELECT min(total_ms)::int AS fastest FROM scores WHERE ${wTotal}`
      : sql`SELECT min(total_ms)::int AS fastest FROM scores WHERE mode = ${mode} AND grid_size = ${size}`,
    dailyShaped
      ? sql`
        SELECT ordinality::int - 1 AS stage_index,
          min((stage->>'durationMs')::int)::int AS fastest,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY (stage->>'durationMs')::int)::int AS median
        FROM scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE ${wStage} AND s.score_date = ${date}
        GROUP BY ordinality ORDER BY ordinality
      `
      : sql`
        SELECT ordinality::int - 1 AS stage_index,
          min((stage->>'durationMs')::int)::int AS fastest,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY (stage->>'durationMs')::int)::int AS median
        FROM scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE s.mode = ${mode} AND s.grid_size = ${size} AND s.score_date = ${date}
        GROUP BY ordinality ORDER BY ordinality
      `,
    dailyShaped
      ? sql`
        SELECT ordinality::int - 1 AS stage_index, min((stage->>'durationMs')::int)::int AS fastest
        FROM scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE ${wStage} GROUP BY ordinality ORDER BY ordinality
      `
      : sql`
        SELECT ordinality::int - 1 AS stage_index, min((stage->>'durationMs')::int)::int AS fastest
        FROM scores s CROSS JOIN LATERAL jsonb_array_elements(s.stages) WITH ORDINALITY AS item(stage, ordinality)
        WHERE s.mode = ${mode} AND grid_size = ${size} GROUP BY ordinality ORDER BY ordinality
      `
  ]);
  const stageIndexes = [...new Set([...todayStages, ...overallStages].map((row) => Number(row.stage_index)))].sort((a, b) => a - b);
  const stages = stageIndexes.map((stageIndex) => {
    const todayStage = todayStages.find((item) => Number(item.stage_index) === stageIndex);
    const overallStage = overallStages.find((item) => Number(item.stage_index) === stageIndex);
    return {
      todayFastestMs: numberOrNull(todayStage?.fastest),
      todayMedianMs: numberOrNull(todayStage?.median),
      overallFastestMs: numberOrNull(overallStage?.fastest)
    };
  });
  return {
    total: {
      todayFastestMs: numberOrNull(todayTotal[0]?.fastest),
      todayMedianMs: numberOrNull(todayTotal[0]?.median),
      overallFastestMs: numberOrNull(overallTotal[0]?.fastest)
    },
    stages
  };
}

function serializeEntry(entry, benchmarks, userId) {
  const stages = Array.isArray(entry.stages) ? entry.stages : JSON.parse(entry.stages || '[]');
  return {
    id: entry.id,
    rank: Number(entry.rank),
    username: entry.username,
    mode: entry.mode || null,
    scoreDate: dateOrNull(entry.score_date),
    totalMs: Number(entry.total_ms),
    totalErrors: Number(entry.total_errors),
    completedAt: entry.completed_at,
    isMe: Boolean(userId && entry.user_id === userId),
    tier: tierFor(Number(entry.total_ms), benchmarks.total),
    stages: stages.map((stage, index) => ({ ...stage, tier: tierFor(Number(stage.durationMs), benchmarks.stages[index]) }))
  };
}

export function tierFor(value, benchmark) {
  if (!benchmark) return 'normal';
  if (benchmark.overallFastestMs != null && value <= benchmark.overallFastestMs) return 'overall-fastest';
  if (benchmark.todayFastestMs != null && value <= benchmark.todayFastestMs) return 'today-fastest';
  if (benchmark.todayMedianMs != null && value > benchmark.todayMedianMs * 1.1) return 'slower';
  return 'normal';
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function dateOrNull(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
