import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHud as setup} from './hud-dom-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('HUD retries local startup reads, then stops after success without capture requests',async()=>{
 let attempt=0;const h=setup(()=>++attempt<3?Promise.reject(Error('receiver starting')):Promise.resolve({enabled:false,historical:false,sessionId:'session-a'}));
 await tick();assert.equal(h.timers[0].delay,250);h.timers[0].fn();await tick();assert.equal(h.timers[1].delay,750);h.timers[1].fn();await tick();assert.equal(attempt,3);assert.equal(h.timers.length,2);assert.ok(h.messages.every(m=>['ATI_STATUS','ATI_HUD_GET','ATI_AUTO_RENAME_GET'].includes(m.type)));
});
test('HUD discards an old failed request after a newer navigation refresh',async()=>{
 let rejectOld,calls=0;const h=setup(()=>++calls===1?new Promise((_,reject)=>{rejectOld=reject;}):Promise.resolve({enabled:false,historical:false,sessionId:'session-a'}));h.events.pageshow();await tick();rejectOld(Error('old receiver'));await tick();assert.equal(h.timers.length,0);assert.equal(calls,2);
});

test('unlistened page auto-opens expanded without capture; stop does not remove HUD',async()=>{
 const h=setup(()=>Promise.resolve({enabled:false,historical:false,sessionId:'session-a'}));await tick();
 assert.equal(h.root.children[0].getAttribute('data-collapsed'),'false');
 assert.equal(h.root.querySelector('.listen-button').textContent,'开启监听');
 assert.ok(!h.messages.some(m=>m.type==='ATI_SET_LISTENING'));
 h.hooks.message({type:'ATI_STATE',state:{enabled:false,historical:false,sessionId:'session-a'}});assert.ok(h.root.children[0].isConnected);
});
test('page listener button uses explicit enable/stop and pending guard, without popup',async()=>{
 let enabled=false,release;const h=setup(msg=>{if(msg.type==='ATI_SET_LISTENING')return new Promise(r=>{release=()=>{enabled=msg.enabled;r({enabled,sessionId:'session-a'});};});return Promise.resolve({enabled,sessionId:'session-a'});});await tick();
 const button=h.root.querySelector('.listen-button');button.handlers.click();button.handlers.click();assert.equal(button.disabled,true);assert.equal(h.messages.filter(m=>m.type==='ATI_SET_LISTENING').length,1);release();await tick();assert.equal(button.textContent,'停止监听');
 button.handlers.click();release();await tick();assert.equal(button.textContent,'开启监听');assert.equal(h.messages.filter(m=>m.type==='ATI_SET_LISTENING').map(m=>m.enabled).join(','),'true,false');
});
test('same-page collapse survives updates; new path opens expanded without auto-listening',async()=>{
 let session='session-a';const h=setup(()=>Promise.resolve({enabled:false,sessionId:session}));await tick();
 h.root.querySelector('.collapse-button').handlers.click();assert.equal(h.root.children[0].getAttribute('data-collapsed'),'true');
 h.hooks.message({type:'ATI_STATE',state:{enabled:false,sessionId:'session-a'}});assert.equal(h.root.children[0].getAttribute('data-collapsed'),'true');
 session='session-b';h.location.pathname='/agent/session-b';h.events.navigatesuccess();await tick();assert.equal(h.root.children[0].getAttribute('data-collapsed'),'false');assert.ok(!h.messages.some(m=>m.type==='ATI_SET_LISTENING'));
});
test('connection failure exposes retry instead of silently hiding the HUD',async()=>{
 const h=setup(()=>Promise.reject(Error('offline')));await tick();for(let i=0;i<4;i++){h.timers[i].fn();await tick();}
 assert.equal(h.root.querySelector('.listen-button').textContent,'重试连接');assert.ok(h.root.children[0].isConnected);
});
