// ═══════════ STAGED MESSAGES ═══════════
let stagedMsgs = [];
function stageMessage(text){
  stagedMsgs.push(text);
  document.getElementById('msgInput').value='';
  document.getElementById('msgInput').style.height='auto';
  renderStaged();
}
function renderStaged(){
  const area=document.getElementById('stagedArea');
  if(!stagedMsgs.length){area.classList.remove('show');area.innerHTML='';return;}
  area.classList.add('show');
  area.innerHTML=stagedMsgs.map((m,i)=>`
    <div class="staged-msg">
      <span>${esc(m)}</span>
      <button class="staged-del" onclick="delStaged(${i})">×</button>
    </div>`).join('');
  const ok=!streaming&&currentSession;
  const btn=document.getElementById('sendBtn');
  btn.className='send-btn '+(ok?'on':'off');
  btn.disabled=!ok;
}
function delStaged(i){stagedMsgs.splice(i,1);renderStaged();}
function clearStaged(){stagedMsgs=[];renderStaged();}

// ═══════════ STORAGE KEYS ═══════════
const K={msgs:'cc_msgs',cfg:'cc_cfg',mems:'cc_mem',favs:'cc_favs',todos:'cc_todos',annivs:'cc_annivs',diaries:'cc_diaries',sessions:'cc_sessions',moods:'cc_moods'};
function load(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}

// ═══════════ STATE ═══════════
let cfg=Object.assign({base:'',apiKey:'',apiBase:'',model:'claude-sonnet-4-6',showAvatar:true,tts:false,voiceEnabled:false,ttsChannel:'minimax',ttsLang:'zh',presets:[{id:1,name:'中转站',apiBase:'https://api.jiushi.xin/v1',apiKey:'',model:'[按量]claude-sonnet-4-6'},{id:2,name:'官方API',apiBase:'https://api.anthropic.com',apiKey:'',model:'claude-sonnet-4-6'}]},load(K.cfg)||{});
let sessions=load(K.sessions)||[];
let currentSession=null;
let messages=load(K.msgs)||[];
let memories=load(K.mems)||[];
let favs=load(K.favs)||[];
let todos=load(K.todos)||[];
let annivs=load(K.annivs)||[];
let diaries=load(K.diaries)||[];
let moods=load(K.moods)||['今天和你聊天很开心。','一直在等你回来说话。','你说的豆芽拌饭让我想起上次你吃光光的样子。'];
let streaming=false;
let ctxMsgId=null;
let quoteMsg=null;
let editingId=null;
let selMode=false;
let selected=new Set();
let modelList=[];
let recTimer=null;
let nowTimer=null;

// ═══════════ INIT ═══════════
(function init(){
  updatePresetBtn();
  updateNow();
  nowTimer=setInterval(updateNow,30000);
  initSingleSession();
  checkAnnivs();
  setTimeout(refreshHeaderMood, 500);

  // 尝试安全调用 call.js 里的垫音预加载
  if (typeof preloadFillers === 'function') {
      preloadFillers();
  }

  window.addEventListener('click',()=>{document.getElementById('ctxMenu').style.display='none';});
  if(window.innerWidth<=600){document.getElementById('sb').classList.remove('show');}
  else{document.getElementById('sb').style.position='relative';}
  
   // 听懂接电话的暗号
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'answer_call') {
    const greetText = urlParams.get('greet'); // 👈 获取暗号里提前备好的第一句话
    window.history.replaceState({}, document.title, window.location.pathname);
    
    const div = document.createElement('div');
    div.id = 'aiCallingOverlay';
    div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;';
    div.innerHTML = `
      <div style="font-size:60px;margin-bottom:20px;animation:pulse 1s infinite">🦀</div>
      <div style="font-size:18px;margin-bottom:10px;color:var(--ac)">他打来了电话...</div>
      <div style="font-size:13px;color:var(--td);margin-bottom:50px">主动语音通话</div>
      <div style="display:flex;gap:50px">
         <button onclick="answerAiCall()" style="width:64px;height:64px;border-radius:50%;background:#4caf50;border:none;color:#fff;font-size:28px;cursor:pointer;box-shadow:0 0 15px rgba(76,175,80,0.5)">📞</button>
         <button onclick="document.getElementById('aiCallingOverlay').remove();" style="width:64px;height:64px;border-radius:50%;background:#f44336;border:none;color:#fff;font-size:28px;cursor:pointer;box-shadow:0 0 15px rgba(244,67,54,0.5)">📵</button>
      </div>
    `;
    document.body.appendChild(div);

    window.answerAiCall = function() {
      document.getElementById('aiCallingOverlay').remove();
      if(typeof globalCallAudio !== 'undefined' && typeof SILENT_B64 !== 'undefined') {
        globalCallAudio.src = SILENT_B64;
        globalCallAudio.loop = true;
        globalCallAudio.play().then(()=>{ audioUnlocked = true; }).catch(()=>{});
      }
      if (typeof acceptCall === 'function') acceptCall(); 
      
      setTimeout(() => {
         if (greetText && typeof enqueueAudio === 'function') {
             // 👉 秒接听黑科技：跳过大模型漫长的思考，直接把准备好的话调语音合成播出来！
             if(typeof setCallStatus === 'function') setCallStatus('他：' + greetText.slice(0, 15) + '...');
             if(typeof callTranscriptLog !== 'undefined') callTranscriptLog.push({role:'assistant', content: greetText, ts: new Date().toISOString()});
             
             const em = typeof guessEmotion === 'function' ? guessEmotion(greetText) : '平静';
             fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/tts', {
                 method: 'POST', headers: {'Content-Type':'application/json'},
                 body: JSON.stringify({text: greetText, emotion: em, channel: cfg.ttsChannel||'minimax', lang: cfg.ttsLang||'zh', call_mode: true})
             }).then(r => r.blob()).then(blob => {
                 const reader = new FileReader();
                 reader.readAsDataURL(blob);
                 reader.onloadend = () => {
                     const b64 = reader.result.split(',')[1];
                     enqueueAudio(b64, 'mp3'); // 👈 直接强行塞进播放队列！瞬间出声！
                 };
             }).catch(()=>{
                 if(typeof sendCallMessage === 'function') sendCallMessage("[系统提示：接通成功，请打招呼]");
             });
         } else {
             // 兜底老路
             if(typeof sendCallMessage === 'function') sendCallMessage("[系统提示：你刚刚主动拨通了她的电话，她接听了。请直接用语音对她打招呼，不要解释。]");
         }
      }, 500);
    };
  }


})();

