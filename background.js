import {isArena, streamSession, decode64, validateToken, SSEParser, publicTokens, extractModels} from './core.js';
import {createHistoryStore, conversationUrl, createAutoRenameStore} from './history.js';
import {extractUsage, mergeUsage, summarizeUsage, formatUsage} from './usage.js';
import {sessionFromUrl, emptyView, historicalView} from './restore.js';
import {createHudPreferences} from './hud-preferences.js';

const history = createHistoryStore(chrome.storage.local);
const autoRename = createAutoRenameStore(chrome.storage.local);
const storageReady = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).then(() => true, () => false);

const hudPreferences = createHudPreferences(chrome.storage.local, storageReady);
const sessions = new Map();
const listenCommands = new Map();
const archiveTickets = new Map();
const command = (tabId, method, params = {}) => chrome.debugger.sendCommand({tabId}, method, params);
const safeState = s => s ? {enabled: true, ...s.view} : {enabled: false, ...emptyView()};
const restoreTickets = new Map();
const invalidateRestore = tabId => restoreTickets.set(tabId, (restoreTickets.get(tabId) || 0) + 1);
function publish(tabId, state) {
  chrome.tabs.sendMessage(tabId, {type: 'ATI_STATE', state}).catch(() => {});
  chrome.runtime.sendMessage({type: 'ATI_STATE', tabId, state}).catch(() => {});
  chrome.action.setBadgeText({tabId, text: state.historical ? 'H' : state.enabled ? (state.models.length ? 'OK' : 'ON') : ''}).catch(() => {});
  chrome.action.setBadgeBackgroundColor({tabId, color: state.historical ? '#65583c' : '#165f54'}).catch(() => {});
}
function alignPage(tabId, url) {
  const s = sessions.get(tabId), id = sessionFromUrl(url);
  if (s && s.pageSession !== id) {
    // Moving from the new-chat route to its first stream's session is not a new job.
    const adoptingNewChat = s.pageSession === null && id !== null && s.activeSession === id;
    s.pageSession = id;
    invalidateRestore(tabId);
    if (!adoptingNewChat) {
      cancelLookup(s); s.streams.clear(); s.activeSession = id; s.resolvedRun = null; s.hasCapture = false;
      s.view = emptyView(id, true);
      publish(tabId, safeState(s));
    }
  }
}
function hasLiveView(s, id) {
  return !!s && (s.hasCapture || (!s.view.historical && !!s.view.runId)) && (s.view.sessionId === id || (!id && s.pageSession === null));
}
async function restoreForTab(tabId, expectedUrl = null) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const pageUrl = tab?.pendingUrl || tab?.url;
  if (expectedUrl && sessionFromUrl(expectedUrl) !== sessionFromUrl(pageUrl)) return {enabled: !!sessions.get(tabId), ...emptyView(sessionFromUrl(expectedUrl)), restoring: true};
  if (!tab || !isArena(pageUrl)) return {enabled: false, ...emptyView()};
  alignPage(tabId, pageUrl);
  const id = sessionFromUrl(pageUrl), s = sessions.get(tabId);
  if (hasLiveView(s, id)) { publish(tabId, safeState(s)); return safeState(s); }
  invalidateRestore(tabId);
  const ticket = restoreTickets.get(tabId);
  let record = null, failed = false;
  if (id) {
    try {
      if (!await storageReady) throw Error('storage unavailable');
      record = await history.get(id);
    } catch { failed = true; }
  }
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  // A slow disk read must never overwrite a newer navigation or live trace.
  if (!currentTab || !isArena(currentTab.pendingUrl || currentTab.url) || sessionFromUrl(currentTab.pendingUrl || currentTab.url) !== id || restoreTickets.get(tabId) !== ticket || sessions.get(tabId) !== s) {
    return {enabled: !!sessions.get(tabId), ...emptyView(sessionFromUrl(currentTab?.pendingUrl || currentTab?.url), !!sessions.get(tabId)), restoring: true};
  }
  if (hasLiveView(s, id)) return safeState(s);
  const view = historicalView(record, id, !!s) || emptyView(id, !!s);
  if (failed) view.status = '本地记录恢复失败；未删除已有记录，请重新打开插件重试。';
  if (s) s.view = view;
  const state = {enabled: !!s, ...view};
  publish(tabId, state);
  return state;
}

