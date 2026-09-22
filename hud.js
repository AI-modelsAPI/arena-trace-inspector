(() => {
  let host,panel,status,dot,compactDot,shell,content,compact,compactName,compactToken,compactCost,compactCount,compactStatus,expandButton,listenButton,listenLabel;
  let requestVersion=0,displayedSession=null,latestState=null,retryTimer;
  let prefs,loadedPrefs=false,interactionVersion=0,drag=null,sizeObserver=null,layoutError='',listenError='',listenPending=false,pageKey=location.pathname;
  let autoRename=false,autoLoaded=false,autoPending=false,autoChecking=false,deletePending=false,archivePending=false;
  let drawStart,drawStop,drawStatus,drawRounds,drawProbe,drawTargets,drawFindAll,cleanupBtn;
  let drawRoundValue=5,contextLost=false,cleanupStopRequested=false;
  let compactPulse,compactPulseText,compactPulseBar,compactPulseFill,pulseLine,pulseText,pulseLineBar,pulseLineFill,pulse=null,pulseError='',pulseFetchedAt=0,pulseLoading=false;
  const drawing=()=>!!globalThis.ArenaAutoDraw?.status().running;
  // A reloaded/updated extension orphans this injected script: chrome.runtime.sendMessage
  // then throws synchronously. Detect it so the HUD points to a page refresh instead of
  // spinning on "读取状态…" forever. Reconnection cannot work; only reload re-injects.
  const contextAlive=()=>{try{return !!chrome.runtime?.id;}catch{return false;}};
  const isContextLost=err=>!contextAlive()||/context invalidated|Extension context/i.test(err?.message||String(err||''));
  function updateDraw(){
    if(!drawStart)return;
    const s=ArenaAutoDraw.status();
    const count=Number(drawRounds?.value);
    const busy=contextLost||cleanupPending||s.running||archivePending||deletePending||listenPending||latestState?.initializing||latestState?.connectionError||!Number.isInteger(count)||count<1||count>100;
    drawStart.disabled=busy;if(drawProbe)drawProbe.disabled=busy;
    if(drawRounds)drawRounds.disabled=s.running;if(drawTargets)drawTargets.disabled=s.running;if(drawFindAll)drawFindAll.disabled=s.running;
    drawStop.disabled=!s.running;
    const idleHint=contextLost?'扩展已重新加载，本页脚本失效；请刷新页面（F5）后再使用自动抽卡／探针。':cleanupPending?drawStatus.textContent:!s.running&&s.phase==='idle'?'点击后将自动：开启监听 → 新建对话 → 随机发送一条算式 → 读取模型名':s.progress;
    drawStatus.textContent=idleHint;updateListenControl();updateCleanup();
  }
  function updateCleanup(){
    if(!cleanupBtn)return;
    const s=ArenaAutoDraw?.status?.()||{running:false};
    if(cleanupPending){cleanupBtn.disabled=false;cleanupBtn.textContent='停止清理';return;}
    cleanupBtn.textContent='一键清理探测残留';
    cleanupBtn.disabled=contextLost||s.running||archivePending||deletePending||listenPending||latestState?.initializing||latestState?.connectionError;
  }
  globalThis.ArenaAutoDraw?.configure({readState:()=>latestState,onProgress:()=>{updateDraw();}});
  const attemptedHere=new Set();
  function repaint(){if(latestState)render(latestState);}
  async function loadAutoRename(){
    if(autoLoaded||latestState?.initializing||latestState?.connectionError)return;autoLoaded=true;
    try{const r=await chrome.runtime.sendMessage({type:'ATI_AUTO_RENAME_GET',pageUrl:location.href});if(r?.error)throw Error(r.error);if(!autoPending)autoRename=!!r.enabled;repaint();}
    catch{autoLoaded=false;}
  }
  async function setAutoRename(enabled){
    if(autoPending)return;autoPending=true;repaint();
    try{const r=await chrome.runtime.sendMessage({type:'ATI_AUTO_RENAME_SET',enabled,pageUrl:location.href});if(r?.error)throw Error(r.error);autoRename=!!r.enabled;listenError='';}
    catch{listenError='自动重命名设置保存失败，请重试';}
    finally{autoPending=false;repaint();}
  }
  async function maybeAutoRename(view){
    if(drawing()||archivePending||!autoRename||autoPending||autoChecking||view.historical||!latestState?.saved||!view.sessionId||!view.models.length||view.completion!=='调用已完成'||attemptedHere.has(view.sessionId))return;
    autoChecking=true;const session=view.sessionId;
    try{
      const r=await chrome.runtime.sendMessage({type:'ATI_AUTO_RENAME_CLAIM',sessionId:session,runId:view.runId,pageUrl:location.href});
      if(r?.error)throw Error(r.error);
      if(r?.claimed){attemptedHere.add(session);if(autoRename&&currentSession()===session&&latestState?.runId===view.runId)await panel.renameModel(view.models[0].model,view);}
    }catch{listenError='自动重命名未执行：状态校验失败，可手动重试';showSaveStatus();}
    finally{autoChecking=false;}
  }
  async function deleteCurrentRecord(view){
    if(drawing()||archivePending||deletePending||view.sessionId!==currentSession())return;
    if(!window.confirm('删除当前会话的扩展本地记录及累计用量？此操作无法撤销，不会删除 Arena 对话。继续监听后可能生成新记录。'))return;
    deletePending=true;repaint();
    try{const r=await chrome.runtime.sendMessage({type:'ATI_HISTORY_DELETE',sessionId:view.sessionId,pageUrl:location.href});if(!r?.ok)throw Error(r?.error);listenError='本地记录已删除';refresh();}
    catch{listenError='删除记录失败，请重试';}
    finally{deletePending=false;repaint();}
  }
  async function archiveCurrentChat(view){
    if(drawing()||archivePending||deletePending||autoChecking||ArenaConversationRename.isBusy()||view.sessionId!==currentSession())return;
    archivePending=true;repaint();let archived=false;
    try{
      const prep=await chrome.runtime.sendMessage({type:'ATI_ARCHIVE_PREPARE',sessionId:view.sessionId,pageUrl:location.href});
      if(!prep?.ticket)throw Error(prep?.error||'归档准备失败');
      const result=await ArenaConversationRename.archive({sessionId:view.sessionId,isCurrent:()=>archivePending&&currentSession()===view.sessionId});
      if(!result?.archived)throw Error('未确认归档，本地记录保留');archived=true;
      const removed=await chrome.runtime.sendMessage({type:'ATI_ARCHIVE_FINISH',ticket:prep.ticket,archived:true});
      if(!removed?.ok)throw Error(removed?.error||'本地记录清理失败');
      listenError='聊天已归档，本地记录已删除';
    }catch(e){listenError=archived?'聊天已归档，但本地记录清理失败；请在扩展会话列表删除记录':(e?.message||'归档失败，本地记录保留');}
    finally{archivePending=false;repaint();}
  }
  let cleanupPending=false;
  const currentSession=()=>location.pathname.match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/)?.[1]||null;
  function sidebarConversations(){
    // Sidebar conversation links with their visible titles, most-recent first.
    const seen=new Set(),out=[];
    for(const a of document.querySelectorAll('a[href^="/agent/"]')){
      const m=(a.getAttribute('href')||'').match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/);
      if(!m||seen.has(m[1]))continue;
      seen.add(m[1]);out.push({sessionId:m[1],title:(a.textContent||'').trim()});
    }
    return out;
  }
  const sidebarSessions=()=>sidebarConversations().map(c=>c.sessionId);
  function sidebarScroller(){
    if(typeof getComputedStyle!=='function')return null;
    for(const a of document.querySelectorAll('a[href^="/agent/"]')){
      let p=a.parentElement;
      while(p){
        const s=getComputedStyle(p);
        if(/(auto|scroll)/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+40)return p;
        p=p.parentElement;
      }
    }
    return null;
  }
  // The sidebar list is virtualized: only visible chat links exist in the DOM.
  // Scroll it to the bottom until the count stops growing, so the sweep sees every chat.
  async function loadAllSidebar(){
    const scroller=sidebarScroller();
    if(!scroller)return;
    let last=-1,stable=0;
    for(let i=0;i<30&&stable<2;i++){
      scroller.scrollTop=scroller.scrollHeight;
      await new Promise(r=>setTimeout(r,300));
      const n=sidebarConversations().length;
      if(n===last)stable++;else{stable=0;last=n;}
    }
  }
  function sidebarLink(sessionId){
    return [...document.querySelectorAll('a[href^="/agent/"]')].find(a=>{
      const m=(a.getAttribute('href')||'').match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/);return m&&m[1]===sessionId;
    })||null;
  }
  const waitFor=async(check,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=check();if(v)return v;await new Promise(r=>setTimeout(r,150));}return null;};
  async function archiveOne(sessionId){
    // Reuse the fully-guarded single-chat archive flow. Requires being on that chat's
    // page, so navigate via a real sidebar click (SPA nav keeps this script alive).
    if(currentSession()!==sessionId){
      const link=sidebarLink(sessionId);if(!link)throw Error('侧栏未找到该对话');
      link.click();
      if(!await waitFor(()=>currentSession()===sessionId))throw Error('切换到该对话超时');
      await waitFor(()=>!ArenaConversationRename.isBusy(),3000);
    }
    const prep=await chrome.runtime.sendMessage({type:'ATI_ARCHIVE_PREPARE',sessionId,pageUrl:location.href});
    if(!prep?.ticket)throw Error(prep?.error||'归档准备失败');
    const result=await ArenaConversationRename.archive({sessionId,isCurrent:()=>cleanupPending&&currentSession()===sessionId});
    if(!result?.archived)throw Error('未确认归档');
    const removed=await chrome.runtime.sendMessage({type:'ATI_ARCHIVE_FINISH',ticket:prep.ticket,archived:true});
    if(!removed?.ok)throw Error(removed?.error||'本地记录清理失败');
  }
  function computeCleanupCandidates(){
    // Arithmetic-title sweep: any sidebar chat still named like "N+N=" is an unanswered
    // probe send (probe now renames only on a hit; misses keep the arithmetic title).
    // Never matches model-name or user-written titles, so no record lookup is needed.
    return ArenaAutoDraw.arithmeticCleanupCandidates(sidebarConversations(),{keepSessionId:currentSession()});
  }
  async function cleanupProbeResidue(){
    if(contextLost||drawing()||archivePending||deletePending||cleanupPending||ArenaConversationRename.isBusy())return;
    if(!contextAlive())return markContextLost();
    // The sidebar list lazy-loads; wait briefly for links before concluding "nothing".
    if(!sidebarConversations().length){
      listenError='正在等待侧栏对话列表加载…';showSaveStatus();
      await waitFor(()=>sidebarConversations().length>0,6000);
    }
    await loadAllSidebar();
    let candidates=computeCleanupCandidates();
    if(!candidates.length){listenError='没有可清理的探测残留（只清理标题为算式的对话，如 1+1=；已命中改名的模型对话与你手动创建的对话都会保留）';showSaveStatus();return;}
    cleanupPending=true;updateCleanup();repaint();
    let done=0,failed=0,stop=false;
    try{
      // Recompute each pass: titles/sidebar change as chats get archived.
      while(!stop){
        if(!contextAlive()){markContextLost();break;}
        if(cleanupStopRequested){stop=true;break;}
        await loadAllSidebar(); // virtualization may drop links between passes
        const list=computeCleanupCandidates();
        const c=list.find(x=>x.sessionId!==currentSession());
        if(!c)break;
        listenError=`正在清理第 ${done+failed+1} 个：${c.title||c.sessionId}`;showSaveStatus();
        try{await archiveOne(c.sessionId);done++;}
        catch(e){
          // Retry once after re-loading the sidebar before counting a failure.
          await loadAllSidebar();
          try{await archiveOne(c.sessionId);done++;}
          catch(e2){failed++;if(/切换到该对话超时|侧栏未找到|离开 Arena/.test(e2?.message||'')||failed>=3){stop=true;}}
        }
      }
      await loadAllSidebar();
      const left=computeCleanupCandidates().filter(x=>x.sessionId!==currentSession()).length;
      listenError=`清理完成：已归档 ${done} 个算式对话${failed?`，失败 ${failed} 个`:''}${left?'；侧栏仍有 '+left+' 个，可再次清理':''}${stop&&(failed>=3)?'；连续失败已中止':stop&&cleanupStopRequested?'；已停止':''}`;
    }finally{cleanupPending=false;cleanupStopRequested=false;updateCleanup();refresh();}
  }
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
  function moveTo(point){if(!host)return;const p=ArenaHudLayout.clamp(point,host.getBoundingClientRect(),viewport());host.style.left=p.x+'px';host.style.top=p.y+'px';}
  // Collapsed mode docks to the right edge and auto-hides; only the saved vertical position applies.
  function placeSaved(){if(!host)return;const p=ArenaHudLayout.position(prefs.position,host.getBoundingClientRect(),viewport());if(prefs.collapsed){host.style.left='auto';host.style.right='0px';host.style.top=p.y+'px';return;}host.style.right='auto';moveTo(p);}
  function keepVisible(){if(host){if(prefs.collapsed){placeSaved();return;}const r=host.getBoundingClientRect();moveTo({x:r.left,y:r.top});}}
  function rememberPosition(){if(!host)return;const r=host.getBoundingClientRect();prefs.position=ArenaHudLayout.normalize({x:r.left,y:r.top},r,viewport());}
  function showSaveStatus(){
    if(status)status.textContent=[listenError,latestState?.status,layoutError].filter(Boolean).join(' · ');
    if(compactStatus)compactStatus.title=(latestState?.status||'')+(layoutError?' · '+layoutError:'');
  }
  async function savePrefs(){
    try{const result=await chrome.runtime.sendMessage({type:'ATI_HUD_SAVE',prefs});if(result?.error||!result?.prefs)throw Error('save failed');layoutError='';}
    catch{layoutError='位置／收起状态未能保存，本页操作仍然有效';}
    showSaveStatus();
  }
  function updatePulseText(){
    const base=pulse?globalThis.ArenaPulse?.format(pulse)||'':'';
    const text=base?base+(pulseError?' · '+pulseError:''):(pulseError?'额度：'+pulseError:'');
    const P=globalThis.ArenaPulse,r=P?.remaining?P.remaining(pulse):null,lv=r===null?'':P.level(pulse);
    if(compactPulseText){compactPulseText.textContent=text||'…';compactPulse.title=pulse?('额度接口每 60 秒读取一次'+(pulse.resetAt?'；重置时间 '+new Date(pulse.resetAt).toLocaleString():'')+(pulseError?'；'+pulseError:'')):(pulseError||'额度读取中…');}
    if(pulseText)pulseText.textContent=text;
    for(const [bar,fill] of [[compactPulseBar,compactPulseFill],[pulseLineBar,pulseLineFill]]){
      if(!bar)continue;
      if(r===null||r===undefined){bar.hidden=true;continue;}
      bar.hidden=false;fill.style.width=Math.max(0,Math.min(100,r))+'%';fill.className='pulse-fill'+(lv==='warn'?' warn':lv==='crit'?' crit':'');
    }
    if(pulseLine)pulseLine.hidden=!text&&r===null;
  }
  async function loadPulse(){
    if(pulseLoading||!contextAlive())return;pulseLoading=true;
    try{
      const r=await chrome.runtime.sendMessage({type:'ATI_PULSE_GET',pageUrl:location.href});
      if(r?.error)throw Error(r.error);
      if(r&&'pulse' in r){pulse=r.pulse||null;pulseError=pulse?'':(r.keys?.length?'返回格式未识别（字段：'+r.keys.join(', ')+'）':'返回格式未识别');}
    }catch(e){pulseError=e?.message||'额度读取失败';}
    finally{pulseFetchedAt=Date.now();pulseLoading=false;updatePulseText();}
  }
  function maybeLoadPulse(){if(Date.now()-pulseFetchedAt>60000)void loadPulse();}
  function loadPrefs(){
    if(loadedPrefs)return;loadedPrefs=true;const version=interactionVersion;
    chrome.runtime.sendMessage({type:'ATI_HUD_GET'}).then(result=>{
      if(result?.error||!result?.prefs)return;
      if(version!==interactionVersion)return; // A late read must not undo a user's drag.
      prefs=ArenaHudLayout.sanitize({...result.prefs,collapsed:false}); // New page visits always open expanded; keep the saved position.
      if(drawTargets&&document.activeElement!==drawTargets)drawTargets.value=prefs.probeTargets;
      if(drawFindAll)drawFindAll.checked=prefs.findAll;
      if(host){applyMode();placeSaved();}
    }).catch(()=>{});
  }
  function applyMode(){
    if(!shell)return;shell.classList.toggle('collapsed',prefs.collapsed);content.hidden=prefs.collapsed;compact.hidden=!prefs.collapsed;
    host.setAttribute('data-collapsed',String(prefs.collapsed));
  }
  function setCollapsed(value){
    interactionVersion++;const r=host.getBoundingClientRect();prefs.collapsed=value;applyMode();
    if(value){rememberPosition();placeSaved();}
    else{host.style.right='auto';moveTo({x:r.left,y:r.top});rememberPosition();}
    void savePrefs();
    if(value)expandButton.focus({preventScroll:true});else shell.querySelector('.collapse-button').focus({preventScroll:true});
  }
  function markContextLost(){
    if(contextLost)return;contextLost=true;clearTimeout(retryTimer);requestVersion++;
    latestState={...latestState,initializing:false,connectionError:false};
    listenError='扩展已重新加载，本页脚本已失效。请刷新此页面（F5）后重新使用。';
    if(host?.isConnected){updateListenControl();if(globalThis.ArenaAutoDraw)updateDraw();showSaveStatus();}
  }
  function updateListenControl(){
    if(!listenButton)return;
    const enabled=!!latestState?.enabled,initializing=!!latestState?.initializing;
    if(contextLost){listenButton.disabled=false;listenButton.textContent='刷新页面';listenButton.setAttribute('aria-pressed','false');listenLabel.textContent='扩展已重新加载，请刷新页面';return;}
    listenButton.disabled=drawing()||archivePending||listenPending||initializing;
    listenButton.textContent=listenPending?'处理中…':initializing?'读取状态…':latestState?.connectionError?'重试连接':enabled?'停止监听':'开启监听';
    listenButton.setAttribute('aria-pressed',String(enabled));
    listenLabel.textContent=initializing?'正在连接扩展':enabled?'当前页监听中':'当前页未监听';
  }
  async function changeListening(){
    if(contextLost){location.reload();return;}
    if(!contextAlive())return markContextLost();
    if(drawing()||archivePending||listenPending||latestState?.initializing)return;
    if(latestState?.connectionError){listenError='';render({...latestState,initializing:true,connectionError:false,status:'正在重新连接扩展…'});refresh();return;}
    const session=currentSession(),path=location.pathname;
    listenPending=true;listenError='';updateListenControl();if(globalThis.ArenaAutoDraw)updateDraw();showSaveStatus();
    try{
      const result=await chrome.runtime.sendMessage({type:'ATI_SET_LISTENING',enabled:!latestState?.enabled,pageUrl:location.href});
      if(path!==location.pathname||session!==currentSession())return;
      if(!result||result.restoring||(result.sessionId&&result.sessionId!==session))throw Error('页面状态已变化，请稍后重试');
      if(result.error)listenError=result.error;
      render(result);
    }catch(error){if(path===location.pathname)listenError=error?.message||'操作失败，请重新加载扩展后刷新页面';}
    finally{listenPending=false;updateListenControl();if(globalThis.ArenaAutoDraw)updateDraw();showSaveStatus();}
  }
  function addDrag(handle){
    handle.tabIndex=0;handle.setAttribute('role','group');handle.setAttribute('aria-label','拖动浮层；也可用方向键移动，Home 键复位');
    handle.title='按住拖动 · 方向键微调 · Home 回到右下角';
    handle.addEventListener('pointerdown',event=>{
      if(prefs.collapsed)return; // Docked collapsed panel auto-hides; dragging would fight the snap-back.
      if(!event.isPrimary||event.button!==0||event.target.closest('button,a,input,select,textarea'))return;
      event.preventDefault();interactionVersion++;const r=host.getBoundingClientRect();
      drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,left:r.left,top:r.top,moved:false};
      handle.setPointerCapture(event.pointerId);host.classList.add('dragging');
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;event.preventDefault();
      const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;
      moveTo({x:drag.left+dx,y:drag.top+dy});
    });
    const finish=event=>{
      if(!drag||drag.id!==event.pointerId)return;const moved=drag.moved;drag=null;host?.classList.remove('dragging');
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
      if(moved){rememberPosition();void savePrefs();}
    };
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('keydown',event=>{
      if(prefs.collapsed)return;
      if(event.target!==handle)return;const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if(event.key==='Home'){event.preventDefault();interactionVersion++;prefs.position={x:1,y:1};placeSaved();void savePrefs();return;}
      if(!steps[event.key])return;event.preventDefault();interactionVersion++;const r=host.getBoundingClientRect(),d=steps[event.key],step=event.shiftKey?40:10;
      moveTo({x:r.left+d[0]*step,y:r.top+d[1]*step});rememberPosition();void savePrefs();
    });
  }
  function createHost(){
    sizeObserver?.disconnect();drag=null;
    host=el('div');host.id='arena-trace-inspector-hud';
    host.style.cssText='position:fixed;left:12px;top:12px;z-index:2147483647;pointer-events:none';
    const root=host.attachShadow({mode:'closed'}),style=el('style');
    style.textContent=`
:host{all:initial}.shell{box-sizing:border-box;pointer-events:auto;width:400px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;border:1px solid #b7cec5;border-radius:15px;background:#f4f8f6;color:#182623;font:14px/1.55 system-ui,sans-serif;box-shadow:0 12px 48px #1c3a2e38;overflow:hidden}.shell *{box-sizing:border-box}[hidden]{display:none!important}.header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #d3e0da;flex-shrink:0}.header strong{font-size:14px;flex:1}.drag-handle{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.drag-handle:active{cursor:grabbing}.dot{width:6px;height:6px;border-radius:50%;background:#17a565;flex-shrink:0}button{font:14px system-ui,sans-serif;border:1px solid #a9c8bb;border-radius:6px;background:#fff;color:#1e5c42;cursor:pointer;padding:3px 8px}button:focus-visible,.drag-handle:focus-visible{outline:2px solid #0b7a4d;outline-offset:-3px}.content{min-height:0;max-height:70vh;overflow:auto;padding:13px}.draw-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.draw-rounds,.draw-targets{border:1px solid #a9c8bb;border-radius:6px;background:#fff;color:#182623;padding:6px;font:14px system-ui}.draw-rounds{width:56px;min-width:48px}.draw-targets{flex:1;min-width:140px}.draw-rounds:disabled,.draw-targets:disabled{opacity:.5}.draw-controls button{padding:6px 9px}.draw-controls button:disabled{opacity:.4;cursor:default}.draw-findall{display:flex;align-items:center;gap:4px;font-size:12px;color:#2e5a48;white-space:nowrap}.draw-findall input{accent-color:#0b7a4d;margin:0}.draw-cleanup{flex:1 0 100%;margin-top:2px;padding:6px 9px;border-color:#d8b48a;color:#8a5a1e;background:#fdf6ea}.draw-cleanup:disabled{opacity:.4;cursor:default}.draw-status{font-size:12px;line-height:1.6;color:#4c625b;margin:6px 0 12px;overflow-wrap:anywhere}.listen-controls{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}.listen-button{padding:7px 13px;border-color:#0b7a4d;background:#0b7a4d;color:#fff;font-weight:650}.listen-button:disabled{opacity:.6;cursor:wait}.listen-label{font-size:13px;color:#46605a}.status{color:#567069;font-size:13px;margin:0 0 12px;overflow-wrap:anywhere}.pulse-line{font-size:13px;color:#0b7a4d;font-weight:650;margin:-4px 0 10px}.pulse-bar{display:block;height:6px;border-radius:4px;background:#e3ede8;overflow:hidden;margin-top:5px}.pulse-fill{display:block;height:100%;border-radius:4px;background:#17a565;transition:width .3s}.pulse-fill.warn{background:#d9a514}.pulse-fill.crit{background:#d0352b}.content::-webkit-scrollbar{width:5px}.content::-webkit-scrollbar-thumb{background:#c0d4cb;border-radius:4px}.shell.collapsed{width:330px;border-color:#b7cec5;border-right:0;border-radius:12px 0 0 12px;background:#fff;transform:translateX(calc(100% - 36px));transition:transform .22s ease;box-shadow:0 8px 30px #1c3a2e2b}.shell.collapsed:hover,.shell.collapsed:focus-within{transform:translateX(0)}.collapsed .header{display:none}.compact{padding:13px 16px 15px;overflow:auto}.compact-head{display:flex;align-items:center;gap:10px;min-height:24px;margin-bottom:6px}.compact-title{flex:1;min-width:0;font:500 14px/1.4 system-ui,sans-serif;letter-spacing:.65px;color:#0b7a4d}.compact-name{min-width:0;margin-bottom:11px;font:700 22px/1.35 system-ui,sans-serif;color:#0c5c3a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.expand-button{flex:0 0 auto;width:24px;height:24px;padding:0;font-size:17px;color:#1e5c42;background:#eef7f2}.compact-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px;margin:0}.compact-field{min-width:0}.compact-field dt{font:600 13px/1.5 system-ui,sans-serif;color:#567069;margin:0}.compact-field dd{font:700 15px/1.5 system-ui,sans-serif;color:#152420;overflow-wrap:anywhere;margin:2px 0 0}.compact-field dd.compact-state{font:650 14px/1.625 system-ui,sans-serif;color:#30544a}
`;
    shell=el('section','shell');shell.setAttribute('aria-label','Arena 模型运行信息');
    const header=el('header','header drag-handle');dot=el('span','dot');
    const title=el('strong','','Arena · Trace Inspector'),toggle=el('button','collapse-button','收起');toggle.type='button';toggle.setAttribute('aria-expanded','true');toggle.addEventListener('click',()=>setCollapsed(true));
    header.append(dot,title,toggle);addDrag(header);header.removeAttribute('title');header.setAttribute('aria-label','浮层标题栏');
    compact=el('section','compact');compact.setAttribute('aria-label','精简模型信息');
    const compactHead=el('div','compact-head drag-handle');compactDot=el('span','dot compact-dot');const compactTitle=el('div','compact-title','ARENA · TRACE INSPECTOR');compactName=el('div','compact-name drag-handle');addDrag(compactName);expandButton=el('button','expand-button','↗');expandButton.type='button';expandButton.title='展开详细面板';expandButton.setAttribute('aria-label','展开详细面板');expandButton.setAttribute('aria-expanded','false');expandButton.addEventListener('click',()=>setCollapsed(false));compactHead.append(compactDot,compactTitle,expandButton);addDrag(compactHead);
    const grid=el('dl','compact-grid');
    const field=(label,name)=>{const wrap=el('div','compact-field');const v=el('dd',name);wrap.append(el('dt','',label),v);grid.append(wrap);return v;};
    compactToken=field('Token','compact-token');compactCost=field('trace 费用','compact-cost');compactCount=field('次数','compact-count');compactStatus=field('状态','compact-state');compactPulse=field('额度','compact-pulse');compactPulseText=el('span','');compactPulseBar=el('div','pulse-bar');compactPulseFill=el('div','pulse-fill');compactPulseBar.append(compactPulseFill);compactPulseBar.hidden=true;compactPulse.append(compactPulseText,compactPulseBar);
    compact.append(compactHead,compactName,grid);
    content=el('div','content');status=el('p','status');status.setAttribute('role','status');const controls=el('div','listen-controls');listenButton=el('button','listen-button','读取状态…');listenButton.type='button';listenButton.disabled=true;listenButton.addEventListener('click',()=>void changeListening());listenLabel=el('span','listen-label');controls.append(listenButton,listenLabel);pulseLine=el('p','pulse-line');pulseLine.hidden=true;pulseText=el('span','pulse-text');pulseLineBar=el('span','pulse-bar');pulseLineFill=el('span','pulse-fill');pulseLineBar.append(pulseLineFill);pulseLineBar.hidden=true;pulseLine.append(pulseText,pulseLineBar);content.append(controls,pulseLine,status);
    if(globalThis.ArenaAutoDraw){const drawControls=el('div','draw-controls');drawRounds=el('input','draw-rounds');drawRounds.type='number';drawRounds.min='1';drawRounds.max='100';drawRounds.step='1';drawRounds.value=String(drawRoundValue);drawRounds.setAttribute('aria-label','自动抽卡轮数');drawRounds.title='自动抽卡／探针轮数（1–100）';drawRounds.addEventListener('input',()=>{drawRoundValue=drawRounds.value;updateDraw();});drawStart=el('button','draw-start','自动抽卡');drawProbe=el('button','draw-probe','自动探针');drawStop=el('button','draw-stop','停止');drawStart.type=drawProbe.type=drawStop.type='button';drawStart.addEventListener('click',()=>{if(!drawStart.disabled&&!archivePending&&!deletePending)void ArenaAutoDraw.start(Number(drawRounds.value),{mode:'draw'});});drawProbe.addEventListener('click',()=>{if(!drawProbe.disabled&&!archivePending&&!deletePending)void ArenaAutoDraw.start(Number(drawRounds.value),{mode:'probe',targets:drawTargets.value,findAll:!!drawFindAll?.checked});});drawStop.addEventListener('click',()=>ArenaAutoDraw.stop());drawTargets=el('input','draw-targets');drawTargets.type='text';drawTargets.value=prefs?.probeTargets||'opus5, fable5, gpt6';drawTargets.setAttribute('aria-label','探针目标型号');drawTargets.placeholder='opus5, fable5, gpt6';drawTargets.title='简写会匹配官方名：opus5→claude-opus-5，fable5→claude-fable-5 / 5.1，gpt6→gpt-6-astra。也可填写 /正则/ 或完整型号';drawTargets.addEventListener('change',()=>{if(!prefs)return;prefs.probeTargets=drawTargets.value;void savePrefs();});const findLabel=el('label','draw-findall');drawFindAll=el('input');drawFindAll.type='checkbox';drawFindAll.checked=!!prefs?.findAll;drawFindAll.addEventListener('change',()=>{if(!prefs)return;prefs.findAll=!!drawFindAll.checked;void savePrefs();});findLabel.append(drawFindAll,el('span','','找齐全部'));findLabel.title='默认勾选：直到列表中的型号都出现过或达到轮数上限才停止；取消勾选则命中任一目标即停';cleanupBtn=el('button','draw-cleanup','一键清理探测残留');cleanupBtn.type='button';cleanupBtn.title='归档由本扩展探测/抽卡生成、且仍在侧栏的对话，并删除其本地记录；不含当前打开的对话。归档不是永久删除，可在 Arena 归档中找回';cleanupBtn.addEventListener('click',()=>{if(cleanupPending){cleanupStopRequested=true;updateCleanup();}else if(!cleanupBtn.disabled)void cleanupProbeResidue();});drawStatus=el('p','draw-status');drawStatus.setAttribute('role','status');drawControls.append(drawRounds,drawStart,drawProbe,drawStop,drawTargets,findLabel,cleanupBtn);content.append(drawControls,drawStatus);updateDraw();}
    panel=ArenaTracePanel.create(content,{onArchive:archiveCurrentChat,onDelete:deleteCurrentRecord,onAutoRenameChange:setAutoRename,onRename:(model,view)=>{
      if(archivePending||drawing())throw Error('自动流程正在进行，请稍候');
      const isCurrent=()=>view.sessionId===currentSession()&&latestState?.sessionId===view.sessionId&&latestState?.runId===view.runId&&ArenaTraceView.build(latestState).models.some(m=>m.model===model);
      if(!isCurrent())throw Error('当前对话或模型已变化，请重试');
      return ArenaConversationRename.rename({sessionId:view.sessionId,model,isCurrent});
    }});
    shell.append(header,compact,content);root.append(style,shell);document.documentElement.append(host);applyMode();updatePulseText();void loadPulse();
    // Tick every second so the reset countdown runs live; the quota itself refetches at most once a minute.
    if(typeof setInterval==='function')setInterval(()=>{if(!host?.isConnected)return;updatePulseText();maybeLoadPulse();},1000);
    if(typeof ResizeObserver==='function'){sizeObserver=new ResizeObserver(()=>{if(!drag&&host?.isConnected)keepVisible();});sizeObserver.observe(shell);}
  }
  function render(state){
    if(!state||state.restoring)return;if(state.sessionId&&state.sessionId!==currentSession())return;
    latestState=state;
    prefs??=ArenaHudLayout.defaults();const created=!host?.isConnected;if(created)createHost();
    displayedSession=state.sessionId||null;for(const indicator of [dot,compactDot]){indicator.style.background=state.enabled?'#17a565':'#b08a2e';indicator.title=state.enabled?'监听中':state.historical?'本地历史 · 未开启监听':'未开启监听';indicator.setAttribute('role','img');indicator.setAttribute('aria-label',indicator.title);}
    const view=ArenaTraceView.build(state);const fullView={...view,sessionId:state.sessionId,autoRename,autoRenamePending:autoPending||archivePending||drawing(),deletePending:deletePending||archivePending||drawing(),archivePending:archivePending||drawing()};panel.render(fullView);void maybeAutoRename(fullView);
    compactName.textContent=view.models.length?[...new Set(view.models.map(m=>m.model))].join(' / '):'模型待确认';compactName.title=compactName.textContent;
    compactToken.textContent=view.tokens+(view.tokenMissing?' · 部分':'');compactToken.title=view.tokenMissing?'已捕获调用覆盖 '+view.tokenCoverage:'仅已捕获 Token，缩写标为约数';
    compactCost.textContent=view.cost+(view.costMissing?' · 部分':'');compactCost.title='trace 展示费用，不代表实际账单';compactCount.textContent=view.count;
    compactStatus.textContent=(view.historical&&view.runId?'历史 · ':'')+(view.runId?view.completion.replace(/^调用/,''):state.enabled?'监听中 · 等待数据':'未开启监听');
    updatePulseText();maybeLoadPulse();
    if(globalThis.ArenaAutoDraw)updateDraw();updateListenControl();showSaveStatus();if(created)placeSaved();else if(!drag)keepVisible();loadPrefs();void loadAutoRename();
  }
  window.addEventListener('resize',()=>{if(host?.isConnected&&!drag)placeSaved();});
  chrome.runtime.onMessage.addListener(msg=>{
    if(msg.type==='ATI_STATE')render(msg.state);
    if(msg.type==='ATI_PULSE'&&msg&&'pulse' in msg){pulse=msg.pulse||null;pulseError=pulse?'':'';pulseFetchedAt=Date.now();updatePulseText();}
  });
  function refresh() {
    if(pageKey!==location.pathname){pageKey=location.pathname;listenError='';if(prefs)prefs.collapsed=false;host?.remove();host=null;latestState=null;}
    if (displayedSession !== currentSession()) { host?.remove(); host=null; }
    if(!host)render({enabled:false,sessionId:currentSession(),models:[],initializing:true,status:'正在读取监听状态…'});
    const version = ++requestVersion;
    clearTimeout(retryTimer);
    const delays = [250, 750, 1500, 3000];
    function request(attempt) {
      if (version !== requestVersion) return;
      if(!contextAlive())return markContextLost();
      const retry = () => {
        if(version!==requestVersion)return;
        if(!contextAlive())return markContextLost();
        if(attempt<delays.length)retryTimer=setTimeout(()=>request(attempt+1),delays[attempt]);
        else render({...latestState,sessionId:currentSession(),initializing:false,connectionError:true,status:'扩展连接暂时不可用，点击“重试连接”或重新加载扩展后刷新页面。'});
      };
      // Extension startup and overlapping navigation may briefly have no receiver.
      // Retry only a local state read; never send an Agent message or start capture.
      // A reloaded extension throws synchronously here, so guard the call itself too.
      let pending;
      try{pending=chrome.runtime.sendMessage({type:'ATI_STATUS',pageUrl:location.href});}
      catch(e){if(isContextLost(e))return markContextLost();return retry();}
      pending.then(state => {
        if (version !== requestVersion) return;
        if (!state || state.restoring || (state.sessionId && state.sessionId !== currentSession())) retry(); else render(state);
      }).catch(e=>{if(isContextLost(e))return markContextLost();retry();});
    }
    request(0);
  }
  window.addEventListener('pageshow', refresh);
  window.navigation?.addEventListener('navigatesuccess', refresh);
  window.addEventListener('popstate', () => { host?.remove(); host=null; refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  // Arena can replace root-level DOM during hydration. Recreate only this view,
  // never a previous conversation's overlay, and never fetch or attach here.
  new MutationObserver(() => {
    if (host && !host.isConnected && latestState && latestState.sessionId === currentSession()) render(latestState);
  }).observe(document, {childList: true, subtree: true});
  refresh();
})();
