const TIME_ZONE = 'Asia/Shanghai';
const STORAGE_KEY = 'time-sense-v1';
const DAILY_TARGETS = [3, 5, 10];
const DAILY_ROUNDS = 3;
const GRID_THEMES = ['海洋蓝', '薄荷青', '森林绿', '暖阳橙', '葡萄紫', '莓果红'];
const DEFAULT_SETTINGS = {
  dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  contrast: false,
  reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  sound: true,
  vibration: true,
  gridTheme: 0
};

const app = {
  date: dateInTimeZone(),
  data: loadData(),
  active: null,
  selectedTarget: 3,
  selectedRounds: 3,
  currentUser: null,
  apiAvailable: true,
  dailyLeaderboard: null,
  lastFinishBoard: null,
  leaderboardMode: 'daily',
  leaderboardTarget: 3,
  leaderboardTimeframe: 'today',
  audio: null,
  storageAvailable: true,
  confirmAction: null,
  guideStartsGame: false
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  bindEvents();
  applySettings();
  detectStorageAvailability();
  await loadAccount();
  await refreshDailyLeaderboard();
  renderHome();
  checkDateChange();
  window.setInterval(checkDateChange, 30000);
  window.setInterval(refreshDynamicRankings, 60000);
}

/* ---------- account ---------- */

async function loadAccount() {
  try {
    const payload = await TimeSenseApi.session();
    app.apiAvailable = true;
    app.currentUser = payload.user || null;
    app.data = loadData(app.currentUser?.id || null);
    app.active = null;
    applySettings();
  } catch (error) {
    app.apiAvailable = false;
    app.currentUser = null;
    $('loadMessage').textContent = `排行榜服务暂不可用：${error.message}`;
  }
  renderUser();
}

function showUser() {
  renderUser();
  openModal('userModal');
}

function renderUser() {
  $('userLabel').textContent = app.currentUser?.username || (app.apiAvailable ? '登录' : '登录不可用');
  $('userButton').classList.toggle('signed-in', Boolean(app.currentUser));
  $('signedInPanel').classList.toggle('hidden', !app.currentUser);
  $('userForms').classList.toggle('hidden', Boolean(app.currentUser));
  $('userModalClose').classList.remove('hidden');
  if (app.currentUser) $('signedInUsername').textContent = app.currentUser.username;
  $('userMessage').textContent = app.apiAvailable ? '' : '登录服务暂不可用，请稍后重试。';
  if (!app.currentUser) showLoginPanel();
}

function showLoginPanel() {
  $('loginPanel').classList.remove('hidden');
  $('registerPanel').classList.add('hidden');
  $('userTitle').textContent = '登录每日秒感';
}

function showRegisterPanel() {
  $('loginPanel').classList.add('hidden');
  $('registerPanel').classList.remove('hidden');
  $('userTitle').textContent = '注册新用户';
}

async function loginUser(event) {
  event.preventDefault();
  const username = $('loginUsername').value;
  const pin = $('loginPin').value;
  await runUserAction(event.submitter, async () => {
    const payload = await TimeSenseApi.login(username, pin);
    await acceptUser(payload.user);
  });
}

async function registerUser(event) {
  event.preventDefault();
  const username = $('registerUsername').value;
  const pin = $('registerPin').value;
  await runUserAction(event.submitter, async () => {
    const payload = await TimeSenseApi.register(username, pin);
    await acceptUser(payload.user);
  });
}

async function runUserAction(button, action) {
  button.disabled = true;
  $('userMessage').textContent = '正在验证…';
  try {
    await action();
    $('userMessage').textContent = '';
  } catch (error) {
    $('userMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function acceptUser(user) {
  app.currentUser = user;
  app.data = loadData(user.id);
  app.active = null;
  $('loginUsername').value = '';
  $('loginPin').value = '';
  $('registerUsername').value = '';
  $('registerPin').value = '';
  renderUser();
  applySettings();
  closeModal('userModal');
  await refreshDailyLeaderboard();
  showHome();
}

async function logoutUser() {
  try {
    await TimeSenseApi.logout();
  } catch (error) {
    $('userMessage').textContent = error.message;
    return;
  }
  app.currentUser = null;
  app.data = loadData(null);
  app.active = null;
  app.dailyLeaderboard = null;
  renderUser();
  applySettings();
  showHome();
  toast('已退出登录，之后的成绩仅保存在本地');
}

/* ---------- events ---------- */

function bindEvents() {
  const pad = $('timingButton');
  if ('PointerEvent' in window) pad.addEventListener('pointerdown', handlePadPointerDown);
  pad.addEventListener('click', handlePadClick);
  pad.addEventListener('contextmenu', (event) => event.preventDefault());
  $('startBtn').addEventListener('click', requestDailyStart);
  $('customBtn').addEventListener('click', requestCustomStart);
  $('targetButtons').addEventListener('click', (event) => {
    const target = Number(event.target.closest('[data-target]')?.dataset.target);
    if (target) {
      app.selectedTarget = target;
      $('customTargetInput').value = String(target);
      renderCustomPickers();
    }
  });
  $('roundsButtons').addEventListener('click', (event) => {
    const rounds = Number(event.target.closest('[data-rounds]')?.dataset.rounds);
    if (rounds) {
      app.selectedRounds = rounds;
      renderCustomPickers();
    }
  });
  $('customTargetInput').addEventListener('change', () => {
    const parsed = Math.round(Number($('customTargetInput').value));
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
      toast('目标秒数需为 1-60 的整数');
      $('customTargetInput').value = String(app.selectedTarget);
      return;
    }
    app.selectedTarget = parsed;
    renderCustomPickers();
  });
  $('dailyShareBtn').addEventListener('click', () => shareResult(app.data.records[app.date]));
  $('guideStartBtn').addEventListener('click', () => {
    app.data.seenGuide = true;
    saveData();
    closeModal('guideModal');
    if (app.guideStartsGame) prepareChallenge();
    app.guideStartsGame = false;
  });
  $('continueBtn').addEventListener('click', advanceStage);
  $('abandonBtn').addEventListener('click', confirmAbandon);
  $('resetBtn').addEventListener('click', resetCustomChallenge);
  $('gameStartBtn').addEventListener('click', startPreparedChallenge);
  $('shareBtn').addEventListener('click', () => shareResult());
  $('replayBtn').addEventListener('click', showHome);
  $('restartBtn').addEventListener('click', restartChallenge);
  $('reloadBtn').addEventListener('click', () => window.location.reload());
  $('showGuideBtn').addEventListener('click', () => {
    app.guideStartsGame = false;
    $('guideStartBtn').textContent = '我知道了';
    closeModal('settingsModal');
    openModal('guideModal');
  });
  $('exportBtn').addEventListener('click', exportHistory);
  $('clearBtn').addEventListener('click', confirmClearData);
  $('confirmCancel').addEventListener('click', () => closeModal('confirmModal'));
  $('confirmAccept').addEventListener('click', () => {
    const action = app.confirmAction;
    closeModal('confirmModal');
    app.confirmAction = null;
    if (action) action();
  });
  $('loginForm').addEventListener('submit', loginUser);
  $('registerForm').addEventListener('submit', registerUser);
  $('toRegisterBtn').addEventListener('click', showRegisterPanel);
  $('toLoginBtn').addEventListener('click', showLoginPanel);
  $('logoutBtn').addEventListener('click', logoutUser);
  $('leaderboardModes').addEventListener('click', (event) => {
    const mode = event.target.closest('[data-board-mode]')?.dataset.boardMode;
    if (!mode) return;
    app.leaderboardMode = mode;
    renderLeaderboardControls();
    loadLeaderboard();
  });
  $('leaderboardTarget').addEventListener('change', (event) => {
    app.leaderboardTarget = Number(event.target.value);
    loadLeaderboard();
  });
  $('leaderboardTimeframe').addEventListener('change', (event) => {
    app.leaderboardTimeframe = event.target.value;
    loadLeaderboard();
  });
  $('lbShowReplay').addEventListener('change', (event) => {
    app.data.showReplay = event.target.checked;
    saveData();
    loadLeaderboard();
  });

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'home') showHome();
    if (action === 'history') showHistory();
    if (action === 'user') showUser();
    if (action === 'leaderboard') showLeaderboard();
    if (action === 'settings') showSettings();
    if (action === 'guide') showGuide();
    const closeTarget = event.target.closest('[data-close]')?.dataset.close;
    if (closeTarget) closeModal(closeTarget);
  });

  for (const [id, key] of [
    ['darkSetting', 'dark'],
    ['contrastSetting', 'contrast'],
    ['motionSetting', 'reduceMotion'],
    ['soundSetting', 'sound'],
    ['vibrationSetting', 'vibration']
  ]) {
    $(id).addEventListener('change', (event) => {
      app.data.settings[key] = event.target.checked;
      saveData();
      applySettings();
    });
  }

  for (const id of ['gridThemeSetting', 'guideGridTheme']) {
    $(id).addEventListener('input', (event) => setGridTheme(Number(event.target.value)));
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDynamicRankings();
  });
}

