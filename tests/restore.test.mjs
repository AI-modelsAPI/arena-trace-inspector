import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sessionFromUrl,historicalView} from '../restore.js';
import {createHistoryStore,mergeRecord} from '../history.js';
import {extractUsage} from '../usage.js';
const context={};vm.runInNewContext(fs.readFileSync(new URL('../view-model.js',import.meta.url),'utf8'),context);const V=context.ArenaTraceView;
const hooks={},tabs=new Map(),data={},notifications=[];
let delayKey=null,releaseRead=null,failRead=false,fetches=0,attaches=0;
const event = key => ({addListener(fn){hooks[key]=fn;}});
const area={setAccessLevel:async()=>{},get:async key=>{if(failRead)throw Error('storage failure');const value=structuredClone(key?{[key]:data[key]}:data);if(key&&key===delayKey){delayKey=null;await new Promise(r=>{releaseRead=r;});}return value;},set:async value=>Object.assign(data,structuredClone(value))};
globalThis.chrome={
 storage:{local:area},
 runtime:{id:'restore-test',getURL:p=>'chrome-extension://restore-test/'+p,onMessage:event('message'),sendMessage:async()=>{}},
 debugger:{attach:async()=>{attaches++;},detach:async()=>{},sendCommand:async()=>({}),onEvent:event('network'),onDetach:event('detach')},
 tabs:{get:async id=>tabs.get(id)||null,sendMessage:async(id,msg)=>notifications.push({tabId:id,...structuredClone(msg)}),onRemoved:event('removed'),onUpdated:event('updated')},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}
};
globalThis.fetch=async()=>{fetches++;throw Error('Restoration must not fetch');};
await import('../background.js');
const sender={id:'restore-test',url:'chrome-extension://restore-test/popup.html'};
const message=(type,tabId)=>new Promise(r=>hooks.message({type,tabId},sender,r));
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(sessionId,runId,model){
 const e={runId,spanId:runId+'-span',message:'ai.streamText.doStream',isPartial:false,isError:false,isCancelled:false,style:{icon:'ai-provider-openai',accessory:{items:[{icon:'tabler-cube',text:model},{icon:'tabler-hash',text:'1.2k'},{icon:'tabler-currency-dollar',text:'$0.002'}]}}};
 return mergeRecord(null,{sessionId,runId,title:'Fixture '+sessionId,checkedAt:'2026-09-15T12:00:00.000Z',models:[{model,provider:'openai',spanId:e.spanId,partial:false}],usage:extractUsage({events:[e]},runId,'2026-09-15T12:00:00.000Z')});
}
data['ati.conversation.v1.session-a']=fixture('session-a','run_a','model-a');
data['ati.conversation.v1.session-b']=fixture('session-b','run_b','model-b');
const navigate=(id,session)=>{const url=session?'https://arena.ai/agent/'+session:'https://arena.ai/agent';tabs.set(id,{id,url});hooks.updated(id,{url});};
test('strict URL scope and newest run selection including legacy observations',()=>{
 assert.equal(sessionFromUrl('https://arena.ai/agent/session-a?x=1'),'session-a');assert.equal(sessionFromUrl('https://arena.ai.evil/agent/session-a'),null);assert.equal(sessionFromUrl('https://arena.ai/agent'),null);
 const record=fixture('session-a','run_a','model-a');record.observations.push({runId:'new',model:'latest',provider:'openai',spanId:'latest-span',lastSeen:'2026-09-16T12:00:00Z'});
 assert.equal(historicalView(record,'session-a').runId,'new');assert.equal(historicalView(record,'session-b'),null);
});
test('direct history get validates exact key and waits for pending writes',async()=>{
 const store=createHistoryStore(area);assert.equal((await store.get('session-a')).sessionId,'session-a');assert.equal(await store.get('unknown'),null);
 await assert.rejects(store.get('../x'));data['ati.conversation.v1.bad']={...data['ati.conversation.v1.session-a']};assert.equal(await store.get('bad'),null);
});
test('cold status restores data, provider, evidence and historical provenance without attaching or fetching',async()=>{
 tabs.set(11,{id:11,url:'https://arena.ai/agent/session-a'});
 const state=await message('ATI_STATUS',11);assert.equal(state.enabled,false);assert.equal(state.historical,true);assert.equal(state.runId,'run_a');assert.equal(state.run.spans[0].evidence.tokens.value,'1.2k');
 const view=V.build(state);assert.equal(view.models[0].model,'model-a');assert.equal(view.tokens,'≈1,200');assert.equal(view.source,'本地历史 · 非重新验证');assert.equal(view.evidenceCount,1);assert.equal(fetches,0);assert.equal(attaches,0);
});
test('enabled listener restores A -> B -> A without mixed runs or losing persisted records',async()=>{
 tabs.set(12,{id:12,url:'https://arena.ai/agent/session-a'});const first=await message('ATI_TOGGLE',12);assert.equal(first.enabled,true);assert.equal(first.runId,'run_a');
 navigate(12,'session-b');await tick();assert.equal((await message('ATI_STATUS',12)).runId,'run_b');
 navigate(12,null);await tick();assert.equal((await message('ATI_STATUS',12)).models.length,0);
 navigate(12,'session-a');await tick();const back=await message('ATI_STATUS',12);assert.equal(back.runId,'run_a');assert.equal(back.run.spans[0].model,'model-a');assert.equal(back.historical,true);
 assert.equal(data['ati.conversation.v1.session-b'].observations[0].model,'model-b');assert.equal(fetches,0);await message('ATI_TOGGLE',12);
});
test('refresh while not listening restores history; stopping retains historical data',async()=>{
 navigate(13,'session-a');await tick();await message('ATI_TOGGLE',13);const stopped=await message('ATI_TOGGLE',13);assert.equal(stopped.enabled,false);assert.equal(stopped.historical,true);
 hooks.updated(13,{status:'complete'});await tick();const refreshed=await message('ATI_STATUS',13);assert.equal(refreshed.runId,'run_a');assert.equal(refreshed.enabled,false);assert.equal(fetches,0);
});
test('late history read cannot overwrite another conversation',async()=>{
 tabs.set(14,{id:14,url:'https://arena.ai/agent/session-a'});delayKey='ati.conversation.v1.session-a';const pending=message('ATI_STATUS',14);await tick();assert.ok(releaseRead);
 navigate(14,'session-b');await tick();const before=notifications.length;releaseRead();const late=await pending;await tick();assert.equal(late.restoring,true);assert.equal(notifications.slice(before).some(n=>n.state.runId==='run_a'),false);assert.equal((await message('ATI_STATUS',14)).runId,'run_b');
});
test('unknown conversation does not reuse a prior record',async()=>{
 navigate(15,'session-a');await tick();navigate(15,'not-saved');await tick();const state=await message('ATI_STATUS',15);assert.equal(state.models.length,0);assert.equal(state.runId,null);assert.equal(state.historical,false);
});
test('storage failures surface without deleting stored data',async()=>{
 tabs.set(16,{id:16,url:'https://arena.ai/agent/session-a'});failRead=true;const state=await message('ATI_STATUS',16);failRead=false;assert.match(state.status,/恢复失败/);assert.ok(data['ati.conversation.v1.session-a']);assert.equal((await message('ATI_STATUS',16)).runId,'run_a');
});
test('worker restart reconstructs state from storage, not process memory',async()=>{
 const previousAttach=attaches;await import('../background.js?restarted=1');tabs.set(17,{id:17,url:'https://arena.ai/agent/session-b'});const state=await message('ATI_STATUS',17);assert.equal(state.enabled,false);assert.equal(state.historical,true);assert.equal(state.runId,'run_b');assert.equal(attaches,previousAttach);assert.equal(fetches,0);
});
test('HUD enable failure preserves existing historical model and usage',async()=>{
 tabs.set(18,{id:18,url:'https://arena.ai/agent/session-a'});const previous=chrome.debugger.attach;chrome.debugger.attach=async()=>{throw Error('occupied');};
 try{const state=await new Promise(resolve=>hooks.message({type:'ATI_SET_LISTENING',enabled:true},{id:'restore-test',url:'https://arena.ai/agent/session-a',tab:{id:18},frameId:0},resolve));assert.equal(state.enabled,false);assert.match(state.error,/无法附加/);assert.equal(state.runId,'run_a');assert.equal(state.run.spans[0].model,'model-a');assert.ok(data['ati.conversation.v1.session-a']);}finally{chrome.debugger.attach=previous;}
});
test('SPA current page URL works when browser sender URL remains the initial document',async()=>{
 tabs.set(19,{id:19,url:'https://arena.ai/agent/session-b'});
 const content={id:'restore-test',url:'https://arena.ai/agent/session-a',tab:{id:19},frameId:0};
 const control=msg=>new Promise(resolve=>hooks.message({...msg,pageUrl:'https://arena.ai/agent/session-b'},content,resolve));
 const state=await control({type:'ATI_STATUS'});assert.equal(state.runId,'run_b');assert.equal(state.restoring,undefined);
 assert.equal((await control({type:'ATI_SET_LISTENING',enabled:true})).enabled,true);
 assert.equal((await control({type:'ATI_SET_LISTENING',enabled:false})).enabled,false);
});
test('a stale claimed SPA URL cannot rename the target of listener control or start another session',async()=>{
 tabs.set(20,{id:20,url:'https://arena.ai/agent/session-b'});
 const content={id:'restore-test',url:'https://arena.ai/agent/session-a',tab:{id:20},frameId:0};
 const result=await new Promise(resolve=>hooks.message({type:'ATI_SET_LISTENING',enabled:true,pageUrl:'https://arena.ai/agent/session-a'},content,resolve));
 assert.equal(result.enabled,false);assert.match(result.error,/页面已变化/);assert.equal(result.runId,'run_b');
});