function update(tabId, s, patch) {
  if (sessions.get(tabId) !== s) return;
  Object.assign(s.view, patch);
  publish(tabId, safeState(s));
}

function cancelLookup(s) {
  s.generation++;
  clearTimeout(s.timer);
  s.abort?.abort();
  s.token = null;
  s.lastToken = null;
}

async function stop(tabId, detach = true, restore = true) {
  const s = sessions.get(tabId);
  invalidateRestore(tabId);
  if (!s) return restore ? restoreForTab(tabId) : safeState(null);
  sessions.delete(tabId);
  cancelLookup(s);
  s.streams.clear();
  if (detach) await chrome.debugger.detach({tabId}).catch(() => {});
  if (restore) return restoreForTab(tabId);
  const state = safeState(null); publish(tabId, state); return state;
}

async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isArena(tab.pendingUrl || tab.url)) throw new Error('请在 https://arena.ai 页面开启');
  if (sessions.has(tabId)) return safeState(sessions.get(tabId));
  const pageSession = sessionFromUrl(tab.pendingUrl || tab.url);
  const s = {streams: new Map(), generation: 0, pageSession, activeSession: pageSession, view: emptyView(pageSession, true)};
  // Do not detach an existing debugger owned by DevTools or another extension.
  try { await chrome.debugger.attach({tabId}, '1.3'); }
  catch { throw new Error('无法附加调试器。请结束 Codex 对此标签页的控制，或关闭该页 DevTools 后重试。'); }
  sessions.set(tabId, s);
  try { await command(tabId, 'Network.enable'); }
  catch { await stop(tabId); throw new Error('无法开启 Network 事件捕获'); }
  update(tabId, s, {});
  return restoreForTab(tabId);
}

