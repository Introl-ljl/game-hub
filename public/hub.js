(() => {
  const $ = (id) => document.getElementById(id);

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] ||= 'application/json';
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败 (${response.status})`);
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  let currentUser = null;
  let apiAvailable = true;

  /* ---------- 北京时间时钟 ---------- */
  const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  function tickClock() {
    const now = new Date();
    const text = clockFormatter.format(now);
    const [date, time] = text.split(' ');
    $('todayLabel').textContent = `北京时间 · ${date}`;
    $('hubClock').textContent = time;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------- 首屏状态 ---------- */
  function renderUser() {
    const button = $('userButton');
    $('userLabel').textContent = currentUser?.username || (apiAvailable ? '登录' : '登录不可用');
    button.classList.toggle('signed-in', Boolean(currentUser));
  }

  async function loadSession() {
    try {
      const payload = await request('/api/session');
      currentUser = payload.user;
      apiAvailable = true;
      if (currentUser) $('signedInUsername').textContent = currentUser.username;
    } catch {
      apiAvailable = false;
    }
    renderUser();
  }

  async function loadParticipants() {
    const targets = [
      { endpoint: '/api/seconds/leaderboard?mode=daily&timeframe=today', players: 'secondsPlayers', state: 'secondsState', ready: '去挑战' },
      { endpoint: '/api/schulte/leaderboard?mode=daily&timeframe=today', players: 'schultePlayers', state: 'schulteState', ready: '去挑战' }
    ];
    await Promise.all(targets.map(async (item) => {
      const state = $(item.state);
      try {
        const board = await request(item.endpoint);
        $(item.players).textContent = `${board.participantCount} 人`;
        state.textContent = board.participantCount > 0 ? `挑战进行中 · ${item.ready}` : item.ready;
        state.classList.toggle('quiet', board.participantCount === 0);
      } catch {
        $(item.players).textContent = '—';
        state.textContent = '排行榜离线';
        state.classList.add('quiet');
      }
    }));
  }

  /* ---------- 方格预览 ---------- */
  const previewGrid = $('previewGrid');
  for (let index = 1; index <= 9; index += 1) {
    const tile = document.createElement('span');
    tile.textContent = index;
    tile.style.setProperty('--i', index - 1);
    previewGrid.appendChild(tile);
  }

  /* ---------- 用户弹窗 ---------- */
  let toastTimer = null;
  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.add('hidden'), 2600);
  }

  function openUserModal() {
    $('signedInPanel').classList.toggle('hidden', !currentUser);
    $('userForms').classList.toggle('hidden', Boolean(currentUser));
    $('userMessage').textContent = '';
    $('userModal').classList.remove('hidden');
    $('userModal').setAttribute('aria-hidden', 'false');
    (currentUser ? $('logoutBtn') : $('loginUsername')).focus();
  }

  function closeUserModal() {
    $('userModal').classList.add('hidden');
    $('userModal').setAttribute('aria-hidden', 'true');
  }

  $('userButton').addEventListener('click', openUserModal);
  $('userModalClose').addEventListener('click', closeUserModal);
  document.querySelectorAll('[data-close="userModal"]').forEach((element) => {
    element.addEventListener('click', closeUserModal);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('userModal').classList.contains('hidden')) closeUserModal();
  });

  $('toRegisterBtn').addEventListener('click', () => {
    $('loginPanel').classList.add('hidden');
    $('registerPanel').classList.remove('hidden');
    $('userMessage').textContent = '';
  });
  $('toLoginBtn').addEventListener('click', () => {
    $('registerPanel').classList.add('hidden');
    $('loginPanel').classList.remove('hidden');
    $('userMessage').textContent = '';
  });

  function showUserError(error) {
    $('userMessage').textContent = error.message || '请求失败，请稍后再试';
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type="submit"], button:not([type])');
    submit.disabled = true;
    try {
      const payload = await request('/api/session', {
        method: 'POST',
        body: { username: $('loginUsername').value.trim(), pin: $('loginPin').value }
      });
      currentUser = payload.user;
      $('signedInUsername').textContent = currentUser.username;
      $('loginPin').value = '';
      renderUser();
      openUserModal();
      toast(`欢迎回来，${currentUser.username}`);
    } catch (error) {
      showUserError(error);
    } finally {
      submit.disabled = false;
    }
  });

  $('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type="submit"], button:not([type])');
    submit.disabled = true;
    try {
      const payload = await request('/api/users', {
        method: 'POST',
        body: { username: $('registerUsername').value.trim(), pin: $('registerPin').value }
      });
      currentUser = payload.user;
      $('signedInUsername').textContent = currentUser.username;
      $('registerPin').value = '';
      renderUser();
      openUserModal();
      toast('注册成功，两个游戏都能玩了');
    } catch (error) {
      showUserError(error);
    } finally {
      submit.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    $('logoutBtn').disabled = true;
    try {
      await request('/api/session', { method: 'DELETE' });
      currentUser = null;
      renderUser();
      closeUserModal();
      toast('已退出登录');
    } catch (error) {
      showUserError(error);
    } finally {
      $('logoutBtn').disabled = false;
    }
  });

  loadSession();
  loadParticipants();
})();
