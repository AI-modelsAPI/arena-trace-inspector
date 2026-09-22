import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../auto-draw.js',import.meta.url),'utf8');
const acquireSrc=fs.readFileSync(new URL('../acquire.js',import.meta.url),'utf8');
function setup({draft='',placeholder='',extraDraft='',mode='Agent Mode',agentShorthand=false,failRename=false,stickyDraft=false,enabled=true,statusEnabled=enabled,listenError=false,model='test-model',completion='调用已完成',detectFailRounds=0}={}){
 let detectFailsLeft=detectFailRounds;
 const location={origin:'https://arena.ai',pathname:'/agent/old-chat'};
 let sent=0,renamed=0,newChats=0,state={enabled};const listens=[];const names=[];
 const node={isConnected:true,getClientRects:()=>[{}]};
 const editor={...node,textContent:draft,className:'',childElementCount:0,getAttribute:a=>a==='data-placeholder'&&placeholder?placeholder:null,querySelector:()=>null,focus(){}};
 const extra=extraDraft?{...node,textContent:extraDraft,className:'',childElementCount:0,getAttribute:()=>null,querySelector:()=>null}:null;
 const combo={...node,textContent:agentShorthand?'Agent':mode,click(){}};
 // Real Arena: the collapsed selector reads the shorthand "Agent" and the Agent Mode
 // option is already aria-selected. The flow must recognize this and never wedge.
 const option={...node,textContent:'Agent ModeBuilt for complex tasks',hasAttribute:()=>false,getAttribute:a=>a==='aria-selected'&&agentShorthand?'true':null,click(){combo.textContent='Agent Mode';}};
 const link={href:'https://arena.ai/agent',textContent:'New Chat',click(){newChats++;location.pathname='/agent';editor.textContent=stickyDraft&&newChats===2?'1+1=':'';}};
  const button={...node,disabled:false,click(){sent++;location.pathname='/agent/new-session';editor.textContent='';state={enabled:true,sessionId:'new-session',runId:'run-one',saved:true,models:[{model}]};}};
 const doc={querySelector:()=>null,querySelectorAll:q=>q==='[contenteditable="true"]'?(extra?[extra,editor]:[editor]):q==='a[href]'?[link]:q==='button[role="combobox"]'?[combo]:q==='[role="option"]'?[option]:q==='button[aria-label="Send message"]'?[button]:[],createRange:()=>({selectNodeContents(){}}),execCommand:(c,_ui,t)=>{editor.textContent=c==='delete'?'':t;return true;}};
 let liveStatus=statusEnabled;
 const sandbox={location,document:doc,window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},URL,Date,setTimeout,Event,localStorage:{_d:new Map(),getItem(k){return this._d.has(k)?this._d.get(k):null;},setItem(k,v){this._d.set(k,String(v));}},chrome:{runtime:{async sendMessage(m){if(m.type==='ATI_STATUS')return {enabled:liveStatus};if(m.type==='ATI_ACQUIRE'){if(state.models?.length&&state.sessionId===m.sessionId){if(detectFailsLeft>0){detectFailsLeft--;return {ok:false,fatal:true,stage:'error',status:'流式读取不可用，等待完整响应后尝试解析'};}return {ok:true,stage:'model',models:state.models,runId:state.runId,sessionId:state.sessionId,status:'已识别模型'};}return {ok:false,stage:'token',status:state.status||'等待运行令牌'};}if(listenError)return {enabled:false,error:'无法附加调试器'};listens.push(m.enabled);state={...state,enabled:m.enabled};liveStatus=m.enabled;return {enabled:m.enabled};}}},ArenaConversationRename:{isBusy:()=>false,async rename({model,isCurrent}){if(failRename)throw Error('rename failed');if(!isCurrent())throw Error('stale');renamed++;names.push(model);}},ArenaTraceView:{build:s=>({models:s.models||[],completion})}};
 vm.createContext(sandbox);vm.runInContext(acquireSrc,sandbox);vm.runInContext(source,sandbox);const api=sandbox.ArenaAutoDraw;api.configure({readState:()=>state});
 return {api,location,listens,get sent(){return sent;},get renamed(){return renamed;},get newChats(){return newChats;},get names(){return names;},setState:s=>{state=s;}};
}
test('single draw sends exactly once, selects Agent Mode, renames, then opens blank chat and stops',async()=>{
 const h=setup({mode:'Battle Mode'});await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.renamed,1);assert.equal(h.newChats,2);assert.equal(h.location.pathname,'/agent');assert.equal(h.api.status().phase,'done');assert.equal(h.api.status().running,false);assert.deepEqual(h.listens,[true,false]);
});
test('duplicate start cannot submit a second message',async()=>{
 const h=setup();await Promise.all([h.api.start(1),h.api.start(1)]);assert.equal(h.sent,1);
});
test('draft is never overwritten or submitted',async()=>{
 const h=setup({draft:'my unsent draft'});await h.api.start(1);assert.equal(h.sent,0);assert.equal(h.newChats,0);assert.equal(h.api.status().phase,'skipped');
});
test('a composer showing only placeholder text is treated as empty and does not block',async()=>{
 const h=setup({draft:'给模型发消息…',placeholder:'给模型发消息…'});
 await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.api.status().phase,'done');
});
test('invisible zero-width leftovers in an empty composer are not a draft',async()=>{
 const h=setup({draft:'​﻿'});
 await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.api.status().phase,'done');
});
test('an unrelated filled page field does not block probing; only the composer draft does',async()=>{
 const h=setup({extraDraft:'agent instructions text'});
 await h.api.start(1,{mode:'probe',targets:'gpt6'});assert.equal(h.sent,1);
 const blocked=setup({extraDraft:'agent instructions text',draft:'my unsent draft'});
 await blocked.api.start(1,{mode:'probe',targets:'gpt6'});
 assert.equal(blocked.sent,0);assert.match(blocked.api.status().progress,/my unsent draft/);
});
test('stop before sending prevents any message and cleans up owned listener',async()=>{
 const h=setup();h.api.configure({readState:()=>({enabled:true}),onProgress:s=>{if(s.phase==='listen')h.api.stop();}});await h.api.start(1);assert.equal(h.sent,0);assert.equal(h.api.status().phase,'stopped');assert.equal(h.api.status().running,false);
});
test('rename failure keeps the generated chat and never retries sending',async()=>{
 const h=setup({failRename:true});await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.newChats,1);assert.equal(h.location.pathname,'/agent/new-session');assert.equal(h.api.status().phase,'done');assert.equal(h.api.status().failed,1);assert.deepEqual(h.listens,[true,false]);
});