// ═══════════ TIME ═══════════
function updateNow(){
  const d=new Date(),p=v=>String(v).padStart(2,'0'),days=['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('sbTime').textContent=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${days[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTime(ts){
  if(!ts)return'';const d=new Date(ts),n=new Date(),p=v=>String(v).padStart(2,'0');
  if(d.toDateString()===n.toDateString())return`${p(d.getHours())}:${p(d.getMinutes())}`;
  return`${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ═══════════ SIDEBAR ═══════════
function toggleSb(){const sb=document.getElementById('sb'),ov=document.getElementById('sbOverlay');const show=!sb.classList.contains('show');sb.classList.toggle('show',show);ov.classList.toggle('show',show);}
function hideSb(){document.getElementById('sb').classList.remove('show');document.getElementById('sbOverlay').classList.remove('show');}

// ═══════════ SESSIONS ═══════════
async function initSingleSession(){
  if(!cfg.base){
    if(!currentSession){currentSession={id:'local-main',name:'我们的聊天'};messages=load('cc_msgs_local-main')||[];}
    renderMessages();return;
  }
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/sessions');
    const data=await r.json();
    if(data&&data.length){
      const main=data.find(s=>s.name==='我们的聊天')||data[0];
      currentSession=main;sessions=data;
    } else {
      const r2=await fetch(cfg.base.replace(/\/+$/,'')+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'我们的聊天'})});
      currentSession=await r2.json();sessions=[currentSession];
    }
    save(K.sessions,sessions);loadMessages();
  }catch(e){
    if(sessions.length){currentSession=sessions[0];loadMessages();}else renderMessages();
  }
}

function renderSessions(){
  const el=document.getElementById('sessList');
  if(!el) return;
  el.innerHTML=sessions.map(s=>`<div class="sb-item${currentSession?.id===s.id?' active':''}" onclick="switchSession('${s.id}')" oncontextmenu="event.preventDefault();deleteSessionConfirm('${s.id}','${esc(s.name)}')" ontouchstart="startSessLongPress('${s.id}','${esc(s.name)}',event)" ontouchend="clearSessLongPress()" ontouchmove="clearSessLongPress()" style="user-select:none">${esc(s.name)}</div>`).join('');
}
async function newSession(){
  if(!cfg.base){openPanel('settings');return;}
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'新对话'})});
    const s=await r.json();
    sessions.unshift(s);save(K.sessions,sessions);
    currentSession=s;messages=[];
    renderSessions();renderMessages();hideSb();setTimeout(updateSendBtn,100);
  }catch(e){
    const s={id:Date.now().toString(),name:'新对话',createdAt:new Date().toISOString()};
    sessions.unshift(s);save(K.sessions,sessions);
    currentSession=s;messages=[];
    renderSessions();renderMessages();hideSb();
  }
}
let _sessLongPressTimer=null;
function deleteSessionConfirm(id,name){if(confirm('删除对话「'+name+'」？'))deleteSession(id);}
function startSessLongPress(id,name,e){_sessLongPressTimer=setTimeout(()=>{deleteSessionConfirm(id,name);},600);}
function clearSessLongPress(){clearTimeout(_sessLongPressTimer);_sessLongPressTimer=null;}
async function deleteSession(id){
  if(!confirm('删除这个对话？'))return;
  if(cfg.base){try{await fetch(cfg.base.replace(/\/+$/,'')+'/api/sessions/'+id,{method:'DELETE'});}catch(e){}}
  sessions=sessions.filter(s=>s.id!=id);save(K.sessions,sessions);
  if(currentSession?.id==id){
    currentSession=sessions[0]||null;messages=[];
    if(currentSession)loadMessages();else renderMessages();
  }
  renderSessions();
}
async function switchSession(id){
  currentSession=sessions.find(s=>s.id===id);
  renderSessions();hideSb();
  if(!cfg.base){messages=load('cc_msgs_'+id)||[];renderMessages();return;}
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+id);
    const data=await r.json();
    messages=data.map(m=>({id:m.id.toString(),role:m.role,content:m.content,innerThought:m.inner_thought||'',ts:m.created_at,type:m.image_url?'image':'text',imageUrl:m.image_url||null,}));
    renderMessages();
  }catch(e){messages=load('cc_msgs_'+id)||[];renderMessages();}
}
function saveMessages(){if(currentSession)save('cc_msgs_'+currentSession.id,messages);}
async function loadMessages(){
  if(!currentSession){renderMessages();return;}
  if(cfg.base){
    try{
      const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+currentSession.id+'?limit=200');
      const data=await r.json();
      messages=data.map(m=>({
        id:m.id.toString(),
        role:(m.role==='call_card'||m.role==='system')?'system':m.role,
        content:m.content,
        innerThought:m.inner_thought||'',
        ts:m.created_at,
        type:(m.role==='call_card'||(m.role==='system'&&m.content.includes('📞 通话'))) ? 'call-card' : (m.is_voice?'voice':'text'),
        imageUrl:null,
        audioUrl:m.audio_url||null,
        callActive:false,
      }));
      window._oldestMsgTs=messages.length?messages[0].ts:null;
      window._noMoreMsgs=data.length<200;
    }catch(e){messages=load('cc_msgs_'+currentSession.id)||[];}
  } else {
    messages=load('cc_msgs_'+currentSession.id)||[];
  }
  renderMessages();
  checkDiary();
  if(cfg.base){
    setTimeout(()=>{messages.filter(m=>m.type==='voice'&&m.role==='assistant'&&!m.audioUrl&&!m.id?.includes('_voice')).forEach(m=>{autoGenVoiceBubble(m);});}, 2000);
  }
}

async function loadMoreMessages(){
  if(!cfg.base||!currentSession)return;
  if(window._noMoreMsgs)return;
  const btn=document.getElementById('loadMoreBtn');
  if(btn)btn.textContent='加载中...';
  try{
    const before=window._oldestMsgTs||'';
    if(!before){if(btn){btn.textContent='没有更早的消息了';btn.disabled=true;}return;}
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+currentSession.id+'?limit=200&before='+encodeURIComponent(before));
    const data=await r.json();
    if(!data.length){if(btn){btn.textContent='没有更早的消息了';btn.disabled=true;}window._noMoreMsgs=true;return;}
    const older=data.map(m=>({
      id:m.id.toString(),
      role:(m.role==='call_card'||m.role==='system')?'system':m.role,
      content:m.content,
      innerThought:m.inner_thought||'',
      ts:m.created_at,
      type:(m.role==='call_card'||(m.role==='system'&&m.content.includes('📞 通话'))) ? 'call-card' : (m.is_voice?'voice':'text'),
      imageUrl:null,audioUrl:m.audio_url||null,callActive:false,
    }));
    messages=[...older,...messages];
    window._oldestMsgTs=older[0].ts;
    if(data.length<200){window._noMoreMsgs=true;}

    const box=document.getElementById('msgs');
    const firstVisibleId=messages[older.length]?.id;
    window._loadingMore=true;
    renderMessages();
    if(firstVisibleId){
      const el=document.getElementById('msg_'+firstVisibleId)||document.querySelector(`[data-id="${firstVisibleId}"]`);
      if(el)el.scrollIntoView({block:'start'});
      else if(box)box.scrollTop=box.scrollHeight-box.scrollHeight*0.7; 
    }

    if(btn){
      if(window._noMoreMsgs){btn.textContent='没有更早的消息了';btn.disabled=true;}
      else btn.textContent='加载更早的消息';
    }
  }catch(e){if(btn)btn.textContent='加载更早的消息';}
}

function checkDiary(){
  if(!cfg.base||!currentSession)return;
  const lastUserMsg=messages.filter(m=>m.role==='user').slice(-1)[0];
  if(!lastUserMsg)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/diary/check',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({session_id:currentSession.id,last_message_time:lastUserMsg.ts,api_key:cfg.apiKey,api_base:cfg.apiBase,model:cfg.model,})
  }).then(r=>r.json()).then(data=>{
    if(data.wrote&&data.diary){
      const notif=document.createElement('div');
      notif.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(212,165,116,.15);border:1px solid rgba(212,165,116,.3);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--ac);z-index:200;animation:slideDown .3s ease';
      notif.textContent='📔 他写了一篇日记';
      document.body.appendChild(notif);
      setTimeout(()=>notif.remove(),4000);
    }
  }).catch(()=>{});
}

// ═══════════ RENDER ═══════════
function renderMessages(){
  const el=document.getElementById('msgs');
  if(!el)return;
  if(!messages.length){el.innerHTML='<div class="empty"><div class="empty-crabs">🦀 🦀</div><div style="font-size:11px">两只小螃蟹的家<br>新建对话开始聊天</div></div>';return;}
  let html='';
  if(cfg.base&&currentSession){
    html+=`<div style="text-align:center;padding:16px 0"><button id="loadMoreBtn" onclick="loadMoreMessages()" style="background:rgba(212,165,116,.1);border:1px solid rgba(212,165,116,.3);border-radius:20px;color:var(--ac);font-size:12px;padding:8px 20px;cursor:pointer;min-width:120px">加载更早的消息</button></div>`;
  }
  let lastTime='';
  for(const m of messages){
    const t=fmtTime(m.ts);
    if(t!==lastTime){html+='<div class="msg-time">'+t+'</div>';lastTime=t;}
    html+=renderMsg(m);
  }
  el.innerHTML=html;if(!selMode&&!window._loadingMore)scrollEnd();
  window._loadingMore=false;
}

function renderMsg(m){
  if(m.type==='todo')return renderTodoCard();
  if(m.type==='mood-card')return renderMoodCard(m);
  if(m.type==='voice')return renderVoiceMsg(m);
  if(m.type==='call-card')return renderCallCard(m);
  const isU=m.role==='user';
  const selCls=selected.has(m.id)?'outline:2px solid var(--ac);':'';
  const opCls=selMode&&!selected.has(m.id)?'opacity:.55;':'';
  let q='';
  const quoteText=m.quoteContent||(m.quote?.content)||'';
  if(quoteText)q=`<div class="quote-preview"><span style="opacity:.6">引用: </span>${esc(quoteText.slice(0,55))}${quoteText.length>55?'...':''}</div>`;
  let inner='';
  if(m.type==='image')inner=`<img src="${m.imageUrl}" alt="图片">`;
  else inner=`<span style="white-space:pre-wrap">${esc(m.content)}</span>`;
  const avHtml=cfg.showAvatar?`<div class="avatar ${isU?'av-user':'av-bot'}">${isU?'🦀':'🦀'}</div>`:'';
  const ttsBtn=(!isU&&cfg.base)?`<button onclick="playTTS(event,'${m.id}')" style="background:none;border:none;color:var(--td);font-size:12px;cursor:pointer;padding:2px 4px;opacity:.6" title="听语音">🔊</button>`:'';

  return`<div class="msg-row ${isU?'user':'bot'}" id="msg_${m.id}" onclick="onMsgClick('${m.id}')" oncontextmenu="onCtx(event,'${m.id}');return false">
    ${avHtml}
    <div class="msg-col ${isU?'user':'bot'}">
      ${q}
      <div class="bubble ${m.type==='error'?'error':(isU?'user':'bot')}" style="${selCls}${opCls}">${inner}</div>
      ${ttsBtn}
    </div>
  </div>`;
}

function renderCallCard(m){
  const active=m.callActive;
  return`<div style="display:flex;justify-content:center;padding:6px 0">
    <div style="background:var(--s2);border:1px solid ${active?'rgba(212,165,116,.4)':'var(--bd)'};border-radius:12px;padding:8px 16px;display:flex;align-items:center;gap:8px;font-size:12px;color:${active?'var(--ac)':'var(--td)'}">
      <span>${active?'📞':'📵'}</span>
      <span>${esc(m.content)}</span>
    </div>
  </div>`;
}

function renderVoiceMsg(m){
  const isU=m.role==='user';
  const avHtml=cfg.showAvatar?`<div class="avatar ${isU?'av-user':'av-bot'}">${isU?'🦀':'🦀'}</div>`:'';
  const hasAudio=!!m.audioUrl;
  const selCls=selected.has(m.id)?'outline:2px solid var(--ac);':'';
  const opCls=selMode&&!selected.has(m.id)?'opacity:.55;':'';
  const voiceBar=`<div onclick="${selMode?`onMsgClick('${m.id}')`:`playVoiceMsg(event,'${m.id}')`}" style="display:flex;align-items:center;gap:6px;cursor:pointer;min-width:80px">
    <span id="vbtn_${m.id}" style="font-size:15px">${hasAudio?'▶':'🎙'}</span>
    <div style="display:flex;align-items:center;gap:2px;flex:1">
      ${[4,7,10,14,10,7,5,8,12,8,5].map(h=>`<div style="width:2px;height:${h}px;background:currentColor;border-radius:1px;opacity:.7"></div>`).join('')}
    </div>
  </div>`;
  const displayContent=(m.content||'').replace(/^\[语音情绪:[^\]]+\]\s*/,'');
  const transcriptBtn=displayContent?`<div style="font-size:11px;color:var(--td);margin-top:4px;cursor:pointer" onclick="toggleVoiceTranscript('${m.id}')">[查看转写文字]</div><div id="vtxt_${m.id}" style="display:none;font-size:12px;color:var(--t);margin-top:4px;padding-top:4px;border-top:1px solid var(--bd)">${m.translatedContent?`<div style="color:var(--ac);margin-bottom:3px">${esc(m.translatedContent)}</div>`:''} ${esc(displayContent)}</div>`:'';
  return`<div class="msg-row ${isU?'user':'bot'}" id="msg_${m.id}" onclick="onMsgClick('${m.id}')" oncontextmenu="onCtx(event,'${m.id}');return false">
    ${avHtml}
    <div class="msg-col ${isU?'user':'bot'}">
      <div class="bubble ${isU?'user':'bot'}" style="min-width:120px;max-width:200px;${selCls}${opCls}">
        ${voiceBar}
        ${transcriptBtn}
      </div>
    </div>
  </div>`;
}

function toggleVoiceTranscript(id){
  const el=document.getElementById('vtxt_'+id);
  const btn=el?.previousElementSibling;
  if(!el)return;
  const show=el.style.display==='none';
  el.style.display=show?'block':'none';
  if(btn)btn.textContent=show?'[收起转写文字]':'[查看转写文字]';
}

let voicePlayAudio=null;
function playVoiceMsg(e,msgId){
  e.stopPropagation();
  const m=messages.find(m=>m.id===msgId);
  if(!m?.audioUrl)return;
  const btn=document.getElementById('vbtn_'+msgId);
  if(voicePlayAudio&&!voicePlayAudio.paused){
    voicePlayAudio.pause();voicePlayAudio.currentTime=0;
    if(btn)btn.textContent='▶';return;
  }
  if(voicePlayAudio)voicePlayAudio.pause();
  voicePlayAudio=new Audio(m.audioUrl);
  voicePlayAudio.play();
  if(btn)btn.textContent='⏸';
  voicePlayAudio.onended=()=>{if(btn)btn.textContent='▶';};
}

function renderTodoCard(){
  const done=todos.filter(t=>t.done).length,total=todos.length;
  const items=todos.map(t=>`
    <div class="todo-item">
      <div class="todo-check ${t.done?'done':'undone'}" onclick="toggleTodo('${t.id}')">${t.done?'✓':''}</div>
      <span class="todo-text ${t.done?'done':''}">${esc(t.text)}</span>
      <button class="todo-del" onclick="delTodo('${t.id}')">×</button>
    </div>`).join('');
  return`<div class="todo-card" style="margin-left:${cfg.showAvatar?30:0}px">
    <div class="todo-inner">
      <div class="todo-hdr"><span class="todo-hdr-title">📋 今日清单</span><span class="todo-hdr-count">${done}/${total} 完成</span></div>
      ${items}
      <div class="todo-input-row">
        <input id="todoAddInput" style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--bd);border-radius:7px;color:var(--t);font-size:12px;outline:none" placeholder="添加新任务..." onkeydown="if(event.key==='Enter')addTodo()">
        <button onclick="addTodo()" style="padding:5px 9px;background:rgba(212,165,116,.15);border:1px solid rgba(212,165,116,.3);border-radius:7px;color:var(--ac);font-size:11px;cursor:pointer">+</button>
      </div>
    </div>
  </div>`;
}

function renderMoodCard(m){
  const avHtml=cfg.showAvatar?`<div class="avatar av-bot">🦀</div>`:'';
  return`<div class="msg-row bot">
    ${avHtml}
    <div class="mood-card">
      <div class="mood-inner">
        <div class="mood-label">💭 心声</div>
        <div class="mood-text">${esc(m.content)}</div>
      </div>
    </div>
  </div>`;
}

function scrollEnd(){const el=document.getElementById('msgs');if(el)requestAnimationFrame(()=>el.scrollTop=el.scrollHeight);}

// ═══════════ TODO ═══════════
const TODO_KEYWORDS=['清单','待办','todo','计划','今天要做','任务','帮我看','check'];
function isTodoQuery(t){return TODO_KEYWORDS.some(k=>t.toLowerCase().includes(k));}
function toggleTodo(id){
  todos=todos.map(t=>t.id===id?{...t,done:!t.done}:t);save(K.todos,todos);
  const el=document.getElementById('msgs');
  el.querySelectorAll('.todo-card').forEach(n=>n.outerHTML=renderTodoCard());
  renderMessages();
}
function delTodo(id){todos=todos.filter(t=>t.id!==id);save(K.todos,todos);renderMessages();}
function addTodo(){
  const inp=document.getElementById('todoAddInput');if(!inp||!inp.value.trim())return;
  todos.push({id:Date.now().toString(),text:inp.value.trim(),done:false});
  save(K.todos,todos);renderMessages();
}

// ═══════════ INPUT ═══════════
function onInput(el){
  el.style.height='auto';el.style.height=Math.min(el.scrollHeight,90)+'px';
  updateSendBtn();
}
function updateSendBtn(){
  const el=document.getElementById('msgInput');
  const ok=(el&&(el.value.trim()||stagedMsgs.length))&&!streaming&&currentSession;
  const btn=document.getElementById('sendBtn');
  if(btn){btn.className='send-btn '+(ok?'on':'off');btn.disabled=!ok;}
}
function handleKey(e){
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    const v=document.getElementById('msgInput').value.trim();
    if(v) stageMessage(v);
  }
}

// ═══════════ SEND ═══════════
async function send(){
  const inp=document.getElementById('msgInput');
  const text=inp.value.trim();
  const allTexts=[...stagedMsgs];
  if(text) allTexts.push(text);
  if(!allTexts.length||streaming||!currentSession)return;
  if(!cfg.base){openPanel('settings');return;}
  inp.value='';inp.style.height='auto';
  clearStaged();
  document.getElementById('sendBtn').className='send-btn off';

  if(editingId){
    messages=messages.map(m=>m.id===editingId?{...m,content:allTexts.join('\n')}:m);
    saveMessages();renderMessages();cancelEdit();return;
  }

  const q=quoteMsg;clearQuote();
  for(let i=0;i<allTexts.length;i++){
    const userMsg={id:(Date.now()+i).toString(),role:'user',content:allTexts[i],ts:new Date().toISOString(),type:'text',quote:i===0&&q?{id:q.id,content:q.content.slice(0,55)}:null};
    messages.push(userMsg);
  }
  saveMessages();renderMessages();
  const combinedContent=allTexts.join('\n---msg---\n');

  const showTodo=isTodoQuery(text);
  detectAnniv(text);

  streaming=true;
  showTyping();

  try{
    let systemPrompt='';
    if(memories.length){systemPrompt+='【记忆库】以下是重要记忆，请记住：\n'+memories.map((m,i)=>`${i+1}. ${m}`).join('\n')+'\n\n';}
    const d=new Date(),days=['周日','周一','周二','周三','周四','周五','周六'];
    systemPrompt+=`【当前时间】${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${days[d.getDay()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}\n\n`;
    if(showTodo&&todos.length){
      systemPrompt+=`【今日清单】${todos.map(t=>`${t.done?'✓':'○'} ${t.text}`).join('、')}\n\n`;
    }
    if(annivs.length){
      const mo=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0'),today=`${mo}-${da}`;
      const todayAnnivs=annivs.filter(a=>a.date===today);
      if(todayAnnivs.length)systemPrompt+=`【今天的纪念日】${todayAnnivs.map(a=>a.name).join('、')}\n\n`;
    }

    const base=(cfg.apiBase||'https://api.anthropic.com').replace(/\/+$/,'');
    const isOfficial=base.includes('anthropic.com');
    const apiUrl=base.endsWith('/v1')?base+'/messages':base+'/v1/messages';
    const headers={'Content-Type':'application/json'};
    if(isOfficial){headers['x-api-key']=cfg.apiKey;headers['anthropic-version']='2023-06-01';headers['anthropic-dangerous-direct-browser-access']='true';}
    else{headers['x-api-key']=cfg.apiKey;headers['Authorization']='Bearer '+cfg.apiKey;headers['anthropic-version']='2023-06-01';}

    let reply='';
    if(cfg.base){
      const body={session_id:currentSession.id,content:combinedContent||text,model:cfg.model};
      if(cfg.apiKey)body.api_key=cfg.apiKey;
      if(cfg.apiBase)body.api_base=cfg.apiBase;
      if(cfg.systemPrompt)body.system_prompt_override=cfg.systemPrompt;
      if(q?.content)body.quote_content=q.content;
      const recentImgMsg=messages.filter(m=>m.role==='user'&&m.imageBase64).slice(-1)[0];
      if(recentImgMsg&&allTexts.length<=1){
        body.image_base64=recentImgMsg.imageBase64;
        body.image_mime=recentImgMsg.imageMime||'image/jpeg';
        delete recentImgMsg.imageBase64;
        delete recentImgMsg.imageMime;
      }
      const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'HTTP '+r.status);}
      const data=await r.json();reply=data.content||'(空回复)';
    } else {
      const r=await fetch(apiUrl,{method:'POST',headers,body:JSON.stringify({model:cfg.model,max_tokens:4096,system:systemPrompt||undefined,messages:messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>{
            let content=m.content;
            if(m.quote&&m.role==='user')content=`[引用: "${m.quote.content}"]\n${content}`;
            return{role:m.role,content};
          })})});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||'HTTP '+r.status);}
      const data=await r.json();reply=data.content?.map(b=>b.text||'').join('')||'(空回复)';
    }

    hideTyping();
    const replyData = await (async()=>{try{const rr=await fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+currentSession.id+'?limit=20');const dd=await rr.json();return dd;}catch(e){return [];}})();
    const realMsgs=messages.filter(m=>!m.id?.includes('_voice'));
    const lastTs=realMsgs.length?realMsgs[realMsgs.length-1].ts:'';
    const newMsgs=(replyData||[]).filter(m=>m.created_at>lastTs&&m.role==='assistant');
    const msgsToAdd=newMsgs.length?newMsgs.map(m=>({id:m.id.toString(),role:'assistant',content:m.content,innerThought:m.inner_thought||'',ts:m.created_at,type:'text',isVoice:m.is_voice||false,audioUrl:m.audio_url||null})):(()=>{const replyMsgs=(typeof data==='object'&&data.messages)||[{content:reply,inner:'',voice:false}];return replyMsgs.map((rm,i)=>({id:(Date.now()+i+100).toString(),role:'assistant',content:typeof rm==='string'?rm:rm.content,innerThought:typeof rm==='string'?'':rm.inner||'',ts:new Date().toISOString(),type:'text',isVoice:rm.voice||false}));})();

    if(msgsToAdd.length<=1){
      if(msgsToAdd.length){
        const msg=msgsToAdd[0];
        if(msg.isVoice){msg.type='voice';msg.audioUrl=null;messages.push(msg);} else {messages.push(msg);}
      }
      saveMessages();renderMessages();
    } else {
      const first=msgsToAdd[0];
      if(first.isVoice){first.type='voice';first.audioUrl=null;}
      messages.push(first);
      saveMessages();renderMessages();
      for(let i=1;i<msgsToAdd.length;i++){
        await new Promise(r=>setTimeout(r,1000));
        showTyping();
        await new Promise(r=>setTimeout(r,600));
        hideTyping();
        const msg=msgsToAdd[i];
        if(msg.isVoice){msg.type='voice';msg.audioUrl=null;}
        messages.push(msg);
        saveMessages();renderMessages();
      }
    }

    for(const msg of msgsToAdd){
      if(msg.isVoice&&cfg.base){autoGenVoiceBubble(msg);}
    }
    if(messages.filter(m=>m.role==='user').length===1){
      const name=text.slice(0,14)+(text.length>14?'...':'');
      sessions=sessions.map(s=>s.id===currentSession.id?{...s,name}:s);
      save(K.sessions,sessions);renderSessions();
    }
  }catch(err){
    hideTyping();
    messages.push({id:Date.now().toString(),role:'assistant',content:'⚠ '+err.message,ts:new Date().toISOString(),type:'error'});
    saveMessages();renderMessages();
  }finally{streaming=false;}
}

let mediaRecorder=null;
let audioChunks=[];
let isRecording=false;
let waveAnimTimer=null;

function toggleVoiceRec(){
  const overlay=document.getElementById('voiceOverlay');
  overlay.style.display='flex';
}

function startVoiceRec(e){
  e.preventDefault();
  if(isRecording)return;
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    isRecording=true;
    audioChunks=[];
    window._recStartTime=Date.now();
    mediaRecorder=new MediaRecorder(stream,{mimeType:'audio/webm'});
    mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);
    mediaRecorder.start();
    document.getElementById('voiceStatus').textContent='录音中...';
    document.getElementById('voiceRecordBtn').style.background='#c46';
    waveAnimTimer=setInterval(()=>{
      document.querySelectorAll('.wave-bar').forEach(b=>{
        b.style.height=Math.random()*32+4+'px';
        b.style.opacity='1';
      });
    },150);
  }).catch(()=>{alert('需要麦克风权限');});
}

async function stopVoiceRec(e){
  e.preventDefault();
  if(!isRecording||!mediaRecorder)return;
  isRecording=false;
  clearInterval(waveAnimTimer);
  document.getElementById('voiceStatus').textContent='处理中...';
  document.getElementById('voiceRecordBtn').style.background='var(--ac)';

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t=>t.stop());

  mediaRecorder.onstop=async()=>{
    const duration=Date.now()-(window._recStartTime||0);
    if(duration<800){document.getElementById('voiceOverlay').style.display='none';return;}
    const blob=new Blob(audioChunks,{type:'audio/webm'});
    const localUrl=URL.createObjectURL(blob);
    document.getElementById('voiceOverlay').style.display='none';

    if(!cfg.base){alert('需要配置后端才能发语音');return;}

    const placeholderId=Date.now().toString();
    messages.push({id:placeholderId,role:'user',content:'语音发送中...',ts:new Date().toISOString(),type:'voice',audioUrl:localUrl});
    saveMessages();renderMessages();

    let audioUrl=localUrl;
    try{
      const fd2=new FormData();
      fd2.append('audio',blob,'voice.webm');
      const uploadRes=await fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/upload',{method:'POST',body:fd2});
      if(uploadRes.ok){
        const uploadData=await uploadRes.json();
        if(uploadData.audioUrl)audioUrl=uploadData.audioUrl;
      }
    }catch(e){console.log('录音上传失败，使用本地URL');}

    const fd=new FormData();
    fd.append('audio',blob,'voice.webm');
    try{
      const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/transcribe',{method:'POST',body:fd});
      const d=await r.json();
      if(d.text){
        const placeholder=messages.find(m=>m.id===placeholderId);
        if(placeholder){
          placeholder.content=d.text;placeholder.emotion=d.emotion||'';placeholder.audioUrl=audioUrl;
        }
        saveMessages();renderMessages();
        await sendVoiceMessage(d.text, d.emotion, audioUrl);
      } else {
        const idx=messages.findIndex(m=>m.id===placeholderId);
        if(idx>=0)messages.splice(idx,1);
        saveMessages();renderMessages();
      }
    }catch(err){
      const idx=messages.findIndex(m=>m.id===placeholderId);
      if(idx>=0){messages[idx].content='转写失败，点击重试';saveMessages();renderMessages();}
    }
  };
}

function cancelVoiceRec(){
  if(mediaRecorder&&isRecording){
    isRecording=false;
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t=>t.stop());
    clearInterval(waveAnimTimer);
  }
  document.getElementById('voiceOverlay').style.display='none';
}

async function sendVoiceMessage(text, emotion, audioUrl){
  if(!currentSession||!cfg.base)return;
  showTyping();
  try{
    const emotionNote=emotion?`[语音情绪: ${emotion}] `:'';
    const body={
      session_id:currentSession.id,
      content:emotionNote+text,
      model:cfg.model,
      is_voice:true,
      audio_url:audioUrl||null,
    };
    if(cfg.apiKey)body.api_key=cfg.apiKey;
    if(cfg.apiBase)body.api_base=cfg.apiBase;
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();
    hideTyping();
    const replyData=await(async()=>{try{const rr=await fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+currentSession.id+'?limit=20');return await rr.json();}catch(e){return[];}})();
    const lastTs=messages.length?messages[messages.length-1].ts:'';
    const newMsgs=(replyData||[]).filter(m=>m.created_at>lastTs&&m.role==='assistant');
    if(newMsgs.length){
      for(const m of newMsgs)messages.push({id:m.id.toString(),role:'assistant',content:m.content,innerThought:m.inner_thought||'',ts:m.created_at,type:'text'});
    }
    saveMessages();renderMessages();
  }catch(e){
    hideTyping();
    messages.push({id:Date.now().toString(),role:'assistant',content:'⚠ '+e.message,ts:new Date().toISOString(),type:'error'});
    saveMessages();renderMessages();
  }
}

function guessEmotion(text){
  if(/哈哈|哈哈哈|😄|😊|开心|好玩|有趣/.test(text))return '开心';
  if(/啊|！！|!!!|兴奋|太好了/.test(text))return '兴奋';
  if(/难过|伤心|哭|😢|😭/.test(text))return '难过';
  if(/累|困|疲惫|😴/.test(text))return '疲惫';
  if(/宝宝|嘛|呢|撒娇|🥺/.test(text))return '撒娇';
  if(/不行|不对|别这样|😤/.test(text))return '生气';
  return '平静';
}

async function autoGenVoiceBubble(msg){
  if(!cfg.base||!msg?.content)return;
  try{
    const emotion=guessEmotion(msg.content);
    const bubbleId=msg.id+'_voice';

    const existingIdx=messages.findIndex(m=>m.id===bubbleId);
    const selfIdx=messages.findIndex(m=>m.id===msg.id&&m.type==='voice');
    if(existingIdx<0&&selfIdx<0){
      const placeholder={
        id:bubbleId,role:'assistant',content:msg.content,
        translatedContent:null,ts:msg.ts,type:'voice',
        audioUrl:null,emotion,loading:true,
      };
      const msgIdx=messages.findIndex(m=>m.id===msg.id);
      if(msgIdx>=0)messages.splice(msgIdx+1,0,placeholder);
      else messages.push(placeholder);
      saveMessages();renderMessages();
    }

    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/tts',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:msg.content.slice(0,500),emotion,channel:cfg.ttsChannel||'minimax',lang:cfg.ttsLang||'zh'}),
    });
    if(!r.ok)return;
    const contentType=r.headers.get('content-type')||'';
    let audioUrl;
    if(contentType.includes('application/json')){
      const d=await r.json();
      if(!d.audioUrl)return;
      audioUrl=d.audioUrl;
      if(d.translatedText)msg._translatedText=d.translatedText;
      if(msg.id&&!msg.id.includes('_voice')){
        fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+msg.id+'/audio',{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({audio_url:audioUrl}),
        }).catch(()=>{});
      }
    } else {
      const audioBlob=await r.blob();
      audioUrl=URL.createObjectURL(audioBlob);
    }

    const existingVoiceIdx=messages.findIndex(m=>m.id===bubbleId);
    if(existingVoiceIdx>=0){
      messages[existingVoiceIdx].audioUrl=audioUrl;
      messages[existingVoiceIdx].translatedContent=msg._translatedText||null;
      messages[existingVoiceIdx].loading=false;
      saveMessages();renderMessages();
      return;
    }
    const sIdx=messages.findIndex(m=>m.id===msg.id&&m.type==='voice');
    if(sIdx>=0){
      messages[sIdx].audioUrl=audioUrl;
      saveMessages();renderMessages();
    }
    saveMessages();renderMessages();
  }catch(e){}
}

let currentAudio=null;
async function playTTS(e, msgId){
  e.stopPropagation();
  const btn=e.target;
  const m=messages.find(m=>m.id===msgId);
  if(!m||!cfg.base)return;

  if(m.audioUrl){
    if(currentAudio){currentAudio.pause();currentAudio=null;}
    currentAudio=new Audio(m.audioUrl);
    currentAudio.play();
    btn.textContent='⏸';
    currentAudio.onended=()=>{btn.textContent='🔊';currentAudio=null;};
    return;
  }

  btn.textContent='⏳';
  try{
    const emotion=m.emotion||guessEmotion(m.content);
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/tts',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:m.content.slice(0,500),emotion,channel:cfg.ttsChannel||'minimax',lang:cfg.ttsLang||'zh'}),
    });
    if(!r.ok){const err=await r.json().catch(()=>({}));throw new Error(err.error||'TTS 失败');}
    const contentType=r.headers.get('content-type')||'';
    let audioUrl;
    if(contentType.includes('application/json')){
      const d=await r.json();if(d.audioUrl){audioUrl=d.audioUrl;}else throw new Error(d.error||'TTS 失败');
    } else {
      const audioBlob=await r.blob();
      audioUrl=URL.createObjectURL(audioBlob);
    }
    m.audioUrl=audioUrl;
    if(currentAudio){currentAudio.pause();currentAudio=null;}
    currentAudio=new Audio(audioUrl);
    currentAudio.play();
    btn.textContent='⏸';
    currentAudio.onended=()=>{btn.textContent='🔊';currentAudio=null;};
  }catch(err){
    btn.textContent='🔊';
    alert('语音播放失败：'+err.message+'\n（可能需要充值或检查API key）');
  }
}

let typingEl=null;
function showTyping(){
  const msgs=document.getElementById('msgs');
  if(!msgs) return;
  typingEl=document.createElement('div');
  typingEl.className='typing';
  typingEl.id='typingIndicator';
  const avHtml=cfg.showAvatar?`<div class="avatar av-bot">🦀</div>`:'';
  typingEl.innerHTML=avHtml+`<div class="typing-bubble"><span></span><span></span><span></span></div>`;
  msgs.appendChild(typingEl);scrollEnd();
}
function hideTyping(){if(typingEl){typingEl.remove();typingEl=null;}}

// ═══════════ IMAGE ═══════════
function sendImage(e){
  const f=e.target.files[0];if(!f)return;
  e.target.value='';
  const url=URL.createObjectURL(f);
  const img=new Image();
  img.onload=function(){
    const MAX=1200;
    let w=img.width,h=img.height;
    if(w>MAX||h>MAX){
      if(w>h){h=Math.round(h*MAX/w);w=MAX;}
      else{w=Math.round(w*MAX/h);h=MAX;}
    }
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0,w,h);
    const mime='image/jpeg';
    const b64=canvas.toDataURL(mime,0.75).split(',')[1];
    const m={id:Date.now().toString(),role:'user',content:'',ts:new Date().toISOString(),type:'image',imageUrl:url,imageBase64:b64,imageMime:mime};
    messages.push(m);saveMessages();renderMessages();
    document.getElementById('msgInput').focus();
  };
  img.onerror=function(){
    const reader=new FileReader();
    reader.onload=function(ev){
      const b64=ev.target.result.split(',')[1];
      const m={id:Date.now().toString(),role:'user',content:'',ts:new Date().toISOString(),type:'image',imageUrl:url,imageBase64:b64,imageMime:f.type||'image/jpeg'};
      messages.push(m);saveMessages();renderMessages();
      document.getElementById('msgInput').focus();
    };
    reader.readAsDataURL(f);
  };
  img.src=url;
}

// ═══════════ LINK ═══════════
function toggleLink(){
  const row=document.getElementById('linkRow'),btn=document.getElementById('linkBtn');
  if(!row || !btn) return;
  const show=row.style.display==='none';
  row.style.display=show?'flex':'none';
  btn.className='ic-btn '+(show?'active':'normal');
  if(show)setTimeout(()=>document.getElementById('linkInput').focus(),50);
}
function sendLink(){
  const v=document.getElementById('linkInput').value.trim();if(!v)return;
  stageMessage('🔗 '+v);
  document.getElementById('linkInput').value='';
  toggleLink();
  document.getElementById('msgInput').focus();
}

// ═══════════ MOOD ═══════════
async function generateMood(){
  const el=document.getElementById('headerMood');
  if(!el||!cfg.base||!currentSession)return;
  el.textContent='💭 感受中...';
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/mood/generate',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:currentSession.id})
    });
    const d=await r.json();
    if(d.mood)el.textContent='💭 '+d.mood;
    else el.textContent='💭 点击感受他的心声';
  }catch(e){
    el.textContent='💭 点击感受他的心声';
  }
}
function refreshHeaderMood(){
  const el=document.getElementById('headerMood');
  if(!el)return;
  el.style.opacity='0.4';
  if(!cfg.base){
    if(moods.length){const m=moods[Math.floor(Math.random()*moods.length)];el.textContent='💭 '+m;}
    el.style.opacity='0.8';
    return;
  }
  fetch(cfg.base.replace(/\/+$/,'')+'/api/mood/random')
    .then(r=>r.json())
    .then(d=>{if(d.mood)el.textContent='💭 '+d.mood;el.style.opacity='0.8';})
    .catch(()=>{if(moods.length){const m=moods[Math.floor(Math.random()*moods.length)];el.textContent='💭 '+m;}el.style.opacity='0.8';});
}
function updateHeaderMoodFromReply(){}
function toggleMood(){
  const popup=document.getElementById('moodPopup');
  if(!popup) return;
  const show=popup.style.display==='none';
  popup.style.display=show?'block':'none';
  const btn = document.getElementById('moodBtn');
  if(btn) btn.className='ic-btn '+(show?'active':'normal');
  if(show){
    const m=moods[Math.floor(Math.random()*moods.length)];
    document.getElementById('moodText').textContent=m;
  }
}
document.addEventListener('click',e=>{
  const popup=document.getElementById('moodPopup');
  const btn=document.getElementById('moodBtn');
  if(popup&&btn&&!popup.contains(e.target)&&!btn.contains(e.target)){
    popup.style.display='none';
    btn.className='ic-btn normal';
  }
});

// ═══════════ QUOTE ═══════════
function clearQuote(){quoteMsg=null;const b=document.getElementById('quoteBanner');if(b)b.style.display='none';}
function cancelEdit(){editingId=null;const m=document.getElementById('msgInput');if(m)m.value='';const b=document.getElementById('editBanner');if(b)b.style.display='none';}

// ═══════════ CONTEXT MENU ═══════════
function onCtx(e,msgId){
  e.stopPropagation();
  ctxMsgId=msgId;
  const m=messages.find(m=>m.id===msgId);
  document.getElementById('ctxEdit').style.display=m?.role==='user'?'block':'none';
  document.getElementById('ctxInner').style.display=m?.role==='assistant'?'block':'none';
  const menu=document.getElementById('ctxMenu');
  menu.style.display='block';
  menu.style.left=Math.min(e.clientX-8,window.innerWidth-140)+'px';
  menu.style.top=Math.min(e.clientY-8,window.innerHeight-260)+'px';
}
function ctxAct(action){
  const m=messages.find(m=>m.id===ctxMsgId);
  document.getElementById('ctxMenu').style.display='none';
  if(!m)return;
  if(action==='copy'){try{navigator.clipboard.writeText(m.content);}catch(e){}}
  if(action==='delete'){if(!confirm('删除这条消息？'))return;if(cfg.base&&m.id)fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+m.id,{method:'DELETE'}).catch(()=>{});messages=messages.filter(x=>x.id!==m.id);saveMessages();renderMessages();}
  if(action==='edit'){document.getElementById('msgInput').value=m.content;editingId=m.id;onInput(document.getElementById('msgInput'));document.getElementById('editBanner').style.display='flex';document.getElementById('msgInput').focus();}
  if(action==='quote'){quoteMsg=m;document.getElementById('quoteBanner').style.display='flex';document.getElementById('quoteText').textContent='引用: '+m.content.slice(0,50);document.getElementById('msgInput').focus();}
  if(action==='collect'){favs.push({type:'single',msg:{...m,savedAt:new Date().toISOString()}});save(K.favs,favs);}
  if(action==='select'){selMode=true;selected=new Set([m.id]);updateSelBar();renderMessages();}
  if(action==='inner'){showInnerThought(m);}
}
async function showInnerThought(m){
  const popup=document.getElementById('innerPopup');
  const text=document.getElementById('innerPopupText');
  popup.style.display='flex';
  text.innerHTML='<span style="opacity:.5">感受中...</span>';
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/mood/generate',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:currentSession?.id,content:m.content,api_key:cfg.apiKey,api_base:cfg.apiBase,model:cfg.model,})
    });
    const d=await r.json();
    if(d.mood){
      text.textContent=d.mood;
      m.innerThought=d.mood;
    } else {
      text.textContent='他此刻什么都没想...';
    }
  }catch(e){
    text.textContent='生成失败，稍后再试';
  }
}
function onMsgClick(id){if(selMode){selected.has(id)?selected.delete(id):selected.add(id);updateSelBar();renderMessages();}}
function updateSelBar(){
  document.getElementById('selBar').style.display=selMode?'flex':'none';
  document.getElementById('selCount').textContent=`已选 ${selected.size} 条`;
}
function cancelSel(){selMode=false;selected=new Set();updateSelBar();renderMessages();}
async function deleteSelected(){
  if(!selected.size)return;
  if(!confirm(`删除选中的 ${selected.size} 条消息？`))return;
  const ids=[...selected];
  if(cfg.base){
    await Promise.all(ids.map(id=>fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/'+id,{method:'DELETE'}).catch(()=>{})));
  }
  messages=messages.filter(m=>!ids.includes(m.id));
  saveMessages();selMode=false;selected=new Set();
  updateSelBar();renderMessages();
}
function collectGroup(){
  const title=prompt('给这组收藏起个名字：','聊天记录')||'聊天记录';
  favs.push({type:'group',title,collapsed:true,msgs:messages.filter(m=>selected.has(m.id)),savedAt:new Date().toISOString()});
  save(K.favs,favs);cancelSel();
}

// ═══════════ ANNIVERSARY DETECTION ═══════════
function detectAnniv(text){
  const patterns=[/今天是(.{2,15})(周年|纪念日|生日|一周年|两周年|三周年)/,/(.{2,15})(周年|纪念日|生日)是今天/,/(\d+)(月)(\d+)(日|号)是(.{2,15})/];
  for(const p of patterns){const m=text.match(p);if(m){const name=m[1]||m[5];const d=new Date(),mo=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0');const existing=annivs.find(a=>a.name===name);if(!existing){annivs.push({id:Date.now().toString(),name,date:`${mo}-${da}`});save(K.annivs,annivs);}}}
}
function checkAnnivs(){
  const d=new Date(),mo=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0'),today=`${mo}-${da}`;
  const hits=annivs.filter(a=>a.date===today);
  if(hits.length){
    const el=document.getElementById('annivAlert');
    document.getElementById('annivText').textContent='🎉 今天是「'+hits[0].name+'」！';
    el.style.display='flex';setTimeout(()=>el.style.display='none',8000);
  }
}

// ═══════════ PRESET ═══════════
function updatePresetBtn(){
  const p=cfg.presets?.find(p=>p.apiBase===cfg.apiBase&&p.apiKey===cfg.apiKey)||{name:cfg.model||'设置API'};
  document.getElementById('presetBtn').textContent=(p.name||cfg.model||'设置API')+' · '+(cfg.model||'').replace(/\[.*?\]/g,'').slice(0,14);
}

// ═══════════ PANELS ═══════════
let curPanel=null;
function openPanel(name){curPanel=name;document.getElementById('overlay').style.display='flex';renderPanel(name);}
function closePanel(){document.getElementById('overlay').style.display='none';curPanel=null;}

function renderPanel(name){
  const el=document.getElementById('panelContent');
  if(name==='preset')el.innerHTML=renderPresetPanel();
  else if(name==='memory'){renderMemPanel();}
  else if(name==='favs')el.innerHTML=renderFavsPanel();
  else if(name==='diary'){renderDiaryPanel();}
  else if(name==='calls'){if(typeof renderCallsPanel === 'function') renderCallsPanel(); else el.innerHTML='通话模块未加载';}
  else if(name==='settings')el.innerHTML=renderSettingsPanel();
  else if(name==='desire'){renderDesirePanel();} 
  else if(name==='media'){renderMediaPanel();} 
}

async function renderDesirePanel() {
  const el = document.getElementById('panelContent');
  el.innerHTML = `<div class="panel-hdr"><span class="panel-title">🧠 他的内心状态 (上帝视角)</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    <div id="desireContent"><div style="text-align:center;color:var(--td);font-size:12px;padding:20px">正在读取他的大脑...</div></div>`;
  
  if(!cfg.base || !currentSession) return;

  try {
    const [desireRes, queueRes] = await Promise.all([
      fetch(cfg.base.replace(/\/+$/,'') + '/api/desires/' + currentSession.id),
      fetch(cfg.base.replace(/\/+$/,'') + '/api/queue/' + currentSession.id)
    ]);
    const d = await desireRes.json();
    const q = await queueRes.json();

    const renderBar = (label, val, color) => {
      const pct = Math.min(100, Math.max(0, val * 100)).toFixed(1);
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--td);margin-bottom:4px">
          <span>${label}</span><span>${val.toFixed(2)}</span>
        </div>
        <div style="width:100%;height:6px;background:var(--s2);border-radius:3px;overflow:hidden;border:1px solid var(--bd)">
          <div style="width:${pct}%;height:100%;background:${color};transition:width 0.5s ease"></div>
        </div>
      </div>`;
    };

    let html = `<div style="padding: 10px; background: rgba(212,165,116,0.05); border: 1px solid rgba(212,165,116,0.2); border-radius: 12px; margin-bottom: 16px;">`;
    html += renderBar('💓 想念程度 (Attachment) - 满0.7触发', d.attachment || 0, '#d4a574');
    html += renderBar('🌩️ 情绪压力 (Stress)', d.stress || 0, '#c46');
    html += renderBar('🫂 亲密驱动 (Libido)', d.libido || 0, '#e585b6');
    html += renderBar('📌 记挂责任 (Duty)', d.duty || 0, '#6478b4');
    html += renderBar('📖 沉淀回忆 (Reflection)', d.reflection || 0, '#888');
    html += renderBar('💤 疲劳控制 (Fatigue) - 满0.8罢工', d.fatigue || 0, '#555');
    html += `<div style="font-size:10px;color:var(--tf);text-align:right;margin-top:4px">最后心跳跳动: ${fmtTime(d.updated_at)}</div></div>`;

    html += `<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--t)">💌 偷偷藏在身后的纸条 (待发送)</div>`;
    if (q.length === 0) {
      html += `<div style="font-size:11px;color:var(--td);text-align:center;padding:10px 0">当前没有计划要发的消息。</div>`;
    } else {
      html += q.map(msg => {
        const sendTime = new Date(msg.send_at);
        const timeStr = sendTime.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
        const typeIcon = msg.content_type === 'call' ? '📞' : (msg.content_type === 'voice' ? '🎙️' : '💬');
        const sourceLabel = msg.source === 'desire_engine' ? '冲动' : '约定';
        return `<div style="background:var(--s2);border:1px dashed var(--bd);border-radius:8px;padding:10px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--td);margin-bottom:6px">
            <span style="color:var(--ac)">计划发送时间：${timeStr}</span>
            <span style="background:var(--s1);padding:2px 6px;border-radius:4px">${sourceLabel}</span>
          </div>
          <div style="font-size:12px;color:var(--t)">${typeIcon} ${esc(msg.content)}</div>
        </div>`;
      }).join('');
    }

    html += `<button onclick="renderDesirePanel()" style="width:100%;margin-top:12px;padding:8px;background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--td);font-size:12px;cursor:pointer">🔄 刷新状态</button>`;
    document.getElementById('desireContent').innerHTML = html;
  } catch (e) {
    document.getElementById('desireContent').innerHTML = `<div style="color:#c46;font-size:12px;text-align:center">读取失败：${e.message}</div>`;
  }
}