/* ---------- start flow ---------- */

function requestDailyStart() {
  requestStart(playedDailyToday() ? 'replay' : 'daily');
}

function requestCustomStart() {
  requestStart('custom');
}

function requestStart(mode) {
  app.activeMode = mode;
  if (!app.data.seenGuide) {
    app.guideStartsGame = true;
    $('guideStartBtn').textContent = '开始挑战';
    openModal('guideModal');
    return;
  }
  prepareChallenge();
}

function prepareChallenge() {
  const mode = app.activeMode || 'daily';
  const custom = mode === 'custom';
  const targets = custom ? [app.selectedTarget] : [...DAILY_TARGETS];
  const roundsPerTarget = custom ? app.selectedRounds : DAILY_ROUNDS;
  const levelId = mode === 'daily'
    ? app.date.replaceAll('-', '')
    : mode === 'replay'
      ? `${app.date.replaceAll('-', '')}-replay`
      : `${app.date.replaceAll('-', '')}-custom-${targets[0]}x${roundsPerTarget}`;
  app.active = {
    date: app.date,
    levelId,
    mode,
    targets,
    roundsPerTarget,
    stageIndex: 0,
    state: 'awaiting-start',
    t0: null,
    lastPressAt: 0,
    revealedAt: 0,
    awaitingAdvance: false,
    stageAdvanceTimer: null,
    stages: targets.map((target) => ({ target, rounds: [] })),
    serverRunId: null,
    finished: false,
    result: null,
    createdAt: new Date().toISOString()
  };
  showView('gameView');
  document.documentElement.dataset.play = 'active';
  renderGame();
}

async function startPreparedChallenge() {
  const a = app.active;
  if (!a || a.state !== 'awaiting-start') return;
  if (app.currentUser && !a.serverRunId) {
    const button = $('gameStartBtn');
    button.disabled = true;
    button.textContent = '正在登记正式成绩…';
    try {
      const response = await TimeSenseApi.startRun({
        mode: a.mode,
        targets: a.targets,
        roundsPerTarget: a.roundsPerTarget
      });
      a.serverRunId = response.runId;
      a.date = response.date;
    } catch (error) {
      if (error.code === 'AUTH_REQUIRED') {
        app.currentUser = null;
        a.serverRunId = null;
        renderUser();
        toast('登录状态已失效，本次成绩将仅保存在本地');
      } else {
        button.disabled = false;
        button.textContent = '开始挑战';
        toast(error.message);
        return;
      }
    }
    button.disabled = false;
    button.textContent = '开始挑战';
  }
  a.state = 'idle';
  renderGame();
}

function resetCustomChallenge() {
  if (!app.active || app.active.finished || app.active.mode !== 'custom') return;
  const mode = app.active.mode;
  app.activeMode = mode;
  window.clearTimeout(app.active.stageAdvanceTimer);
  closeModal('stageModal');
  app.active = null;
  prepareChallenge();
  toast('游戏已重置，准备好后点击开始挑战');
}

/* ---------- core game: press to start, press to stop ---------- */

function handlePadPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  pressPad();
}

function handlePadClick(event) {
  if ('PointerEvent' in window && event.detail !== 0) return;
  pressPad();
}

function pressPad() {
  const a = app.active;
  if (!a || a.finished || a.state === 'awaiting-start' || a.awaitingAdvance) return;
  const now = performance.now();
  if (now - a.lastPressAt < 250) return;
  a.lastPressAt = now;
  if (a.state === 'timing') {
    stopRound(now);
  } else if (a.state === 'revealed') {
    if (now - a.revealedAt < 600) return;
    beginRound(now);
  } else if (a.state === 'idle') {
    beginRound(now);
  }
}

function beginRound(now) {
  const a = app.active;
  a.state = 'timing';
  a.t0 = now;
  feedback('start');
  renderGame();
}

function stopRound(now) {
  const a = app.active;
  const actualMs = Math.max(1, Math.round(now - a.t0));
  a.t0 = null;
  const stage = a.stages[a.stageIndex];
  const deviationMs = actualMs - stage.target * 1000;
  stage.rounds.push({ actualMs, deviationMs, absDeviationMs: Math.abs(deviationMs) });
  feedback('stop');
  a.state = 'revealed';
  a.revealedAt = now;
  const stageDone = stage.rounds.length >= a.roundsPerTarget;
  const runDone = stageDone && a.stageIndex === a.targets.length - 1;
  if (runDone) {
    renderGame();
    finishChallenge();
    return;
  }
  if (stageDone) {
    a.awaitingAdvance = true;
    renderGame();
    openStageModal();
    return;
  }
  renderGame();
}

