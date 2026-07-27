(() => {
  const SUPABASE_HOST = 'https://kipcvugwlghonpgvitjk.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable__GQklRAhqZ2zvxmrnsUmhQ_JYHazo-s';
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(SUPABASE_HOST)) return originalFetch(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('apikey', PUBLISHABLE_KEY);
    return originalFetch(input, { ...init, headers });
  };
})();