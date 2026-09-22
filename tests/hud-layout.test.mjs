import test from 'node:test';
import assert from 'node:assert/strict';
import '../hud-layout.js';
import {createHudPreferences,HUD_PREF_KEY} from '../hud-preferences.js';
const L=globalThis.ArenaHudLayout;
test('HUD defaults and whitelist reject invalid positions and extra sensitive fields',()=>{
 assert.deepEqual(L.defaults(),{schemaVersion:1,collapsed:false,position:{x:1,y:1},probeTargets:'opus5, fable5, gpt6',findAll:true});
 const p=L.sanitize({collapsed:true,position:{x:-5,y:9,token:'SECRET'},token:'SECRET'});
 assert.deepEqual(p,{schemaVersion:1,collapsed:true,position:{x:0,y:1},probeTargets:'opus5, fable5, gpt6',findAll:true});assert.ok(!JSON.stringify(p).includes('SECRET'));
 assert.equal(L.sanitize({findAll:false}).findAll,false);
 assert.deepEqual(L.sanitize({position:{x:NaN,y:Infinity}}).position,{x:1,y:1});
});
test('dragging is clamped on all viewport edges and positions round trip',()=>{
 const size={width:370,height:500},v={width:1200,height:900};
 assert.deepEqual(L.clamp({x:-100,y:2000},size,v),{x:12,y:388});
 const p={x:300,y:123};const f=L.normalize(p,size,v),restored=L.position(f,size,v);assert.ok(Math.abs(restored.x-p.x)<1e-8);assert.ok(Math.abs(restored.y-p.y)<1e-8);
});
test('restored coordinates remain visible after window resize or panel expansion',()=>{
 const v={width:420,height:500},size={width:370,height:450};
 const p=L.position({x:1,y:1},size,v);assert.equal(p.x,38);assert.equal(p.y,38);assert.ok(p.x+size.width<=v.width);assert.ok(p.y+size.height<=v.height);
 const tiny=L.position({x:1,y:1},{width:370,height:600},{width:300,height:400});assert.deepEqual(tiny,{x:0,y:0});
});
test('HUD preferences persist independently of conversation data and merge serialized writes',async()=>{
 const data={'ati.conversation.v1.existing':{model:'retained'}};
 const area={get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))};const store=createHudPreferences(area);
 await Promise.all([store.save({position:{x:.2,y:.4}}),store.save({collapsed:true,token:'NEVER_SAVE'})]);
 const p=await createHudPreferences(area).get();assert.equal(p.collapsed,true);assert.deepEqual(p.position,{x:.2,y:.4});assert.deepEqual(data['ati.conversation.v1.existing'],{model:'retained'});assert.ok(!JSON.stringify(data[HUD_PREF_KEY]).includes('NEVER_SAVE'));
});
test('failed preference write does not poison future saves',async()=>{
 const data={};let fail=true;const store=createHudPreferences({get:async key=>({[key]:data[key]}),set:async value=>{if(fail){fail=false;throw Error('quota');}Object.assign(data,value);}});
 await assert.rejects(store.save({collapsed:true}));await store.save({collapsed:true});assert.equal((await store.get()).collapsed,true);
});
