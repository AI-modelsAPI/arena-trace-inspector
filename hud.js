(() => {
  let host,panel,status,dot,compactDot,shell,content,compact,compactName,compactToken,compactCost,compactCount,compactStatus,expandButton,listenButton,listenLabel;
  let requestVersion=0,displayedSession=null,latestState=null,retryTimer;
  let prefs,loadedPrefs=false,interactionVersion=0,drag=null,sizeObserver=null,layoutError='',listenError='',listenPending=false,pageKey=location.pathname;
  let autoRename=false,autoLoaded=false,autoPending=false,autoChecking=false,deletePending=false,archivePending=false;
  let drawStart,drawStop,drawStatus,drawRounds;
  let drawRoundValue=5;
  const drawing=()=>!!globalThis.ArenaAutoDraw?.status().running;
  function updateDraw(){if(!drawStart)return;const s=ArenaAutoDraw.status();const count=Number(drawRounds?.value);drawStart.disabled=s.running||archivePending||deletePending||listenPending||!latestState?.enabled||latestState?.initializing||latestState?.connectionError||!Number.isInteger(count)||count<1||count>100;if(drawRounds)drawRounds.disabled=s.running;drawStop.disabled=!s.running;drawStatus.textContent=!s.running&&!latestState?.enabled?'请先开启监听，再开始自动抽卡。 '+(s.phase==='idle'?'':s.progress):s.progress;updateListenControl();}
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
  const currentSession=()=>location.pathname.match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/)?.[1]||null;
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
  function moveTo(point){if(!host)return;const p=ArenaHudLayout.clamp(point,host.getBoundingClientRect(),viewport());host.style.left=p.x+'px';host.style.top=p.y+'px';}
  function placeSaved(){if(host)moveTo(ArenaHudLayout.position(prefs.position,host.getBoundingClientRect(),viewport()));}
  function keepVisible(){if(host){const r=host.getBoundingClientRect();moveTo({x:r.left,y:r.top});}}
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
  function loadPrefs(){
    if(loadedPrefs)return;loadedPrefs=true;const version=interactionVersion;
    chrome.runtime.sendMessage({type:'ATI_HUD_GET'}).then(result=>{
      if(result?.error||!result?.prefs)return;
      if(version!==interactionVersion)return; // A late read must not undo a user's drag.
      prefs=ArenaHudLayout.sanitize({...result.prefs,collapsed:false}); // New page visits always open expanded; keep the saved position.
      if(host){applyMode();placeSaved();}
    }).catch(()=>{});
  }
  function applyMode(){
    if(!shell)return;shell.classList.toggle('collapsed',prefs.collapsed);content.hidden=prefs.collapsed;compact.hidden=!prefs.collapsed;
    host.setAttribute('data-collapsed',String(prefs.collapsed));
  }
  function setCollapsed(value){
    interactionVersion++;const r=host.getBoundingClientRect();prefs.collapsed=value;applyMode();moveTo({x:r.left,y:r.top});rememberPosition();void savePrefs();
    if(value)expandButton.focus({preventScroll:true});else shell.querySelector('.collapse-button').focus({preventScroll:true});
  }
  function updateListenControl(){
    if(!listenButton)return;
    const enabled=!!latestState?.enabled,initializing=!!latestState?.initializing;
    listenButton.disabled=drawing()||archivePending||listenPending||initializing;
    listenButton.textContent=listenPending?'处理中…':initializing?'读取状态…':latestState?.connectionError?'重试连接':enabled?'停止监听':'开启监听';
    listenButton.setAttribute('aria-pressed',String(enabled));
    listenLabel.textContent=initializing?'正在连接扩展':enabled?'当前页监听中':'当前页未监听';
  }
  async function changeListening(){
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
      if(event.target!==handle)return;const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if(event.key==='Home'){event.preventDefault();interactionVersion++;prefs.position={x:1,y:1};placeSaved();void savePrefs();return;}
      if(!steps[event.key])return;event.preventDefault();interactionVersion++;const r=host.getBoundingClientRect(),d=steps[event.key],step=event.shiftKey?40:10;
      moveTo({x:r.left+d[0]*step,y:r.top+d[1]*step});rememberPosition();void savePrefs();
    });
  }
  function createHost(){
    sizeObserver?.disconnect();drag=null;
    host=el('div');host.id='arena-trace-inspector-hud';
    host.style.cssText='position:fixed;left:12px;top:12px;z-index:2147483647';
    const root=host.attachShadow({mode:'closed'}),style=el('style');
    style.textContent=`
:host{all:initial}.shell{box-sizing:border-box;width:370px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;border:1px solid #3b554a;border-radius:15px;background:#111a20;color:#e8f1f0;font:12px/1.55 system-ui,sans-serif;box-shadow:0 12px 48px #0007;overflow:hidden}.shell *{box-sizing:border-box}[hidden]{display:none!important}.header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2b3b42;flex-shrink:0}.header strong{font-size:12px;flex:1}.drag-handle{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.drag-handle:active{cursor:grabbing}.dot{width:6px;height:6px;border-radius:50%;background:#92e4b9;flex-shrink:0}button{font:12px system-ui,sans-serif;border:1px solid #3b5147;border-radius:6px;background:transparent;color:#bce7d0;cursor:pointer;padding:3px 8px}button:focus-visible,.drag-handle:focus-visible{outline:2px solid #9ae9ca;outline-offset:-3px}.content{min-height:0;max-height:70vh;overflow:auto;padding:13px}.draw-controls{display:flex;gap:8px;align-items:center}.draw-rounds{width:56px;min-width:48px;border:1px solid #3b5147;border-radius:6px;background:#17242b;color:#d6eee2;padding:6px;font:12px system-ui}.draw-rounds:disabled{opacity:.5}.draw-controls button{padding:6px 9px}.draw-controls button:disabled{opacity:.4;cursor:default}.draw-status{font-size:10px;line-height:1.6;color:#9bb6ae;margin:6px 0 12px;overflow-wrap:anywhere}.listen-controls{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}.listen-button{padding:7px 13px;border-color:#5f9a85;background:#235b4b;color:#e3fff1;font-weight:650}.listen-button:disabled{opacity:.6;cursor:wait}.listen-label{font-size:11px;color:#aac1b8}.status{color:#99afb5;font-size:11px;margin:0 0 12px;overflow-wrap:anywhere}.content::-webkit-scrollbar{width:5px}.content::-webkit-scrollbar-thumb{background:#3d5054;border-radius:4px}.shell.collapsed{width:310px;border-color:#3b555b;border-radius:12px;background:#18262b}.collapsed .header{display:none}.compact{padding:13px 16px 15px;overflow:auto}.compact-head{display:flex;align-items:center;gap:10px;min-height:24px;margin-bottom:6px}.compact-title{flex:1;min-width:0;font:500 12px/1.4 system-ui,sans-serif;letter-spacing:.65px;color:#8fd3c9}.compact-name{min-width:0;margin-bottom:11px;font:700 20px/1.35 system-ui,sans-serif;color:#b0f0de;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.expand-button{flex:0 0 auto;width:24px;height:24px;padding:0;font-size:17px;color:#b7d5c7;background:#ffffff04}.compact-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px;margin:0}.compact-field{min-width:0}.compact-field dt{font:600 11px/1.5 system-ui,sans-serif;color:#a7bdbd;margin:0}.compact-field dd{font:700 13px/1.5 system-ui,sans-serif;color:#d8e8e8;overflow-wrap:anywhere;margin:2px 0 0}.compact-field dd.compact-state{font:650 12px/1.625 system-ui,sans-serif;color:#cfdfdf}
`;
    shell=el('section','shell');shell.setAttribute('aria-label','Arena 模型运行信息');
    const header=el('header','header drag-handle');dot=el('span','dot');
    const title=el('strong','','Arena · Trace Inspector'),toggle=el('button','collapse-button','收起');toggle.type='button';toggle.setAttribute('aria-expanded','true');toggle.addEventListener('click',()=>setCollapsed(true));
    header.append(dot,title,toggle);addDrag(header);header.removeAttribute('title');header.setAttribute('aria-label','浮层标题栏');
    compact=el('section','compact');compact.setAttribute('aria-label','精简模型信息');
    const compactHead=el('div','compact-head drag-handle');compactDot=el('span','dot compact-dot');const compactTitle=el('div','compact-title','ARENA · TRACE INSPECTOR');compactName=el('div','compact-name drag-handle');addDrag(compactName);expandButton=el('button','expand-button','↗');expandButton.type='button';expandButton.title='展开详细面板';expandButton.setAttribute('aria-label','展开详细面板');expandButton.setAttribute('aria-expanded','false');expandButton.addEventListener('click',()=>setCollapsed(false));compactHead.append(compactDot,compactTitle,expandButton);addDrag(compactHead);
    const grid=el('dl','compact-grid');
    const field=(label,name)=>{const wrap=el('div','compact-field');const v=el('dd',name);wrap.append(el('dt','',label),v);grid.append(wrap);return v;};
    compactToken=field('Token','compact-token');compactCost=field('trace 费用','compact-cost');compactCount=field('次数','compact-count');compactStatus=field('状态','compact-state');
    compact.append(compactHead,compactName,grid);
    content=el('div','content');status=el('p','status');status.setAttribute('role','status');const controls=el('div','listen-controls');listenButton=el('button','listen-button','读取状态…');listenButton.type='button';listenButton.disabled=true;listenButton.addEventListener('click',()=>void changeListening());listenLabel=el('span','listen-label');controls.append(listenButton,listenLabel);content.append(controls,status);
    if(globalThis.ArenaAutoDraw){const drawControls=el('div','draw-controls');drawRounds=el('input','draw-rounds');drawRounds.type='number';drawRounds.min='1';drawRounds.max='100';drawRounds.step='1';drawRounds.value=String(drawRoundValue);drawRounds.setAttribute('aria-label','自动抽卡轮数');drawRounds.title='自动抽卡轮数（1–100）';drawRounds.addEventListener('input',()=>{drawRoundValue=drawRounds.value;updateDraw();});drawStart=el('button','draw-start','自动抽卡');drawStop=el('button','draw-stop','停止抽卡');drawStart.type=drawStop.type='button';drawStart.addEventListener('click',()=>{if(!drawStart.disabled&&latestState?.enabled&&!archivePending&&!deletePending)void ArenaAutoDraw.start(Number(drawRounds.value));});drawStop.addEventListener('click',()=>ArenaAutoDraw.stop());drawStatus=el('p','draw-status');drawStatus.setAttribute('role','status');drawControls.append(drawRounds,drawStart,drawStop);content.append(drawControls,drawStatus);updateDraw();}
    panel=ArenaTracePanel.create(content,{onArchive:archiveCurrentChat,onDelete:deleteCurrentRecord,onAutoRenameChange:setAutoRename,onRename:(model,view)=>{
      if(archivePending||drawing())throw Error('自动流程正在进行，请稍候');
      const isCurrent=()=>view.sessionId===currentSession()&&latestState?.sessionId===view.sessionId&&latestState?.runId===view.runId&&ArenaTraceView.build(latestState).models.some(m=>m.model===model);
      if(!isCurrent())throw Error('当前对话或模型已变化，请重试');
      return ArenaConversationRename.rename({sessionId:view.sessionId,model,isCurrent});
    }});
    shell.append(header,compact,content);root.append(style,shell);document.documentElement.append(host);applyMode();
    if(typeof ResizeObserver==='function'){sizeObserver=new ResizeObserver(()=>{if(!drag&&host?.isConnected)keepVisible();});sizeObserver.observe(shell);}
  }
  function render(state){
    if(!state||state.restoring)return;if(state.sessionId&&state.sessionId!==currentSession())return;
    latestState=state;
    prefs??=ArenaHudLayout.defaults();const created=!host?.isConnected;if(created)createHost();
    displayedSession=state.sessionId||null;for(const indicator of [dot,compactDot]){indicator.style.background=state.enabled?'#92e4b9':'#d5bd83';indicator.title=state.enabled?'监听中':state.historical?'本地历史 · 未开启监听':'未开启监听';indicator.setAttribute('role','img');indicator.setAttribute('aria-label',indicator.title);}
    const view=ArenaTraceView.build(state);const fullView={...view,sessionId:state.sessionId,autoRename,autoRenamePending:autoPending||archivePending||drawing(),deletePending:deletePending||archivePending||drawing(),archivePending:archivePending||drawing()};panel.render(fullView);void maybeAutoRename(fullView);
    compactName.textContent=view.models.length?[...new Set(view.models.map(m=>m.model))].join(' / '):'模型待确认';compactName.title=compactName.textContent;
    compactToken.textContent=view.tokens+(view.tokenMissing?' · 部分':'');compactToken.title=view.tokenMissing?'已捕获调用覆盖 '+view.tokenCoverage:'仅已捕获 Token，缩写标为约数';
    compactCost.textContent=view.cost+(view.costMissing?' · 部分':'');compactCost.title='trace 展示费用，不代表实际账单';compactCount.textContent=view.count;
    compactStatus.textContent=(view.historical&&view.runId?'历史 · ':'')+(view.runId?view.completion.replace(/^调用/,''):state.enabled?'监听中 · 等待数据':'未开启监听');
    if(globalThis.ArenaAutoDraw)updateDraw();updateListenControl();showSaveStatus();if(created)placeSaved();else if(!drag)keepVisible();loadPrefs();void loadAutoRename();
  }
  window.addEventListener('resize',()=>{if(host?.isConnected&&!drag)placeSaved();});
  chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='ATI_STATE')render(msg.state);});
  function refresh() {
    if(pageKey!==location.pathname){pageKey=location.pathname;listenError='';if(prefs)prefs.collapsed=false;host?.remove();host=null;latestState=null;}
    if (displayedSession !== currentSession()) { host?.remove(); host=null; }
    if(!host)render({enabled:false,sessionId:currentSession(),models:[],initializing:true,status:'正在读取监听状态…'});
    const version = ++requestVersion;
    clearTimeout(retryTimer);
    const delays = [250, 750, 1500, 3000];
    function request(attempt) {
      if (version !== requestVersion) return;
      const retry = () => {
        if(version!==requestVersion)return;
        if(attempt<delays.length)retryTimer=setTimeout(()=>request(attempt+1),delays[attempt]);
        else render({...latestState,sessionId:currentSession(),initializing:false,connectionError:true,status:'扩展连接暂时不可用，点击“重试连接”或重新加载扩展后刷新页面。'});
      };
      // Extension startup and overlapping navigation may briefly have no receiver.
      // Retry only a local state read; never send an Agent message or start capture.
      chrome.runtime.sendMessage({type:'ATI_STATUS',pageUrl:location.href}).then(state => {
        if (version !== requestVersion) return;
        if (!state || state.restoring || (state.sessionId && state.sessionId !== currentSession())) retry(); else render(state);
      }).catch(retry);
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