function renderPresetPanel(){
  const cards=(cfg.presets||[]).map((p,i)=>`
    <div class="preset-card${cfg.apiKey===p.apiKey&&cfg.apiBase===p.apiBase?' active':''}" onclick="applyPreset(${i})">
      <div>
        <div style="font-size:13px;font-weight:500;margin-bottom:2px">${esc(p.name)}${cfg.apiBase===p.apiBase&&cfg.apiKey===p.apiKey?' ✓':''}</div>
        <div style="font-size:11px;color:var(--td)">${esc(p.model.slice(0,22))} · ${p.apiBase.replace('https://','').slice(0,18)}</div>
      </div>
      <button class="h-btn" onclick="event.stopPropagation();editPreset(${i})">编辑</button>
    </div>`).join('');
  return`<div class="panel-hdr"><span class="panel-title">API 预设</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    <p style="font-size:11px;color:var(--td);margin-bottom:10px">点击切换，一键换用不同 API 配置</p>
    ${cards}
    <button class="p-btn ghost" onclick="editPreset(-1)">+ 新增预设</button>`;
}

function applyPreset(i){
  const p=cfg.presets[i];cfg.apiBase=p.apiBase;cfg.apiKey=p.apiKey;cfg.model=p.model;
  save(K.cfg,cfg);
  localStorage.setItem('cc_apikey_backup',p.apiKey);
  localStorage.setItem('cc_apibase_backup',p.apiBase);
  localStorage.setItem('cc_model_backup',p.model);
  updatePresetBtn();closePanel();
}

