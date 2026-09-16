import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTokenLabel,parseCostLabel,extractUsage,mergeUsage,summarizeUsage,formatUsage} from '../usage.js';
import {mergeRecord} from '../history.js';
const event=(spanId='s1',token='6.6k',cost='$0.0133')=>({runId:'run_x',spanId,message:'ai.streamText.doStream',isPartial:false,style:{accessory:{items:[{text:'model',icon:'tabler-cube'},{text:token,icon:'tabler-hash'},{text:cost,icon:'tabler-currency-dollar'}]}}});
test('observed token/cost labels and unknown values',()=>{
  assert.deepEqual(parseTokenLabel('6.6k'),{value:6600,approximate:true});
  assert.deepEqual(parseTokenLabel('1,024'),{value:1024,approximate:false});
  assert.deepEqual(parseTokenLabel('1.5M'),{value:1500000,approximate:true});
  assert.equal(parseTokenLabel('unknown'),null);
  assert.equal(parseCostLabel('$0.0133'),0.0133);
  assert.equal(parseCostLabel('$0'),0);
  assert.equal(parseCostLabel('€1.00'),null);
  assert.equal(parseCostLabel('-1'),null);
});
test('count leaf span once, exclude parent and other run',()=>{
  const e=event();
  const u=extractUsage({events:[e,e,{...e,spanId:'parent',message:'ai.streamText'},{...e,spanId:'other',runId:'other'},event('s2','400','$0.001')]},'run_x');
  const t=summarizeUsage([u]);
  assert.equal(t.spanCount,2);assert.equal(t.tokens,7000);assert.equal(t.costUsd,0.0143);assert.equal(t.tokensApproximate,true);
});
test('same run snapshot replaces same span, new spans accumulate',()=>{
  let runs=mergeUsage([],extractUsage({events:[event()]},'run_x'));
  runs=mergeUsage(runs,extractUsage({events:[event()]},'run_x'));
  assert.equal(summarizeUsage(runs).tokens,6600);
  runs=mergeUsage(runs,extractUsage({events:[event('s1','7k','$0.015'),event('s2','1k','$0.002')]},'run_x'));
  assert.equal(summarizeUsage(runs).tokens,8000);
  assert.equal(summarizeUsage(runs).costUsd,0.017);
});
test('unknown remains null, zero remains zero, missing coverage explicit',()=>{
  const missing=extractUsage({events:[event('s1','?', '?')]},'run_x');
  assert.equal(summarizeUsage([missing]).tokens,null);
  assert.match(formatUsage(summarizeUsage([missing])),/未提供/);
  const mixed=extractUsage({events:[event('s1','0','$0'),event('s2','?', '?')]},'run_x');
  const t=summarizeUsage([mixed]);assert.equal(t.tokens,0);assert.equal(t.costUsd,0);assert.match(formatUsage(t),/部分缺失/);
});
test('v0.2 records migrate lazily and store no extra usage fields',()=>{
  const input={sessionId:'session',models:[{model:'model'}],runId:'run_x'};
  const old=mergeRecord(null,input);delete old.runs;delete old.totals;
  const usage=extractUsage({events:[event()]},'run_x');usage.spans[0].token='secret';
  const r=mergeRecord(old,{...input,usage});
  assert.equal(r.totals.tokens,6600);
  assert.equal(JSON.stringify(r).includes('secret'),false);
  assert.equal(mergeRecord(r,{...input,usage}).totals.costUsd,0.0133);
});
