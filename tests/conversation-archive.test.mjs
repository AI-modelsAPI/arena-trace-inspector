import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../conversation-rename.js',import.meta.url),'utf8');
function setup({entry='Archive',dialog=false,remove=true,path='/agent/session-a',collapsed=false}={}){
 let archived=false,clicks=0,menuOpen=false,opens=0;const location={origin:'https://arena.ai',pathname:path};
 const visibleNode={isConnected:true,getClientRects:()=>[{}],getAttribute:()=>null};
 const sidebar={...visibleNode};
 const trigger={id:'menu-a',disabled:false,dispatchEvent(){},click(){menuOpen=true;}};
 const a={...visibleNode,getAttribute:k=>k==='data-state'?'closed':null,href:'https://arena.ai/agent/session-a',closest:selector=>selector.includes('collapsed')?(collapsed?{}:null):selector==='[data-sidebar="menu-item"]'?{querySelector:()=>trigger}:sidebar};
 const item={textContent:entry,hasAttribute:()=>false,click(){clicks++;if(remove){archived=true;menuOpen=false;}}};
 const menu={...visibleNode,getAttribute:k=>k==='role'?'menu':k==='aria-labelledby'?'menu-a':menuOpen?'open':'closed',querySelectorAll:()=>[item],dispatchEvent(){menuOpen=false;}};
 const opener={...visibleNode,getAttribute:()=> 'Open sidebar',click(){collapsed=false;opens++;}};
 const document={querySelectorAll:selector=>selector==='button[aria-label]'?[opener]:selector.includes('dialog')?(dialog?[visibleNode]:[]):selector.includes('a[data-sidebar')?(archived?[]:[a]):selector==='[role="menu"]'&&menuOpen?[menu]:[]};
 const sandbox={document,location,URL,Date,setTimeout,clearTimeout,setInterval,clearInterval,PointerEvent:class{},KeyboardEvent:class{}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {api:sandbox.ArenaConversationRename,get clicks(){return clicks;},get opens(){return opens;},location};
}
test('archive uses exact Archive menu and waits for confirmed sidebar removal',async()=>{
 const h=setup();const result=await h.api.archive({sessionId:'session-a'});
 assert.equal(result.archived,true);assert.equal(result.sessionId,'session-a');assert.equal(h.clicks,1);assert.equal(h.api.isBusy(),false);
});
test('archive refuses a different current conversation and does not click',async()=>{
 const h=setup({path:'/agent/session-b'});await assert.rejects(h.api.archive({sessionId:'session-a'}));assert.equal(h.clicks,0);
});
test('archive never substitutes Delete or another menu action',async()=>{
 const h=setup({entry:'Delete'});await assert.rejects(h.api.archive({sessionId:'session-a'}),/Archive/);assert.equal(h.clicks,0);assert.equal(h.api.isBusy(),false);
});
test('archive refuses an existing dialog and does not modify the chat',async()=>{
 const h=setup({dialog:true});await assert.rejects(h.api.archive({sessionId:'session-a'}));assert.equal(h.clicks,0);
});
test('archive revalidates current chat before clicking and unlocks after failure',async()=>{
 const h=setup();let checks=0;await assert.rejects(h.api.archive({sessionId:'session-a',isCurrent:()=>++checks<3}));assert.equal(h.clicks,0);assert.equal(h.api.isBusy(),false);
});

test('archive automatically expands a collapsed sidebar before selecting the exact chat',async()=>{
 const h=setup({collapsed:true});const result=await h.api.archive({sessionId:'session-a'});
 assert.equal(result.archived,true);assert.equal(h.opens,1);assert.equal(h.clicks,1);
});
test('visible tooltip trigger with data-state closed does not require opening the sidebar',async()=>{
 const h=setup();await h.api.archive({sessionId:'session-a'});assert.equal(h.opens,0);assert.equal(h.clicks,1);
});