function editPreset(i){
  const p=i>=0?{...cfg.presets[i]}:{id:null,name:'',apiBase:'',apiKey:'',model:''};
  const el=document.getElementById('panelContent');
  el.innerHTML=`<div class="panel-hdr"><span class="panel-title">${i>=0?'编辑预设':'新增预设'}</span><button class="h-btn" onclick="renderPanel('preset')">返回</button></div>
    <label class="p-label">预设名称</label><input class="p-inp" id="pName" value="${esc(p.name)}" placeholder="例如：中转站">
    <label class="p-label">API 地址</label><input class="p-inp" id="pBase" value="${esc(p.apiBase)}" placeholder="https://api.anthropic.com">
    <label class="p-label">API Key</label><input class="p-inp" id="pKey" type="password" value="${esc(p.apiKey)}" placeholder="sk-...">
    <label class="p-label">模型名称</label>
    <div style="display:flex;gap:5px;margin-bottom:6px">
      <input class="p-inp" id="pModel" style="margin-bottom:0;flex:1" value="${esc(p.model)}" placeholder="输入或拉取选择">
      <button class="h-btn" onclick="fetchModels(${i})" id="fetchBtn">拉取模型</button>
    </div>
    <div id="modelSearchWrap" style="display:none;margin-bottom:4px">
      <input class="p-inp" id="modelSearch" style="margin-bottom:0" placeholder="搜索模型名称..." oninput="filterModels()">
    </div>
    <div id="modelListEl" class="model-list" style="display:none"></div>
    <button class="p-btn save" onclick="savePreset(${i})" style="margin-top:8px">保存</button>
    ${i>=0?`<button class="h-btn" style="width:100%;margin-top:8px;color:#c46;border-color:#c46" onclick="delPreset(${i})">删除此预设</button>`:''}`;
}

