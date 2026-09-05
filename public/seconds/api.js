window.TimeSenseApi = (() => {
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

  return {
    session: () => request('/api/session'),
    register: (username, pin) => request('/api/users', { method: 'POST', body: { username, pin } }),
    login: (username, pin) => request('/api/session', { method: 'POST', body: { username, pin } }),
    logout: () => request('/api/session', { method: 'DELETE' }),
    startRun: (run) => request('/api/seconds/runs/start', { method: 'POST', body: run }),
    finishRun: (result) => request('/api/seconds/runs/finish', { method: 'POST', body: result }),
    leaderboard: ({ mode, target, timeframe, includeReplay }) => {
      const query = new URLSearchParams({ mode, timeframe });
      if (target != null) query.set('target', target);
      if (includeReplay != null) query.set('replay', includeReplay ? '1' : '0');
      return request(`/api/seconds/leaderboard?${query}`);
    }
  };
})();
