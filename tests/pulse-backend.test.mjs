import test from 'node:test';
import assert from 'node:assert/strict';

// Isolated module graph: this file gets its own background.js instance.
const hooks = {};
const event = name => ({addListener(fn) { hooks[name] = fn; }});
globalThis.chrome = {
  storage: {local: {setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}}},
  runtime: {id: 'test-extension', getURL: p => 'chrome-extension://test-extension/' + p, onMessage: event('message'), sendMessage: async () => {}},
  debugger: {attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}), onEvent: event('network'), onDetach: event('detach')},
  tabs: {get: async () => ({url: 'https://arena.ai/agent'}), sendMessage: async () => {}, onRemoved: event('removed'), onUpdated: event('updated'), query: async () => []},
  action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}},
};
let pulseStatus = 200, pulseRetry = null, pulseCalls = 0, pulseDefer = false, releasePulse;
const payload = {pulse: 99, refreshedAt: '2099-01-01T00:00:00Z'};
globalThis.fetch = async url => {
  if (!String(url).includes('/api/me/pulse')) throw Error('unexpected fetch: ' + url);
  pulseCalls++;
  if (pulseDefer) await new Promise(r => { releasePulse = r; });
  return {ok: pulseStatus === 200, status: pulseStatus, headers: {get: k => k === 'retry-after' ? pulseRetry : null}, json: async () => payload, text: async () => JSON.stringify(payload)};
};
await import('../background.js');
const popup = {id: 'test-extension', url: 'chrome-extension://test-extension/popup.html'};
const message = type => new Promise(resolve => hooks.message({type}, popup, resolve));

test('concurrent pulse reads share one in-flight request, then hit the 60s cache', async () => {
  pulseDefer = true;
  const p1 = message('ATI_PULSE_GET'), p2 = message('ATI_PULSE_GET');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  releasePulse();
  const [a, b] = await Promise.all([p1, p2]);
  pulseDefer = false;
  assert.equal(pulseCalls, 1, 'two simultaneous reads must produce exactly one fetch');
  assert.equal(a.pulse.percentRemaining, 99);
  assert.equal(b.pulse.percentRemaining, 99);
  const c = await message('ATI_PULSE_GET');
  assert.equal(pulseCalls, 1, 'a read within 60s must be served from cache');
  assert.equal(c.fetchedAt, a.fetchedAt);
});

test('a 429 backs off until retry-after and further reads fail fast without refetching', async () => {
  globalThis.__pulseResetForTest();
  pulseStatus = 429; pulseRetry = '1';
  const a = await message('ATI_PULSE_GET');
  assert.match(a.error, /429/);
  assert.equal(pulseCalls, 2);
  const b = await message('ATI_PULSE_GET');
  assert.match(b.error, /限流/);
  assert.equal(pulseCalls, 2, 'blocked window must not hit the API again');
  await new Promise(r => setTimeout(r, 1100));
  pulseStatus = 200; pulseRetry = null;
  const c = await message('ATI_PULSE_GET');
  assert.equal(c.pulse.percentRemaining, 99);
  assert.equal(pulseCalls, 3, 'recovery refetches once the backoff expires');
});