function openStageModal() {
  const a = app.active;
  const stage = a.stages[a.stageIndex];
  const averageMs = stage.rounds.reduce((sum, round) => sum + round.absDeviationMs, 0) / stage.rounds.length;
  const bestMs = Math.min(...stage.rounds.map((round) => round.absDeviationMs));
  $('stageCompleteTitle').textContent = `${formatTargetSec(stage.target)} 完成`;
  $('stageAvg').textContent = formatSeconds(averageMs);
  $('stageBest').textContent = formatSeconds(bestMs);
  $('stageRounds').innerHTML = stage.rounds.map((round) =>
    `<span class="${accuracyClass(round.absDeviationMs, stage.target)}">${formatSeconds(round.actualMs)}</span>`
  ).join('<i> · </i>');
  const nextTarget = a.targets[a.stageIndex + 1];
  $('nextStageLabel').textContent = nextTarget != null ? `下一目标：${formatTargetSec(nextTarget)}` : '全部目标完成';
  openModal('stageModal');
  window.clearTimeout(a.stageAdvanceTimer);
  a.stageAdvanceTimer = window.setTimeout(advanceStage, app.data.settings.reduceMotion ? 500 : 3000);
}

function advanceStage() {
  const a = app.active;
  if (!a || a.finished || !a.awaitingAdvance) return;
  window.clearTimeout(a.stageAdvanceTimer);
  closeModal('stageModal');
  a.stageIndex += 1;
  a.awaitingAdvance = false;
  a.state = 'idle';
  renderGame();
}

async function finishChallenge() {
  const a = app.active;
  a.finished = true;
  delete document.documentElement.dataset.play;
  const result = buildResult();
  const firstResult = saveFirstResult(result);
  result.savedAsFirst = firstResult;
  const newBest = saveBestResult(result);
  if (result.mode === 'custom') pushCustomHistory(result);
  saveData();
  a.result = result;
  feedback('finish');
  renderResult(result, firstResult, newBest);
  showView('resultView');
  await submitCompetitiveResult(result, firstResult, newBest);
}

function buildResult() {
  const a = app.active;
  const stages = a.stages.map((stage) => {
    const rounds = stage.rounds.map((round) => ({ ...round }));
    const totalMs = rounds.reduce((sum, round) => sum + round.absDeviationMs, 0);
    return {
      target: stage.target,
      rounds,
      totalMs,
      averageMs: totalMs / rounds.length,
      bestMs: Math.min(...rounds.map((round) => round.absDeviationMs))
    };
  });
  const totalMs = stages.reduce((sum, stage) => sum + stage.totalMs, 0);
  const roundsCount = stages.reduce((sum, stage) => sum + stage.rounds.length, 0);
  return {
    date: a.date,
    levelId: a.levelId,
    mode: a.mode,
    targets: [...a.targets],
    roundsPerTarget: a.roundsPerTarget,
    roundsCount,
    totalMs,
    averageMs: totalMs / roundsCount,
    bestMs: Math.min(...stages.map((stage) => stage.bestMs)),
    stages,
    completedAt: new Date().toISOString()
  };
}

/* ---------- render: game ---------- */

function renderGame() {
  const a = app.active;
  if (!a) return;
  const target = a.targets[a.stageIndex];
  const stage = a.stages[a.stageIndex];
  $('stageLabel').textContent = a.targets.length > 1 ? `第 ${a.stageIndex + 1} / ${a.targets.length} 目标` : (a.mode === 'custom' ? '自由模式' : '每日挑战');
  $('gridSizeLabel').textContent = `目标 ${formatTargetSec(target)}`;
  $('gameModeBadge').textContent = modeLabel(a.mode);
  $('abandonBtn').textContent = a.mode === 'daily' ? '放弃今日挑战' : a.mode === 'replay' ? '退出复战' : '退出自由模式';
  $('abandonBtn').classList.remove('hidden');
  $('resetBtn').classList.toggle('hidden', a.mode !== 'custom');
  const totalRounds = a.targets.length * a.roundsPerTarget;
  const doneRounds = a.stages.reduce((sum, item) => sum + item.rounds.length, 0);
  $('progressBar').style.width = `${(doneRounds / totalRounds) * 100}%`;
  const roundNumber = a.state === 'revealed' ? stage.rounds.length : stage.rounds.length + 1;
  $('roundLabel').textContent = `第 ${Math.min(roundNumber, a.roundsPerTarget)} / ${a.roundsPerTarget} 次`;
  const roundAbsDeviations = a.stages.flatMap((item) => item.rounds.map((round) => round.absDeviationMs));
  $('bestLabel').textContent = roundAbsDeviations.length ? `最佳 ±${formatSeconds(Math.min(...roundAbsDeviations))}` : '最佳 —';
  $('stageDots').innerHTML = a.targets.map((_, index) => `<i class="${index < a.stageIndex ? 'done' : index === a.stageIndex && !a.finished ? 'active' : ''}"></i>`).join('');
  updateHudStars(a.stageIndex + (a.finished ? 1 : 0), a.targets.length);
  $('hudTimer').textContent = formatTargetSec(target);
  $('gameHelp').textContent = a.state === 'timing'
    ? '心中默数，不要看任何地方，到点立刻按下'
    : a.state === 'revealed' ? '点击按钮继续下一轮'
      : '按下按钮开始计时，心中默数，再次按下停止';

  const awaitingStart = a.state === 'awaiting-start';
  $('gameBoard').classList.toggle('ready', awaitingStart);
  $('gameStartPanel').setAttribute('aria-hidden', String(!awaitingStart));
  if (awaitingStart) {
    const startBtn = $('gameStartBtn');
    startBtn.disabled = false;
    startBtn.textContent = '开始挑战';
  }
  renderTimingButton();
}

