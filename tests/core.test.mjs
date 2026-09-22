import test from 'node:test';
import assert from 'node:assert/strict';
import {isArena, streamSession, validateToken, publicTokens, SSEParser, extractModels, isFatalTraceStatus, parseProbeTargets, matchProbeTargets, DEFAULT_PROBE_TARGETS} from '../core.js';
const claims = {pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:9999999999,scopes:['read:runs:run_abc123','read:sessions:session-123','write:sessions:session-123']};
const jwt = c => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.test';
test('origin and exact stream path restrictions', () => {
  assert.equal(isArena('https://arena.ai/agent'), true);
  assert.equal(isArena('https://arena.ai.evil.test/agent'), false);
  assert.equal(streamSession('https://arena.ai/ai-proxy/realtime/v1/sessions/session-123/out?q=1'), 'session-123');
  assert.equal(streamSession('https://arena.ai/ai-proxy/realtime/v2/sessions/session-123/stream'), 'session-123');
  assert.equal(streamSession('https://evil.test/ai-proxy/realtime/v1/sessions/session-123/out'), null);
});
test('valid token is constrained to current session and one run', () => {
  assert.equal(validateToken(jwt(claims), 'session-123').runId, 'run_abc123');
  assert.throws(() => validateToken(jwt(claims), 'another-session'));
  assert.throws(() => validateToken(jwt({...claims,exp:1}), 'session-123'));
  assert.throws(() => validateToken(jwt({...claims,aud:'https://evil.test'}), 'session-123'));
  assert.throws(() => validateToken(jwt({...claims,pub:false}), 'session-123'));
  assert.throws(() => validateToken(jwt({...claims,scopes:[...claims.scopes,'read:runs:run_other']}), 'session-123'));
  assert.throws(() => validateToken('broken', 'session-123'));
  const modern = {pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:9999999999,run:'run_abc123'};
  assert.equal(validateToken(jwt(modern), 'session-123').runId, 'run_abc123');
  assert.equal(validateToken(jwt({...modern,aud:undefined}), 'session-123').runId, 'run_abc123');
});
test('SSE arbitrary byte chunking and UTF-8 / CRLF boundaries', () => {
  const output = [];
  const parser = new SSEParser(x => output.push(x));
  const frame = {records:[{headers:[['public-access-token',jwt(claims)]]}],text:'中文测试'};
  const bytes = Buffer.from('event: ping\r\ndata: {"ping":true}\r\n\r\nevent: batch\r\ndata: '+JSON.stringify(frame)+'\r\n\r\n');
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  assert.equal(output.length,2);
  assert.equal(output[1].text,'中文测试');
  assert.deepEqual(publicTokens(output[1]),[jwt(claims)]);
});
test('only headers count as tokens, not user text', () => {
  assert.deepEqual(publicTokens({records:[{body:'public-access-token: fake'}]}),[]);
  assert.deepEqual(publicTokens({headers:{'PUBLIC-ACCESS-TOKEN':'value'}}),['value']);
});
test('ignore malformed JSON and bound retained buffer', () => {
  const out=[]; const p = new SSEParser(x=>out.push(x));
  p.push(Buffer.from('data: bad\n\ndata: {"ok":true}\n\n'));
  assert.deepEqual(out,[{ok:true}]);
  assert.throws(()=>p.push(Buffer.from('x'.repeat(2*1024*1024+1))));
});
test('trace exact model span; deduplicate; reject unrelated runs and cost labels', () => {
  const event={runId:'run_abc123',message:'ai.streamText.doStream',spanId:'span1',style:{icon:'ai-provider-xai',accessory:{items:[{text:'grok-4.6',icon:'tabler-cube'},{text:'$0.0133',icon:'tabler-currency-dollar'}]}}};
  const out=extractModels({events:[event,event,{...event,runId:'run_other'},{...event,message:'chat title'}]},'run_abc123');
  assert.deepEqual(out,[{model:'grok-4.6',provider:'xai',spanId:'span1',partial:false}]);
  assert.deepEqual(extractModels({events:[]},'run_abc123'),[]);
  assert.throws(()=>extractModels({},'run_abc123'));
  const generate={runId:'run_abc123',message:'ai.generateText.doGenerate',spanId:'span2',style:{icon:'ai-provider-openai',accessory:{items:[{text:'gpt-6',icon:'tabler-cube'}]}}};
  assert.equal(extractModels({events:[generate]},'run_abc123')[0].model,'gpt-6');
  assert.equal(extractModels({data:{events:[generate]}},'run_abc123')[0].model,'gpt-6');
});
test('fatal trace statuses stop; 404 is retryable', () => {
  assert.equal(isFatalTraceStatus(401), true);
  assert.equal(isFatalTraceStatus(403), true);
  assert.equal(isFatalTraceStatus(429), true);
  assert.equal(isFatalTraceStatus(404), false);
  assert.equal(isFatalTraceStatus(500), false);
});
test('probe shorthands match official 2026 ids and ignore previous generations', () => {
  assert.deepEqual(parseProbeTargets('opus5, fable5., gpt6'), DEFAULT_PROBE_TARGETS);
  assert.equal(matchProbeTargets(['claude-opus-5'],['opus5'])[0].model,'claude-opus-5');
  assert.equal(matchProbeTargets(['Claude Opus 5'],['opus5']).length,1);
  assert.equal(matchProbeTargets(['claude-opus-4.5'],['opus5']).length,0);
  assert.equal(matchProbeTargets(['claude-fable-5-1'],['fable5'])[0].model,'claude-fable-5-1');
  assert.equal(matchProbeTargets(['Claude Fable 5.1'],['fable5']).length,1);
  assert.equal(matchProbeTargets(['gpt-6-astra'],['gpt6'])[0].model,'gpt-6-astra');
  assert.equal(matchProbeTargets(['GPT-6 Astra'],['gpt6']).length,1);
  assert.equal(matchProbeTargets(['gpt-5.6-sol'],['gpt6']).length,0);
  assert.equal(matchProbeTargets(['gpt-6-astra'],['/gpt-6-astra/'])[0].model,'gpt-6-astra');
  assert.equal(matchProbeTargets(['gpt-6-pro'],['/gpt-6-astra/']).length,0);
  assert.equal(matchProbeTargets([{model:'grok-4.6'}],['opus5']).length,0);
});
