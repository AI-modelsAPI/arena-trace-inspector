import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoRenameStore,createHistoryStore} from '../history.js';
import {setupHud} from './hud-dom-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function area(){const data={};return {get:async k=>k?{[k]:data[k]}:{...data},set:async v=>Object.assign(data,v),remove:async k=>{delete data[k];}};}
test('auto rename defaults off, persists, claims once per session and survives deleting history',async()=>{
 const a=area(),s=createAutoRenameStore(a);
 assert.equal((await s.get()).enabled,false);assert.equal(await s.claim('session-a'),false);
 await s.set(true);assert.equal((await createAutoRenameStore(a).get()).enabled,true);
 assert.deepEqual(await Promise.all([s.claim('session-a'),s.claim('session-a')]),[true,false]);
 await createHistoryStore(a).remove('session-a');assert.equal(await createAutoRenameStore(a).claim('session-a'),false);
 assert.equal(await s.claim('session-b'),true);
 await s.set(false);assert.equal(await s.claim('session-c'),false);
 await assert.rejects(s.set('yes'));await assert.rejects(s.claim('../invalid'));
});
test('failed auto rename preference write does not poison queue',async()=>{
 const a=area(),s=createAutoRenameStore(a),set=a.set;a.set=async()=>{throw Error('disk');};
 await assert.rejects(s.set(true));a.set=set;await s.set(true);assert.equal(await s.claim('session-a'),true);
});
const complete={enabled:true,saved:true,historical:false,sessionId:'session-a',runId:'run-a',models:[{model:'test-model'}],run:{runId:'run-a',spans:[{spanId:'span-a',model:'test-model',partial:false,error:false,cancelled:false}]}};
test('HUD auto rename skips history, partial calls and repeats; triggers once after complete live detection',async()=>{
 let claims=0;const h=setupHud(msg=>{if(msg.type==='ATI_AUTO_RENAME_CLAIM'){claims++;return Promise.resolve({claimed:true});}return Promise.resolve({...complete,historical:true});},true);
 await tick();assert.equal(claims,0);
 h.hooks.message({type:'ATI_STATE',state:{...complete,run:{runId:'run-a',spans:[{spanId:'span-a',model:'test-model',partial:true}]}}});await tick();assert.equal(claims,0);
 h.hooks.message({type:'ATI_STATE',state:complete});await tick();assert.equal(claims,1);assert.equal(h.hooks.renames.length,1);
 h.hooks.message({type:'ATI_STATE',state:complete});await tick();assert.equal(claims,1);
});
test('HUD auto rename is opt-in and a denied persisted claim never renames',async()=>{
 const off=setupHud(()=>Promise.resolve(complete));await tick();assert.equal(off.messages.some(m=>m.type==='ATI_AUTO_RENAME_CLAIM'),false);
 const done=setupHud(msg=>Promise.resolve(msg.type==='ATI_AUTO_RENAME_CLAIM'?{claimed:false}:complete),true);await tick();assert.equal(done.hooks.renames,undefined);
});
test('HUD navigation during claim cannot rename the newly opened conversation',async()=>{
 let release;const h=setupHud(msg=>msg.type==='ATI_AUTO_RENAME_CLAIM'?new Promise(r=>{release=r;}):Promise.resolve(complete),true);
 await tick();h.location.pathname='/agent/session-b';release({claimed:true});await tick();assert.equal(h.hooks.renames,undefined);
});