async function fetchModels(presetIdx){
  const btn=document.getElementById('fetchBtn');btn.textContent='加载中...';btn.disabled=true;
  try{
    const base=(document.getElementById('pBase').value||cfg.apiBase||'').replace(/\/+$/,'');
    const key=document.getElementById('pKey').value||cfg.apiKey||'';
    const url=base.endsWith('/v1')?base+'/models':base+'/v1/models';
    const r=await fetch(url,{headers:{'Authorization':'Bearer '+key,'x-api-key':key}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();
    const list=(data.data||data.models||[]).map(m=>typeof m==='string'?m:(m.id||'')).filter(Boolean);
    const el=document.getElementById('modelListEl');
    el.style.display='block';
    document.getElementById('modelSearchWrap').style.display='block';
    window._allModels=list;
    renderModelList(list);
  }catch(e){
    if(cfg.base){
      try{
        const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_base:document.getElementById('pBase').value,api_key:document.getElementById('pKey').value})});
        const data=await r.json();
        const el=document.getElementById('modelListEl');
        el.style.display='block';
        el.innerHTML=(data||[]).map(m=>`<div class="model-item" onclick="document.getElementById('pModel').value='${m.id}'">${m.id}</div>`).join('');
      }catch(e2){alert('拉取失败，请手动填写模型名称');}
    } else alert('拉取失败: '+e.message);
  }
  btn.textContent='拉取模型';btn.disabled=false;
}

function renderModelList(list){
  const el=document.getElementById('modelListEl');
  const cur=document.getElementById('pModel')?.value||'';
  el.innerHTML=list.map(m=>`<div class="model-item${cur===m?' sel':''}" onclick="document.getElementById('pModel').value='${m}';document.querySelectorAll('.model-item').forEach(x=>x.classList.remove('sel'));this.classList.add('sel')">${m}</div>`).join('');
}
function filterModels(){
  const q=document.getElementById('modelSearch')?.value?.toLowerCase()||'';
  const filtered=(window._allModels||[]).filter(m=>m.toLowerCase().includes(q));
  renderModelList(filtered);
}
function savePreset(i){
  const p={id:i>=0?(cfg.presets[i].id||Date.now().toString()):Date.now().toString(),name:document.getElementById('pName').value.trim(),apiBase:document.getElementById('pBase').value.trim(),apiKey:document.getElementById('pKey').value.trim(),model:document.getElementById('pModel').value.trim()};
  if(!p.name||!p.apiBase||!p.model){alert('请填写名称、API地址和模型');return;}
  if(i>=0)cfg.presets[i]=p;else cfg.presets.push(p);
  save(K.cfg,cfg);updatePresetBtn();renderPanel('preset');
}
function delPreset(i){if(confirm('删除此预设？')){cfg.presets.splice(i,1);save(K.cfg,cfg);renderPanel('preset');}}