function renderTimingButton() {
  const a = app.active;
  if (!a) return;
  const button = $('timingButton');
  const target = a.targets[a.stageIndex];
  const stage = a.stages[a.stageIndex];
  button.className = 'timing-button';
  button.disabled = false;
  if (a.state === 'timing') {
    button.classList.add('is-timing');
    button.innerHTML = `
      <span class="timing-eyebrow">RECORDING</span>
      <strong class="timing-cta">计时中</strong>
      <small class="timing-hint">心中默数 · 到点再次按下停止</small>`;
    return;
  }
  if (a.state === 'revealed') {
    const round = stage.rounds[stage.rounds.length - 1];
    const accuracy = accuracyClass(round.absDeviationMs, stage.target);
    const direction = round.deviationMs > 0 ? '偏晚' : round.deviationMs < 0 ? '偏早' : '精准';
    button.classList.add('is-revealed', accuracy);
    const hint = a.awaitingAdvance ? '即将进入下一目标…' : '点击继续下一轮';
    button.innerHTML = `
      <span class="timing-eyebrow">实际用时</span>
      <strong class="timing-result">${formatSeconds(round.actualMs)}</strong>
      <em class="timing-deviation">${direction} ${formatSignedDeviation(round.deviationMs)}</em>
      <small class="timing-hint">${hint}</small>`;
    return;
  }
  button.innerHTML = `
    <span class="timing-eyebrow">TARGET · 目标</span>
    <strong class="timing-target">${formatTargetSec(target)}</strong>
    <small class="timing-hint">按下开始计时 · 期间不会显示任何数字</small>`;
}

/* ---------- render: result ---------- */

function renderResult(result, savedAsFirst, newBest = false) {
  const isDaily = result.mode === 'daily';
  const isReplay = result.mode === 'replay';
  $('resultEyebrow').textContent = isDaily ? 'DAILY COMPLETE' : isReplay ? 'REPLAY COMPLETE' : 'FREE MODE COMPLETE';
  $('resultTitle').textContent = isDaily ? '今日挑战完成' : isReplay ? '复战完成' : '自由模式完成';
  const tier = recordTier(result);
  const totalEl = $('resultTotal').parentElement;
  totalEl.classList.remove('tier-fastest', 'tier-today-fastest', 'tier-overall-fastest', 'tier-normal', 'tier-slower');
  totalEl.classList.add(`tier-${tier}`);
  $('resultTotal').textContent = formatSeconds(result.averageMs);
  $('resultBest').textContent = `±${formatSeconds(result.bestMs)}`;
  $('resultStreakLabel').textContent = isDaily || isReplay ? '连续挑战' : '按压次数';
  $('resultStreak').textContent = isDaily || isReplay ? `${calculateStreak()} 天` : `${result.roundsCount} 次`;
  const stagesEl = $('resultStages');
  stagesEl.classList.remove('hidden');
  stagesEl.innerHTML = result.stages.map((stage, index) => {
    const tier = stageTier(result, index);
    const roundsHtml = stage.rounds.map((round, roundIndex) => {
      const direction = round.deviationMs > 0 ? '偏晚' : round.deviationMs < 0 ? '偏早' : '精准';
      const accuracy = accuracyClass(round.absDeviationMs, stage.target);
      return `<div class="round-row">
        <span class="round-index">第 ${roundIndex + 1} 次</span>
        <strong class="round-actual">${formatSeconds(round.actualMs)}</strong>
        <em class="round-deviation ${accuracy}">${direction} ${formatSignedDeviation(round.deviationMs)}</em>
      </div>`;
    }).join('');
    return `<div class="result-stage-card tier-${tier}">
      <div class="stage-card-head">
        <span>${formatTargetSec(stage.target)} 目标</span>
        <b>平均偏差 ${formatSeconds(stage.averageMs)}</b>
      </div>
      <div class="stage-card-rounds">${roundsHtml}</div>
      <small class="stage-card-best">最佳一轮 ±${formatSeconds(stage.bestMs)}</small>
    </div>`;
  }).join('');
  if (isDaily || isReplay) {
    $('resultCompareLabel').textContent = result.globalRank ? '今日排名' : '近期对比';
    $('resultCompare').textContent = result.globalRank ? `第 ${result.globalRank} 名` : comparisonLabel(result);
  } else {
    const best = bestResultFor(result);
    $('resultCompareLabel').textContent = result.globalRank ? '今日排名' : '本地最佳';
    $('resultCompare').textContent = result.globalRank ? `第 ${result.globalRank} 名` : `±${formatSeconds(best ? best.averageMs : result.averageMs)}`;
  }
  $('resultNote').textContent = result.localOnly
    ? '未登录模式：成绩仅保存在当前设备的本地记录，不计入排行榜；登录后成绩计入排行榜。'
    : result.syncError
      ? `本地成绩已保存，但未进入全局榜：${result.syncError}`
      : result.globalRank
        ? `成绩已进入今日 Top 20，目前排名第 ${result.globalRank}。${isDaily && !savedAsFirst ? '首页仍展示今天首次完成的记录。' : ''}`
        : result.recorded === false
          ? '成绩已保存，当前未进入今日 Top 20。'
          : '成绩正在同步到全局榜。';
  $('restartBtn').textContent = isDaily || isReplay ? '复战今日' : '再来一次';
  $('restartBtn').classList.toggle('danger-fill', !(isDaily || isReplay));
  updateHudStars(result.stages.length, result.stages.length);
}

function comparisonLabel(result) {
  const previous = sortedRecords().filter((record) => record.date < result.date).slice(0, 7);
  if (!previous.length) return '首次记录';
  const average = previous.reduce((sum, record) => sum + record.averageMs, 0) / previous.length;
  const difference = result.averageMs - average;
  if (Math.abs(difference) < 20) return '与近期持平';
  return difference < 0 ? `优于近期 ${formatSeconds(Math.abs(difference))}` : `落后近期 ${formatSeconds(difference)}`;
}

function recordTier(result) {
  if (result.globalTiers?.total) return result.globalTiers.total;
  const board = boardForResult(result);
  if (board) return tierFromBenchmark(result.averageMs, board.benchmarks?.total);
  return 'normal';
}

function stageTier(record, index) {
  if (record.globalTiers?.stages?.[index]) return record.globalTiers.stages[index];
  const board = boardForResult(record);
  if (board) return tierFromBenchmark(record.stages[index].averageMs, board.benchmarks?.stages?.[index]);
  return 'normal';
}

function boardForResult(result) {
  if (result.mode === 'daily' || result.mode === 'replay') return app.dailyLeaderboard;
  return app.lastFinishBoard?.target === result.targets[0] ? app.lastFinishBoard : null;
}

