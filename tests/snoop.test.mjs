import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

test('page snoop tees session SSE and posts only the public token', async () => {
  const token = 'aaa.' + Buffer.from(JSON.stringify({pub: true})).toString('base64url') + '.sig';
  const sse = 'event: batch\ndata: ' + JSON.stringify({records: [{headers: [['public-access-token', token]], body: 'secret-chat'}]}) + '\n\n';
  const makeBody = () => {
    const bytes = new TextEncoder().encode(sse);
    const reader = () => {
      let sent = false;
      return {read: async () => sent ? {done: true} : ((sent = true), {done: false, value: bytes})};
    };
    return {tee: () => [{getReader: reader}, {getReader: reader}]};
  };
  const posts = [];
  const windowObj = {
    EventSource: function EventSource() {},
    postMessage(data, origin) { posts.push({data, origin}); }
  };
  windowObj.fetch = async () => ({ok: true, body: makeBody(), headers: {}, status: 200, statusText: 'OK'});
  class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status; this.headers = init.headers; this.statusText = init.statusText; } }
  const sandbox = {window: windowObj, location: {href: 'https://arena.ai/agent'}, URL, TextDecoder, Response: FakeResponse};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../snoop.js', import.meta.url), 'utf8'), sandbox);
  await windowObj.fetch('https://arena.ai/ai-proxy/realtime/v1/sessions/session-123/out');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].origin, 'https://arena.ai');
  assert.equal(posts[0].data.source, 'ati-snoop');
  assert.equal(posts[0].data.sessionId, 'session-123');
  assert.equal(posts[0].data.token, token);
  assert.equal(JSON.stringify(posts).includes('secret-chat'), false);
});
