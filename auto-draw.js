/* Bounded, opt-in UI automation. Requires active listening; no send retries. */
(() => {
  const DEFAULT_TARGETS=['opus5','fable5','gpt6'];
  const FAMILIES={opus5:String.raw`(?:claude[-_\s.]*)?opus[-_\s.]*5(?:[-_.]\d+)?(?!\d)`,fable5:String.raw`(?:claude[-_\s.]*)?fable[-_\s.]*5(?:[-_.]\d+)?(?!\d)`,gpt6:String.raw`(?:chat)?gpt[-_\s.]*6(?:[-_\s.]*astra|[-_\s.]*pro)?(?!\d)`};
  const ALIASES={opus5:'opus5',claudeopus5:'opus5',fable5:'fable5',claudefable5:'fable5',fable51:'fable5',claudefable51:'fable5',gpt6:'gpt6',chatgpt6:'gpt6',gpt6astra:'gpt6',gpt6pro:'gpt6',astra:'gpt6'};
  const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const parseTargets=text=>[...new Set(String(text??'').split(/[,，;；\n]+/).map(s=>s.trim().replace(/[.\s]+$/,'')).filter(s=>s.length>=2&&s.length<=80))].slice(0,20);
  function compileTarget(target){
    const raw=String(target||'').trim();if(!raw)return null;
    if(raw.length>=3&&raw.startsWith('/')&&raw.lastIndexOf('/')>0){
      const last=raw.lastIndexOf('/');const body=raw.slice(1,last);let flags=raw.slice(last+1).replace(/[^gimsuy]/g,'')||'i';
      if(!flags.includes('i'))flags+='i';if(!body||body.length>120)return null;
      try{return new RegExp(body,flags);}catch{return null;}
    }
    const family=ALIASES[normalize(raw)];
    if(family)return new RegExp(FAMILIES[family],'i');
    try{return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[-_\s.]+/g,'[-_\\s.]*'),'i');}catch{return null;}
  }
  function matchTargets(models,targets){
    const names=(Array.isArray(models)?models:[]).map(m=>typeof m==='string'?m:m?.model).filter(Boolean);
    const hits=[];
    for(const target of targets||[]){
      const regex=compileTarget(target);if(!regex)continue;
      const index=names.findIndex(name=>regex.test(name)||regex.test(normalize(name)));
      if(index>=0)hits.push({target,model:names[index]});
    }
    return hits;
  }
  let running=false,cancelled=false,progress='点击后将自动开启监听、新建对话并随机发送一条算式',phase='idle',sent=false,sessionId=null;
  let total=5,round=0,completed=0,failed=0,mode='draw',targets=[],hits=[],findAll=false;
  let notify=()=>{},readState=()=>null;
  // 50 short, cheap, unambiguous probe prompts. Distinct arithmetic keeps replies
  // one-token-fast and avoids identical-text dedup; one is chosen at random per round.
  const PROMPTS=Array.from({length:50},(_,i)=>`${i+1}+${i+1}=`);
  const pickPrompt=()=>PROMPTS[Math.floor(Math.random()*PROMPTS.length)];
  let currentPrompt=PROMPTS[0];
  const NEW_CHAT_LABELS=['New Chat','New chat','新建聊天','新对话','新建对话'];
  const visible=e=>!!e?.isConnected&&e.getClientRects().length>0;
  const session=()=>location.pathname.match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/)?.[1]||null;
  const agentPath=()=>location.pathname.replace(/\/$/,'')==='/agent';
  const status=()=>({running,phase,progress,sent,sessionId,total,round,completed,failed,mode,targets:[...targets],hits:hits.map(h=>({...h})),findAll});
  const publish=(p,text)=>{phase=p;progress=text;notify(status());};
  function guard(){if(cancelled)throw Error('已停止自动抽卡；已发送的消息不会撤回');if(location.origin!=='https://arena.ai')throw Error('已离开 Arena，自动抽卡已停止');}
  async function wait(check,message,ms=15000){const end=Date.now()+ms;while(Date.now()<end){guard();const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,250));}throw Error(message);}
  const labelOf=e=>((e?.getAttribute?.('aria-label')||e?.placeholder||'')+' '+(e?.textContent||'')).trim();
  const isSearch=e=>/search|搜索|查找/i.test(labelOf(e))||e?.closest?.('[data-sidebar]');
  function editors(){
    const nodes=[];
    for(const sel of ['[contenteditable="true"]','textarea','[role="textbox"]'])nodes.push(...document.querySelectorAll(sel));
    return [...new Set(nodes)].filter(e=>visible(e)&&!isSearch(e));
  }
  // Zero-width characters survive trim() but are not visible content.
  const clean=t=>String(t??'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim();
  function placeholderText(e){
    const own=e.getAttribute?.('data-placeholder')||e.getAttribute?.('aria-placeholder')||'';
    if(own)return String(own).trim();
    const inner=e.querySelector?.('[data-placeholder]');
    return String(inner?.getAttribute?.('data-placeholder')||'').trim();
  }
  // Prefer the box that looks like a chat composer (message-ish label, placeholder,
  // or inside a form); never blindly take DOM order, or a message edit box later in
  // the document would be mistaken for the composer.
  function composerScore(e){
    let s=0;
    if(/message|prompt|发送|消息|提问|ask|chat/i.test(labelOf(e)))s+=4;
    if(e.closest?.('form'))s+=2;
    if(placeholderText(e))s+=1;
    return s;
  }
  function composer(){
    const all=editors();
    if(!all.length)return null;
    let best=all.at(-1),score=composerScore(best);
    for(const e of all){const s=composerScore(e);if(s>score){best=e;score=s;}}
    return best;
  }
  function editorText(e){
    if(!e)return '';
    const tag=(e.tagName||'').toUpperCase();
    if(tag==='TEXTAREA'||tag==='INPUT')return clean(e.value);
    // Rich-text composers mark an empty box with an is-empty class or render the
    // placeholder as real DOM text; neither is a user draft.
    if(/\bis-(?:editor-)?empty\b/.test(String(e.className||'')))return '';
    const text=clean(e.innerText??e.textContent);
    const ph=placeholderText(e);
    if(text&&ph&&text===ph)return '';
    if(text&&e.childElementCount===1&&/placeholder|hint/i.test(String(e.firstElementChild?.className||'')))return '';
    return text;
  }
  const isOwnPrompt=t=>PROMPTS.includes(t);
  function noDraft(allowPrompt=false){
    const all=editors();
    const main=composer();
    // Only the composer receives our inserted prompt, so only its draft can block
    // the flow. Unrelated page fields must not wedge probing with false positives.
    const suspects=main?[main]:all;
    const offender=suspects.find(e=>{const t=editorText(e);return t&&!(allowPrompt&&isOwnPrompt(t));});
    if(offender){
      // The dump tells us exactly which boxes exist and what was read from each,
      // so a future false positive is diagnosable from the message alone.
      const dump=all.map(e=>`${String(e.tagName||'?').toLowerCase()}${e.id?'#'+e.id:''}:"${editorText(e).slice(0,10)}…"`).join(' ');
      throw Error(`输入框有未发送内容（"${editorText(offender).slice(0,24)}" · 共${all.length}个输入区 ${dump}），已停止；不会覆盖草稿`);
    }
  }
  function expandSidebar(){
    const buttons=[...document.querySelectorAll('button[aria-label]')].filter(b=>visible(b)&&!b.disabled);
    const opener=buttons.find(b=>['Open sidebar','展开侧栏','打开侧边栏','展开侧边栏'].includes(b.getAttribute('aria-label')))
      ||buttons.find(b=>['Toggle Sidebar','Toggle sidebar','切换侧栏'].includes(b.getAttribute('aria-label'))&&b.closest?.('[data-state="collapsed"]'));
    opener?.click();
  }
  function newChatControl(){
    const agentLink=a=>{try{const u=new URL(a.href,location.origin);return u.origin==='https://arena.ai'&&u.pathname.replace(/\/$/,'')==='/agent';}catch{return false;}};
    const links=[...document.querySelectorAll('a[href]')].filter(agentLink);
    const named=links.filter(a=>NEW_CHAT_LABELS.includes((a.textContent||'').trim())||NEW_CHAT_LABELS.includes((a.getAttribute?.('aria-label')||'').trim()));
    if(named.length)return named.find(visible)||named[0];
    const buttons=[...document.querySelectorAll('button,[role="button"]')];
    const labeled=buttons.filter(e=>NEW_CHAT_LABELS.includes((e.textContent||'').trim())||NEW_CHAT_LABELS.includes((e.getAttribute?.('aria-label')||'').trim()));
    return labeled.find(visible)||labeled[0]||null;
  }
  async function newChat(allowPrompt=false){
    guard();noDraft(allowPrompt&&!session());
    if(!session()&&agentPath()&&composer()){noDraft(allowPrompt);return;}
    expandSidebar();
    const control=await wait(()=>newChatControl(),'未找到 New Chat 入口，已停止');
    control.click();
    await wait(()=>!session()&&agentPath(),'新建聊天超时');
    await wait(()=>composer(),'等待新聊天输入框超时');
    noDraft(allowPrompt);
  }
  function fillPrompt(editor,text){
    editor.focus();
    if(editorText(editor)===text)return true;
    const tag=(editor.tagName||'').toUpperCase();
    if(tag==='TEXTAREA'||tag==='INPUT'){
      const proto=tag==='TEXTAREA'?globalThis.HTMLTextAreaElement?.prototype:globalThis.HTMLInputElement?.prototype;
      const setter=proto&&Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(editor,text);else editor.value=text;
      editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      editor.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    }else{
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,text)){
        editor.textContent=text;
        editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      }
    }
    return editorText(editor)===text;
  }
  function findSend(editor){
    const ok=b=>visible(b)&&!b.disabled;
    const exact=[...document.querySelectorAll('button[aria-label="Send message"]')].find(ok);
    if(exact)return exact;
    const buttons=[...document.querySelectorAll('button')].filter(ok);
    const named=buttons.find(b=>/^(send( message)?|submit|发送(消息)?)$/i.test((b.getAttribute?.('aria-label')||'').trim())||/^(send|发送)$/i.test((b.textContent||'').trim()));
    if(named)return named;
    const form=editor?.closest?.('form');
    if(form){
      const submit=[...form.querySelectorAll('button[type="submit"], button')].find(b=>ok(b)&&b.getAttribute('type')!=='reset');
      if(submit)return submit;
    }
    const host=editor?.parentElement;
    if(host){
      const local=[...host.querySelectorAll('button')].filter(ok);
      if(local.length===1)return local[0];
    }
    return null;
  }
  // The collapsed selector shows the shorthand "Agent"; expanded it reads "Agent Mode…".
  // Accept either so a UI label change never wedges the flow on an already-correct mode.
  const isAgentLabel=txt=>{const t=String(txt||'').trim();return /^Agent(\s+Mode)?\b/i.test(t)||/agent\s*mode/i.test(t);};
  async function modeSelect(){
    const combo=await wait(()=>[...document.querySelectorAll('button[role="combobox"]')].find(visible),'未找到模式选择器');
    if(!isAgentLabel(combo.textContent)){
      combo.click();const option=await wait(()=>[...document.querySelectorAll('[role="option"]')].find(e=>visible(e)&&/agent\s*mode/i.test(e.textContent.trim())&&!e.hasAttribute('data-disabled')&&e.getAttribute('aria-disabled')!=='true'),'未找到 Agent Mode 选项');
      if(option.getAttribute('aria-selected')==='true')combo.click();else option.click();
    }
    await wait(()=>[...document.querySelectorAll('button[role="combobox"]')].some(e=>visible(e)&&isAgentLabel(e.textContent)),'未能确认 Agent Mode');
  }
  async function nextBlank(){
    await newChat(true);await modeSelect();guard();
    const editor=composer();
    // Arena may restore the just-submitted prompt as its new-chat draft.
    // Clear only one of our own probe prompts, never another user draft.
    if(editor&&isOwnPrompt(editorText(editor))){
      editor.focus();
      const tag=(editor.tagName||'').toUpperCase();
      if(tag==='TEXTAREA'||tag==='INPUT'){
        const proto=tag==='TEXTAREA'?globalThis.HTMLTextAreaElement?.prototype:globalThis.HTMLInputElement?.prototype;
        const setter=proto&&Object.getOwnPropertyDescriptor(proto,'value')?.set;
        if(setter)setter.call(editor,'');else editor.value='';
        editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      }else{
        const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand('delete',false))throw Error('已进入新聊天，但残留提示未能清理；未再次发送');
      }
      await wait(()=>!editorText(composer()),'新聊天草稿未能清空；未再次发送');
    }
    noDraft();
  }
  async function listen(enabled){const r=await chrome.runtime.sendMessage({type:'ATI_SET_LISTENING',enabled,pageUrl:location.href});if(r?.error||!!r?.enabled!==enabled)throw Error(r?.error||'监听状态切换失败');return r;}
  async function requireListening(){
    const state=await chrome.runtime.sendMessage({type:'ATI_STATUS',pageUrl:location.href});
    if(state?.enabled===true&&!state.restoring&&!state.error)return state;
    const next=await listen(true);
    if(next?.enabled!==true||next.restoring||next.error)throw Error(next?.error||'无法开启监听；未发送消息');
    return next;
  }
  function remainingTargets(){
    const found=new Set(hits.map(h=>normalize(h.target)));
    return targets.filter(t=>!found.has(normalize(t)));
  }
  // Probe hits are renamed "<model>-NNN" with a per-model counter persisted in
  // site storage, so numbering continues across probe runs: first hit -001,
  // second -002, …
  const COUNTER_KEY='ati.probe.counters';
  function nextSuffix(model){
    const key=normalize(model)||'model';
    let store={};
    try{store=JSON.parse(globalThis.localStorage?.getItem(COUNTER_KEY)||'{}');}catch{store={};}
    const n=(Number.isInteger(store[key])&&store[key]>=0?store[key]:0)+1;
    store[key]=n;
    try{globalThis.localStorage?.setItem(COUNTER_KEY,JSON.stringify(store));}catch{}
    return String(n).padStart(3,'0');
  }
  // A pure-arithmetic conversation title, e.g. "1+1=", "2+3=", "5*5=", "12 - 4 =".
  // These are only ever produced by our own probe/draw sends (a human names chats
  // with words), so a title-based sweep can archive probe residue even without a
  // local record — while never matching a model-name or user-written title.
  const isArithmeticTitle=t=>/^\s*\d{1,4}\s*[+\-*/×÷]\s*\d{1,4}\s*=\s*$/.test(String(t||''));
  // Title-based cleanup: archive sidebar conversations whose title is a bare arithmetic
  // expression (our own unanswered probe sends). Model-name titles from hits are kept.
  // Never matches user-written titles. sidebarList: [{sessionId,title}].
  function arithmeticCleanupCandidates(sidebarList,options={}){
    const keepSessionId=options.keepSessionId||null;
    const seen=new Set(),out=[];
    for(const c of Array.isArray(sidebarList)?sidebarList:[]){
      const id=c?.sessionId;
      if(typeof id!=='string'||seen.has(id))continue;
      if(keepSessionId&&id===keepSessionId)continue;
      if(!isArithmeticTitle(c.title))continue;
      seen.add(id);
      out.push({sessionId:id,title:String(c.title||'').slice(0,300)});
    }
    return out;
  }
  async function start(rounds=5, options={}){
    if(running)return status();
    const count=Number(rounds);
    if(!Number.isInteger(count)||count<1||count>100){publish('blocked','轮数必须是 1–100 的整数');return status();}
    if(readState()?.connectionError){publish('blocked','扩展连接不可用，请先重试连接');return status();}
    const nextMode=options.mode==='probe'?'probe':'draw';
    const nextTargets=nextMode==='probe'?(parseTargets(options.targets).length?parseTargets(options.targets):DEFAULT_TARGETS):[];
    if(nextMode==='probe'&&!nextTargets.length){publish('blocked','请填写要探测的型号，例如 opus5, fable5, gpt6');return status();}
    running=true;cancelled=false;sent=false;sessionId=null;total=count;round=0;completed=0;failed=0;
    mode=nextMode;targets=nextTargets;hits=[];findAll=nextMode==='probe'&&options.findAll===true;
    let ownListening=false,consecutiveFailures=0,halted=false,matched=false;
    publish('checking',nextMode==='probe'?`探针目标：${targets.join(', ')}；将自动开监听、新建对话并随机发送一条算式`:'将自动开启监听、新建对话并随机发送一条算式');
    try{
      publish('listen','正在开启监听');await listen(true);ownListening=true;guard();
      for(round=1;round<=total;round++){
        sent=false;sessionId=null;
        publish('new-chat',`${round}/${total} · 正在新建聊天`);
        try{
      if(ArenaConversationRename.isBusy())throw Error('聊天操作正在进行，请稍后重试');
      noDraft(!session());if(document.querySelector('button[aria-label="Stop generating"]'))throw Error('当前回复仍在生成，已停止试运行');
      await newChat(true);publish('mode',`${round}/${total} · 正在确认 Agent Mode`);await modeSelect();
      guard();if(!agentPath())throw Error('页面已变化，未发送');
      guard();if(session())throw Error('新聊天状态已变化，未发送');noDraft(true);
      const editor=composer();if(!editor)throw Error('输入框不可用');
      currentPrompt=pickPrompt();
      if(!fillPrompt(editor,currentPrompt))throw Error('输入消息失败；未发送');
      const button=await wait(()=>findSend(editor),'发送按钮不可用；未发送');
      guard();if(editorText(editor)!==currentPrompt||session())throw Error('输入或页面已变化；未发送');
      if(![...document.querySelectorAll('button[role="combobox"]')].some(b=>visible(b)&&isAgentLabel(b.textContent)))throw Error('模式已变化；未发送');
      await requireListening();guard();if(session())throw Error('页面已变化，未发送');
      sent=true;publish('detect',`${round}/${total} · 已发送 ${currentPrompt}，获取模型名：会话流 → 令牌 → trace`);button.click();
      sessionId=await wait(()=>session(),'发送后未确认新会话；不重发',30000);
      const acquired=await ArenaAcquire.waitForModel({
        sessionId,timeout:180000,
        isCurrent:()=>!cancelled&&session()===sessionId&&readState()?.enabled!==false,
        abortReason:()=>cancelled?'手动停止':session()!==sessionId?`地址变为 ${location.pathname||'（无）'}，本轮会话 ${sessionId}`:'监听状态断开',
        send:m=>chrome.runtime.sendMessage({...m,pageUrl:location.href}),
        onStage:snap=>publish('detect',`${round}/${total} · ${({stream:'截获会话流',token:'等待运行令牌',trace:'拉取 Trigger.dev trace',model:'已解析模型标签'})[snap.stage]||snap.stage} · ${snap.status||''}`)
      });
      const models=acquired.models||[];
      if(!models.length)throw Error('trace 未返回模型名称');
      const detected={state:{sessionId,runId:acquired.runId,models,saved:true},view:{models,completion:'调用已完成'}};
      const model=detected.view.models[0].model;
      const doRename=async()=>{
        const name=mode==='probe'?model+'-'+nextSuffix(model):model;
        publish('rename',`${round}/${total} · 已取得 ${model}，正在重命名为 ${name}`);guard();
        await ArenaConversationRename.rename({sessionId,model:name,isCurrent:()=>!cancelled&&session()===sessionId&&(readState()?.runId===detected.state.runId||acquired.runId===detected.state.runId)});
        guard();
      };
      // Probe mode renames only on a hit; misses keep their arithmetic title so
      // 一键清理 can later archive them. Draw mode still names every round.
      if(mode==='probe'){
        const roundHits=matchTargets(detected.view.models,remainingTargets());
        if(roundHits.length){
          await doRename();
          hits.push(...roundHits.map(h=>({...h,sessionId,round})));
          matched=true;
          const left=remainingTargets();
          publish('hit',`${round}/${total} · 命中 ${roundHits.map(h=>h.model).join(' / ')}（目标 ${roundHits.map(h=>h.target).join(', ')}）`);
          if(!findAll||!left.length){halted=true;publish('done',`探针命中：${hits.map(h=>h.model).join(' / ')}；已停止${left.length?'，未找到 '+left.join(', '):''}`);break;}
        }else{
          publish('miss',`${round}/${total} · 当前为 ${model}，未命中 ${remainingTargets().join(', ')}；保留算式标题待清理`);
        }
      }else{
        await doRename();
      }
      if(halted)break;
      publish('next',`${round}/${total} · 正在进入新的空白聊天`);await nextBlank();
      completed++;consecutiveFailures=0;
        }catch(e){
          if(cancelled)throw e;
          failed++;consecutiveFailures++;
          const message=e?.message||'本轮失败';
          // Only a completed send on the same chat may be skipped automatically.
          // Never continue after loss of listening, navigation, or an unsafe draft.
          // The next round opens a fresh blank chat, so a token/trace acquisition
          // failure ('detect') on an already-sent chat is safe to skip — we never
          // resend into the same conversation.
          const canSkip=sent&&sessionId&&session()===sessionId&&readState()?.enabled===true
            &&(/检测超时/.test(message)||phase==='detect'||phase==='rename'||phase==='hit'||phase==='miss');
          if(!canSkip||consecutiveFailures>=3){halted=true;publish('skipped',message+(consecutiveFailures>=3?'；连续失败 3 次，已停止':'；已停止抽卡'));break;}
          publish('skipped',`${round}/${total} · ${message}；保留聊天，跳过本轮`);
        }
        guard();
      }
      round=Math.min(round,total);
      if(!halted){
        if(mode==='probe')publish('done',matched?`探针结束：命中 ${hits.map(h=>h.model).join(' / ')||'无'}，成功 ${completed} 轮`:`探针结束：未命中 ${targets.join(', ')}；成功 ${completed} 轮，跳过 ${failed} 轮`);
        else publish('done',`抽卡结束：成功 ${completed} 轮，跳过 ${failed} 轮；不再自动发送`);
      }
    }catch(e){publish(cancelled?'stopped':'skipped',e?.message||'自动抽卡已停止');}
    finally{
      if(ownListening&&location.origin==='https://arena.ai'&&(!sessionId||session()===sessionId||!session())){
        try{await listen(false);}catch{progress+='；停止监听失败，请手动停止';}
      }
      running=false;notify(status());
    }
    return status();
  }
  function stop(){if(running){cancelled=true;publish('stopping','正在停止；不会再发送新消息');}}
  globalThis.ArenaAutoDraw={start,stop,status,configure(options){readState=options.readState;notify=options.onProgress||(()=>{});notify(status());},parseTargets,matchTargets,normalizeModelKey:normalize,DEFAULT_TARGETS,PROMPTS,isOwnPrompt,arithmeticCleanupCandidates,isArithmeticTitle};
})();