async function submitCompetitiveResult(result, savedAsFirst, newBest) {
  if (!app.active?.serverRunId) {
    result.localOnly = true;
    renderResult(result, savedAsFirst, newBest);
    return;
  }
  try {
    const response = await TimeSenseApi.finishRun({
      runId: app.active.serverRunId,
      stages: result.stages.map((stage) => ({
        target: stage.target,
        rounds: stage.rounds.map((round) => ({ actualMs: round.actualMs }))
      }))
    });
    result.recorded = response.recorded !== false;
    if (response.ranking) {
      result.globalScoreId = response.ranking.scoreId;
      result.globalRank = response.ranking.rank;
      result.globalTiers = {
        total: response.ranking.totalTier,
        stages: response.ranking.stageTiers
      };
    }
    if (response.leaderboard) {
      if (result.mode === 'daily' || result.mode === 'replay') app.dailyLeaderboard = response.leaderboard;
      else app.lastFinishBoard = response.leaderboard;
    }
    renderResult(result, savedAsFirst && result.recorded !== false, newBest);
    if (result.mode === 'daily' || result.mode === 'replay') renderHomeDynamicRanking();
  } catch (error) {
    result.syncError = error.message;
    renderResult(result, savedAsFirst, newBest);
  }
}

/* ---------- home ---------- */

function showHome() {
  const hadActive = Boolean(app.active && !app.active.finished);
  if (app.active) window.clearTimeout(app.active.stageAdvanceTimer);
  app.active = null;
  delete document.documentElement.dataset.play;
  closeAllModals();
  showView('homeView');
  renderHome();
  if (hadActive) toast('挑战已退出，进度未保存');
}

function restartChallenge() {
  const result = app.active?.result;
  if (!result) { showHome(); return; }
  const mode = result.mode || 'daily';
  app.active = null;
  delete document.documentElement.dataset.play;
  app.activeMode = mode === 'replay' ? 'replay' : mode;
  if (mode === 'custom' && result.targets[0] != null) {
    app.selectedTarget = result.targets[0];
    app.selectedRounds = result.roundsPerTarget || 3;
  }
  requestStart(app.activeMode);
}

function renderHome() {
  const date = app.date;
  $('todayLabel').textContent = `${formatChineseDate(date)} · 北京时间`;
  $('levelId').textContent = `#${date.replaceAll('-', '')}`;
  const todayRecord = app.data.records[date];
  const dailyActive = isDailyActive();
  $('challengeState').textContent = todayRecord ? '今日成绩已记录' : dailyActive ? '今日挑战进行中' : '今日未开始';
  $('challengeState').classList.toggle('complete', Boolean(todayRecord));
  $('challengeState').classList.toggle('in-progress', dailyActive);
  const dailyTier = $('dailyTier');
  if (todayRecord) {
    const tier = recordTier(todayRecord);
    dailyTier.textContent = tierLabel(tier);
    dailyTier.className = `status-tag tier-tag tier-${tier}`;
  } else {
    dailyTier.className = 'status-tag tier-tag hidden';
  }
  renderDailyLap(todayRecord);
  $('startBtn').innerHTML = startButtonLabel();
  $('customBtn').innerHTML = `开始自定义 · ${app.selectedTarget}s × ${app.selectedRounds}次 <span>→</span>`;
  renderCustomPickers();
  $('dailyShareBtn').classList.toggle('hidden', !todayRecord);
  const streak = calculateStreak();
  $('streakValue').textContent = streak;
  $('streakHint').textContent = streak ? (todayRecord ? '今天也完成了' : '完成今天以延续记录') : '完成今日挑战开始记录';
  const latest = sortedRecords()[0];
  $('lastScore').textContent = latest ? `±${formatSeconds(latest.averageMs)}` : '—';
  $('hudTimer').textContent = 'READY';
  updateHudStars(todayRecord ? DAILY_TARGETS.length : 0, DAILY_TARGETS.length);
}

function renderDailyLap(record) {
  const board = $('lapBoard');
  const total = $('lapTotal');
  const sectors = $('lapSectors').children;
  board.classList.remove('has-time', 'tier-fastest', 'tier-today-fastest', 'tier-overall-fastest', 'tier-normal', 'tier-slower');
  if (!record) {
    total.textContent = '--.---';
    for (const sector of sectors) sector.querySelector('b').textContent = '--.---';
    return;
  }
  board.classList.add('has-time', `tier-${recordTier(record)}`);
  total.textContent = formatSeconds(record.averageMs);
  record.stages.forEach((stage, index) => {
    const sector = sectors[index];
    if (!sector) return;
    sector.querySelector('b').textContent = formatSeconds(stage.averageMs);
    sector.classList.remove('tier-fastest', 'tier-today-fastest', 'tier-overall-fastest', 'tier-normal', 'tier-slower');
    sector.classList.add(`tier-${stageTier(record, index)}`);
  });
}

function renderHomeDynamicRanking() {
  if (!$('homeView').classList.contains('hidden')) {
    renderHome();
    return;
  }
  const record = app.data.records[app.date];
  if (!record) return;
  const tier = recordTier(record);
  $('dailyTier').textContent = tierLabel(tier);
  $('dailyTier').className = `status-tag tier-tag tier-${tier}`;
  renderDailyLap(record);
}

