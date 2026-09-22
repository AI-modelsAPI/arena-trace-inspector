import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHud} from './hud-dom-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('draw input defaults to five; probe and draw can start without prior listening',async()=>{
 let starts=[],notify;const state={running:false,phase:'idle',progress:'ready'};
 const draw={status:()=>state,configure:o=>{notify=o.onProgress;},start:n=>starts.push(n),stop(){}};
 const h=setupHud(()=>Promise.resolve({enabled:false,sessionId:'session-a'}),false,draw);await tick();
 const button=h.root.querySelector('.draw-start'),input=h.root.querySelector('.draw-rounds');
 assert.equal(button.textContent,'自动抽卡');assert.equal(input.value,'5');assert.equal(button.disabled,false);
 button.handlers.click();assert.deepEqual(starts,[5]);
 h.hooks.message({type:'ATI_STATE',state:{enabled:true,sessionId:'session-a'}});
 input.value='2';input.handlers.input();button.handlers.click();assert.deepEqual(starts,[5,2]);
 input.value='0';input.handlers.input();assert.equal(button.disabled,true);
 input.value='5';input.handlers.input();state.running=true;notify();assert.equal(button.disabled,true);assert.equal(input.disabled,true);
});

test('New Chat listen request pending still locks draw until it settles',async()=>{
 let release,starts=[];const draw={status:()=>({running:false,phase:'idle',progress:'ready'}),configure(){},start:n=>starts.push(n),stop(){}};
 const h=setupHud(msg=>msg.type==='ATI_SET_LISTENING'?new Promise(r=>{release=r;}):Promise.resolve({enabled:false,sessionId:null}),false,draw);
 h.location.pathname='/agent';await tick();
 const listen=h.root.querySelector('.listen-button'),button=h.root.querySelector('.draw-start');
 assert.equal(button.disabled,false);
 listen.handlers.click();assert.equal(button.disabled,true);
 h.hooks.message({type:'ATI_STATE',state:{enabled:true,sessionId:null}});
 assert.equal(button.disabled,true);
 release({enabled:true,sessionId:null});await tick();
 assert.equal(listen.textContent,'停止监听');
 assert.equal(button.disabled,false,'must unlock without a subsequent state update or user input');
 button.handlers.click();assert.deepEqual(starts,[5]);
 listen.handlers.click();assert.equal(button.disabled,true);
 release({enabled:false,sessionId:null});await tick();assert.equal(button.disabled,false);
});
test('probe button uses the target list and can start while listening is off',async()=>{
 let probes=[];const state={running:false,phase:'idle',progress:'ready'};
 const draw={status:()=>state,configure(){},start:(n,o)=>probes.push({n,...o}),stop(){}};
 const h=setupHud(()=>Promise.resolve({enabled:false,sessionId:'session-a'}),false,draw);await tick();
 const probe=h.root.querySelector('.draw-probe'),targets=h.root.querySelector('.draw-targets');
 assert.equal(probe.textContent,'自动探针');assert.equal(targets.value,'opus5, fable5, gpt6');assert.equal(probe.disabled,false);
 targets.value='opus5';probe.handlers.click();
 assert.equal(probes[0].n,5);assert.equal(probes[0].mode,'probe');assert.equal(probes[0].targets,'opus5');
});
test('failed listening enable does not prevent a later automatic draw click',async()=>{
 let started=false;const draw={status:()=>({running:false,phase:'idle',progress:'ready'}),configure(){},start(){started=true;},stop(){}};
 const h=setupHud(msg=>msg.type==='ATI_SET_LISTENING'?Promise.reject(Error('attach failed')):Promise.resolve({enabled:false,sessionId:null}),false,draw);
 h.location.pathname='/agent';await tick();h.root.querySelector('.listen-button').handlers.click();await tick();
 assert.equal(h.root.querySelector('.draw-start').disabled,false);h.root.querySelector('.draw-start').handlers.click();assert.equal(started,true);
});
