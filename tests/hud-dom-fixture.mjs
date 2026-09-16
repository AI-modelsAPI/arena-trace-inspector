// Minimal DOM fixture for control-flow tests; CSS and pointer geometry are browser-tested separately.
import fs from 'node:fs';
import vm from 'node:vm';
export function setupHud(sendMessage, autoEnabled=false, drawApi=undefined){
 const timers=[],events={},messages=[],hooks={};let document;
 class Node{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.style={};this.handlers={};this.textContent='';this.className='';this.isConnected=false;this.classList={toggle:(name,on)=>{const names=new Set(this.className.split(' '));on?names.add(name):names.delete(name);this.className=[...names].join(' ');},add:()=>{},remove:()=>{}};}
  append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;n.isConnected=true;}}
  attachShadow(){this.shadowRoot=new Node('shadow');return this.shadowRoot;}
  setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,v){this.handlers[k]=v;}getBoundingClientRect(){return {x:12,y:12,left:12,top:12,width:370,height:500};}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelector(selector){for(const n of [...this.children,...(this.shadowRoot?[this.shadowRoot]:[])]){if(selector[0]==='.'&&n.className.split(' ').includes(selector.slice(1)))return n;const child=n.querySelector(selector);if(child)return child;}return null;}
  focus(){}getClientRects(){return [this.getBoundingClientRect()];}
 }
 const root=new Node('html');root.isConnected=true;document={documentElement:root,hidden:false,createElement:tag=>new Node(tag),addEventListener:(name,fn)=>{events[name]=fn;}};
 const location={pathname:'/agent/session-a'};
 const sandbox={document,location,ArenaAutoDraw:drawApi,window:{innerWidth:1200,innerHeight:900,addEventListener:(name,fn)=>{events[name]=fn;},navigation:{addEventListener:(name,fn)=>{events[name]=fn;}}},MutationObserver:class{constructor(fn){hooks.repair=fn;}observe(){}},ArenaTracePanel:{create:(_parent,options)=>{hooks.panelOptions=options;return {render(view){hooks.view=view;},async renameModel(model,view){hooks.renames??=[];hooks.renames.push({model,sessionId:view.sessionId});}};}},chrome:{runtime:{onMessage:{addListener(fn){hooks.message=fn;}},sendMessage:msg=>{messages.push(msg);if(msg.type==='ATI_AUTO_RENAME_GET')return Promise.resolve({enabled:autoEnabled});if(msg.type==='ATI_HUD_GET')return Promise.resolve({prefs:{collapsed:true,position:{x:.4,y:.4}}});if(msg.type==='ATI_HUD_SAVE')return Promise.resolve({prefs:msg.prefs});return sendMessage(msg);}}},setTimeout:(fn,delay)=>{const entry={fn,delay,cancelled:false};timers.push(entry);return entry;},clearTimeout:entry=>{if(entry)entry.cancelled=true;}};
 vm.createContext(sandbox);
 for(const name of ['hud-layout.js','view-model.js','hud.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),sandbox);
 return {timers,events,messages,hooks,root,location};
}