function renderCustomPickers() {
  for (const button of document.querySelectorAll('[data-target]')) {
    const active = Number(button.dataset.target) === app.selectedTarget;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of document.querySelectorAll('[data-rounds]')) {
    const active = Number(button.dataset.rounds) === app.selectedRounds;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (document.activeElement !== $('customTargetInput')) $('customTargetInput').value = String(app.selectedTarget);
  $('customBtn').innerHTML = `开始自定义 · ${app.selectedTarget}s × ${app.selectedRounds}次 <span>→</span>`;
}

function startButtonLabel() {
  if (playedDailyToday()) return '复战今日 · 再测一次 <span>→</span>';
  if (isDailyActive()) return '今日挑战进行中';
  return '开始今日挑战 <span>→</span>';
}

/* ---------- history / records ---------- */

function saveFirstResult(result) {
  if (result.mode !== 'daily') return false;
  if (playedDailyToday()) return false;
  app.data.records[app.date] = result;
  trimRecords();
  return true;
}

function saveBestResult(result) {
  if (result.mode !== 'custom') return false;
  const key = `custom:${result.targets[0]}`;
  const previous = app.data.bestRecords[key];
  if (previous && previous.averageMs <= result.averageMs) return false;
  app.data.bestRecords[key] = { ...result };
  return true;
}

function bestResultFor(result) {
  return app.data.bestRecords[`custom:${result.targets[0]}`] || null;
}

function pushCustomHistory(result) {
  const key = `custom:${result.targets[0]}`;
  app.data.customHistory ||= {};
  app.data.customHistory[key] ||= [];
  app.data.customHistory[key].unshift({ ...result });
  app.data.customHistory[key] = app.data.customHistory[key].slice(0, 50);
}

function customHistoryFor(result) {
  return app.data.customHistory?.[`custom:${result.targets[0]}`] || [];
}

function playedDailyToday() {
  return Boolean(app.data.records[app.date]);
}

function isDailyActive() {
  return Boolean(app.active && !app.active.finished && (app.active.mode === 'daily' || app.active.mode === 'replay') && app.active.date === app.date);
}

function calculateStreak() {
  const completed = new Set(Object.keys(app.data.records));
  let cursor = completed.has(app.date) ? app.date : addDays(app.date, -1);
  let streak = 0;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function sortedRecords() {
  return Object.values(app.data.records).sort((first, second) => second.date.localeCompare(first.date));
}

function trimRecords() {
  const keep = sortedRecords().slice(0, 30);
  app.data.records = Object.fromEntries(keep.map((record) => [record.date, record]));
}

function showHistory() {
  const records = sortedRecords().slice(0, 30);
  $('historyList').innerHTML = records.length
    ? records.map((record) => `<div class="history-row"><span>${formatChineseDate(record.date)}</span><strong>±${formatSeconds(record.averageMs)}</strong><small>最佳 ±${formatSeconds(record.bestMs)}</small></div>`).join('')
    : '<div class="empty-state">完成第一次每日挑战后，记录会出现在这里。</div>';
  openModal('historyModal');
}

/* ---------- leaderboard ---------- */

function showLeaderboard() {
  renderLeaderboardControls();
  showView('leaderboardView');
  loadLeaderboard();
}

function renderLeaderboardControls() {
  for (const button of document.querySelectorAll('[data-board-mode]')) {
    button.classList.toggle('active', button.dataset.boardMode === app.leaderboardMode);
  }
  const dailyShaped = app.leaderboardMode === 'daily';
  $('leaderboardTarget').value = String(app.leaderboardTarget);
  $('leaderboardTarget').disabled = dailyShaped;
  $('leaderboardTimeframe').value = app.leaderboardTimeframe;
  $('lbReplayToggle').classList.toggle('hidden', !dailyShaped);
  $('lbShowReplay').checked = app.data.showReplay;
}

async function loadLeaderboard() {
  if (!app.apiAvailable) {
    $('leaderboardList').innerHTML = '<div class="empty-state">排行榜服务暂不可用。</div>';
    return;
  }
  $('leaderboardList').innerHTML = '<div class="empty-state">正在加载排行榜…</div>';
  try {
    const dailyShaped = app.leaderboardMode === 'daily';
    const board = await TimeSenseApi.leaderboard({
      mode: app.leaderboardMode,
      target: dailyShaped ? null : app.leaderboardTarget,
      timeframe: app.leaderboardTimeframe,
      includeReplay: dailyShaped ? app.data.showReplay : undefined
    });
    if (board.mode === 'daily') app.dailyLeaderboard = board;
    renderLeaderboard(board);
    if (board.mode === 'daily') renderHomeDynamicRanking();
  } catch (error) {
    $('leaderboardList').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

const DAILY_STAGE_LABELS = ['3s', '5s', '10s'];

function benchmarkTierOf(value, benchmark) {
  if (value == null) return 'normal';
  if (benchmark?.overallFastestMs != null && value <= benchmark.overallFastestMs) return 'overall-fastest';
  if (benchmark?.todayFastestMs != null && value <= benchmark.todayFastestMs) return 'today-fastest';
  return 'normal';
}

function renderLeaderboard(board) {
  const benchmarks = board.benchmarks || {};
  const totalBench = benchmarks.total || {};
  const stageBenches = benchmarks.stages || [];
  const dailyShaped = board.mode === 'daily';
  const isToday = (board.timeframe || 'today') === 'today';
  const showScoreDate = board.mode === 'daily' && !isToday;
  const primaryMs = isToday ? totalBench.todayFastestMs : totalBench.overallFastestMs;
  const secondaryMs = isToday ? totalBench.overallFastestMs : totalBench.todayFastestMs;
  const primaryLabel = isToday ? 'TODAY ACCURACY · 今日最准' : 'ALL-TIME ACCURACY · 整体最准';
  const secondaryLabel = isToday ? '整体最准' : '今日最准';
  const participants = board.participantCount ?? board.entries.length;

  const benchmarkEl = $('lbBenchmark');
  const sectorsHtml = (values) => values && values.length > 1
    ? `<div class="lb-sectors">${values.map((stage, index) => {
        const label = dailyShaped ? (DAILY_STAGE_LABELS[index] ?? `#${index + 1}`) : `${stage.target}s`;
        return `<div class="sector tier-${stage.tier || 'normal'}"><span>${label}</span><b>${formatSeconds(stage.value)}</b></div>`;
      }).join('')}</div>`
    : '';

  if (primaryMs != null) {
    const benchTier = benchmarkTierOf(primaryMs, totalBench);
    const benchSectors = dailyShaped && stageBenches.length
      ? `<div class="lb-sectors">${stageBenches.map((sb, index) => {
          const stageVal = isToday ? sb.todayFastestMs : sb.overallFastestMs;
          const stageTierValue = benchmarkTierOf(stageVal, sb);
          const label = DAILY_STAGE_LABELS[index] ?? `#${index + 1}`;
          return `<div class="sector tier-${stageTierValue}"><span>${label}</span><b>${stageVal != null ? formatSeconds(stageVal) : '--.---'}</b></div>`;
        }).join('')}</div>`
      : '';
    benchmarkEl.innerHTML = `
      <div class="lb-bench tier-${benchTier}">
        <div class="lb-bench-top">
          <span class="lb-bench-tag">${primaryLabel}</span>
          <span class="lb-bench-count">记录 <b>${participants}</b></span>
        </div>
        <strong class="lb-bench-time">${formatSeconds(primaryMs)}</strong>
        ${benchSectors}
        <div class="lb-bench-foot">${secondaryLabel} <b>${secondaryMs != null ? formatSeconds(secondaryMs) : '-'}</b></div>
      </div>`;
  } else {
    benchmarkEl.innerHTML = `
      <div class="lb-bench">
        <div class="lb-bench-top">
          <span class="lb-bench-tag">${primaryLabel}</span>
          <span class="lb-bench-count">记录 <b>${participants}</b></span>
        </div>
        <strong class="lb-bench-time">--.---</strong>
      </div>`;
  }

  if (!board.entries.length) {
    $('leaderboardList').innerHTML = '<div class="empty-state">还没有正式成绩，等你成为第一个。</div>';
    return;
  }
  $('leaderboardList').innerHTML = board.entries.map((entry) => {
    const rankBadge = entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`;
    const entrySectors = sectorsHtml(entry.stages);
    const replayMark = entry.mode === 'replay' ? '<em class="lb-replay-mark" title="复战成绩">*</em>' : '';
    return `
    <article class="lb-row tier-${entry.tier}${entry.isMe ? ' is-me' : ''}">
      <div class="lb-rank"><b>${rankBadge}</b></div>
      <div class="lb-body">
        <div class="lb-line">
          <strong class="lb-name">${escapeHtml(entry.username)}${replayMark}${entry.isMe ? '<em class="lb-you">你</em>' : ''}</strong>
          <time class="lb-time tier-${entry.tier}">${formatSeconds(entry.value)}</time>
        </div>
        ${entrySectors}
        <div class="lb-meta">最佳一轮 ±${formatSeconds(entry.bestMs)} · ${entry.rounds} 次按压${showScoreDate && entry.scoreDate ? ` · 记录日期 ${formatChineseDate(entry.scoreDate)}` : ''}</div>
      </div>
    </article>`;
  }).join('');
}

