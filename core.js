export function isArena(url) {
  try { return new URL(url).origin === 'https://arena.ai'; } catch { return false; }
}

export function streamSession(url) {
  if (!isArena(url)) return null;
  const path = new URL(url).pathname;
  return path.match(/^\/ai-proxy\/realtime\/v\d+\/sessions\/([a-zA-Z0-9-]+)\/(?:out|stream)$/)?.[1]
    || path.match(/^\/ai-proxy\/(?:v\d+\/)?realtime\/sessions\/([a-zA-Z0-9-]+)\/(?:out|stream)$/)?.[1]
    || null;
}

export function decode64(text) {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
}

const RUN_ID = /^run_[a-zA-Z0-9]+$/;
const RUN_SCOPE = /^read:runs:(run_[a-zA-Z0-9]+)$/;
const MODEL_SPANS = /^(ai\.(?:streamText\.doStream|generateText\.doGenerate|streamObject\.doStream|generateObject\.doGenerate))$/;
const CUBE_ICONS = new Set(['tabler-cube', 'cube', 'tabler-box']);
const TOKEN_HEADER_KEYS = new Set(['public-access-token', 'public_access_token', 'publicaccesstoken', 'x-public-access-token']);

export function runIdFromClaims(claims) {
  if (typeof claims?.run === 'string' && RUN_ID.test(claims.run)) return claims.run;
  const scopes = Array.isArray(claims?.scopes) ? claims.scopes : [];
  const runs = [];
  for (const scope of scopes) {
    const match = typeof scope === 'string' ? scope.match(RUN_SCOPE) : null;
    if (match && !runs.includes(match[1])) runs.push(match[1]);
  }
  return runs.length === 1 ? runs[0] : null;
}

// Decoding is NOT signature verification. Trigger.dev validates the token on GET.
export function validateToken(token, sessionId, now = Date.now() / 1000) {
  if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw new Error('令牌格式不符合预期');
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(decode64(token.split('.')[1]))); }
  catch { throw new Error('无法解析令牌'); }
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud == null ? [] : [claims.aud];
  if (claims.pub !== true || claims.iss !== 'https://id.trigger.dev') throw new Error('不是预期的公开运行令牌');
  if (aud.length && !aud.includes('https://api.trigger.dev')) throw new Error('不是预期的公开运行令牌');
  if (!Number.isFinite(claims.exp) || claims.exp <= now + 5) throw new Error('令牌已过期，请发送新的测试消息');
  const runId = runIdFromClaims(claims);
  if (!runId) throw new Error('令牌必须仅明确指定一个可读取运行');
  const scopes = Array.isArray(claims.scopes) ? claims.scopes : [];
  const sessionScopes = scopes.filter(s => typeof s === 'string' && s.startsWith('read:sessions:'));
  if (sessionScopes.length && !sessionScopes.includes('read:sessions:' + sessionId)) throw new Error('令牌与当前流会话不匹配');
  return {runId, exp: claims.exp};
}

export function isFatalTraceStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

export function traceStatusLabel(status) {
  return ({401: '令牌被拒绝或已过期', 403: '该令牌无权读取 trace', 404: '运行 trace 不存在', 429: '接口限流，已停止查询'})[status] || ('trace 返回 HTTP ' + status);
}

export class SSEParser {
  constructor(onFrame) { this.buffer = ''; this.decoder = new TextDecoder(); this.onFrame = onFrame; }
  push(bytes) {
    this.buffer += this.decoder.decode(bytes, {stream: true});
    let match;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      if (frame.length > 2 * 1024 * 1024) throw new Error('单个流事件过大，停止解析');
      const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) { let obj; try { obj = JSON.parse(data); } catch { continue; } this.onFrame(obj); }
    }
    if (this.buffer.length > 2 * 1024 * 1024) { this.buffer = ''; throw new Error('流缓冲区超限'); }
  }
}

export function publicTokens(frame) {
  const records = Array.isArray(frame?.records) ? frame.records : [frame];
  const tokens = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const headers = record.headers;
    const pairs = Array.isArray(headers) ? headers : headers && typeof headers === 'object' ? Object.entries(headers) : [];
    for (const pair of pairs) {
      const key = Array.isArray(pair) ? pair[0] : null;
      const value = Array.isArray(pair) ? pair[1] : null;
      if (TOKEN_HEADER_KEYS.has(String(key || '').toLowerCase()) && typeof value === 'string') tokens.push(value);
    }
    for (const key of ['publicAccessToken', 'public_access_token']) {
      if (typeof record[key] === 'string') tokens.push(record[key]);
    }
  }
  return tokens;
}

