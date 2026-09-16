/* Bounded, opt-in UI automation. Requires active listening; no send retries. */
(() => {
  let running=false,cancelled=false,progress='请先开启监听，再设置轮数并开始抽卡',phase='idle',sent=false,sessionId=null;
  let total=5,round=0,completed=0,failed=0;
  let notify=()=>{},readState=()=>null;
  const visible=e=>!!e?.isConnected&&e.getClientRects().length>0;
  const session=()=>location.pathname.match(/^\/agent\/([a-zA-Z0-9-]{1,128})\/?$/)?.[1]||null;
  const status=()=>({running,phase,progress,sent,sessionId,total,round,completed,failed});
  const publish=(p,text)=>{phase=p;progress=text;notify(status());};
  function guard(){if(cancelled)throw Error('已停止自动抽卡；已发送的消息不会撤回');if(location.origin!=='https://arena.ai')throw Error('已离开 Arena，自动抽卡已停止');}
  async function wait(check,message,ms=15000){const end=Date.now()+ms;while(Date.now()<end){guard();const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,250));}throw Error(message);}
  const editors=()=>[...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
  const editorText=e=>(e?.innerText??e?.textContent??'').trim();
  function noDraft(allowPrompt=false){if(editors().some(e=>editorText(e)&&!(allowPrompt&&editorText(e)==='1+1=')))throw Error('输入框有未发送内容，已停止；不会覆盖草稿');}
  async function newChat(allowPrompt=false){
    guard();noDraft(allowPrompt&&!session());
    const links=[...document.querySelectorAll('a[href]')].filter(a=>{try{return new URL(a.href).origin==='https://arena.ai'&&new URL(a.href).pathname==='/agent'&&['New Chat','新建聊天','新对话'].includes(a.textContent.trim());}catch{return false;}});
    if(!links.length)throw Error('未找到 New Chat 入口，已停止');
    links[0].click();await wait(()=>location.pathname.replace(/\/$/,'')==='/agent','新建聊天超时');
    await wait(()=>editors().length===1,'等待新聊天输入框超时');noDraft(allowPrompt);
  }
  async function mode(){
    const combo=await wait(()=>[...document.querySelectorAll('button[role="combobox"]')].find(visible),'未找到模式选择器');
    if(!combo.textContent.includes('Agent Mode')){
      combo.click();const option=await wait(()=>[...document.querySelectorAll('[role="option"]')].find(e=>visible(e)&&/^Agent Mode(?:Built for complex tasks)?$/.test(e.textContent.trim())&&!e.hasAttribute('data-disabled')),'未找到 Agent Mode 选项');option.click();
    }
    await wait(()=>[...document.querySelectorAll('button[role="combobox"]')].some(e=>visible(e)&&e.textContent.trim()==='Agent Mode'),'未能确认 Agent Mode');
  }
  async function nextBlank(){
    await newChat(true);await mode();guard();
    const editor=editors()[0];
    // Arena may restore the just-submitted fixed prompt as its new-chat draft.
    // Clear only this exact owned prompt, never another user draft.
    if(editorText(editor)==='1+1='){
      editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('delete',false))throw Error('已进入新聊天，但残留提示未能清理；未再次发送');
      await wait(()=>!editorText(editors()[0]),'新聊天草稿未能清空；未再次发送');
    }
    noDraft();
  }
  async function listen(enabled){const r=await chrome.runtime.sendMessage({type:'ATI_SET_LISTENING',enabled,pageUrl:location.href});if(r?.error||!!r?.enabled!==enabled)throw Error(r?.error||'监听状态切换失败');return r;}
  async function requireListening(){
    const state=await chrome.runtime.sendMessage({type:'ATI_STATUS',pageUrl:location.href});
    if(state?.enabled!==true||state.restoring||state.error)throw Error('请先开启监听；未发送消息');
    return state;
  }
  async function start(rounds=5){
    if(running)return status();
    const count=Number(rounds);
    if(!Number.isInteger(count)||count<1||count>100){publish('blocked','轮数必须是 1–100 的整数');return status();}
    if(readState()?.enabled!==true){publish('blocked','请先开启监听，再开始自动抽卡');return status();}
    running=true;cancelled=false;sent=false;sessionId=null;total=count;round=0;completed=0;failed=0;
    let ownListening=false,consecutiveFailures=0,halted=false;
    publish('checking','正在确认当前页监听状态…');
    try{
      await requireListening();guard();
      for(round=1;round<=total;round++){
        sent=false;sessionId=null;
        publish('new-chat',`${round}/${total} · 正在新建聊天`);
        try{
      if(ArenaConversationRename.isBusy())throw Error('聊天操作正在进行，请稍后重试');
      noDraft(!session());if(document.querySelector('button[aria-label="Stop generating"]'))throw Error('当前回复仍在生成，已停止试运行');
      await newChat(true);publish('mode',`${round}/${total} · 正在确认 Agent Mode`);await mode();
      guard();if(location.pathname.replace(/\/$/,'')!=='/agent')throw Error('页面已变化，未发送');
      publish('listen',`${round}/${total} · 开启监听`);await listen(true);ownListening=true;
      guard();if(session())throw Error('新聊天状态已变化，未发送');noDraft(true);
      const editor=editors()[0];if(!editor)throw Error('输入框不可用');
      if(editorText(editor)!=='1+1='){
      editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,'1+1='))throw Error('输入消息失败；未发送');
      }
      const button=await wait(()=>[...document.querySelectorAll('button[aria-label="Send message"]')].find(b=>visible(b)&&!b.disabled),'发送按钮不可用；未发送');
      guard();if(editorText(editor)!=='1+1='||session())throw Error('输入或页面已变化；未发送');
      if(![...document.querySelectorAll('button[role="combobox"]')].some(b=>b.textContent.trim()==='Agent Mode'))throw Error('模式已变化；未发送');
      await requireListening();guard();if(session())throw Error('页面已变化，未发送');
      sent=true;publish('detect',`${round}/${total} · 已发送 1+1=，等待完成检测（最多 180 秒）`);button.click();
      sessionId=await wait(()=>session(),'发送后未确认新会话；不重发',30000);
      const detected=await wait(()=>{
        if(session()!==sessionId)throw Error('已切换到其他聊天，停止抽卡');
        if(readState()?.enabled===false&&!readState()?.initializing)throw Error('监听已停止，自动抽卡终止');
        const state=readState();if(state?.sessionId!==sessionId||state.historical||!state.saved)return null;
        const view=ArenaTraceView.build(state);
        return view.models.length&&view.completion==='调用已完成'?{state,view}:null;
      },'检测超时，跳过本轮；保留聊天，不重发',180000);
      publish('rename',`${round}/${total} · 检测完成，正在重命名`);guard();
      const model=detected.view.models[0].model;
      await ArenaConversationRename.rename({sessionId,model,isCurrent:()=>!cancelled&&session()===sessionId&&readState()?.runId===detected.state.runId});
      guard();
      publish('next',`${round}/${total} · 已重命名，正在进入新的空白聊天`);await nextBlank();
      completed++;consecutiveFailures=0;
        }catch(e){
          if(cancelled)throw e;
          failed++;consecutiveFailures++;
          const message=e?.message||'本轮失败';
          // Only a completed send on the same chat may be skipped automatically.
          // Never continue after loss of listening, navigation, or an unsafe draft.
          const canSkip=sent&&sessionId&&session()===sessionId&&readState()?.enabled===true
            &&(/检测超时/.test(message)||phase==='rename');
          if(!canSkip||consecutiveFailures>=3){halted=true;publish('skipped',message+(consecutiveFailures>=3?'；连续失败 3 次，已停止':'；已停止抽卡'));break;}
          publish('skipped',`${round}/${total} · ${message}；保留聊天，跳过本轮`);
        }
        guard();
      }
      round=Math.min(round,total);
      if(!halted)publish('done',`抽卡结束：成功 ${completed} 轮，跳过 ${failed} 轮；不再自动发送`);
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
  globalThis.ArenaAutoDraw={start,stop,status,configure(options){readState=options.readState;notify=options.onProgress||(()=>{});notify(status());}};
})();