async function refreshDailyLeaderboard() {
  if (!app.apiAvailable) return;
  try {
    app.dailyLeaderboard = await TimeSenseApi.leaderboard({ mode: 'daily', timeframe: 'today', includeReplay: app.data.showReplay });
    syncDailyStateFromServer();
    renderHomeDynamicRanking();
  } catch (error) {
    console.warn('每日排行榜刷新失败', error);
  }
}

function syncDailyStateFromServer(overwrite = false) {
  const entry = app.dailyLeaderboard?.entries?.find((item) => item.isMe && item.mode === 'daily');
  if (entry && (overwrite || !app.data.records[app.date])) {
    app.data.records[app.date] = {
      date: app.date,
      levelId: app.date.replaceAll('-', ''),
      mode: 'daily',
      targets: entry.stages.map((stage) => stage.target),
      roundsPerTarget: entry.rounds / (entry.stages.length || 1),
      roundsCount: entry.rounds,
      totalMs: entry.value * entry.rounds,
      averageMs: entry.value,
      bestMs: entry.bestMs,
      stages: entry.stages.map(({ tier, ...stage }) => stage),
      completedAt: new Date().toISOString()
    };
    trimRecords();
    saveData();
  }
}

async function refreshDynamicRankings() {
  if (document.hidden || !app.apiAvailable) return;
  await refreshDailyLeaderboard();
  if (!$('leaderboardView').classList.contains('hidden')) await loadLeaderboard();
  const result = app.active?.result;
  if (result && !result.localOnly) await refreshResultRanking(result);
}

async function refreshResultRanking(result) {
  try {
    const board = (result.mode === 'daily' || result.mode === 'replay')
      ? app.dailyLeaderboard
      : await TimeSenseApi.leaderboard({ mode: 'custom', target: result.targets[0], timeframe: 'today' });
    if (!board) return;
    result.globalTiers = {
      total: tierFromBenchmark(result.averageMs, board.benchmarks?.total),
      stages: result.stages.map((stage, index) => tierFromBenchmark(stage.averageMs, board.benchmarks?.stages?.[index]))
    };
    const ranked = result.globalScoreId ? board.entries.find((entry) => entry.id === result.globalScoreId) : null;
    if (ranked) result.globalRank = ranked.rank;
    else delete result.globalRank;
    renderResult(result, Boolean(result.savedAsFirst), false);
  } catch (error) {
    console.warn('成绩颜色刷新失败', error);
  }
}

function currentDailyEntry() {
  return app.dailyLeaderboard?.entries?.find((entry) => entry.isMe && entry.mode === 'daily') || null;
}

function tierFromBenchmark(value, benchmark) {
  if (!benchmark) return 'normal';
  if (benchmark.overallFastestMs != null && value <= benchmark.overallFastestMs) return 'overall-fastest';
  if (benchmark.todayFastestMs != null && value <= benchmark.todayFastestMs) return 'today-fastest';
  if (benchmark.todayMedianMs != null && value > benchmark.todayMedianMs * 1.1) return 'slower';
  return 'normal';
}

function tierLabel(tier) {
  if (tier === 'overall-fastest') return '整体最准 · RECORD';
  if (tier === 'today-fastest' || tier === 'fastest') return '今日最准 · FASTEST';
  if (tier === 'slower') return '偏慢 · OFF PACE';
  return '正常 · SOLID';
}

/* ---------- modals & flow helpers ---------- */

function showSettings() {
  for (const [id, key] of [
    ['darkSetting', 'dark'], ['contrastSetting', 'contrast'], ['motionSetting', 'reduceMotion'],
    ['soundSetting', 'sound'], ['vibrationSetting', 'vibration']
  ]) $(id).checked = Boolean(app.data.settings[key]);
  syncThemeControls();
  openModal('settingsModal');
}

function showGuide() {
  app.guideStartsGame = false;
  $('guideStartBtn').textContent = '我知道了';
  openModal('guideModal');
}

function confirmAbandon() {
  const mode = app.active?.mode;
  const isDaily = mode === 'daily';
  const isReplay = mode === 'replay';
  const title = isDaily ? '放弃今日挑战？' : isReplay ? '退出复战？' : '退出自由模式？';
  const message = '未完成的进度将被清空，你可以随时重新开始。';
  showConfirm(title, message, isDaily ? '确认放弃' : '确认退出', () => {
    if (app.active) window.clearTimeout(app.active.stageAdvanceTimer);
    app.active = null;
    delete document.documentElement.dataset.play;
    showHome();
  });
}

function confirmClearData() {
  showConfirm('清除当前用户的本地记录？', '本地历史、连续天数、未完成进度和偏好设置都会被删除。服务器上的用户、已提交的排行榜成绩不会被删除。', '确认清除', () => {
    app.data = defaultData();
    app.active = null;
    delete document.documentElement.dataset.play;
    saveData();
    applySettings();
    closeModal('settingsModal');
    renderHome();
    toast('当前用户的本地记录已清除');
  });
}

function showConfirm(title, text, acceptLabel, action) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmAccept').textContent = acceptLabel;
  app.confirmAction = action;
  openModal('confirmModal');
}

/* ---------- share ---------- */

