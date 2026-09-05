import { HttpError } from '../lib/http.mjs';

export const COMPETITIVE_MODES = new Set(['daily', 'replay', 'easy', 'classic', 'fifty']);

export function validateRunStart(body, serverDate) {
  const mode = String(body.mode || '');
  if (!COMPETITIVE_MODES.has(mode)) throw new HttpError(400, 'INVALID_MODE', '该玩法不能进入排行榜');
  const rulesVersion = Number(body.rulesVersion);
  if (!Number.isInteger(rulesVersion) || rulesVersion < 1 || rulesVersion > 1000) throw new HttpError(400, 'INVALID_RULES', '关卡规则版本无效');
  const levelId = String(body.levelId || '').slice(0, 80);
  if (!levelId) throw new HttpError(400, 'INVALID_LEVEL', '关卡编号无效');
  if (mode === 'daily' && levelId !== serverDate.replaceAll('-', '')) {
    throw new HttpError(409, 'STALE_DAILY_LEVEL', '页面中的每日关卡不是今天的版本，请刷新页面');
  }
  let gridSize = null;
  if (mode === 'easy' || mode === 'classic') {
    gridSize = Number(body.gridSize);
    if (![3, 4, 5, 6].includes(gridSize)) throw new HttpError(400, 'INVALID_SIZE', '方格规格无效');
  } else if (mode === 'fifty') {
    gridSize = 5;
  }
  return { mode, gridSize, levelId, rulesVersion };
}

export function validateScore(body, run) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'INVALID_SCORE', '成绩内容无效');
  const stages = Array.isArray(body.stages) ? body.stages.map(validateStage) : [];
  const expected = expectedStages(run.mode, run.grid_size);
  if (stages.length !== expected.length) throw new HttpError(400, 'INVALID_STAGES', '阶段数量与玩法不一致');
  stages.forEach((stage, index) => {
    const target = expected[index];
    if (stage.type !== target.type || stage.size !== target.size) throw new HttpError(400, 'INVALID_STAGES', '阶段规格与玩法不一致');
  });
  const totalMs = stages.reduce((sum, stage) => sum + stage.durationMs, 0);
  const totalErrors = stages.reduce((sum, stage) => sum + stage.errors, 0);
  if (Number(body.totalMs) !== totalMs || Number(body.totalErrors) !== totalErrors) {
    throw new HttpError(400, 'INVALID_TOTAL', '总成绩与阶段成绩不一致');
  }
  const ageMs = Date.now() - new Date(run.started_at).getTime();
  const maxAge = (run.mode === 'daily' || run.mode === 'replay') ? 26 * 3600000 : 6 * 3600000;
  if (ageMs < 0 || ageMs > maxAge) throw new HttpError(409, 'RUN_EXPIRED', '本次竞赛运行已过期，请重新开始');
  return { stages, totalMs, totalErrors };
}

function validateStage(stage) {
  const type = String(stage?.type || '');
  const size = Number(stage?.size);
  const durationMs = Number(stage?.durationMs);
  const errors = Number(stage?.errors);
  if (!['classic', 'simple', 'fifty'].includes(type) || !Number.isInteger(size) || size < 3 || size > 6) {
    throw new HttpError(400, 'INVALID_STAGE', '阶段类型或规格无效');
  }
  if (!Number.isInteger(durationMs) || durationMs < 300 || durationMs > 1800000) {
    throw new HttpError(400, 'INVALID_TIME', '阶段用时超出有效范围');
  }
  if (!Number.isInteger(errors) || errors < 0 || errors > 10000) throw new HttpError(400, 'INVALID_ERRORS', '错误次数无效');
  return { type, size, durationMs, errors };
}

function expectedStages(mode, gridSize) {
  if (mode === 'daily' || mode === 'replay') return [
    { type: 'classic', size: 3 },
    { type: 'classic', size: 4 },
    { type: 'classic', size: 5 },
    { type: 'fifty', size: 5 }
  ];
  if (mode === 'easy') return [{ type: 'simple', size: Number(gridSize) }];
  if (mode === 'classic') return [{ type: 'classic', size: Number(gridSize) }];
  return [{ type: 'fifty', size: 5 }];
}

