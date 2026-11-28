(async () => {
  const runtime = window.IQC_RUNTIME;
  if (!runtime?.authentication) return;
  const settingsButton = document.getElementById('displaySettingsToggle');
  settingsButton.removeAttribute('popovertarget');
  settingsButton.removeAttribute('aria-haspopup');
  settingsButton.removeAttribute('aria-controls');
  settingsButton.removeAttribute('aria-expanded');
  settingsButton.addEventListener('click', () => location.assign('/settings'));
  const clearData = (includeFactory = false) => { try { ['qms_dash_cache', 'qms_factories_cache', ...(includeFactory ? ['qms_factory'] : [])].forEach(key => localStorage.removeItem(key)); } catch {} };
  const expire = () => { clearData(true); document.body.style.visibility = 'hidden'; location.replace('/login'); };
  window.IQCAccount = { expire };
  clearData();
  window.addEventListener('storage', event => { if (event.key === 'iqc_logout_event') expire(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') return;
    try { const response = await fetch('/api/auth/me', { cache: 'no-store' }); if (response.status === 401) expire(); else if (response.ok && (await response.json()).user.id !== runtime.user?.id) location.reload(); } catch {}
  });
})();