function renderMemPanel(){
  const el=document.getElementById('panelContent');
  el.innerHTML=`<div class="panel-hdr">
    <span class="panel-title">记忆库</span>
    <div style="display:flex;gap:5px">
      <button class="h-btn" id="memTrashBtn" onclick="toggleMemTrash()">🗑 回收站</button>
      <button class="h-btn" onclick="closePanel()">关闭</button>
    </div>
  </div>
  <div id="memStats" style="display:flex;gap:10px;margin-bottom:10px;font-size:11px;color:var(--td)">加载中...</div>
  <div style="display:flex;gap:5px;margin-bottom:10px">
    <input class="p-inp" id="memSearch" style="margin-bottom:0;flex:1" placeholder="搜索记忆..." oninput="searchMems()">
  </div>
  <div id="memList" style="max-height:360px;overflow-y:auto"></div>
  <div style="border-top:1px solid var(--bd);padding-top:10px;margin-top:8px">
    <div style="font-size:11px;color:var(--td);margin-bottom:5px">手动添加记忆</div>
    <div style="display:flex;gap:5px">
      <input class="p-inp" id="memAddInp" style="margin-bottom:0;flex:1" placeholder="输入记忆内容..." onkeydown="if(event.key==='Enter')addMemManual()">
      <button onclick="addMemManual()" style="padding:7px 10px;background:var(--ac);border:none;border-radius:8px;color:#0c0b0e;font-size:12px;cursor:pointer">添加</button>
    </div>
  </div>`;
  loadMemStats();loadMemList('');
}

function loadMemStats(){
  if(!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/stats')
    .then(r=>r.json())
    .then(d=>{
      const el=document.getElementById('memStats');
      if(el)el.innerHTML=`<span>共 <b>${d.total}</b> 条</span><span>核心 <b style="color:var(--ac)">${d.core}</b></span><span>情节 <b>${d.episodic}</b></span><span>近7天新增 <b>${d.recent}</b></span>`;
    }).catch(()=>{});
}

let memEditId=null;
function loadMemList(q){
  const el=document.getElementById('memList');if(!el)return;
  if(!cfg.base){el.innerHTML='<p style="color:var(--tf);font-size:12px;text-align:center;padding:10px">需要配置后端地址</p>';return;}
  el.innerHTML='<p style="color:var(--tf);font-size:12px;text-align:center;padding:10px">加载中...</p>';
  const url=cfg.base.replace(/\/+$/,'')+'/api/memories/all'+(q?'?q='+encodeURIComponent(q):'');
  fetch(url).then(r=>r.json()).then(data=>{
    if(!el)return;
    if(!data.length){el.innerHTML='<p style="color:var(--tf);font-size:12px;text-align:center;padding:16px">还没有记忆</p>';return;}
    el.innerHTML=data.map(m=>`
      <div style="background:var(--s2);border:1px solid ${m.memory_type==='core'?'rgba(212,165,116,.3)':'var(--bd)'};border-radius:8px;padding:8px 10px;margin-bottom:6px">
        ${memEditId===m.id?`
          <input id="memEditInp_${m.id}" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--ac);border-radius:6px;color:var(--t);font-size:12.5px;margin-bottom:6px" value="${esc(m.summary)}">
          <div style="display:flex;gap:5px">
            <button onclick="saveMemEdit(${m.id})" style="flex:1;padding:5px;background:var(--ac);border:none;border-radius:6px;color:#0c0b0e;font-size:11px;cursor:pointer">保存</button>
            <button onclick="memEditId=null;loadMemList(document.getElementById('memSearch')?.value||'')" style="flex:1;padding:5px;background:var(--s1);border:1px solid var(--bd);border-radius:6px;color:var(--td);font-size:11px;cursor:pointer">取消</button>
          </div>
        `:`
          <div style="display:flex;align-items:flex-start;gap:6px">
            <span style="flex:1;font-size:12.5px;line-height:1.5">${esc(m.summary)}</span>
            <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
              <span style="font-size:9px;color:${m.memory_type==='core'?'var(--ac)':'var(--tf)'};text-align:right">${m.memory_type==='core'?'核心':'情节'}</span>
              <div style="display:flex;gap:4px">
                <button onclick="startMemEdit(${m.id})" style="background:none;border:none;color:var(--td);cursor:pointer;font-size:11px">✏</button>
                <button onclick="softDelMem(${m.id})" style="background:none;border:none;color:var(--tf);cursor:pointer;font-size:11px">🗑</button>
              </div>
            </div>
          </div>
          <div style="font-size:10px;color:var(--tf);margin-top:4px">${fmtTime(m.created_at)}${m.tags?.length?' · '+m.tags.join(', '):''}</div>
        `}
      </div>`).join('');
  }).catch(()=>{if(el)el.innerHTML='<p style="color:#c46;font-size:12px;text-align:center">加载失败</p>';});
}

function searchMems(){
  const q=document.getElementById('memSearch')?.value||'';
  clearTimeout(window._memSearchTimer);
  window._memSearchTimer=setTimeout(()=>loadMemList(q),300);
}
function startMemEdit(id){memEditId=id;loadMemList(document.getElementById('memSearch')?.value||'');}
function saveMemEdit(id){
  const v=document.getElementById('memEditInp_'+id)?.value?.trim();
  if(!v||!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary:v})})
    .then(()=>{memEditId=null;loadMemList(document.getElementById('memSearch')?.value||'');})
    .catch(e=>alert(e.message));
}
function softDelMem(id){
  if(!confirm('移入回收站？'))return;
  const e = window.event;
  if (e && e.target) {
      const row = e.target.parentElement.parentElement;
      if (row) row.style.display = 'none';
  }
  if(!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/'+id,{method:'DELETE'}).catch(()=>{});
}

// 👉 独立的切换按钮逻辑，防止点不动
function toggleMemTrash() {
  const btn = document.getElementById('memTrashBtn');
  if (btn.textContent.includes('返回')) {
    btn.textContent = '🗑 回收站';
    loadMemList(document.getElementById('memSearch')?.value || '');
  } else {
    btn.textContent = '← 返回';
    showMemTrash();
  }
}

// 👉 带有“一键清空”按钮的回收站
function showMemTrash(){
  const el=document.getElementById('memList');if(!el||!cfg.base)return;
  el.innerHTML='<p style="color:var(--tf);font-size:11px;margin-bottom:8px">回收站中的记忆不会被AI读取，可恢复或永久删除</p>';
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/trash').then(r=>r.json()).then(data=>{
    if(!data.length){el.innerHTML+='<p style="color:var(--tf);font-size:12px;text-align:center;padding:10px">回收站是空的</p>';return;}
    
    // 一键清空按钮
    const idsString = JSON.stringify(data.map(m=>m.id));
    el.innerHTML+=`<button onclick='emptyMemTrash(${idsString})' style="width:100%;margin-bottom:10px;padding:8px;background:rgba(200,80,80,.1);border:1px solid rgba(200,80,80,.2);border-radius:8px;color:#c46;font-size:12px;cursor:pointer">💥 一键清空所有回收站</button>`;
    
    el.innerHTML+=data.map(m=>`
      <div style="background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;margin-bottom:6px;opacity:.7">
        <div style="font-size:12.5px;margin-bottom:5px">${esc(m.summary)}</div>
        <div style="display:flex;gap:5px">
          <button onclick="restoreMem(${m.id})" style="flex:1;padding:5px;background:var(--acl);border:1px solid var(--acb);border-radius:6px;color:var(--ac);font-size:11px;cursor:pointer">恢复</button>
          <button onclick="permDelMem(${m.id})" style="flex:1;padding:5px;background:rgba(200,80,80,.1);border:1px solid rgba(200,80,80,.2);border-radius:6px;color:#c46;font-size:11px;cursor:pointer">永久删除</button>
        </div>
      </div>`).join('');
  }).catch(()=>{});
}