test('after success, a restored fixed-prompt draft is cleared without sending again',async()=>{
 const h=setup({stickyDraft:true});await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.newChats,2);assert.equal(h.api.status().phase,'done');
});

test('default five rounds send five times and then stop',async()=>{
 const h=setup();await h.api.start();assert.equal(h.sent,5);assert.equal(h.renamed,5);assert.equal(h.api.status().total,5);assert.equal(h.api.status().completed,5);assert.equal(h.api.status().running,false);
});
test('configured round limit is respected',async()=>{
 const h=setup();await h.api.start(2);assert.equal(h.sent,2);assert.equal(h.renamed,2);
});
test('start without listening auto-enables, opens a new chat and sends',async()=>{
 const h=setup({enabled:false,statusEnabled:false});await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.newChats,2);assert.equal(h.listens[0],true);
});
test('listening enable failure never navigates or sends',async()=>{
 const h=setup({enabled:false,statusEnabled:false,listenError:true});await h.api.start(5);assert.equal(h.sent,0);assert.equal(h.newChats,0);assert.equal(h.api.status().phase,'skipped');
});
test('invalid round counts never send',async()=>{
 for(const n of [0,-1,1.5,101,'',NaN]){const h=setup();await h.api.start(n);assert.equal(h.sent,0);assert.equal(h.newChats,0);}
});
test('three consecutive rename failures stop a five-round job',async()=>{
 const h=setup({failRename:true});await h.api.start(5);assert.equal(h.sent,3);assert.equal(h.api.status().failed,3);assert.equal(h.api.status().phase,'skipped');assert.equal(h.api.status().running,false);
});
test('partial completion still counts as a successful detection',async()=>{
 const h=setup({completion:'调用进行中'});await h.api.start(1);assert.equal(h.sent,1);assert.equal(h.renamed,1);assert.equal(h.api.status().phase,'done');
});
test('probe stops on the first matching target and renames only that hit chat',async()=>{
 const h=setup({model:'claude-opus-5'});await h.api.start(8,{mode:'probe',targets:'opus5, fable5, gpt6'});
 assert.equal(h.sent,1);assert.equal(h.renamed,1,'a hit renames to the model name');assert.equal(h.api.status().hits[0].target,'opus5');assert.match(h.api.status().progress,/命中/);assert.equal(h.location.pathname,'/agent/new-session');assert.equal(h.api.status().running,false);
});
test('probe treats gpt-5.6 as a miss for the gpt6 shorthand and does NOT rename it',async()=>{
 const h=setup({model:'gpt-5.6-sol'});await h.api.start(1,{mode:'probe',targets:'gpt6'});
 assert.equal(h.sent,1);assert.equal(h.api.status().hits.length,0);
 assert.equal(h.renamed,0,'a miss keeps its arithmetic title for later cleanup');
});
test('probe continues through misses until the round limit',async()=>{
 const h=setup({model:'grok-4.6'});await h.api.start(2,{mode:'probe',targets:'opus5'});
 assert.equal(h.sent,2);assert.equal(h.api.status().hits.length,0);assert.match(h.api.status().progress,/未命中/);
});
test('probe findAll keeps going after the first hit',async()=>{
 const h=setup({model:'gpt-6'});await h.api.start(2,{mode:'probe',targets:'gpt6, opus5',findAll:true});
 assert.equal(h.sent,2);assert.equal(h.api.status().hits[0].target,'gpt6');
});
test('probe hits are renamed with a per-model -001/-002 suffix that persists across runs',async()=>{
 const h=setup({model:'gpt-6'});
 await h.api.start(1,{mode:'probe',targets:'gpt6'});
 assert.deepEqual(h.names,['gpt-6-001']);
 await h.api.start(1,{mode:'probe',targets:'gpt6'});
 assert.deepEqual(h.names,['gpt-6-001','gpt-6-002'],'same model keeps counting up across probe runs');
 const other=setup({model:'claude-fable-5.1'});
 await other.api.start(1,{mode:'probe',targets:'fable5'});
 assert.deepEqual(other.names,['claude-fable-5.1-001'],'a different model has its own counter');
});
test('draw mode still renames with the bare model name, no suffix',async()=>{
 const h=setup({model:'gpt-6'});await h.api.start(1);
 assert.deepEqual(h.names,['gpt-6']);
});
test('collapsed "Agent" shorthand is treated as Agent Mode and never wedges the flow',async()=>{
 const h=setup({agentShorthand:true});await h.api.start(1);
 assert.equal(h.sent,1);assert.equal(h.renamed,1);assert.equal(h.api.status().phase,'done');
 assert.ok(!/未能确认 Agent Mode/.test(h.api.status().progress));
});
test('probe fable5.1 detects claude-fable-5.1 with the shorthand selector present',async()=>{
 const h=setup({agentShorthand:true,model:'claude-fable-5.1'});await h.api.start(1,{mode:'probe',targets:'fable5.1'});
 assert.equal(h.sent,1);assert.equal(h.api.status().hits[0].target,'fable5.1');assert.match(h.api.status().progress,/命中/);
});
test('a token-acquisition failure skips the round and continues into a fresh chat',async()=>{
 const h=setup({detectFailRounds:1});await h.api.start(3);
 assert.equal(h.sent,3,'each round still sends into its own fresh chat');
 assert.equal(h.api.status().completed,2);assert.equal(h.api.status().failed,1);
 assert.equal(h.api.status().phase,'done','one detect failure must not halt the whole job');
});
test('three consecutive token-acquisition failures still stop the job',async()=>{
 const h=setup({detectFailRounds:3});await h.api.start(5);
 assert.equal(h.api.status().failed,3);assert.equal(h.api.status().phase,'skipped');assert.equal(h.api.status().running,false);
});
test('there are exactly 50 distinct probe prompts and each is recognized as own',()=>{
 const h=setup();const P=h.api.PROMPTS;
 assert.equal(P.length,50);assert.equal(new Set(P).size,50);
 assert.ok(P.every(p=>h.api.isOwnPrompt(p)));
 assert.ok(!h.api.isOwnPrompt('please delete everything'));
 assert.ok(P.includes('1+1='));
});
test('arithmetic-title detection matches only probe sends, never model names or user titles',()=>{
 const h=setup();
 for(const t of ['1+1=','7+7=','2+3=','12 - 4 =','5*5=','9÷3=','50+50='])assert.ok(h.api.isArithmeticTitle(t),t);
 for(const t of ['claude-fable-5-1','gpt-6','qwen3.8-max','大还是小','New Chat','1+1','=','1+1=2','my 2+2= notes',''])assert.ok(!h.api.isArithmeticTitle(t),t);
});
test('arithmeticCleanupCandidates sweeps only arithmetic-titled sidebar chats and keeps the open one',()=>{
 const h=setup();
 const sidebar=[
  {sessionId:'a',title:'1+1='},           // probe residue
  {sessionId:'b',title:'5*5='},           // probe residue
  {sessionId:'hit',title:'claude-fable-5-1'}, // renamed hit — keep
  {sessionId:'user',title:'大还是小'},         // user chat — keep
  {sessionId:'open',title:'3+3='}          // arithmetic but currently open — keep
 ];
 const out=h.api.arithmeticCleanupCandidates(sidebar,{keepSessionId:'open'});
 assert.equal(out.map(c=>c.sessionId).join(','),'a,b');
});
