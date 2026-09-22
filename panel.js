/* Shared renderer. Every external value is rendered with textContent, never HTML. */
(() => {
  const css = `
.ati{--bg:#f4f8f6;--surface:#ffffff;--line:#d3e0da;--text:#182623;--muted:#5c716c;--green:#0b7a4d;box-sizing:border-box;color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
.ati *{box-sizing:border-box}.ati button,.ati summary{font:inherit}.ati button{cursor:pointer}.ati button:disabled{opacity:.4;cursor:default}.ati button:focus-visible,.ati summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}.ati .result{border:1px solid #a9d3bf;border-radius:14px;padding:18px;background:linear-gradient(135deg,#eafaf1,#f4f9f6)}
.ati .eyebrow{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--green)}.ati .row{display:flex;align-items:center;justify-content:space-between;gap:10px}.ati .source{font-size:12px;padding:3px 8px;border:1px solid #a9d3bf;border-radius:20px;color:#1f6a48;white-space:nowrap;background:#fff}.ati .model{font:650 28px/1.28 ui-monospace,Consolas,monospace;letter-spacing:-.6px;margin:13px 0 4px;color:#0c5c3a;word-break:break-word}.ati .provider{font-size:14px;color:#4c625b;margin-bottom:10px}.ati .extra-model{border-top:1px solid #cfe4da;margin-top:12px;padding-top:4px}.ati .idrow{display:flex;align-items:center;gap:7px;color:#46605a;font:13px/1.6 ui-monospace,Consolas,monospace}.ati .idrow code{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.ati .iconbutton,.ati .secondary{border:1px solid #a9c8bb;color:#1e5c42;background:#fff;border-radius:7px;padding:5px 9px;font-size:13px;white-space:nowrap;width:auto}.ati .iconbutton:hover,.ati .secondary:hover{background:#eef7f2}.ati .toplabel{font-size:12px;color:var(--muted);letter-spacing:1.1px;margin:17px 0 9px}.ati .metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ati .metric{min-width:0;padding:13px 14px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.ati .metric-label{color:#567069;font-size:13px}.ati .metric-value{font:600 22px/1.3 ui-monospace,Consolas,monospace;margin-top:5px;color:#152420}.ati .metric-value.state{font:600 16px/1.9 system-ui,sans-serif}.ati .metric-note{color:var(--muted);font-size:12px;margin-top:4px}.ati .footnote{font-size:12px;color:var(--muted);margin:10px 1px 15px}.ati .fold{border:1px solid var(--line);border-radius:10px;background:#fbfcfb;margin-top:9px;overflow:hidden}.ati summary{list-style:none;cursor:pointer;padding:13px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600}.ati summary::-webkit-details-marker{display:none}.ati summary:after{content:'+';font-size:19px;color:#5c716c;font-weight:400}.ati details[open]>summary:after{content:'−'}.ati .count{margin-left:auto;font-size:12px;font-weight:400;color:var(--muted);padding-right:5px}.ati .fold-body{border-top:1px solid var(--line);padding:13px}.ati .call+.call{border-top:1px solid var(--line);padding-top:13px;margin-top:13px}.ati .call-title{font-size:14px;font-weight:650;color:#1d3a30}.ati .call-index{font:13px ui-monospace,Consolas,monospace;color:var(--green);margin-right:7px}.ati .call-state{font-size:12px;color:var(--muted)}.ati .call-sub{color:var(--muted);font-size:13px;margin:5px 0 8px}.ati .call-metrics{display:flex;gap:15px;font-size:14px;margin:8px 0;color:#30544a}.ati .evidence-intro{color:#567069;font-size:13px;margin:0 0 14px}.ati .evidence-item{border-left:2px solid #a9d3bf;padding:2px 0 2px 10px;margin:12px 0}.ati .evidence-label{font-size:13px;color:#4a655a}.ati .evidence-value{font:14px/1.6 ui-monospace,Consolas,monospace;color:#17352b;white-space:pre-wrap}.ati .path{font:12px/1.55 ui-monospace,Consolas,monospace;color:#6a7f79;overflow-wrap:anywhere;margin-top:3px}.ati .legacy{background:#fdf8e8;border:1px solid #e0d3a6;border-radius:8px;padding:10px 12px;font-size:13px;color:#6b5f33;line-height:1.7}.ati .evidence-actions{display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:12px;margin-top:12px}.ati .empty{padding:8px 0;font-size:14px;color:var(--muted)}.ati .notice{font-size:13px;min-height:20px;color:#0b7a4d;margin-top:8px}.ati .checked{color:#6a7f79;font-size:12px;margin:9px 0 0}.ati .model-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0}.ati .rename-status{font-size:13px;color:#0b7a4d;margin:7px 0;white-space:normal}.ati .rename-status:empty{display:none}.ati .rename-status[data-error="true"]{color:#9a5b12}.ati .caption{font-size:12px;color:var(--muted)}
`;
  const actionCss = `.ati .run-meta{margin-top:14px}.ati .rename-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-start;width:100%}.ati .auto-rename{display:flex;align-items:center;gap:4px;font-size:12px;color:#2e5a48;cursor:pointer;white-space:nowrap}.ati .auto-rename input{accent-color:#0b7a4d;width:15px;height:15px;margin:0}.ati .delete-button{color:#b3261e;border-color:#e2b3ae}.ati .model-actions{align-items:flex-start;margin-top:16px;padding-top:12px;border-top:1px solid #cfe4da}.ati .model-actions .iconbutton{padding:5px 6px;font-size:12px}.ati .model-actions .rename-row{max-width:100%}`;
  const el = (tag, className, text) => { const e=document.createElement(tag); if(className)e.className=className;if(text!==undefined)e.textContent=text;return e; };
  const date = x => x && Number.isFinite(Date.parse(x)) ? new Date(x).toLocaleString() : '未记录时间';
  async function copy(text, button, notice) {
    const before=button.textContent;
    try { await navigator.clipboard.writeText(text); button.textContent='已复制'; notice.textContent='已复制，不含令牌、Cookie 或正文。'; }
    catch { notice.textContent='复制失败，请使用“下载证据 JSON”，或手动选中文本复制。'; }
    setTimeout(()=>{if(button.isConnected)button.textContent=before;},1500);
  }
  function create(parent, options = {}) {
    const style=el('style');style.textContent=css+actionCss;const root=el('section','ati');parent.append(style,root);let lastRun='',currentView=null,renameBusy=false,renameMessage='',renameFailed=false,renameView=null;
    function updateRename(){
      for(const b of root.querySelectorAll('.rename-button')){b.disabled=renameBusy||!!currentView?.archivePending||!currentView?.models.length;b.textContent=renameBusy?'重命名中…':'重命名对话';}
      const message=root.querySelector('.rename-status');if(message){message.textContent=renameMessage;message.dataset.error=String(renameFailed);}
    }
    async function renameModel(model,view){
      if(renameBusy)return;renameBusy=true;renameMessage='';renameFailed=false;renameView=view;updateRename();
      try{const result=await options.onRename(model,view);if(currentView?.runId===view.runId&&currentView?.sessionId===view.sessionId)renameMessage=(result?.unchanged?'当前对话已命名为：':'已重命名为：')+(result?.title||model);}
      catch(error){if(currentView?.runId===view.runId&&currentView?.sessionId===view.sessionId){renameFailed=true;renameMessage=error?.message||'重命名失败，请重试';}}
      finally{renameBusy=false;updateRename();}
    }
    function render(view) {
      currentView=view;if(renameView&&(renameView.runId!==view.runId||renameView.sessionId!==view.sessionId)){renameMessage='';renameFailed=false;}

      const sameRun=lastRun===view.runId;const opens=sameRun?[...root.querySelectorAll('details[open]')].map(x=>x.dataset.section):[];lastRun=view.runId;
      root.replaceChildren();
      const notice=el('div','notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
      const result=el('article','result');const top=el('div','row');top.append(el('div','eyebrow','服务端模型标签'),el('span','source',view.source));result.append(top);
      if(!view.models.length){result.append(el('h2','model','模型待确认'),el('div','provider',view.runId?'等待本次 trace 返回模型标签':'开启监听后发送消息，或查看本地会话记录'));}
      for(const [i,m] of view.models.entries()){
        const group=el('div',i?'extra-model':'');const row=el('div','row');row.append(el('h2','model',m.model));
        group.append(row,el('div','provider',m.provider||'供应商未提供'));result.append(group);
      }
      if(options.onRename){
        const actions=el('div','model-actions'),row=el('div','rename-row');
        if(options.onAutoRenameChange){
          const label=el('label','auto-rename'),check=el('input');check.type='checkbox';check.checked=!!view.autoRename;check.disabled=!!view.autoRenamePending;
          check.addEventListener('change',()=>void options.onAutoRenameChange(check.checked));
          label.append(check,el('span','','自动重命名'));label.title='开启后每个会话首次完成新检测时自动命名一次；历史恢复不触发';row.append(label);
        }
        const rename=el('button','iconbutton rename-button','重命名对话');rename.type='button';rename.disabled=!view.models.length;
        rename.addEventListener('click',()=>{if(view.models.length)void renameModel(view.models[0].model,view);});row.append(rename);actions.append(row);
        if(options.onDelete){const remove=el('button','iconbutton delete-button',view.deletePending?'删除中…':'删除记录');remove.type='button';remove.disabled=!view.runId||!!view.deletePending;remove.addEventListener('click',()=>void options.onDelete(view));row.append(remove);}
        if(options.onArchive){const archive=el('button','iconbutton delete-button archive-button',view.archivePending?'归档中…':'归档聊天及删除记录');archive.type='button';archive.disabled=!view.sessionId||!!view.deletePending||renameBusy;archive.title='归档 Arena 聊天，并删除扩展本地记录；不等于永久删除聊天';archive.addEventListener('click',()=>void options.onArchive(view));row.append(archive);}
        result.append(actions);
      }
      if(view.runId){const row=el('div','idrow run-meta');row.append(el('span','','run'));const code=el('code','',view.runId);code.title=view.runId;row.append(code);result.append(row,el('div','checked','记录时间 · '+date(view.checkedAt)));}
      if(options.onRename&&view.models.length){const renameStatus=el('div','rename-status');renameStatus.setAttribute('role','status');renameStatus.setAttribute('aria-live','polite');result.append(renameStatus);}
      root.append(result,el('div','toplabel',view.historical&&view.runId?'所选历史运行 · 已捕获指标':'本次运行 · 已捕获指标'));
      const metrics=el('div','metrics');
      for(const [label,value,note,state]of [
        ['Token',view.tokens,view.tokenMissing?'部分缺失 · 覆盖 '+view.tokenCoverage+' 次调用':'缩写标为约数；不推算输入／输出'],
        ['trace 费用',view.cost,view.costMissing?'部分缺失 · 覆盖 '+view.costCoverage+' 次调用':'trace 展示值，非实际账单'],
        ['调用次数',view.count,view.calls.length?'按 runId + spanId 去重':'尚无调用明细'],
        ['完成状态',view.completion,'仅指已捕获的模型调用',true]
      ]){const card=el('div','metric');card.append(el('div','metric-label',label),el('div','metric-value'+(state?' state':''),value),el('div','metric-note',note));metrics.append(card);}
      root.append(metrics,el('p','footnote','不将历史记录视为重新验证；未监听的调用不计入累计。'));
      function fold(key,title,count){const d=el('details','fold');d.dataset.section=key;d.open=opens.includes(key);const sum=el('summary');sum.append(el('span','',title),el('span','count',count));const body=el('div','fold-body');d.append(sum,body);root.append(d);return body;}
      const callBody=fold('calls','调用明细',view.calls.length?view.calls.length+' 次':'暂无明细');
      if(!view.calls.length)callBody.append(el('div','empty','此运行尚未记录调用明细。旧版本未保存的数据不会自动补录。'));
      for(const [i,c]of view.calls.entries()){
        const item=el('article','call'),head=el('div','row'),title=el('div','call-title');title.append(el('span','call-index',String(i+1).padStart(2,'0')),el('span','',c.model||'模型未提供'));head.append(title,el('span','call-state',ArenaTraceView.completion([c])));
        item.append(head,el('div','call-sub',c.provider||'供应商未提供'));
        const stats=el('div','call-metrics');stats.append(el('span','','Token '+ArenaTraceView.tokens(c.tokens,c.tokensApproximate)),el('span','','trace '+ArenaTraceView.money(c.costUsd)));item.append(stats);
        const row=el('div','idrow');row.append(el('span','','span'));const id=el('code','',c.spanId);id.title=c.spanId;const b=el('button','iconbutton','复制');b.type='button';b.setAttribute('aria-label','复制调用 '+(i+1)+' 的 span ID');b.addEventListener('click',()=>copy(c.spanId,b,notice));row.append(id,b);item.append(row);callBody.append(item);
      }
      const evidenceBody=fold('evidence','证据来源',view.evidenceCount?view.evidenceCount+'/'+view.calls.length+' 次保留原始标签':'未保存原始标签');
      evidenceBody.append(el('p','evidence-intro','只读来源：Trigger.dev run events → ai.streamText.doStream。按当前选中的 runId 与 spanId 对齐，不混入其他运行。'));
      if(view.calls.length&&!view.evidenceCount)evidenceBody.append(el('div','legacy','这是旧版保存的解析结果，未保存原始标签。上方数值可查看，但不能冒充本次重新读取的原始证据。升级后新捕获的运行会保存标签及其来源。'));
      if(!view.calls.length)evidenceBody.append(el('div','empty','尚无可展示的证据。'));
      for(const [i,c]of view.calls.entries()){
        if(!c.evidence)continue;const group=el('article','call');group.append(el('div','call-title','调用 '+String(i+1).padStart(2,'0')+' · '+(c.model||'模型未提供')),el('div','path','spanId: '+c.spanId));
        for(const [name,label]of [['model','模型原始标签'],['provider','供应商原始标识'],['tokens','Token 原始标签'],['cost','费用原始标签']]){
          const v=c.evidence[name],entry=el('div','evidence-item');entry.append(el('div','evidence-label',label),el('div','evidence-value',v?.value||'未提供'));
          if(v)entry.append(el('div','path',v.path),el('div','caption','观测于 '+date(v.observedAt)));
          group.append(entry);
        }
        if(c.evidence.flags){const f=c.evidence.flags;group.append(el('div','path','状态原始字段：isPartial='+String(f.isPartial)+' · isError='+String(f.isError)+' · isCancelled='+String(f.isCancelled)));}
        evidenceBody.append(group);
      }
      if(view.evidenceCount&&view.evidenceCount<view.calls.length)evidenceBody.append(el('div','legacy','部分调用来自旧记录，未保存原始标签；不会补造证据。'));
      const actions=el('div','evidence-actions'),copyButton=el('button','secondary','复制证据 JSON'),download=el('button','secondary','下载证据 JSON');
      copyButton.type=download.type='button';copyButton.disabled=download.disabled=!view.calls.length;
      const payload=()=>JSON.stringify(ArenaTraceView.exportEvidence(view),null,2);
      copyButton.addEventListener('click',()=>copy(payload(),copyButton,notice));
      download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([payload()],{type:'application/json'})),a=el('a');a.href=url;a.download='arena-evidence-'+(view.runId||'unknown').replace(/[^\w-]/g,'')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notice.textContent='已生成脱敏证据文件；旧记录会明确标注来源。';});
      actions.append(copyButton,download);evidenceBody.append(actions,el('p','footnote','不包含令牌、Cookie、对话正文或原始 trace 全文。标签各自保留观测时间。'));
      root.append(notice);updateRename();
    }
    return {render,root,renameModel};
  }
  globalThis.ArenaTracePanel={create};
})();
