import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../auto-draw.js',import.meta.url),'utf8');
function setup({draft='',mode='Agent Mode',failRename=false,stickyDraft=false,enabled=true,statusEnabled=enabled}={}){
 const location={origin:'https://arena.ai',pathname:'/agent/old-chat'};
 let sent=0,renamed=0,newChats=0,state={enabled};const listens=[];
 const node={isConnected:true,getClientRects:()=>[{}]};
 const editor={...node,textContent:draft,focus(){}};
 const combo={...node,textContent:mode,click(){}};
 const option={...node,textContent:'Agent ModeBuilt for complex tasks',hasAttribute:()=>false,click(){combo.textContent='Agent Mode';}};
 const link={href:'https://arena.ai/agent',textContent:'New Chat',click(){newChats++;location.pathname='/agent';editor.textContent=stickyDraft&&newChats===2?'1+1=':'';}};
 const button={...node,disabled:false,click(){sent++;location.pathname='/agent/new-session';editor.textContent='';state={enabled:true,sessionId:'new-session',runId:'run-one',saved:true,models:[{model:'test-model'}]};}};
 const doc={querySelector:()=>null,querySelectorAll:q=>q==='[contenteditable="true"]'?[editor]:q==='a[href]'?[link]:q==='button[role="combobox"]'?[combo]:q==='[role="option"]'?[option]:q==='button[aria-label="Send message"]'?[button]:[],createRange:()=>({selectNodeContents(){}}),execCommand:(c,_ui,t)=>{editor.textContent=c==='delete'?'':t;return true;}};
 const sandbox={location,document:doc,window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},URL,Date,setTimeout,chrome:{runtime:{async sendMessage(m){if(m.type==='ATI_STATUS')return {enabled:statusEnabled};listens.push(m.enabled);state={...state,enabled:m.enabled};return {enabled:m.enabled};}}},ArenaConversationRename:{isBusy:()=>false,async rename({isCurrent}){if(failRename)throw Error('rename failed');if(!isCurrent())throw Error('stale');renamed++;}},ArenaTraceView:{build:s=>({models:s.models,completion:'调用已完成'})}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);const api=sandbox.ArenaAutoDraw;api.configure({readState:()=>state});
 return {api,location,listens,get sent(){return sent;},get renamed(){return renamed;},get newChats(){return newChats;},setState:s=>{state=s;}};
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
test('disabled listening blocks before navigation or enabling capture',async()=>{
 const h=setup({enabled:false});await h.api.start(5);assert.equal(h.sent,0);assert.equal(h.newChats,0);assert.deepEqual(h.listens,[]);assert.equal(h.api.status().phase,'blocked');
});
test('stale enabled UI cannot bypass background listening gate',async()=>{
 const h=setup({enabled:true,statusEnabled:false});await h.api.start(5);assert.equal(h.sent,0);assert.equal(h.newChats,0);assert.deepEqual(h.listens,[]);
});
test('invalid round counts never send',async()=>{
 for(const n of [0,-1,1.5,101,'',NaN]){const h=setup();await h.api.start(n);assert.equal(h.sent,0);assert.equal(h.newChats,0);}
});
test('three consecutive rename failures stop a five-round job',async()=>{
 const h=setup({failRename:true});await h.api.start(5);assert.equal(h.sent,3);assert.equal(h.api.status().failed,3);assert.equal(h.api.status().phase,'skipped');assert.equal(h.api.status().running,false);
});
