/* Isolated world: forward page-world tokens to the worker. Never keep the JWT. */
(() => {
  window.addEventListener('message', event => {
    if (event.origin !== 'https://arena.ai' || event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ati-snoop' || typeof data.token !== 'string' || typeof data.sessionId !== 'string') return;
    chrome.runtime.sendMessage({type: 'ATI_PAGE_TOKEN', token: data.token, sessionId: data.sessionId, pageUrl: location.href}).catch(() => {});
  });
})();
