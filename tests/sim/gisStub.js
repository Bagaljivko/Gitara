// Lažni Google Identity Services (accounts.google.com/gsi/client) za testove sa tests/sim/driveSim.mjs.
// GIS_STUB je tekst skripte: servira ga routeHandler(sim) umesto pravog GIS-a, ili ide kroz page/context.addInitScript.
// Svaku odluku („koji nalog je prijavljen“, „da li je korisnik dozvolio“) donosi Node simulator preko
// window.__simAuth(req) (context.exposeBinding u installSim), pa test upravlja ponašanjem po uređaju.
export const GIS_STUB = `(() => {
  const g = (window.google = window.google || {});
  g.accounts = g.accounts || {};
  if (g.accounts.oauth2 && g.accounts.oauth2.__sim) return;
  const ask = (req) => (typeof window.__simAuth === 'function'
    ? Promise.resolve(window.__simAuth(req))
    : Promise.resolve({ error_callback: { type: 'popup_failed_to_open', message: 'sim: __simAuth missing' } }));
  const err = (e) => Object.assign(new Error(e.message || e.type), e);
  function deliver(cfg, r) {
    if (!r || r.hang) return; // korisnik nikad ne završi prozor
    setTimeout(() => {
      if (r.error_callback) { if (typeof cfg.error_callback === 'function') cfg.error_callback(err(r.error_callback)); return; }
      if (typeof cfg.callback === 'function') cfg.callback(r.callback);
    }, r.delay || 0);
  }
  const has = (resp, list) => { const s = new Set(String((resp && resp.scope) || '').split(/\\s+/).filter(Boolean)); return list.map((x) => s.has(x)); };
  g.accounts.oauth2 = {
    __sim: true,
    initTokenClient(cfg) {
      return {
        requestAccessToken(o = {}) {
          const prompt = o.prompt !== undefined ? o.prompt : cfg.prompt;
          ask({ kind: 'token', client_id: cfg.client_id, scope: o.scope || cfg.scope, hint: o.login_hint || o.hint || cfg.login_hint || cfg.hint || '',
            prompt: prompt === undefined ? '' : prompt, select_account: prompt === 'select_account',
            include_granted_scopes: (o.include_granted_scopes !== undefined ? o.include_granted_scopes : cfg.include_granted_scopes) !== false })
            .then((r) => deliver(cfg, r), () => deliver(cfg, { error_callback: { type: 'unknown', message: 'sim error' } }));
        },
      };
    },
    initCodeClient(cfg) {
      return {
        requestCode() {
          ask({ kind: 'code', client_id: cfg.client_id, scope: cfg.scope, hint: cfg.login_hint || cfg.hint || '', select_account: !!cfg.select_account,
            prompt: cfg.select_account ? 'select_account' : '', include_granted_scopes: cfg.include_granted_scopes !== false, ux_mode: cfg.ux_mode || 'popup' })
            .then((r) => deliver(cfg, r), () => deliver(cfg, { error_callback: { type: 'unknown', message: 'sim error' } }));
        },
      };
    },
    hasGrantedAllScopes(resp, ...s) { return has(resp, s).every(Boolean); },
    hasGrantedAnyScope(resp, ...s) { return has(resp, s).some(Boolean); },
    revoke(token, done) { ask({ kind: 'revoke', token }).then((r) => { if (typeof done === 'function') setTimeout(() => done((r && r.revoke) || { successful: true }), 0); }); },
  };
  g.accounts.id = g.accounts.id || { initialize() {}, prompt() {}, renderButton() {}, disableAutoSelect() {}, cancel() {} };
})();`;
