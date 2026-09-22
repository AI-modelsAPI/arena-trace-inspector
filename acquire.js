/* Model-name acquisition: SSE token → Trigger.dev trace → cube label. */
(() => {
  function snapshot(state, sessionId) {
    if (!state?.enabled) return {ok: false, stage: 'idle', status: state?.status || '未开启监听'};
    if (state.historical) return {ok: false, stage: 'stream', status: state.status || '仍是历史记录，等待本次运行'};
    if (sessionId && state.sessionId && state.sessionId !== sessionId) return {ok: false, stage: 'stream', status: '等待当前会话流…'};
    if (Array.isArray(state.models) && state.models.length && (!sessionId || state.sessionId === sessionId)) {
      return {ok: true, stage: 'model', sessionId: state.sessionId, runId: state.runId, models: state.models, status: state.status || '已识别模型'};
    }
    if (state.runId) return {ok: false, stage: 'trace', sessionId: state.sessionId, runId: state.runId, status: state.status || '已取得运行令牌，读取 trace…'};
    if (state.sessionId) return {ok: false, stage: 'token', sessionId: state.sessionId, status: state.status || '已捕获会话流，等待运行令牌…'};
    return {ok: false, stage: 'stream', status: state.status || '等待会话流'};
  }
  async function waitForModel({sessionId, timeout = 180000, isCurrent, abortReason, onStage, send, interval = 400, abortGrace = 2500}) {
    const end = Date.now() + timeout;
    let last = '';
    let lostSince = 0;
    while (Date.now() < end) {
      if (isCurrent && !isCurrent()) {
        // SPA routers flicker through intermediate URLs during hydration; only a
        // sustained mismatch counts as really leaving the page. The reason is
        // included so the next false positive is diagnosable from the message.
        if (!lostSince) lostSince = Date.now();
        if (Date.now() - lostSince > abortGrace) {
          throw Error('页面已变化，停止获取模型名' + (abortReason ? '（' + (abortReason() || '原因未知') + '）' : ''));
        }
      } else lostSince = 0;
      const raw = await send({type: 'ATI_ACQUIRE', sessionId, pageUrl: location.href});
      const snap = raw?.ok || raw?.stage ? raw : snapshot(raw, sessionId);
      const line = snap.status || '';
      if (line && line !== last) { last = line; onStage?.(snap); }
      if (snap.ok && snap.models?.length) return snap;
      if (snap.fatal) throw Error(snap.status || '模型名获取失败');
      await new Promise(r => setTimeout(r, interval));
    }
    throw Error((last || '检测超时') + '；未从 trace 读到模型名称');
  }
  globalThis.ArenaAcquire = {snapshot, waitForModel};
})();
