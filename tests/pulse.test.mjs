import test from 'node:test';
import assert from 'node:assert/strict';
import '../pulse.js';
const P = globalThis.ArenaPulse;
test('live payload: {"pulse":99,"refreshedAt":"…"} parses to remaining percent + reset time', () => {
  const p = P.parse({pulse: 99, refreshedAt: '2026-09-22T02:28:42.070Z'});
  assert.equal(p.percentRemaining, 99);
  assert.equal(p.percentUsed, 1);
  assert.equal(p.resetAt, Date.parse('2026-09-22T02:28:42.070Z'));
  const now = Date.parse('2026-09-21T14:28:42.070Z'); // exactly 12h before reset
  assert.equal(P.format(p, now), '剩余额度 99% · 12:00:00 后重置');
});
test('reset countdown rolls to H:MM:SS and reports an expired window', () => {
  const p = P.parse({pulse: 40, refreshedAt: '2026-09-21T12:05:00Z'});
  assert.equal(P.format(p, Date.parse('2026-09-21T11:20:00Z')), '剩余额度 40% · 0:45:00 后重置');
  assert.match(P.format(p, Date.parse('2026-09-21T13:00:00Z')), /已到重置时间/);
});
test('remaining/level drive the progress bar traffic light', () => {
  assert.equal(P.remaining(P.parse({pulse: 99})), 99);
  assert.equal(P.level(P.parse({pulse: 99})), 'ok');
  assert.equal(P.level(P.parse({pulse: 19})), 'warn');
  assert.equal(P.level(P.parse({pulse: 9})), 'crit');
  assert.equal(P.level(P.parse({pulse: 10})), 'warn');
  assert.equal(P.level(P.parse({pulse: 20})), 'ok');
  assert.equal(P.remaining(P.parse({used: 120, limit: 500})), 76);
  assert.equal(P.remaining(null), null);
  assert.equal(P.level(null), 'unknown');
});
test('used/limit derives both sides; remaining/quota stays remaining', () => {
  const a = P.parse({used: 120, limit: 500});
  assert.equal(a.percentUsed, 24);
  assert.equal(a.percentRemaining, 76);
  assert.equal(P.format(a), '剩余额度 76%');
  const b = P.parse({remaining: 380, quota: 500});
  assert.equal(b.percentRemaining, 76);
});
test('fractional ratios and epoch-second reset timestamps are accepted', () => {
  const p = P.parse({usage: {percent_used: 0.42}, reset_at: 1760000000});
  assert.equal(p.percentUsed, 42);
  assert.equal(p.percentRemaining, 58);
  assert.equal(p.resetAt, 1760000000000);
});
test('unrecognized or malformed payloads return null, never a guess', () => {
  assert.equal(P.parse({foo: 1, bar: 'x'}), null);
  assert.equal(P.parse('pulse'), null);
  assert.equal(P.parse(null), null);
  assert.equal(P.parse([99]), null);
  assert.equal(P.format(null), '');
});