export function traceEvents(trace) {
  if (Array.isArray(trace?.events)) return trace.events;
  if (Array.isArray(trace?.data?.events)) return trace.data.events;
  if (Array.isArray(trace?.spans)) return trace.spans;
  if (Array.isArray(trace?.data) && trace.data.every(x => x && typeof x === 'object')) return trace.data;
  return null;
}

function spanName(event) {
  return String(event?.message || event?.name || event?.spanName || '');
}

function cubeItems(event) {
  const items = event?.style?.accessory?.items;
  return Array.isArray(items) ? items.filter(item => CUBE_ICONS.has(item?.icon) && typeof item.text === 'string' && item.text.trim() && item.text.length <= 200) : [];
}

export function extractModels(trace, runId) {
  const events = traceEvents(trace);
  if (!events) throw new Error('trace 格式不符合预期');
  const found = [];
  const push = (event, item) => {
    found.push({model: item.text, provider: String(event.style?.icon || '').replace(/^ai-provider-/, ''), spanId: event.spanId, partial: !!event.isPartial});
  };
  for (const event of events) {
    if (event.runId !== runId || !MODEL_SPANS.test(spanName(event))) continue;
    for (const item of cubeItems(event)) push(event, item);
  }
  if (!found.length) {
    for (const event of events) {
      if (event.runId !== runId) continue;
      for (const item of cubeItems(event)) push(event, item);
    }
  }
  return found.filter((x, i) => found.findIndex(y => y.model === x.model && y.provider === x.provider) === i);
}

export const DEFAULT_PROBE_TARGETS = ['opus5', 'fable5', 'gpt6'];

// Shorthands → official 2026 IDs: claude-opus-5, claude-fable-5 / 5.1, gpt-6-astra.
const PROBE_FAMILIES = {
  opus5: String.raw`(?:claude[-_\s.]*)?opus[-_\s.]*5(?:[-_.]\d+)?(?!\d)`,
  fable5: String.raw`(?:claude[-_\s.]*)?fable[-_\s.]*5(?:[-_.]\d+)?(?!\d)`,
  gpt6: String.raw`(?:chat)?gpt[-_\s.]*6(?:[-_\s.]*astra|[-_\s.]*pro)?(?!\d)`
};
const FAMILY_ALIASES = {
  opus5: 'opus5', claudeopus5: 'opus5',
  fable5: 'fable5', claudefable5: 'fable5', fable51: 'fable5', claudefable51: 'fable5',
  gpt6: 'gpt6', chatgpt6: 'gpt6', gpt6astra: 'gpt6', gpt6pro: 'gpt6', astra: 'gpt6'
};

export function normalizeModelKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function parseProbeTargets(text) {
  const parts = String(text ?? '').split(/[,，;；\n]+/).map(s => s.trim().replace(/[.\s]+$/, '')).filter(s => s.length >= 2 && s.length <= 80);
  return [...new Set(parts)].slice(0, 20);
}

export function compileProbeTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) return null;
  if (raw.length >= 3 && raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const last = raw.lastIndexOf('/');
    const body = raw.slice(1, last);
    let flags = raw.slice(last + 1).replace(/[^gimsuy]/g, '') || 'i';
    if (!flags.includes('i')) flags += 'i';
    if (!body || body.length > 120) return null;
    try { return {kind: 'regex', source: raw, regex: new RegExp(body, flags)}; }
    catch { return null; }
  }
  const family = FAMILY_ALIASES[normalizeModelKey(raw)];
  if (family) return {kind: 'family', source: raw, regex: new RegExp(PROBE_FAMILIES[family], 'i')};
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_\s.]+/g, '[-_\\s.]*');
  try { return {kind: 'literal', source: raw, regex: new RegExp(escaped, 'i')}; }
  catch { return null; }
}

export function matchProbeTargets(models, targets) {
  const names = (Array.isArray(models) ? models : []).map(m => typeof m === 'string' ? m : m?.model).filter(Boolean);
  const hits = [];
  for (const target of targets || []) {
    const compiled = compileProbeTarget(target);
    if (!compiled) continue;
    const index = names.findIndex(name => compiled.regex.test(name) || compiled.regex.test(normalizeModelKey(name)));
    if (index >= 0) hits.push({target, model: names[index]});
  }
  return hits;
}

