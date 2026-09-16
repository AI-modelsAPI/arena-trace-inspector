import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHud} from './hud-dom-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('draw input defaults to five; button only unlocks after listening is enabled',async()=>{
 let starts=[],notify;const state={running:false,phase:'idle',progress:'ready'};
 const draw={status:()=>state,configure:o=>{notify=o.onProgress;},start:n=>starts.push(n),stop(){}};
 const h=setupHud(()=>Promise.resolve({enabled:false,sessionId:'session-a'}),false,draw);await tick();
 const button=h.root.querySelector('.draw-start'),input=h.root.querySelector('.draw-rounds');
 assert.equal(button.textContent,'自动抽卡');assert.equal(input.value,'5');assert.equal(button.disabled,true);
 button.handlers.click();assert.deepEqual(starts,[]);
 h.hooks.message({type:'ATI_STATE',state:{enabled:true,sessionId:'session-a'}});
 assert.equal(button.disabled,false);button.handlers.click();assert.deepEqual(starts,[5]);
 input.value='2';input.handlers.input();button.handlers.click();assert.deepEqual(starts,[5,2]);
 input.value='0';input.handlers.input();assert.equal(button.disabled,true);
 input.value='5';input.handlers.input();state.running=true;notify();assert.equal(button.disabled,true);assert.equal(input.disabled,true);
 state.running=false;h.hooks.message({type:'ATI_STATE',state:{enabled:false,sessionId:'session-a'}});assert.equal(button.disabled,true);
});

test('New Chat unlocks draw immediately when listening request settles without another state event',async()=>{
 let release,starts=[];const draw={status:()=>({running:false,phase:'idle',progress:'ready'}),configure(){},start:n=>starts.push(n),stop(){}};
 const h=setupHud(msg=>msg.type==='ATI_SET_LISTENING'?new Promise(r=>{release=r;}):Promise.resolve({enabled:false,sessionId:null}),false,draw);
 h.location.pathname='/agent';await tick();
 const listen=h.root.querySelector('.listen-button'),button=h.root.querySelector('.draw-start');
 assert.equal(button.disabled,true);
 listen.handlers.click();assert.equal(button.disabled,true);
 // Background state can arrive before the request promise is settled.
 h.hooks.message({type:'ATI_STATE',state:{enabled:true,sessionId:null}});
 assert.equal(button.disabled,true);
 release({enabled:true,sessionId:null});await tick();
 assert.equal(listen.textContent,'停止监听');
 assert.equal(button.disabled,false,'must unlock without a subsequent state update or user input');
 button.handlers.click();assert.deepEqual(starts,[5]);
 // Stopping must lock the draw control immediately, even before a response.
 listen.handlers.click();assert.equal(button.disabled,true);
 release({enabled:false,sessionId:null});await tick();assert.equal(button.disabled,true);
});
test('failed listening enable keeps automatic draw blocked',async()=>{
 const draw={status:()=>({running:false,phase:'idle',progress:'ready'}),configure(){},start(){throw Error('must not start');},stop(){}};
 const h=setupHud(msg=>msg.type==='ATI_SET_LISTENING'?Promise.reject(Error('attach failed')):Promise.resolve({enabled:false,sessionId:null}),false,draw);
 h.location.pathname='/agent';await tick();h.root.querySelector('.listen-button').handlers.click();await tick();
 assert.equal(h.root.querySelector('.draw-start').disabled,true);assert.equal(h.root.querySelector('.listen-button').disabled,false);
});
