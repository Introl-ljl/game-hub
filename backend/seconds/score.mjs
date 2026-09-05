import { HttpError } from '../lib/http.mjs';

export const DAILY_TARGETS = [3, 5, 10];
export const DAILY_ROUNDS = 3;
export const CUSTOM_TARGET_MIN = 1;
export const CUSTOM_TARGET_MAX = 60;
export const CUSTOM_ROUNDS_MAX = 10;

export function validateStartShape(mode, targets, roundsPerTarget) {
  if (mode === 'daily' || mode === 'replay') {
    if (!Array.isArray(targets) || targets.length !== DAILY_TARGETS.length || targets.some((value, index) => Number(value) !== DAILY_TARGETS[index])) {
      throw new HttpError(400, 'BAD_RUN_SHAPE', '每日挑战的目标秒数不正确');
    }
    if (Number(roundsPerTarget) !== DAILY_ROUNDS) {
      throw new HttpError(400, 'BAD_RUN_SHAPE', '每日挑战每个目标固定 3 次按压');
    }
    return { targets: [...DAILY_TARGETS], roundsPerTarget: DAILY_ROUNDS };
  }
  if (mode === 'custom') {
    if (!Array.isArray(targets) || targets.length !== 1) throw new HttpError(400, 'BAD_RUN_SHAPE', '自由模式需要恰好一个目标秒数');
    const target = Number(targets[0]);
    if (!Number.isInteger(target) || target < CUSTOM_TARGET_MIN || target > CUSTOM_TARGET_MAX) {
      throw new HttpError(400, 'BAD_RUN_SHAPE', `目标秒数需为 ${CUSTOM_TARGET_MIN}-${CUSTOM_TARGET_MAX} 的整数`);
    }
    const rounds = Number(roundsPerTarget);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > CUSTOM_ROUNDS_MAX) {
      throw new HttpError(400, 'BAD_RUN_SHAPE', `按压次数需为 1-${CUSTOM_ROUNDS_MAX} 的整数`);
    }
    return { targets: [target], roundsPerTarget: rounds };
  }
  throw new HttpError(400, 'BAD_RUN_SHAPE', '未知的模式');
}

export function validateFinishStages(run, stages) {
  if (!Array.isArray(stages) || stages.length !== run.targets.length) {
    throw new HttpError(400, 'BAD_RESULT_SHAPE', '成绩阶段数不正确');
  }
  const maxActualMs = run.mode === 'custom' ? 120000 : 60000;
  stages.forEach((stage, index) => {
    if (!stage || Number(stage.target) !== run.targets[index]) {
      throw new HttpError(400, 'BAD_RESULT_SHAPE', `第 ${index + 1} 阶段目标不匹配`);
    }
    if (!Array.isArray(stage.rounds) || stage.rounds.length !== run.roundsPerTarget) {
      throw new HttpError(400, 'BAD_RESULT_SHAPE', `第 ${index + 1} 阶段按压次数不正确`);
    }
    for (const round of stage.rounds) {
      const actualMs = Number(round?.actualMs);
      if (!Number.isInteger(actualMs) || actualMs < 200 || actualMs > maxActualMs) {
        throw new HttpError(400, 'BAD_RESULT_SHAPE', '按压用时数据不合法');
      }
    }
  });
}

export function computeScore(run, stages) {
  const mappedStages = stages.map((stage) => {
    const rounds = stage.rounds.map((round) => {
      const actualMs = Number(round.actualMs);
      const deviationMs = actualMs - stage.target * 1000;
      return { actualMs, deviationMs, absDeviationMs: Math.abs(deviationMs) };
    });
    const totalMs = rounds.reduce((sum, round) => sum + round.absDeviationMs, 0);
    return {
      target: stage.target,
      rounds,
      totalMs,
      averageMs: totalMs / rounds.length,
      bestMs: Math.min(...rounds.map((round) => round.absDeviationMs))
    };
  });
  const totalMs = mappedStages.reduce((sum, stage) => sum + stage.totalMs, 0);
  const roundsCount = mappedStages.reduce((sum, stage) => sum + stage.rounds.length, 0);
  return {
    stages: mappedStages,
    totalMs,
    averageMs: totalMs / roundsCount,
    bestMs: Math.min(...mappedStages.map((stage) => stage.bestMs)),
    roundsCount
  };
}
