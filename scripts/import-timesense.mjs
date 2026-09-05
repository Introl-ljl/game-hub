// 将原 timetest（每日秒感）的 JSON 存储（data/db.json）导入统一数据库。
// - 用户保留原 UUID（浏览器本地记录按用户 ID 存放，保留 ID 即可无缝衔接）；
// - 与现有账号同名（name_key 相同）且 PIN 哈希一致时合并为同一账号，成绩归入现有账号；
// - 同名但 PIN 不同时，导入为独立账号，显示名追加「·秒感」后缀；
// - 旧会话 token 一并导入，老用户无需重新登录。
// 用法：TIMETENSE_DB_JSON=/path/to/db.json node scripts/import-timesense.mjs
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getSql, closeSql } from '../backend/lib/db.mjs';

const SOURCE_FILE = process.env.TIMETENSE_DB_JSON || './import/db.json';

function loadSource() {
  const raw = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
  return {
    users: raw.users || [],
    sessions: raw.sessions || [],
    runs: raw.runs || [],
    scores: raw.scores || []
  };
}

async function main() {
  const source = loadSource();
  const sql = getSql();
  const userIdMap = new Map();
  const summary = { usersImported: 0, usersMerged: 0, usersRenamed: 0, sessions: 0, runs: 0, scores: 0, skippedRuns: 0, skippedScores: 0 };

  for (const user of source.users) {
    const existing = await sql`
      SELECT id, pin_hash FROM users WHERE name_key = ${user.nameKey} LIMIT 1
    `;
    if (!existing.length) {
      await sql`
        INSERT INTO users (id, display_name, name_key, pin_salt, pin_hash, created_at, updated_at)
        VALUES (${user.id}, ${user.displayName}, ${user.nameKey}, ${user.pinSalt}, ${user.pinHash}, ${user.createdAt}, now())
        ON CONFLICT (id) DO NOTHING
      `;
      userIdMap.set(user.id, user.id);
      summary.usersImported += 1;
      continue;
    }
    if (existing[0].pin_hash === user.pinHash) {
      userIdMap.set(user.id, existing[0].id);
      summary.usersMerged += 1;
      continue;
    }
    const displayName = `${user.displayName}·秒感`.slice(0, 24);
    const nameKey = `${user.nameKey}·秒感`;
    const id = randomUUID();
    await sql`
      INSERT INTO users (id, display_name, name_key, pin_salt, pin_hash, created_at, updated_at)
      VALUES (${id}, ${displayName}, ${nameKey}, ${user.pinSalt}, ${user.pinHash}, ${user.createdAt}, now())
      ON CONFLICT (name_key) DO NOTHING
    `;
    userIdMap.set(user.id, id);
    summary.usersRenamed += 1;
  }

  for (const session of source.sessions) {
    if (Date.parse(session.expiresAt) <= Date.now()) continue;
    const userId = userIdMap.get(session.userId);
    if (!userId) continue;
    const result = await sql`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${session.tokenHash}, ${session.expiresAt})
      ON CONFLICT (token_hash) DO NOTHING
      RETURNING id
    `;
    if (result.length) summary.sessions += 1;
  }

  for (const run of source.runs) {
    const userId = userIdMap.get(run.userId);
    if (!userId) { summary.skippedRuns += 1; continue; }
    const result = await sql`
      INSERT INTO ts_runs (id, user_id, mode, targets, rounds_per_target, run_date, started_at, finished_at)
      VALUES (${run.id}, ${userId}, ${run.mode}, ${run.targets}, ${run.roundsPerTarget}, ${run.runDate}, ${run.startedAt}, ${run.finishedAt})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) summary.runs += 1;
    else summary.skippedRuns += 1;
  }

  for (const score of source.scores) {
    const userId = userIdMap.get(score.userId);
    if (!userId) { summary.skippedScores += 1; continue; }
    const result = await sql`
      INSERT INTO ts_scores (
        id, run_id, user_id, mode, target, score_date,
        total_ms, average_ms, best_ms, rounds_count, stages, completed_at
      ) VALUES (
        ${score.id}, ${score.runId}, ${userId}, ${score.mode}, ${score.mode === 'custom' ? score.target : null}, ${score.scoreDate},
        ${score.totalMs}, ${score.averageMs}, ${score.bestMs}, ${score.roundsCount}, ${sql.json(score.stages)}, ${score.completedAt}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) summary.scores += 1;
    else summary.skippedScores += 1;
  }

  console.log(`timetest 导入完成: ${JSON.stringify(summary)}`);
  console.log(`来源文件: ${SOURCE_FILE}`);
}

try {
  await main();
} catch (error) {
  console.error('导入失败:', error);
  process.exitCode = 1;
} finally {
  await closeSql();
}
