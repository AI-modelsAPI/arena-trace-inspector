import test from 'node:test';
import assert from 'node:assert/strict';

const hooks = {};
const notifications = [];
const calls = [];
const detached = [];
const event = name => ({addListener(fn) { hooks[name] = fn; }});
let buffered = '';
let fetchMode = 'ok';
let release;
const stored = {};
let storageFails = false;
globalThis.chrome = {
  storage: {local:{setAccessLevel:async()=>{}, get:async key=>key ? {[key]:stored[key]} : {...stored},set:async value=>{if(storageFails) throw new Error('quota');Object.assign(stored,structuredClone(value));}}},
  runtime: {id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:event('message'),sendMessage:async()=>{}},
  debugger: {attach:async()=>{},detach:async({tabId})=>{detached.push(tabId);},sendCommand:async(_target,method)=>method==='Network.streamResourceContent'?{bufferedData:buffered}:{},onEvent:event('network'),onDetach:event('detach')},
  tabs: {get:async()=>({url:'https://arena.ai/agent'}),sendMessage:async(tabId,msg)=>notifications.push({tabId,...msg}),onRemoved:event('removed'),onUpdated:event('updated')},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}
};
globalThis.fetch = async(url,options) => {
  calls.push({url,options});
  if(fetchMode==='deferred') await new Promise(resolve=>{release=resolve;});
  return {
    ok:fetchMode!=='401'&&fetchMode!=='404',status:fetchMode==='401'?401:fetchMode==='404'?404:200,
    text:async()=>JSON.stringify({events:[{runId:'run_test',message:'ai.streamText.doStream',spanId:'testspan',style:{icon:'ai-provider-xai',accessory:{items:[{text:'example-model',icon:'tabler-cube'}]}}}]})
  };
};
await import('../background.js');
const popup={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
const message=(type,tabId,sender=popup)=>new Promise(resolve=>hooks.message({type,tabId},sender,resolve));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const token=(session='test-session')=>'header.'+Buffer.from(JSON.stringify({pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:9999999999,scopes:['read:runs:run_test','read:sessions:'+session]})).toString('base64url')+'.sig';
const sse=(session='test-session', tok=token(session))=>'event: batch\ndata: '+JSON.stringify({records:[{headers:[['public-access-token',tok]]}]})+'\n\n';
const response=tabId=>hooks.network({tabId},'Network.responseReceived',{requestId:'request1',response:{status:200,url:'https://arena.ai/ai-proxy/realtime/v1/sessions/test-session/out'}});

test('background: buffered SSE -> fixed GET -> sanitized state -> stop',async()=>{
  buffered=Buffer.from(sse()).toString('base64');
  await message('ATI_TOGGLE',1); response(1); await tick(); await tick();
  const state=await message('ATI_STATUS',1);
  assert.equal(state.models[0].model,'example-model');
  assert.equal(state.run.spans.length,1);
  assert.equal(state.run.spans[0].evidence.model.value,'example-model');
  assert.equal(calls[0].url,'https://api.trigger.dev/api/v1/runs/run_test/events');
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token());
  assert.equal(JSON.stringify(notifications).includes(token()),false);
  assert.equal(JSON.stringify(state).includes(token()),false);
  const saved=stored['ati.conversation.v1.test-session'];
  assert.equal(saved.url,'https://arena.ai/agent/test-session');
  assert.equal(saved.observations[0].model,'example-model');
  assert.equal(JSON.stringify(stored).includes(token()),false);
  assert.equal(state.saved,true);
  await message('ATI_TOGGLE',1);
  assert.equal((await message('ATI_STATUS',1)).enabled,false);
  assert.ok(detached.includes(1));
});
test('background: history remains available without an active Arena tab',async()=>{
  const result=await message('ATI_HISTORY_LIST',undefined);
  assert.equal(result.records[0].sessionId,'test-session');
});
test('background: storage failure preserves detected model and reports failure',async()=>{
  buffered=Buffer.from(sse()).toString('base64'); storageFails=true;
  await message('ATI_TOGGLE',9); response(9); await tick(); await tick();
  const state=await message('ATI_STATUS',9);
  assert.equal(state.models[0].model,'example-model');
  assert.equal(state.saved,false);
  assert.match(state.status,/保存失败/);
  await message('ATI_TOGGLE',9); storageFails=false;
});
test('background: mismatched token never triggers fetch',async()=>{
  const count=calls.length; buffered=Buffer.from(sse('wrong-session')).toString('base64');
  await message('ATI_TOGGLE',2); response(2); await tick();
  assert.equal(calls.length,count);
  assert.match((await message('ATI_STATUS',2)).status,/不匹配/);
  await message('ATI_TOGGLE',2);
});
test('background: 404 schedules a retry instead of failing the capture',async()=>{
  buffered=Buffer.from(sse()).toString('base64'); fetchMode='404';
  await message('ATI_TOGGLE',8); response(8); await tick(); await tick();
  const state=await message('ATI_STATUS',8);
  assert.deepEqual(state.models,[]); assert.match(state.status,/重试/);
  await message('ATI_TOGGLE',8); fetchMode='ok';
});
test('background: run-claim tokens without session scopes still query trace',async()=>{
  const modern='header.'+Buffer.from(JSON.stringify({pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:9999999999,run:'run_test'})).toString('base64url')+'.sig';
  buffered=Buffer.from(sse('test-session', modern)).toString('base64');
  await message('ATI_TOGGLE',7); response(7); await tick(); await tick();
  assert.equal((await message('ATI_STATUS',7)).models[0].model,'example-model');
  await message('ATI_TOGGLE',7);
});
test('background: 401 stops without model guessing',async()=>{
  buffered=Buffer.from(sse()).toString('base64'); fetchMode='401';
  await message('ATI_TOGGLE',3); response(3); await tick(); await tick();
  const state=await message('ATI_STATUS',3);
  assert.deepEqual(state.models,[]); assert.match(state.status,/令牌被拒绝/);
  await message('ATI_TOGGLE',3); fetchMode='ok';
});
test('background: stop invalidates in-flight result',async()=>{
  fetchMode='deferred'; await message('ATI_TOGGLE',4); response(4); await tick();
  await message('ATI_TOGGLE',4); const count=notifications.length;
  release(); await tick(); await tick();
  assert.equal(notifications.length,count);
  assert.equal((await message('ATI_STATUS',4)).enabled,false); fetchMode='ok';
});
test('background: live data chunks and off-origin navigation cleanup',async()=>{
  buffered=''; await message('ATI_TOGGLE',5); response(5); await tick();
  const bytes=Buffer.from(sse());
  for(let i=0;i<bytes.length;i+=7) hooks.network({tabId:5},'Network.dataReceived',{requestId:'request1',data:bytes.subarray(i,i+7).toString('base64')});
  await tick(); await tick(); assert.equal((await message('ATI_STATUS',5)).models[0].model,'example-model');
  hooks.updated(5,{url:'https://example.org/'}); await tick();
  assert.equal((await message('ATI_STATUS',5)).enabled,false);
});

