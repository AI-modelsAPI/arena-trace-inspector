import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRecord,createHistoryStore,conversationUrl} from '../history.js';
const input={sessionId:'session-1',title:'测试会话',runId:'run_one',checkedAt:'2026-09-15T10:00:00.000Z',models:[{model:'model-A',provider:'provider',spanId:'span1'}],token:'NEVER_SAVE',body:'NEVER_SAVE'};
test('allowlisted fields only, canonical conversation URL',()=>{
  const r=mergeRecord(null,input);
  assert.equal(r.url,'https://arena.ai/agent/session-1');
  assert.equal(JSON.stringify(r).includes('NEVER_SAVE'),false);
  assert.throws(()=>conversationUrl('../other'));
  assert.throws(()=>mergeRecord(null,{...input,models:[]}));
});
test('deduplicate same run/model; preserve observations when model changes',()=>{
  let r=mergeRecord(null,input);
  r=mergeRecord(r,{...input,checkedAt:'2026-09-15T11:00:00.000Z'});
  assert.equal(r.observations.length,1);
  assert.equal(r.firstSeen,input.checkedAt);
  assert.equal(r.observations[0].firstSeen,input.checkedAt);
  r=mergeRecord(r,{...input,runId:'run_two',models:[{model:'model-B'}]});
  assert.equal(r.observations.length,2);
  assert.equal(r.observations[0].model,'model-A');
});
test('concurrent saves serialized; persistence survives store recreation',async()=>{
  const data={}; const area={get:async k=>k?{[k]:structuredClone(data[k])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))};
  const store=createHistoryStore(area);
  await Promise.all([store.save(input),store.save({...input,runId:'run_two'}),store.save({...input,sessionId:'session-2',checkedAt:'2026-09-16T10:00:00.000Z'})]);
  const restored=await createHistoryStore(area).list();
  assert.equal(restored.length,2);
  assert.equal(restored[0].sessionId,'session-2');
  assert.equal(restored[1].observations.length,2);
});
test('failed save does not poison queue',async()=>{
  const data={}; let fail=true;
  const store=createHistoryStore({get:async k=>k?{[k]:data[k]}:data,set:async v=>{if(fail){fail=false;throw Error('quota');}Object.assign(data,v);}});
  await assert.rejects(store.save(input));
  await store.save(input);
  assert.equal((await store.list()).length,1);
});

function deletionArea() {
  const data = {'ati.preferences': {keep: true}};
  return {data, get: async key => key ? {[key]: structuredClone(data[key])} : structuredClone(data),
    set: async values => Object.assign(data, structuredClone(values)), remove: async key => {delete data[key];}};
}
test('delete removes only one conversation and persists across store recreation', async () => {
  const area=deletionArea(), store=createHistoryStore(area);
  await store.save(input); await store.save({...input,sessionId:'session-2'});
  await store.remove(input.sessionId);
  assert.equal(await store.get(input.sessionId),null);
  assert.deepEqual((await createHistoryStore(area).list()).map(r=>r.sessionId),['session-2']);
  assert.deepEqual(area.data['ati.preferences'],{keep:true});
  await store.remove(input.sessionId); // Idempotent when already deleted.
});
test('delete is serialized after pending saves; a later capture can create a fresh record', async () => {
  const area=deletionArea(),store=createHistoryStore(area);
  await Promise.all([store.save(input),store.save({...input,runId:'run_two'}),store.remove(input.sessionId)]);
  assert.deepEqual(await store.list(),[]);
  await store.save({...input,runId:'run_new'});
  assert.deepEqual((await store.get(input.sessionId)).observations.map(o=>o.runId),['run_new']);
});
test('invalid ids and failed deletions preserve data and do not poison the queue', async () => {
  const area=deletionArea(),store=createHistoryStore(area);
  await store.save(input);
  for(const id of [null,undefined,'','../other']) await assert.rejects(store.remove(id));
  const remove=area.remove; area.remove=async()=>{throw Error('storage unavailable');};
  await assert.rejects(store.remove(input.sessionId));
  assert.ok(await store.get(input.sessionId));
  area.remove=remove; await store.remove(input.sessionId);
  await store.save(input); assert.equal((await store.list()).length,1);
});