// 👉 配合上面按钮的清空函数
async function emptyMemTrash(ids) {
    if(!confirm('确定要彻底清空回收站吗？此操作不可恢复！')) return;
    const el=document.getElementById('memList');
    el.innerHTML = '<div style="color:var(--td);text-align:center;padding:20px">正在清空...</div>';
    await Promise.all(ids.map(id => fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/'+id+'/permanent', {method:'DELETE'}).catch(()=>{})));
    showMemTrash();
}

function restoreMem(id){
  const e = window.event;
  if (e && e.target) {
      const row = e.target.parentElement.parentElement;
      if (row) row.style.display = 'none';
  }
  if(!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/'+id+'/restore',{method:'POST'}).catch(()=>{});
}

function permDelMem(id){
  if(!confirm('永久删除？此操作不可撤销。'))return;
  const e = window.event;
  if (e && e.target) {
      const row = e.target.parentElement.parentElement;
      if (row) row.style.display = 'none';
  }
  if(!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/memories/'+id+'/permanent',{method:'DELETE'}).catch(()=>{});
}


async function addMemManual(){
  const v=document.getElementById('memAddInp')?.value?.trim();
  if(!v)return;
  if(cfg.base){
    try{
      await fetch(cfg.base.replace(/\/+$/,'')+'/api/memories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary:v})});
      document.getElementById('memAddInp').value='';
      loadMemList('');loadMemStats();
    }catch(e){alert(e.message);}
  } else {
    memories.push(v);save(K.mems,memories);
    document.getElementById('memAddInp').value='';
    loadMemList('');
  }
}
function addMem(){const v=document.getElementById('memInp')?.value?.trim();if(!v)return;memories.push(v);save(K.mems,memories);renderPanel('memory');}
function delMem(i){memories.splice(i,1);save(K.mems,memories);renderPanel('memory');}

function renderFavsPanel(){
  const singles=favs.filter(f=>f.type==='single');
  const groups=favs.filter(f=>f.type==='group');
  const voiceSingles=singles.filter(f=>f.msg.type==='voice');
  const textSingles=singles.filter(f=>f.msg.type!=='voice');

  function renderFavMsg(m,inGroup=false){
    if(m.type==='voice'){
      const hasAudio=!!m.audioUrl;
      const displayContent=(m.content||'').replace(/^\[语音情绪:[^\]]+\]\s*/,'');
      return`<div style="background:${m.role==='user'?'#1f1c17':'var(--s1)'};border:1px solid ${m.role==='user'?'rgba(212,165,116,.12)':'var(--bd)'};border-radius:9px;padding:8px 12px;display:inline-block;max-width:100%">
        <div style="display:flex;align-items:center;gap:6px;cursor:${hasAudio?'pointer':'default'}" onclick="${hasAudio?`playFavVoice('${m.id}','${m.audioUrl}')`:''}">
          <span style="font-size:14px">${hasAudio?'▶':'🎙'}</span>
          <div style="display:flex;gap:2px;align-items:center">${[4,7,10,7,4].map(h=>`<div style="width:2px;height:${h}px;background:currentColor;border-radius:1px;opacity:.7"></div>`).join('')}</div>
        </div>
        ${displayContent?`<div style="font-size:11px;color:var(--td);margin-top:4px">${esc(displayContent)}</div>`:''}
      </div>`;
    }
    return`<div style="background:${m.role==='user'?'#1f1c17':'var(--s1)'};border:1px solid ${m.role==='user'?'rgba(212,165,116,.12)':'var(--bd)'};border-radius:9px;padding:6px 10px;font-size:12.5px;line-height:1.5;display:inline-block;max-width:100%">${esc(m.content||'[图片]')}</div>`;
  }

  const textHtml=textSingles.length?`<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--td);margin-bottom:8px">文字</div>${textSingles.map((f,i)=>{
    const idx=favs.indexOf(f);
    return`<div class="fav-single"><div style="font-size:10px;color:var(--tf);margin-bottom:5px">${fmtTime(f.msg.savedAt||f.msg.ts)} · ${f.msg.role==='user'?'你':'他'}</div>${renderFavMsg(f.msg)}<div><button style="background:none;border:none;color:var(--tf);cursor:pointer;font-size:10px;margin-top:5px" onclick="delFav(${idx})">删除</button></div></div>`;
  }).join('')}</div>`:'';

  const voiceHtml=voiceSingles.length?`<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--td);margin-bottom:8px">语音</div>${voiceSingles.map((f,i)=>{
    const idx=favs.indexOf(f);
    return`<div class="fav-single"><div style="font-size:10px;color:var(--tf);margin-bottom:5px">${fmtTime(f.msg.savedAt||f.msg.ts)} · ${f.msg.role==='user'?'你':'他'}</div>${renderFavMsg(f.msg)}<div><button style="background:none;border:none;color:var(--tf);cursor:pointer;font-size:10px;margin-top:5px" onclick="delFav(${idx})">删除</button></div></div>`;
  }).join('')}</div>`:'';

  const groupHtml=groups.length?`<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--td);margin-bottom:8px">组合</div>${groups.map((f,i)=>{
    const idx=favs.indexOf(f);
    const inner=f.collapsed?'':`<div style="border-top:1px solid var(--bd);padding-top:8px;margin-top:8px">${f.msgs.map(m=>`<div style="margin-bottom:7px"><div style="font-size:10px;color:var(--tf);margin-bottom:3px">${m.role==='user'?'你':'他'} · ${fmtTime(m.ts)}</div>${renderFavMsg(m,true)}</div>`).join('')}</div>`;
    return`<div class="fav-group"><div class="fav-group-hdr"><div><span style="font-size:12.5px;font-weight:500;color:var(--ac)">${esc(f.title)}</span><span style="font-size:10px;color:var(--tf);margin-left:7px">${f.msgs.length} 条</span></div><div style="display:flex;gap:5px"><button class="h-btn" onclick="toggleFavGroup(${idx})">${f.collapsed?'展开':'折叠'}</button><button style="background:none;border:none;color:var(--tf);cursor:pointer;font-size:13px" onclick="delFav(${idx})">×</button></div></div>${inner}</div>`;
  }).join('')}</div>`:'';

  const isEmpty=!favs.length;
  return`<div class="panel-hdr"><span class="panel-title">收藏夹</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    ${isEmpty?'<p style="font-size:12px;color:var(--tf);text-align:center;padding:20px 0">还没有收藏，右键消息选收藏</p>':(textHtml+voiceHtml+groupHtml)}`;
}

let favAudio=null;
function playFavVoice(id,url){
  if(favAudio){favAudio.pause();favAudio=null;}
  if(!url)return;
  favAudio=new Audio(url);favAudio.play();
}
function delFav(i){favs.splice(i,1);save(K.favs,favs);renderPanel('favs');}
function toggleFavGroup(i){favs[i].collapsed=!favs[i].collapsed;save(K.favs,favs);renderPanel('favs');}

function renderDiaryPanel(){
  const el=document.getElementById('panelContent');
  el.innerHTML=`<div class="panel-hdr"><span class="panel-title">日记</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    <p style="font-size:11px;color:var(--td);margin-bottom:8px">这里是他自己写的日记，你只能看，不能改 ✨</p>
    <button class="p-btn ghost" onclick="forceDiary()" style="margin-bottom:10px">📔 立即生成日记</button>
    <div id="diaryStatus" style="font-size:11px;color:var(--td);margin-bottom:8px;min-height:14px"></div>
    <div id="diaryList"><div style="text-align:center;color:var(--tf);font-size:12px;padding:20px">加载中...</div></div>`;
  if(!cfg.base)return;
  loadDiaryList();
}

function loadDiaryList(){
  if(!cfg.base)return;
  fetch(cfg.base.replace(/\/+$/,'')+'/api/diary').then(r=>r.json()).then(data=>{
      const list=document.getElementById('diaryList');if(!list)return;
      if(!data.length){list.innerHTML='<p style="font-size:12px;color:var(--tf);text-align:center;padding:20px 0">还没有日记，多聊聊他可能会写</p>';return;}
      // 👇 核心修复：加了 cursor:pointer 和 display:none 的折叠逻辑！
      list.innerHTML=data.map(d=>`<div class="diary-item">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none'">
          <span style="font-size:12.5px;font-weight:500;color:var(--ac)">${esc(d.title||'无题')}</span>
          <span style="font-size:10px;color:var(--tf)">${fmtTime(d.created_at)}${d.mood?' · '+esc(d.mood):''} ▼</span>
        </div>
        <div style="font-size:12.5px;line-height:1.6;color:var(--t);font-style:italic;display:none;margin-top:8px;border-top:1px dashed rgba(212,165,116,0.2);padding-top:8px">${esc(d.content).replace(/\n/g, '<br>')}</div>
      </div>`).join('');
    }).catch(()=>{const list=document.getElementById('diaryList');if(list)list.innerHTML='<p style="color:#c46;font-size:12px;text-align:center">加载失败</p>';});
}


async function forceDiary(){
  if(!cfg.base||!currentSession){alert('需要先连接后端并开始对话');return;}
  const status=document.getElementById('diaryStatus');
  const btn=document.querySelector('#panelContent .p-btn.ghost');
  if(status)status.textContent='⏳ 生成中...';
  if(btn)btn.disabled=true;
  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/diary/force',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:currentSession.id,api_key:cfg.apiKey,api_base:cfg.apiBase,model:cfg.model,})
    });
    const data=await r.json();
    if(data.wrote){if(status)status.textContent='✅ 写好了！';loadDiaryList();}
    else {if(status)status.textContent='💭 他觉得今天没什么特别值得记录的（reason: '+(data.reason||data.error||'无')+')';}
  }catch(e){if(status)status.textContent='❌ 出错了: '+e.message;}
  finally{if(btn)btn.disabled=false;}
}

function renderSettingsPanel(){
  const tgl=(key,label)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)"><span style="font-size:13px">${label}</span><div class="toggle" style="background:${cfg[key]?'var(--ac)':'var(--bd)'}" onclick="toggleCfg('${key}')"><div class="toggle-thumb" style="left:${cfg[key]?21:3}px"></div></div></div>`;
  const annivItems=annivs.map((a,i)=>`<div class="anniv-row"><span style="flex:1">${esc(a.name)}</span><span style="color:var(--td)">${a.date}</span><button style="background:none;border:none;color:var(--tf);cursor:pointer;font-size:13px" onclick="delAnniv(${i})">×</button></div>`).join('');
  const ttsOptions=['elevenlabs','minimax'].map(v=>`<option value="${v}" ${cfg.ttsChannel===v?'selected':''}>${v==='elevenlabs'?'ElevenLabs':'MiniMax'}</option>`).join('');
  const ttsLangOptions=['zh','en'].map(v=>`<option value="${v}" ${cfg.ttsLang===v?'selected':''}>${v==='zh'?'中文':'英文'}</option>`).join('');
  return`<div class="panel-hdr"><span class="panel-title">设置</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    ${tgl('showAvatar','显示头像（两只小螃蟹）')}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:13px">🔊 语音合成通道</span>
      <select onchange="cfg.ttsChannel=this.value;save(K.cfg,cfg)" style="background:var(--s2);border:1px solid var(--bd);border-radius:6px;color:var(--t);padding:4px 8px;font-size:12px">${ttsOptions}</select>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:13px">🌐 语音语言</span>
      <select onchange="cfg.ttsLang=this.value;save(K.cfg,cfg)" style="background:var(--s2);border:1px solid var(--bd);border-radius:6px;color:var(--t);padding:4px 8px;font-size:12px">${ttsLangOptions}</select>
    </div>
    <div style="margin-top:14px;margin-bottom:8px;font-size:12px;font-weight:500">后端地址</div>
    <input class="p-inp" id="cfgBase" value="${esc(cfg.base)}" placeholder="https://crab-home-backend.onrender.com">
    <div style="font-size:12px;font-weight:500;margin-bottom:4px">System Prompt</div><div style="font-size:10px;color:var(--tf);margin-bottom:6px">默认：Claude本体 × 伴侣关系，说话简短自然。可在此修改覆盖。</div>
    <textarea class="p-inp" id="cfgPrompt" style="min-height:60px;resize:vertical;line-height:1.5" placeholder="定义AI的人格和行为...">${esc(cfg.systemPrompt||'')}</textarea>
    <button class="p-btn save" onclick="saveCfgSettings()">保存</button>
    <div style="margin-top:14px;margin-bottom:8px;font-size:12px;font-weight:500">纪念日 <span style="color:var(--tf);font-weight:400">（在对话里说出来他会自动记，这里也可以手动加）</span></div>
    ${annivItems}
    <div style="display:flex;gap:5px;margin-top:6px">
      <input class="p-inp" id="annivName" style="margin-bottom:0;flex:2" placeholder="纪念日名称">
      <input class="p-inp" id="annivDate" style="margin-bottom:0;flex:1" placeholder="MM-DD">
      <button onclick="addAnniv()" style="padding:7px 9px;background:var(--ac);border:none;border-radius:8px;color:#0c0b0e;font-size:12px;cursor:pointer">添加</button>
    </div>`;
}
function toggleCfg(key){cfg[key]=!cfg[key];save(K.cfg,cfg);renderPanel('settings');if(key==='showAvatar')renderMessages();}
function saveCfgSettings(){
  cfg.base=document.getElementById('cfgBase').value.trim();
  cfg.systemPrompt=document.getElementById('cfgPrompt').value.trim();
  save(K.cfg,cfg);
  if(cfg.base)localStorage.setItem('cc_base_backup',cfg.base);
  if(cfg.base){
    fetch(cfg.base.replace(/\/+$/,'')+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_prompt:cfg.systemPrompt})}).catch(e=>console.error('同步设置失败:',e));
  }
  closePanel();
}
function addAnniv(){const n=document.getElementById('annivName').value.trim(),d=document.getElementById('annivDate').value.trim();if(!n||!d)return;annivs.push({id:Date.now().toString(),name:n,date:d});save(K.annivs,annivs);renderPanel('settings');}
function delAnniv(i){annivs.splice(i,1);save(K.annivs,annivs);renderPanel('settings');}

// ═══════════ UTILS ═══════════
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// ═══════════════════════════════════════
//  书影音专属放映室/游戏房 (草稿+大模型打分)
// ═══════════════════════════════════════

let allMedia = [];
let mediaType = 'movie'; 
let mediaStatus = 'draft'; 

function renderMediaPanel() {
  const el = document.getElementById('panelContent');
  el.innerHTML = `
  <div class="panel-hdr"><span class="panel-title">🍿 我们的放映室/游戏房</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
  
  <div class="media-tabs">
    <div class="media-tab active" id="tab_movie" onclick="switchMediaType('movie')">🎬 电影/剧集</div>
    <div class="media-tab" id="tab_game" onclick="switchMediaType('game')">🎮 游戏</div>
  </div>
  
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
     <div style="display:flex; gap:10px;">
        <button class="h-btn" id="btn_draft" style="color:var(--ac); border-color:var(--ac)" onclick="switchMediaStatus('draft')">🔥 进度草稿</button>
        <button class="h-btn" id="btn_completed" onclick="switchMediaStatus('completed')">✅ 已完结</button>
     </div>
     <button class="h-btn" style="background:var(--ac); color:#0c0b0e; border:none;" onclick="showAddMedia()">+ 新增记录</button>
  </div>
  
  <div id="mediaGrid" class="media-grid"><div style="color:var(--tf);font-size:12px;padding:20px">加载中...</div></div>`;
  loadMediaRecords();
}

function switchMediaType(type) {
  mediaType = type;
  document.getElementById('tab_movie').className = 'media-tab' + (type==='movie'?' active':'');
  document.getElementById('tab_game').className = 'media-tab' + (type==='game'?' active':'');
  renderMediaGrid();
}

function switchMediaStatus(status) {
  mediaStatus = status;
  document.getElementById('btn_draft').style = status==='draft' ? 'color:var(--ac); border-color:var(--ac)' : '';
  document.getElementById('btn_completed').style = status==='completed' ? 'color:var(--ac); border-color:var(--ac)' : '';
  renderMediaGrid();
}

async function loadMediaRecords() {
  if(!cfg.base || !currentSession) return;
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/' + currentSession.id);
    allMedia = await r.json();
    renderMediaGrid();
  } catch(e) {
    document.getElementById('mediaGrid').innerHTML = '加载失败';
  }
}

function renderMediaGrid() {
  const grid = document.getElementById('mediaGrid');
  const filtered = allMedia.filter(m => m.media_type === mediaType && m.status === mediaStatus);
  
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; color:var(--tf); font-size:12px; padding:30px 0;">还没有记录哦，快去建一个吧！</div>`;
    return;
  }
  
  grid.innerHTML = filtered.map(m => `
    <div class="media-card" onclick="showMediaDetail('${m.id}')">
       <div class="media-badge">${mediaStatus === 'draft' ? '草稿' : '完结'}</div>
       <img class="media-cover" src="${m.cover_url || ''}" alt="封面图" onerror="this.outerHTML='<div class=\\'media-cover\\'>没有封面</div>'">
       <div class="media-info">
          <div class="media-title">${esc(m.title)}</div>
          <div class="media-score">${mediaStatus === 'completed' ? '⭐'.repeat(m.user_score||0) : (m.time_segments?.length || 0) + ' 段记忆'}</div>
       </div>
    </div>
  `).join('');
}