async function lookup(tabId, s, token, sessionId) {
  if (s.lastToken === token) return;
  let claims;
  try { claims = validateToken(token, sessionId); }
  catch (e) { update(tabId, s, {status: e.message}); return; }
  cancelLookup(s);
  invalidateRestore(tabId);
  s.token = token;
  s.lastToken = token;
  const generation = s.generation;
  const live = () => sessions.get(tabId) === s && s.generation === generation;
  update(tabId, s, {status: '已取得本次运行标识，读取 trace…', sessionId, historical: false, runId: claims.runId, models: [], run: null, usage: null, checkedAt: null, saved: false, usageText: '', totalUsageText: ''});
  let attempt = 0;
  const poll = async () => {
    if (!live()) return;
    if (Date.now() / 1000 >= claims.exp - 5) { s.token = null; update(tabId, s, {status: '令牌已过期，请发送新的消息'}); return; }
    attempt++;
    s.abort = new AbortController();
    const timeout = setTimeout(() => s.abort?.abort(), 10000);
    try {
      // Fixed origin, exact run scope, no redirects, cookies or write endpoints.
      const response = await fetch('https://api.trigger.dev/api/v1/runs/' + encodeURIComponent(claims.runId) + '/events', {
        method: 'GET', headers: {Authorization: 'Bearer ' + s.token, Accept: 'application/json'},
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: s.abort.signal
      });
      if (!live()) return;
      if (!response.ok) {
        const labels = {401: '令牌被拒绝或已过期', 403: '该令牌无权读取 trace', 404: '运行 trace 不存在', 429: '接口限流，已停止查询'};
        throw new Error(labels[response.status] || ('trace 返回 HTTP ' + response.status));
      }
      const text = await response.text();
      if (!live()) return;
      if (text.length > 4 * 1024 * 1024) throw new Error('trace 超过 4 MB，停止解析');
      const trace = JSON.parse(text);
      const models = extractModels(trace, claims.runId);
      const checkedAt = new Date().toISOString();
      const extracted = extractUsage(trace, claims.runId, checkedAt);
      const priorRuns = s.view.run?.runId === claims.runId ? [s.view.run] : [];
      const usage = mergeUsage(priorRuns, extracted).find(r => r.runId === claims.runId);
      const usageTotals = summarizeUsage([usage]);
      if (models.length) {
        s.resolvedRun = claims.runId;
        update(tabId, s, {status: '已读取模型标签，正在保存会话记录…', models, checkedAt, run: usage, usage: usageTotals, usageText: formatUsage(usageTotals)});
        try {
          if (!await storageReady) throw new Error('storage unavailable');
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          if (!live()) return;
          // Capture title only when it belongs to this run's actual conversation.
          const expectedUrl = conversationUrl(sessionId);
          const matchingTab = tab?.url?.split(/[?#]/)[0] === expectedUrl;
          const record = await history.save({sessionId, title: matchingTab ? tab.title : undefined, models, runId: claims.runId, checkedAt, usage});
          if (live()) update(tabId, s, {status: '已识别并保存会话—模型记录', saved: true, totalUsageText: formatUsage(record.totals)});
        } catch {
          if (live()) update(tabId, s, {status: '已识别模型，但本地保存失败；请检查存储权限或空间', saved: false});
        }
        if (live() && s.view.saved && attempt < 8 && (usageTotals.partial || usageTotals.tokenCoverage < usageTotals.spanCount || usageTotals.costCoverage < usageTotals.spanCount)) {
          update(tabId, s, {status: '已识别模型，等待用量补齐 ' + attempt + '/8'});
          s.timer = setTimeout(poll, 3000);
        } else { s.token = null; s.lastToken = null; }
        return;
      }
      if (attempt >= 8) { s.token = null; s.lastToken = null; update(tabId, s, {status: 'trace 未包含模型标签；不猜测模型'}); return; }
      update(tabId, s, {status: 'trace 暂无模型标签，等待重试 ' + attempt + '/8'});
      s.timer = setTimeout(poll, 3000);
    } catch (e) {
      if (live()) {
        s.token = null; s.lastToken = null;
        const known = /令牌|trace|接口|运行|无权/.test(e.message || '');
        update(tabId, s, {status: known ? e.message : 'trace 请求失败或超时，请检查网络和扩展站点权限'});
      }
    } finally { clearTimeout(timeout); }
  };
  await poll();
}

async function onNetwork(tabId, method, p) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (method === 'Network.responseReceived') {
    const sessionId = streamSession(p.response.url);
    if (!sessionId || p.response.status !== 200) return;
    if (s.pageSession && s.pageSession !== sessionId) return; // Ignore a delayed stream from another conversation.
    s.hasCapture = true;
    invalidateRestore(tabId);
    if (s.streams.size >= 8) s.streams.delete(s.streams.keys().next().value);
    if (s.activeSession !== sessionId) {
      cancelLookup(s); s.activeSession = sessionId; s.resolvedRun = null;
      update(tabId, s, {status: '已捕获会话流，等待运行令牌…', sessionId, historical: false, runId: null, models: [], run: null, usage: null, checkedAt: null, saved: false, usageText: '', totalUsageText: ''});
    }
    const stream = {sessionId, ready: false, pending: [], pendingBytes: 0, tapped: false};
    stream.parser = new SSEParser(frame => {
      if (s.activeSession !== sessionId) return;
      for (const token of publicTokens(frame)) {
        void lookup(tabId, s, token, sessionId);
      }
    });
    s.streams.set(p.requestId, stream);
    try {
      const result = await command(tabId, 'Network.streamResourceContent', {requestId: p.requestId});
      if (sessions.get(tabId) !== s || s.streams.get(p.requestId) !== stream) return;
      stream.tapped = true;
      if (result.bufferedData) stream.parser.push(decode64(result.bufferedData));
      for (const bytes of stream.pending) stream.parser.push(bytes);
    } catch {
      update(tabId, s, {status: '流式读取不可用，等待完整响应后尝试解析'});
    } finally { stream.ready = true; stream.pending = []; }
  }
  const stream = s.streams.get(p.requestId);
  if (!stream) return;
  if (method === 'Network.dataReceived' && p.data) {
    try {
      const bytes = decode64(p.data);
      if (!stream.ready) {
        stream.pendingBytes += bytes.length;
        if (stream.pendingBytes > 2 * 1024 * 1024) throw new Error('流缓冲区超限');
        stream.pending.push(bytes);
      } else stream.parser.push(bytes);
    } catch { s.streams.delete(p.requestId); update(tabId, s, {status: '流解析失败，已停止读取该响应'}); }
  }
  if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
    if (!stream.tapped) {
      try {
        const r = await command(tabId, 'Network.getResponseBody', {requestId: p.requestId});
        stream.parser.push(r.base64Encoded ? decode64(r.body) : new TextEncoder().encode(r.body));
      } catch { update(tabId, s, {status: '响应正文不可用，请重新发送测试消息'}); }
    }
    s.streams.delete(p.requestId);
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined && !source.sessionId) void onNetwork(source.tabId, method, params).catch(() => {
    const s = sessions.get(source.tabId); if (s) update(source.tabId, s, {status: '捕获异常，请停止后重新开启'});
  });
});
chrome.debugger.onDetach.addListener(source => { if (source.tabId !== undefined) void stop(source.tabId, false); });
chrome.tabs.onRemoved.addListener(tabId => {
  void stop(tabId, true, false).finally(() => restoreTickets.delete(tabId));
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) {
    if (!isArena(change.url)) { void stop(tabId, true, false); return; }
    alignPage(tabId, change.url);
    // Clear a previous historical overlay immediately, then load only this URL's record.
    if (!sessions.has(tabId)) publish(tabId, {enabled: false, ...emptyView(sessionFromUrl(change.url))});
    void restoreForTab(tabId);
  } else if (change.status === 'complete') {
    void restoreForTab(tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (msg.type === 'ATI_HISTORY_LIST' && popup) {
    history.list().then(records => reply({records}), () => reply({error: '读取本地记录失败', records: []}));
    return true;
  }
  if (msg.type === 'ATI_HISTORY_DELETE') {
    (async () => {
      if (!await storageReady) throw Error('storage unavailable');
      if (!popup) {
        if (!isArena(sender.url) || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) throw Error('Invalid sender');
        const tab=await chrome.tabs.get(sender.tab.id);
        if(sessionFromUrl(tab.pendingUrl||tab.url)!==msg.sessionId || sessionFromUrl(msg.pageUrl)!==msg.sessionId)throw Error('Stale page');
      }
      await history.remove(msg.sessionId);
      for(const [id,s] of sessions)if(s.view.sessionId===msg.sessionId&&!s.view.historical){
        update(id,s,{saved:false,totalUsageText:'',status:'本地记录已删除；当前捕获仍保留在内存中'});
      }
      // Refresh historical overlays without stopping an active capture.
      const tabs = await chrome.tabs.query({url: 'https://arena.ai/*'}).catch(() => []);
      await Promise.all(tabs.filter(tab => sessionFromUrl(tab.pendingUrl || tab.url) === msg.sessionId)
        .map(tab => restoreForTab(tab.id).catch(() => {})));
      reply({ok: true});
    })().catch(() => reply({error: '删除本地记录失败，请重试'}));
    return true;
  }
  if (msg.type === 'ATI_ARCHIVE_FINISH') {
    (async()=>{
      const entry=archiveTickets.get(msg.ticket);
      if(popup||sender.frameId!==0||!isArena(sender.url)||!entry||entry.tabId!==sender.tab?.id||entry.expires<Date.now())throw Error('Invalid archive ticket');
      const tab=await chrome.tabs.get(entry.tabId);if(!isArena(tab.pendingUrl||tab.url))throw Error('Invalid page');
      if(msg.archived!==true)throw Error('Archive unconfirmed');
      if(!await storageReady)throw Error('Storage unavailable');
      await history.remove(entry.sessionId);archiveTickets.delete(msg.ticket);
      await restoreForTab(entry.tabId).catch(()=>{});
      reply({ok:true});
    })().catch(()=>reply({error:'聊天可能已归档，但本地记录未能删除；请在扩展会话列表重试删除记录'}));
    return true;
  }
  const tabId = popup ? msg.tabId : sender.tab?.id;
  if (!Number.isInteger(tabId) || (!popup && !isArena(sender.url))) return;
  if (msg.type === 'ATI_HUD_GET' || msg.type === 'ATI_HUD_SAVE') {
    const task = msg.type === 'ATI_HUD_GET' ? hudPreferences.get() : hudPreferences.save(msg.prefs);
    task.then(prefs => reply({prefs}), () => reply({error: '界面位置与收起状态保存／读取失败'}));
    return true;
  }
  // sender.url can remain the original document URL after an Arena SPA navigation.
  // The current URL claim is still checked against this sender's actual tab.
  const pageUrl = !popup && typeof msg.pageUrl === 'string' ? msg.pageUrl : sender.url;
  if (!popup && !isArena(pageUrl)) return;
  if(msg.type==='ATI_ARCHIVE_PREPARE'){
    (async()=>{
      if(popup||sender.frameId!==0||!await storageReady)throw Error('Invalid sender');
      conversationUrl(msg.sessionId);
      const tab=await chrome.tabs.get(tabId);
      if(sessionFromUrl(tab.pendingUrl||tab.url)!==msg.sessionId||sessionFromUrl(pageUrl)!==msg.sessionId)throw Error('Stale page');
      await stop(tabId); // Invalidate in-flight captures before touching the chat.
      for(const [key,value] of archiveTickets)if(value.expires<Date.now()||value.tabId===tabId)archiveTickets.delete(key);
      const ticket=crypto.randomUUID();archiveTickets.set(ticket,{tabId,sessionId:msg.sessionId,expires:Date.now()+120000});
      reply({ticket});
    })().catch(()=>reply({error:'无法准备归档；未删除聊天或本地记录'}));
    return true;
  }
  if (['ATI_AUTO_RENAME_GET' ,'ATI_AUTO_RENAME_SET','ATI_AUTO_RENAME_CLAIM'].includes(msg.type)) {
    (async()=>{
      if(popup || sender.frameId!==0 || !await storageReady)throw Error('Invalid sender');
      const tab=await chrome.tabs.get(tabId);
      if(!isArena(tab.pendingUrl||tab.url)||sessionFromUrl(tab.pendingUrl||tab.url)!==sessionFromUrl(pageUrl))throw Error('Stale page');
      if(msg.type==='ATI_AUTO_RENAME_GET')return autoRename.get();
      if(msg.type==='ATI_AUTO_RENAME_SET')return autoRename.set(msg.enabled);
      const s=sessions.get(tabId),v=s?.view,spans=v?.run?.spans||[];
      if(!s||v.historical||!v.saved||v.sessionId!==msg.sessionId||v.runId!==msg.runId||sessionFromUrl(pageUrl)!==msg.sessionId||!v.models?.length||!spans.length||!spans.every(c=>c.partial===false&&!c.error&&!c.cancelled))return {claimed:false};
      return {claimed:await autoRename.claim(msg.sessionId)};
    })().then(reply,()=>reply({error:'自动重命名设置或状态校验失败，请重试'}));
    return true;
  }
  if (msg.type === 'ATI_STATUS') {
    restoreForTab(tabId, popup ? null : pageUrl).then(reply, () => reply({enabled: false, ...emptyView(), status: '读取本地记录失败，请重试。'}));
    return true;
  }
  const setListening = msg.type === 'ATI_SET_LISTENING';
  if (!setListening && (msg.type !== 'ATI_TOGGLE' || !popup)) return;
  if (setListening && (typeof msg.enabled !== 'boolean' || (!popup && sender.frameId != null && sender.frameId !== 0))) return;
  // A page can control only its own tab (sender.tab.id), never msg.tabId.
  // Serialize popup and HUD actions; repeated "enable" requests are idempotent.
  const task = (listenCommands.get(tabId) || Promise.resolve()).catch(() => {}).then(async () => {
    try {
      if (!popup) {
        const tab = await chrome.tabs.get(tabId);
        const url = tab.pendingUrl || tab.url;
        if (!isArena(url) || sessionFromUrl(url) !== sessionFromUrl(pageUrl)) throw new Error('页面已变化，请在当前 Arena 页面重试');
      }
      const enabled = setListening ? msg.enabled : !sessions.has(tabId);
      reply(enabled ? await start(tabId) : await stop(tabId));
    } catch (e) {
      const state = await restoreForTab(tabId).catch(() => safeState(sessions.get(tabId)));
      reply({...state, error: e.message, status: e.message});
    }
  });
  listenCommands.set(tabId, task);
  const cleanup = () => { if (listenCommands.get(tabId) === task) listenCommands.delete(tabId); };
  task.then(cleanup, cleanup);
  return true;
});