test('background: page-snoop token triggers the same trace lookup',async()=>{
  await message('ATI_TOGGLE',11);
  const sender={id:'test-extension',url:'https://arena.ai/agent',frameId:0,tab:{id:11}};
  await new Promise(resolve=>hooks.message({type:'ATI_PAGE_TOKEN',token:token('test-session'),sessionId:'test-session',pageUrl:'https://arena.ai/agent/test-session'},sender,resolve));
  await tick(); await tick();
  assert.equal((await message('ATI_STATUS',11)).models[0].model,'example-model');
  await message('ATI_TOGGLE',11);
});
test('HUD controls only sender tab; enable is idempotent and never sends Agent messages',async()=>{
 const sender={id:'test-extension',url:'https://arena.ai/agent',frameId:0,tab:{id:41}};
 const control=enabled=>new Promise(resolve=>hooks.message({type:'ATI_SET_LISTENING',tabId:42,enabled},sender,resolve));
 let attached=0;const original=chrome.debugger.attach;chrome.debugger.attach=async()=>{attached++;};const fetchCount=calls.length;
 try{const results=await Promise.all([control(true),control(true)]);assert.ok(results.every(r=>r.enabled));assert.equal(attached,1);assert.equal((await message('ATI_STATUS',42)).enabled,false);assert.equal((await message('ATI_STATUS',41)).enabled,true);assert.equal(calls.length,fetchCount);await control(false);assert.equal((await message('ATI_STATUS',41)).enabled,false);}finally{chrome.debugger.attach=original;}
});
test('HUD rejects foreign senders, frames, invalid booleans and off-origin messages',()=>{
 const valid={id:'test-extension',url:'https://arena.ai/agent',frameId:0,tab:{id:43}};let replied=false;
 for(const sender of [{...valid,id:'foreign'},{...valid,url:'https://arena.ai.evil/agent'},{...valid,frameId:2},{...valid,tab:undefined}])assert.equal(hooks.message({type:'ATI_SET_LISTENING',enabled:true},sender,()=>{replied=true;}),undefined);
 assert.equal(hooks.message({type:'ATI_SET_LISTENING',enabled:'yes'},valid,()=>{replied=true;}),undefined);assert.equal(replied,false);
});
test('HUD refuses a stale page request after target tab navigates off Arena',async()=>{
 const original=chrome.tabs.get;chrome.tabs.get=async()=>({url:'https://arena.ai/agent',pendingUrl:'https://example.org/'});
 try{const result=await new Promise(resolve=>hooks.message({type:'ATI_SET_LISTENING',enabled:true},{id:'test-extension',url:'https://arena.ai/agent',frameId:0,tab:{id:44}},resolve));assert.equal(result.enabled,false);assert.match(result.error,/页面已变化/);}finally{chrome.tabs.get=original;}
});
