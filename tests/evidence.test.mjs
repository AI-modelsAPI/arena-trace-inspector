import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extractUsage,mergeUsage} from '../usage.js';
import {sanitizeEvidence} from '../evidence.js';
const ctx={};vm.runInNewContext(fs.readFileSync(new URL('../view-model.js',import.meta.url),'utf8'),ctx);const V=ctx.ArenaTraceView;
const now='2026-09-15T12:00:00.000Z';
const event=(id='span1')=>({runId:'run_test',spanId:id,message:'ai.streamText.doStream',isPartial:false,isError:false,isCancelled:false,body:'NEVER_SAVE',style:{icon:'ai-provider-openai',accessory:{items:[{icon:'tabler-cube',text:'example-model-full-label'},{icon:'tabler-hash',text:'9.3k'},{icon:'tabler-currency-dollar',text:'$0.0935'}]}}});
test('evidence stores observed labels, canonical paths and times only',()=>{
 const run=extractUsage({events:[event()]},'run_test',now),e=run.spans[0].evidence;
 assert.equal(e.model.value,'example-model-full-label');assert.equal(e.tokens.value,'9.3k');assert.equal(e.cost.value,'$0.0935');assert.equal(e.provider.value,'ai-provider-openai');assert.equal(e.tokens.observedAt,now);assert.equal(e.flags.isPartial,false);assert.match(e.model.path,/tabler-cube/);assert.equal(JSON.stringify(run).includes('NEVER_SAVE'),false);
 const clean=sanitizeEvidence({...e,token:'NEVER_SAVE',model:{...e.model,path:'WRONG',secret:'NEVER_SAVE'}});assert.equal(JSON.stringify(clean).includes('NEVER_SAVE'),false);assert.equal(JSON.stringify(clean).includes('WRONG'),false);
});
test('same model multiple calls remain distinct; exclude parents and unrelated runs',()=>{
 const e=event(),run=extractUsage({events:[e,event('span2'),{...e,runId:'other'},{...e,message:'ai.streamText'}]},'run_test',now);
 const v=V.build({runId:run.runId,run,models:[]});assert.equal(v.calls.length,2);assert.equal(v.models.length,1);assert.equal(v.count,'2');assert.equal(v.completion,'调用已完成');assert.equal(v.tokens,'≈18,600');assert.equal(v.cost,'$0.187');assert.equal(v.historical,false);
});
test('partial, failure, cancellation and unknown are never reported complete',()=>{
 assert.equal(V.completion([{partial:true}]),'调用进行中');assert.equal(V.completion([{partial:false,error:true}]),'调用报错');assert.equal(V.completion([{partial:false,cancelled:true}]),'调用已取消');assert.equal(V.completion([{partial:null}]),'状态未提供');const e=event();delete e.isPartial;assert.equal(extractUsage({events:[e]},'run_test').spans[0].partial,null);
});
test('legacy history has no fabricated raw evidence and runs never mix',()=>{
 const record={observations:[{runId:'old',model:'old-model',provider:'openai',spanId:'oldspan',lastSeen:now}],runs:[{runId:'old',spans:[{spanId:'oldspan',model:'old-model',tokens:9300,tokensApproximate:true,costUsd:.0935,partial:false}]}]};
 const old=V.build({},record);assert.equal(old.historical,true);assert.equal(old.evidenceCount,0);assert.equal(old.calls[0].provider,'openai');assert.equal(V.exportEvidence(old).calls[0].evidence,null);assert.match(V.exportEvidence(old).calls[0].provenance,/legacy/);
 const current=V.build({runId:'new',models:[]},record);assert.equal(current.runId,'new');assert.equal(current.calls.length,0);assert.equal(current.models.length,0);const selected=V.build({runId:'new'},record,'old');assert.equal(selected.runId,'old');assert.equal(selected.historical,true);
});
test('missing later values retain original label observation times',()=>{
 let runs=mergeUsage([],extractUsage({events:[event()]},'run_test',now));const later=event();later.style.accessory.items=later.style.accessory.items.filter(i=>i.icon==='tabler-cube');runs=mergeUsage(runs,extractUsage({events:[later]},'run_test','2026-09-15T12:01:00.000Z'));
 assert.equal(runs[0].spans[0].tokens,9300);assert.equal(runs[0].spans[0].evidence.tokens.observedAt,now);assert.equal(runs[0].spans[0].evidence.model.observedAt,'2026-09-15T12:01:00.000Z');assert.equal(runs.length,1);
});
test('zero vs unknown and partial coverage',()=>{
 assert.equal(V.tokens(0,false),'0');assert.equal(V.money(0),'$0');assert.equal(V.tokens(null,false),'未提供');const v=V.build({runId:'run',run:{runId:'run',spans:[{spanId:'1',tokens:0,costUsd:0},{spanId:'2',tokens:null,costUsd:null}]}});assert.equal(v.tokens,'0');assert.equal(v.cost,'$0');assert.equal(v.tokenCoverage,'1/2');assert.equal(v.tokenMissing,true);
});
test('evidence export never copies arbitrary raw payloads',()=>{
 const run=extractUsage({events:[event()]},'run_test',now);run.spans[0].token='NEVER_SAVE';run.spans[0].evidence.body='NEVER_SAVE';const v=V.build({runId:run.runId,run});assert.equal(JSON.stringify(V.exportEvidence(v)).includes('NEVER_SAVE'),false);
});
