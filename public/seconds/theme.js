try {
  const raw = localStorage.getItem('time-sense-v1');
  const settings = raw ? JSON.parse(raw).settings || {} : {};
  if (settings.dark) document.documentElement.dataset.theme = 'dark';
  if (settings.gridTheme != null) document.documentElement.dataset.gridTheme = String(settings.gridTheme);
} catch { /* storage disabled */ }
