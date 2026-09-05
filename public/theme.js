// 延续两个游戏的深色偏好：任一游戏开启了深色模式，导航页跟随；否则跟随系统。
try {
  let dark = null;
  for (const key of ['time-sense-v1', 'schulte-daily-v2']) {
    try {
      const raw = localStorage.getItem(key);
      const settings = raw ? JSON.parse(raw).settings || {} : {};
      if (typeof settings.dark === 'boolean') dark = settings.dark;
    } catch { /* storage disabled */ }
    if (dark === true) break;
  }
  if (dark == null) dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.dataset.theme = 'dark';
} catch { /* storage disabled */ }