async function shareResult(resultOverride = null) {
  const result = resultOverride || app.active?.result || app.data.records[app.date];
  if (!result) return;
  const isDaily = result.mode === 'daily';
  const isReplay = result.mode === 'replay';
  const isCustom = !isDaily && !isReplay;
  const [, month, day] = result.date.split('-').map(Number);
  const heading = isDaily
    ? `${month}月 ${day} - 每日秒感 #${result.levelId}`
    : isReplay
      ? `${month}月 ${day} - 每日秒感 · 复战`
      : `${month}月 ${day} - 每日秒感 · 自定义 ${result.targets[0]}s x ${result.roundsPerTarget}次`;
  const lines = [window.location.origin, heading];
  result.stages.forEach((stage) => {
    lines.push(`${stage.target}s: 🎯 平均偏差 ${formatSeconds(stage.averageMs)} (最佳 ±${formatSeconds(stage.bestMs)})`);
  });
  lines.push(`总计: 🎯 平均偏差 ${formatSeconds(result.averageMs)}${!isCustom ? ` · 连续 ${calculateStreak()} 天` : ''}`);
  if (isCustom) {
    const history = customHistoryFor(result);
    const best = bestResultFor(result) || result;
    const average = history.length ? history.reduce((sum, record) => sum + record.averageMs, 0) / history.length : result.averageMs;
    lines.push(`自定义 ${result.targets[0]}s: ${history.length + 1} 局 · 最佳 🏆 ±${formatSeconds(best.averageMs)} · 平均 ±${formatSeconds(average)}`);
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('成绩已复制');
  } catch {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  toast('成绩已复制');
}

function exportHistory() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), timeZone: TIME_ZONE, records: app.data.records, bestRecords: app.data.bestRecords, customHistory: app.data.customHistory }, null, 2);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  link.download = `time-sense-${app.date}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------- storage ---------- */

function loadData(userId = null) {
  try {
    const current = localStorage.getItem(dataStorageKey(userId));
    if (current) return normalizeData(JSON.parse(current));
    return defaultData();
  } catch {
    return defaultData();
  }
}

function normalizeData(data) {
  const fresh = defaultData();
  if (!data || typeof data !== 'object') return fresh;
  return {
    seenGuide: Boolean(data.seenGuide),
    showReplay: data.showReplay !== false,
    records: data.records && typeof data.records === 'object' ? data.records : {},
    bestRecords: data.bestRecords && typeof data.bestRecords === 'object' ? data.bestRecords : {},
    customHistory: data.customHistory && typeof data.customHistory === 'object' ? data.customHistory : {},
    settings: { ...fresh.settings, ...(data.settings || {}) }
  };
}

function defaultData() {
  return { seenGuide: false, showReplay: true, records: {}, bestRecords: {}, customHistory: {}, settings: { ...DEFAULT_SETTINGS } };
}

function saveData() {
  try {
    localStorage.setItem(dataStorageKey(app.currentUser?.id || null), JSON.stringify(app.data));
    app.storageAvailable = true;
  } catch {
    app.storageAvailable = false;
  }
}

function dataStorageKey(userId) {
  return userId ? `${STORAGE_KEY}:user:${userId}` : STORAGE_KEY;
}

function detectStorageAvailability() {
  try {
    const probe = '__time_sense_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    app.storageAvailable = false;
    $('loadMessage').textContent = '浏览器禁止本地存储：可以游玩，但成绩和连续记录无法长期保存。';
  }
}

/* ---------- settings ---------- */

function applySettings() {
  const settings = app.data.settings;
  document.documentElement.dataset.theme = settings.dark ? 'dark' : 'light';
  document.documentElement.dataset.contrast = settings.contrast ? 'high' : 'normal';
  document.documentElement.dataset.reduceMotion = String(Boolean(settings.reduceMotion));
  document.documentElement.dataset.gridTheme = String(normalizeGridTheme(settings.gridTheme));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.dark ? '#171b18' : '#f3f0e8');
  syncThemeControls();
}

function setGridTheme(value) {
  app.data.settings.gridTheme = normalizeGridTheme(value);
  saveData();
  applySettings();
}

function normalizeGridTheme(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < GRID_THEMES.length ? index : 0;
}

function syncThemeControls() {
  const index = normalizeGridTheme(app.data.settings.gridTheme);
  for (const id of ['gridThemeSetting', 'guideGridTheme']) {
    if ($(id)) $(id).value = String(index);
  }
  if ($('settingsThemeName')) $('settingsThemeName').textContent = GRID_THEMES[index];
  if ($('guideThemeName')) $('guideThemeName').textContent = GRID_THEMES[index];
}

/* ---------- feedback ---------- */

function feedback(type) {
  if (app.data.settings.vibration && navigator.vibrate) {
    navigator.vibrate(type === 'finish' ? [30, 45, 70] : 12);
  }
  if (!app.data.settings.sound) return;
  try {
    app.audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = app.audio.createOscillator();
    const gain = app.audio.createGain();
    oscillator.frequency.value = type === 'stop' ? 520 : type === 'finish' ? 660 : 410;
    gain.gain.setValueAtTime(.035, app.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, app.audio.currentTime + .09);
    oscillator.connect(gain).connect(app.audio.destination);
    oscillator.start();
    oscillator.stop(app.audio.currentTime + .1);
  } catch { /* Browsers may block audio feedback. */ }
}

/* ---------- date ---------- */

function checkDateChange() {
  const current = dateInTimeZone();
  if (current !== app.date) $('dateNotice').classList.remove('hidden');
}

/* ---------- views & modals ---------- */

function showView(id) {
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('hidden', view.id !== id);
  document.documentElement.classList.toggle('scroll-locked', id === 'gameView');
}

function openModal(id) {
  const modal = $(id);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  if (id === 'stageModal' && app.active) window.clearTimeout(app.active.stageAdvanceTimer);
  const modal = $(id);
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function closeAllModals() {
  for (const modal of document.querySelectorAll('.modal')) closeModal(modal.id);
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.remove('hidden');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add('hidden'), 2200);
}

/* ---------- formatting ---------- */

function dateInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatChineseDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: TIME_ZONE }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  return `${year}年${month}月${day}日 · ${weekday}`;
}

function addDays(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function formatTargetSec(seconds) {
  return `${Number(seconds).toFixed(2)}s`;
}

function formatSeconds(milliseconds) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(3)}s`;
}

function formatSignedDeviation(milliseconds) {
  if (Math.abs(milliseconds) < 1) return `±${formatSeconds(0)}`;
  return `${milliseconds > 0 ? '+' : '-'}${formatSeconds(Math.abs(milliseconds))}`;
}

function accuracyClass(absDeviationMs, targetSeconds) {
  const ratio = absDeviationMs / (targetSeconds * 1000);
  if (ratio <= 0.03) return 'acc-great';
  if (ratio <= 0.08) return 'acc-good';
  if (ratio <= 0.15) return 'acc-fair';
  return 'acc-poor';
}

function modeLabel(mode = 'daily') {
  if (mode === 'daily') return '今日挑战';
  if (mode === 'replay') return '今日复战';
  return '自由模式';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function updateHudStars(completedTargets, totalTargets = DAILY_TARGETS.length) {
  const count = Math.max(1, totalTargets);
  $('hudStars').innerHTML = Array.from({ length: count }, (_, index) =>
    index < completedTargets ? '<span class="lit">★</span>' : '<span>☆</span>'
  ).join(' ');
}