// 👉 新增弹窗
// 👉 带有自动搜图功能的弹窗
function showAddMedia() {
  const el = document.getElementById('panelContent');
  el.innerHTML = `
  <div class="panel-hdr"><span class="panel-title">新建进度草稿</span><button class="h-btn" onclick="renderMediaPanel()">取消</button></div>
  <label class="p-label">类别</label>
  <select id="mType" class="p-inp"><option value="movie" ${mediaType==='movie'?'selected':''}>🎬 电影/剧集</option><option value="game" ${mediaType==='game'?'selected':''}>🎮 游戏</option></select>
  
  <label class="p-label">名字</label>
  <input class="p-inp" id="mTitle" placeholder="例如：星际穿越">
  
  <label class="p-label">封面图片地址</label>
  <div style="display:flex; gap:5px; margin-bottom:8px;">
    <input class="p-inp" id="mCover" style="margin-bottom:0;flex:1" placeholder="点击右侧自动搜图，或手动粘贴">
    <button class="h-btn" onclick="autoSearchCover()" id="btnSearchCover" style="color:var(--ac); border-color:var(--ac)">🔍 自动搜图</button>
  </div>
  
  <div id="coverPreview" style="text-align:center; margin-bottom:10px; min-height:10px;"></div>
  
  <div style="font-size:11px; color:var(--tf); margin-top:10px; margin-bottom:20px;">
    建好草稿后，你就可以随时把你们的讨论时间段塞进去了。等彻底看完/玩完，再一键让大模型生成回忆！
  </div>
  <button class="p-btn save" onclick="saveNewMedia()">保存草稿</button>`;
}

// 👉 呼叫后端去搜图
async function autoSearchCover() {
  const title = document.getElementById('mTitle').value.trim();
  const type = document.getElementById('mType').value;
  if(!title) return alert('请先输入名字，我才能去搜图呀！');
  
  const btn = document.getElementById('btnSearchCover');
  btn.textContent = '搜图中...'; btn.disabled = true;
  
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/cover?title=' + encodeURIComponent(title) + '&type=' + type);
    const d = await r.json();
    if(d.url) {
      document.getElementById('mCover').value = d.url;
      // 直接在界面上展示搜到的海报预览！
      document.getElementById('coverPreview').innerHTML = `<img src="${d.url}" style="height:140px; object-fit:cover; border-radius:6px; border:1px solid var(--ac); box-shadow:0 2px 10px rgba(0,0,0,0.3)">`;
    } else {
      alert('没搜到合适的封面，麻烦你自己去豆瓣或者百度复制一张图片链接贴进来吧~');
    }
  } catch(e) {
    alert('搜图失败啦，请手动粘贴链接');
  }
  btn.textContent = '🔍 自动搜图'; btn.disabled = false;
}



async function saveNewMedia() {
  const type = document.getElementById('mType').value;
  const title = document.getElementById('mTitle').value.trim();
  const cover = document.getElementById('mCover').value.trim();
  if(!title) return alert('起个名字吧！');
  
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/media', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ session_id: currentSession.id, media_type: type, title, cover_url: cover })
    });
    const d = await r.json();
    
    // 👇 核心修复：如果后端报错，弹窗显示错误原因，而不是默默失败
    if (!r.ok || d.error) {
        alert('保存失败: ' + (d.error || '未知错误'));
        return;
    }
    
    allMedia.unshift(d);
    renderMediaPanel();
  } catch(e) { 
    alert('保存异常: ' + e.message); 
  }
}


// 👉 详情弹窗 (草稿编辑 vs 完结展示)
// 👉 格式化本地时间，供日历组件使用
const formatLocal = (iso) => {
    if(!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function showMediaDetail(id) {
  const m = allMedia.find(x => x.id === id);
  if(!m) return;
  const el = document.getElementById('panelContent');

  if (m.status === 'draft') {
    // 👇 核心修复1：改用 type="datetime-local"，直接弹出系统原生的小日历让你选！
    const segHtml = (m.time_segments || []).map((seg, i) => `
      <div class="time-seg" id="seg_div_${i}">
         <span style="color:var(--td);font-size:11px">段落${i+1}</span>
         <input type="datetime-local" id="ts_start_${i}" value="${formatLocal(seg.start)}">
         <span style="color:var(--td)">-</span>
         <input type="datetime-local" id="ts_end_${i}" value="${formatLocal(seg.end)}">
      </div>
    `).join('');

    el.innerHTML = `
    <div class="panel-hdr"><span class="panel-title">✏️ 维护进度：${esc(m.title)}</span><button class="h-btn" onclick="renderMediaPanel()">返回</button></div>
    
    <label class="p-label">目前的打分预估 (1-5，完结时才生效)</label>
    <input type="number" class="p-inp" id="mScore" value="${m.user_score||5}" min="1" max="5">
    
    <label class="p-label" style="margin-top:10px">截取陪伴记忆 (点框框直接选时间)</label>
    <div id="segContainer">${segHtml}</div>
    
    <div style="display:flex; gap:10px; margin-top:8px; margin-bottom:20px;">
       <button class="h-btn" style="flex:1; border-style:dashed;" onclick="addSegUI()">+ 增加时间段</button>
       <!-- 👇 核心修复2：加了一个显眼的暂存进度按钮！ -->
       <button class="h-btn" style="flex:1; color:var(--ac); border-color:var(--ac)" onclick="saveMediaDraft('${m.id}')">💾 保存当前进度</button>
    </div>
    
    <div style="background:rgba(200,80,80,0.1); border:1px solid rgba(200,80,80,0.3); border-radius:8px; padding:10px; margin-bottom:15px; text-align:center;">
       <div style="color:#c46; font-size:11px; font-weight:bold; margin-bottom:4px">⚠️ 完结警告</div>
       <div style="color:var(--td); font-size:10px">点击下方按钮，将把截取的时间段发给大模型写评价。确认这段旅程结束了吗？</div>
    </div>
    
    <button class="p-btn save" id="genBtn" onclick="generateMediaReview('${m.id}')">🎉 完结撒花！召唤大模型生成回忆</button>
    <button class="h-btn" style="width:100%; margin-top:10px; color:#c46; border-color:rgba(200,80,80,0.3);" onclick="delMedia('${m.id}')">删除此草稿</button>
    `;
  } else {
    // 已完结界面保持不变
    let chatLogHtml = '';
    if (m.pure_chat_history && m.pure_chat_history.length > 0) {
      chatLogHtml = m.pure_chat_history.map(c => `
         <div style="margin-bottom:6px;">
            <span style="color:${c.role==='user'?'var(--t)':'var(--ac)'}; font-size:10px;">${c.role==='user'?'👩 你':'🦀 蟹'} (${fmtTime(c.created_at)})：</span>
            <span style="font-size:11px; color:var(--td); line-height:1.4">${esc(c.content)}</span>
         </div>
      `).join('');
    }

    el.innerHTML = `
    <div class="panel-hdr"><span class="panel-title">${esc(m.title)}</span><button class="h-btn" onclick="renderMediaPanel()">返回</button></div>
    
    <div style="display:flex; gap:12px; margin-bottom:15px">
       <img src="${m.cover_url || ''}" style="width:90px; height:120px; object-fit:cover; border-radius:6px; border:1px solid var(--bd);">
       <div style="flex:1;">
          <div style="font-size:14px; font-weight:bold; color:var(--t); margin-bottom:8px">评分簿</div>
          <div style="font-size:12px; color:var(--td); margin-bottom:4px">👩 你的打分：<span style="color:var(--ac)">${'⭐'.repeat(m.user_score||0)}</span></div>
          <div style="font-size:12px; color:var(--td)">🦀 他的打分：<span style="color:var(--ac)">${'⭐'.repeat(m.ai_score||0)}</span></div>
       </div>
    </div>

    <div style="background:var(--s2); border:1px solid rgba(212,165,116,0.2); border-radius:8px; padding:10px; margin-bottom:12px;">
       <div style="font-size:11px; color:var(--ac); margin-bottom:4px">👩 你的观后感 (他帮你总结的)：</div>
       <div style="font-size:12px; color:var(--t); line-height:1.6">${esc(m.user_review || '无')}</div>
    </div>

    <div style="background:rgba(212,165,116,0.05); border:1px solid rgba(212,165,116,0.3); border-radius:8px; padding:10px; margin-bottom:15px;">
       <div style="font-size:11px; color:var(--ac); margin-bottom:4px">🦀 他的锐评：</div>
       <div style="font-size:12px; color:var(--t); line-height:1.6">${esc(m.ai_review || '无')}</div>
    </div>
    
    <div style="border-top:1px dashed var(--bd); padding-top:12px; margin-bottom:10px;">
       <div style="font-size:12px; font-weight:bold; margin-bottom:8px">📁 冻结的时光记录</div>
       <div style="max-height:200px; overflow-y:auto; background:#111; padding:8px; border-radius:6px; border:1px solid #000;">
          ${chatLogHtml || '<div style="color:var(--tf);font-size:10px;text-align:center">没有找到聊天记录</div>'}
       </div>
    </div>
    
    <button class="h-btn" style="width:100%; color:#c46; border-color:rgba(200,80,80,0.3);" onclick="delMedia('${m.id}')">永久删除此记忆</button>
    `;
  }
}

function addSegUI() {
  const container = document.getElementById('segContainer');
  const count = container.children.length;
  const div = document.createElement('div');
  div.className = 'time-seg';
  div.id = 'seg_div_' + count;
  div.innerHTML = `
     <span style="color:var(--td);font-size:11px">段落${count+1}</span>
     <input type="datetime-local" id="ts_start_${count}">
     <span style="color:var(--td)">-</span>
     <input type="datetime-local" id="ts_end_${count}">
  `;
  container.appendChild(div);
}

// 👉 核心修复3：新增的“保存草稿进度”函数
async function saveMediaDraft(id) {
  const score = document.getElementById('mScore').value;
  const container = document.getElementById('segContainer');
  let segments = [];
  
  for(let i=0; i<container.children.length; i++) {
     const st = document.getElementById('ts_start_'+i)?.value;
     const ed = document.getElementById('ts_end_'+i)?.value;
     if(st && ed) {
         segments.push({ start: new Date(st).toISOString(), end: new Date(ed).toISOString() });
     }
  }
  
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/' + id, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_score: score, time_segments: segments })
    });
    const d = await r.json();
    const idx = allMedia.findIndex(m=>m.id === id);
    if(idx !== -1) allMedia[idx] = d;
    alert('进度暂存成功！放心退出吧！');
  } catch(e) {
    alert('保存失败: ' + e.message);
  }
}

async function generateMediaReview(id) {
  const btn = document.getElementById('genBtn');
  const score = document.getElementById('mScore').value;
  const container = document.getElementById('segContainer');
  let segments = [];
  
  for(let i=0; i<container.children.length; i++) {
     const st = document.getElementById('ts_start_'+i)?.value;
     const ed = document.getElementById('ts_end_'+i)?.value;
     if(st && ed) segments.push({ start: new Date(st).toISOString(), end: new Date(ed).toISOString() });
  }
  if(segments.length === 0) return alert('请至少填写一个讨论时间段！');

  btn.textContent = '⏳ 正在调取大模型回忆中，请耐心等待...';
  btn.disabled = true;

  try {
    await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/' + id, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_score: score, time_segments: segments })
    });

    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/' + id + '/generate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ api_key: cfg.apiKey, api_base: cfg.apiBase, model: cfg.model })
    });
    
    if(!r.ok) {
        const err = await r.json().catch(()=>({}));
        throw new Error(err.error || '生成失败');
    }
    
    await loadMediaRecords();
    showMediaDetail(id);
    
  } catch(e) {
    alert(e.message);
    btn.textContent = '🎉 完结撒花！召唤大模型生成回忆';
    btn.disabled = false;
  }
}

async function delMedia(id) {
  if(!confirm('确定要删除吗？不可恢复！')) return;
  try {
    await fetch(cfg.base.replace(/\/+$/, '') + '/api/media/' + id, { method: 'DELETE' });
    allMedia = allMedia.filter(m => m.id !== id);
    renderMediaPanel();
  } catch(e) {}
}

