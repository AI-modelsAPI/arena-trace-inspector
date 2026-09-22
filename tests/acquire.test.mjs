import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const sandbox = {location: {href: 'https://arena.ai/agent/s1'}, Date, setTimeout};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../acquire.js', import.meta.url), 'utf8'), sandbox);
const {snapshot, waitForModel} = sandbox.ArenaAcquire;

test('acquisition snapshot follows stream → token → trace → model', () => {
  assert.equal(snapshot({enabled: false}, 's').stage, 'idle');
  assert.equal(snapshot({enabled: true, historical: true, status: '历史'}, 's').stage, 'stream');
  assert.equal(snapshot({enabled: true, sessionId: 's'}, 's').stage, 'token');
  assert.equal(snapshot({enabled: true, sessionId: 's', runId: 'run_1', models: []}, 's').stage, 'trace');
  const hit = snapshot({enabled: true, sessionId: 's', runId: 'run_1', models: [{model: 'claude-opus-5'}]}, 's');
  assert.equal(hit.ok, true);
  assert.equal(hit.stage, 'model');
});

test('waitForModel returns when ATI_ACQUIRE reports labels', async () => {
  let n = 0;
  const stages = [];
  const result = await waitForModel({
    sessionId: 's1',
    timeout: 2000,
    send: async () => {
      n++;
      if (n < 2) return {ok: false, stage: 'token', status: '等待运行令牌'};
      return {ok: true, stage: 'model', models: [{model: 'gpt-6-astra'}], runId: 'run_x', status: '已识别'};
    },
    onStage: snap => stages.push(snap.stage)
  });
  assert.equal(result.models[0].model, 'gpt-6-astra');
  assert.ok(stages.includes('token'));
});

test('a transient page flicker below the grace window does not abort acquisition', async () => {
  let checks = 0;
  const result = await waitForModel({
    sessionId: 's1', timeout: 5000, interval: 5, abortGrace: 2500,
    // Mismatch for the first few polls (SPA intermediate URL), then settle back.
    isCurrent: () => ++checks > 3,
    send: async () => ({ok: true, stage: 'model', models: [{model: 'm'}], runId: 'r'}),
  });
  assert.equal(result.ok, true);
});

test('a sustained mismatch aborts with the specific reason', async () => {
  await assert.rejects(
    waitForModel({
      sessionId: 's1', timeout: 10000, interval: 5, abortGrace: 30,
      isCurrent: () => false,
      abortReason: () => '地址变为 /agent，本轮会话 s1',
      send: async () => ({ok: false, stage: 'token', status: '等待运行令牌'}),
    }),
    /页面已变化，停止获取模型名（地址变为 \/agent，本轮会话 s1）/
  );
});
