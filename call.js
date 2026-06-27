// ═══════════════════════════════════════
//  通话系统 (完美防卡死、防闹鬼版)
// ═══════════════════════════════════════
let callActive=false,callRecognition=null,callTimerInterval=null,callSeconds=0;
let callSilenceTimer=null,callTranscriptLog=[],callSpeaking=false;
let callStartedAt=null,ringTimer=null;

let vadAudioCtx = null, vadAnalyser = null, vadStream = null, vadMic = null;
let vadRecorder = null, vadChunks = [];
let isDetectingSpeech = false, vadSilenceTimer = null, vadAnimFrame = null;
const VAD_THRESHOLD = 3; 

const SILENT_B64 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEyLjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIAD+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+AAAAAExhdmM1OC4xMgAAAAAAAAAAAAAAACQAAAAAAAAAAAEgAEiAAAAB//OEAAAAAEMASAAAAAAAQAEAAQAAAEAAoB4AAgCBAgIBAQEBAgIBAQEBAQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA=';
let globalCallAudio = new Audio();
globalCallAudio.playsInline = true;
let audioUnlocked = false;

function keepAliveAudio() {
  if(!callActive) return;
  if(globalCallAudio.src !== SILENT_B64) {
      globalCallAudio.src = SILENT_B64;
      globalCallAudio.loop = true;
      globalCallAudio.play().catch(()=>{});
  } else if (globalCallAudio.paused) {
      globalCallAudio.play().catch(()=>{});
  }
}

let pipCanvas=null, pipCtx=null, pipVideo=null;

function setupPiP() {
  if(!document.pictureInPictureEnabled || pipVideo) return;
  pipCanvas = document.createElement('canvas');
  pipCanvas.width = 300; pipCanvas.height = 300;
  pipCtx = pipCanvas.getContext('2d');
  pipVideo = document.createElement('video');
  pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.autoplay = true;
  pipVideo.style.display = 'none';
  document.body.appendChild(pipVideo);
  pipVideo.srcObject = pipCanvas.captureStream(10);
  pipVideo.play().catch(()=>{});
}

function updatePiP(status) {
  if(!pipCtx) return;
  pipCtx.fillStyle = '#1e1d23'; pipCtx.fillRect(0,0,300,300);
  pipCtx.font = '80px Arial'; pipCtx.textAlign = 'center'; pipCtx.fillText('🦀', 150, 130);
  pipCtx.font = '24px Arial'; pipCtx.fillStyle = '#d4a574'; pipCtx.fillText('我们的家', 150, 180);
  pipCtx.font = '18px Arial'; pipCtx.fillStyle = '#7d7a72'; pipCtx.fillText(status, 150, 240);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: '🦀 我们的家', artist: status, album: '语音通话' });
  }
}

function setCallStatus(txt){
  const el = document.getElementById('callStatus');
  if(el) el.textContent = txt;
  updatePiP(txt); 
}

function startCall(){
  if(callActive)return;
  if(!cfg.base){alert('需要配置后端');return;}
  
  if(!audioUnlocked) {
    globalCallAudio.src = SILENT_B64;
    globalCallAudio.loop = true;
    globalCallAudio.play().then(()=>{ audioUnlocked = true; }).catch(()=>{});
  }
  
  setupPiP();
  updatePiP('准备接通...');
  if(pipVideo && document.pictureInPictureEnabled) {
      pipVideo.requestPictureInPicture().catch(()=>{});
  }

  document.getElementById('incomingCall').style.display='block';
  document.getElementById('ringStatus').textContent='响铃中...';
  const delay=2000+Math.random()*2000;
  ringTimer=setTimeout(()=>{
    document.getElementById('ringStatus').textContent='接听中...';
    setTimeout(acceptCall,800);
  },delay);
}

function acceptCall(){
  clearTimeout(ringTimer);
  document.getElementById('incomingCall').style.display='none';
  callActive=true;callTranscriptLog=[];callSeconds=0;
  callStartedAt=new Date().toISOString();
  document.getElementById('callWindow').style.display='block';
  document.getElementById('callBtn').style.color='var(--ac)';
  
  keepAliveAudio();
  
  callTimerInterval=setInterval(()=>{
    callSeconds++;
    const m=String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s=String(callSeconds%60).padStart(2,'0');
    document.getElementById('callTimer').textContent=m+':'+s;
  },1000);
  makeDraggable(document.getElementById('callWindow'));
  const cardId='call_card_'+Date.now();
  window._callCardId=cardId;
  messages.push({id:cardId,role:'system',content:'📞 通话中',ts:new Date().toISOString(),type:'call-card',callActive:true});
  saveMessages();renderMessages();
  setCallStatus('在听...');
  startListening();
}

function rejectCall(){
  clearTimeout(ringTimer);
  document.getElementById('incomingCall').style.display='none';
  if(document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});
}

function animateCallWave(active){
  document.querySelectorAll('.cwave').forEach((el,i)=>{
    el.style.animation=active?('cwave '+(0.4+i*0.08)+'s ease-in-out infinite'):'none';
    el.style.opacity=active?'1':'0.4';
    if(!active)el.style.height='4px';
  });
}

function startListening(){
  if(!callActive||callSpeaking)return;
  // 👉 彻底抛弃自带的拉垮识别，不管电脑还是手机，全都走我们强大的 VAD 黑科技！
  startVADListening();
}


async function startVADListening() {
  if(vadStream) return;
  try {
    vadStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    vadAnalyser = vadAudioCtx.createAnalyser();
    vadAnalyser.fftSize = 512;
    vadMic = vadAudioCtx.createMediaStreamSource(vadStream);
    vadMic.connect(vadAnalyser);
    vadRecorder = new MediaRecorder(vadStream, { mimeType: 'audio/webm' });
    vadRecorder.ondataavailable = e => { if (e.data.size > 0) vadChunks.push(e.data); };
    vadRecorder.onstop = processVADAudio;
    setCallStatus('在听...');
    monitorVAD();
  } catch (e) {
    setCallStatus('麦克风权限被拒');
  }
}

function monitorVAD() {
  if (!callActive) return;
  vadAnimFrame = requestAnimationFrame(monitorVAD);
  
  if (callSpeaking || audioPlaying || (globalCallAudio && !globalCallAudio.paused && globalCallAudio.src !== SILENT_B64)) {
     if (isDetectingSpeech) {
         isDetectingSpeech = false;
         clearTimeout(vadSilenceTimer); vadSilenceTimer = null;
         const orig = vadRecorder.onstop;
         vadRecorder.onstop = null;
         if(vadRecorder.state !== 'inactive') vadRecorder.stop();
         vadRecorder.onstop = orig;
         setCallStatus('他在想...');
     }
     return;
  }

  const dataArray = new Uint8Array(vadAnalyser.frequencyBinCount);
  vadAnalyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  let avg = sum / dataArray.length;

  if (avg > VAD_THRESHOLD) {
    if (!isDetectingSpeech) {
      isDetectingSpeech = true;
      speechStartTime = Date.now(); // 记录说话开始时间
      vadChunks = [];
      if(vadRecorder.state === 'inactive') vadRecorder.start();
      setCallStatus('听你说话...');
      animateCallWave(true);
    }
    clearTimeout(vadSilenceTimer);
    vadSilenceTimer = null;

    // 👇 修复：放宽到 60000 毫秒（60秒），让你能一口气说一段长长的话！
    if (isDetectingSpeech && Date.now() - speechStartTime > 60000) {
      isDetectingSpeech = false;
      if(vadRecorder.state !== 'inactive') vadRecorder.stop();
      setCallStatus('识别中...');
      animateCallWave(false);
    }

  } else {
    if (isDetectingSpeech && !vadSilenceTimer) {
      vadSilenceTimer = setTimeout(() => {
         isDetectingSpeech = false;
         vadSilenceTimer = null;
         if(vadRecorder.state !== 'inactive') vadRecorder.stop();
         setCallStatus('识别中...');
         animateCallWave(false);
      }, 1200); // 停顿1.2秒判定你说完了
    }
  }
}


async function processVADAudio() {
  if (vadChunks.length === 0) { setCallStatus('在听...'); return; }
  const blob = new Blob(vadChunks, { type: 'audio/webm' });
  vadChunks = [];
  // 👉 降低文件体积要求，防止漏掉合法的短句
  if (blob.size < 2000) { setCallStatus('在听...'); return; }
  
  const fd = new FormData();
  fd.append('audio', blob, 'voice.webm');
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/voice/transcribe', { method: 'POST', body: fd });
    const d = await r.json();
    let txt = d.text || '';
    
    const badWords = ['字幕', '观看', '订阅', '点赞', '收藏', '三连', '频道', '谢谢', 'Thank', '欢迎', '收看', '拜拜', '由AI生成', '再见', '不客气', 'AI'];
    if (badWords.some(w => txt.includes(w)) && txt.length < 25) {
        txt = ''; 
    }
    
    if (txt.trim()) {
      setCallStatus('你：' + txt.slice(0, 12) + (txt.length > 12 ? '...' : ''));
      sendCallMessage(txt);
    } else {
      // 👉 提示没听清，而不是毫无反应
      setCallStatus('没听清...');
      setTimeout(() => { if(!callSpeaking) setCallStatus('在听...') }, 1000);
    }
  } catch (err) {
    setCallStatus('识别失败');
    setTimeout(() => { if(!callSpeaking) setCallStatus('在听...') }, 1000);
  }
}

const FILLER_WORDS=['嗯…','让我想想','这个嘛…','嗯嗯'];
let fillerAudios={};
async function preloadFillers(){
  if(!cfg.base)return;
  for(const word of FILLER_WORDS){
    try{
      const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/voice/tts',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:word,emotion:'平静',channel:cfg.ttsChannel||'minimax',lang:'zh',call_mode:true}),
      });
      if(r.ok){
        const blob=await r.blob();
        fillerAudios[word]=URL.createObjectURL(blob);
      }
    }catch(e){}
  }
}

let fillerTimer=null;
function playFiller(){
  const words=Object.keys(fillerAudios);
  if(!words.length)return;
  const url=fillerAudios[words[Math.floor(Math.random()*words.length)]];
  if(currentAudio){currentAudio.pause();currentAudio=null;}
  currentAudio=new Audio(url);
  currentAudio.play();
  currentAudio.onended=()=>{currentAudio=null;};
}

let audioQueue=[];
let audioPlaying=false;
function enqueueAudio(base64,format='mp3'){
  if (!callActive) return; // 👉 挂断后绝对不排队！防闹鬼
  audioQueue.push({base64,format});
  if(!audioPlaying)drainAudioQueue();
}
async function drainAudioQueue(){
  if(audioPlaying||!audioQueue.length) {
      if(!audioPlaying && callActive) keepAliveAudio();
      return;
  }
  if (!callActive) return; // 👉 挂断后绝对不播！

  audioPlaying=true;
  const {base64,format}=audioQueue.shift();
  try{
    const bytes=atob(base64);
    const arr=new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);
    const blob=new Blob([arr],{type:'audio/'+format});
    const url=URL.createObjectURL(blob);
    
    globalCallAudio.loop = false;
    globalCallAudio.src = url;
    
    // 👉 同时绑定 onended 和 onerror，防止任何意外卡死
    const cleanup = () => {
      globalCallAudio.onended = null;
      globalCallAudio.onerror = null;
      audioPlaying=false;
      URL.revokeObjectURL(url);
      drainAudioQueue();
    };
    
    globalCallAudio.onended = cleanup;
    globalCallAudio.onerror = cleanup;
    await globalCallAudio.play();
  }catch(e){
    audioPlaying=false;
    drainAudioQueue();
  }
}

async function sendCallMessage(text){
  if(!callActive||!text.trim())return;
  clearTimeout(callSilenceTimer);
  if(callRecognition){try{callRecognition.abort();}catch(e){}}
  callTranscriptLog.push({role:'user',content:text,ts:new Date().toISOString()});
  setCallStatus('他在想...');animateCallWave(false);callSpeaking=true;
  audioQueue=[];audioPlaying=false;

  if (Math.random() < 0.3) playFiller();

  try{
    const r=await fetch(cfg.base.replace(/\/+$/,'')+'/api/call/stream',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:currentSession?.id,content:text,model:cfg.model,api_key:cfg.apiKey,api_base:cfg.apiBase, tts_channel:cfg.ttsChannel, tts_lang:cfg.ttsLang}),
    });
    if(!r.ok)throw new Error('HTTP '+r.status);

    const reader=r.body.getReader();
    const decoder=new TextDecoder();
    let fullReply='';
    let sseBuf='';

    while(true){
      if(!callActive) break; // 👉 如果已经挂断，立刻掐断水管！防闹鬼
      const {done,value}=await reader.read();
      if(done)break;
      sseBuf+=decoder.decode(value,{stream:true});
      const parts=sseBuf.split('\n');
      sseBuf=parts.pop()||''; 
      for(const line of parts){
        if(!line.startsWith('data: '))continue;
        try{
          const evt=JSON.parse(line.slice(6));
          if(evt.type==='text'){
            setCallStatus('他：'+evt.text.slice(0,25)+(evt.text.length>25?'...':''));
            animateCallWave(true);
          } else if(evt.type==='audio'){
            enqueueAudio(evt.audio,evt.format||'mp3');
          } else if(evt.type==='done'){
            fullReply=evt.fullReply||fullReply;
          }
        }catch(e){}
      }
    }
    
    if(callActive && sseBuf.startsWith('data: ')){
      try{
        const evt=JSON.parse(sseBuf.slice(6));
        if(evt.type==='audio')enqueueAudio(evt.audio,evt.format||'mp3');
        if(evt.type==='done')fullReply=evt.fullReply||fullReply;
      }catch(e){}
    }

    if(fullReply) callTranscriptLog.push({role:'assistant',content:fullReply,ts:new Date().toISOString()});

    // 👉 终极防卡死保险：如果遇到各种奇葩断流，20秒后强行踢开播放器把麦克风给你！
    await new Promise(resolve=>{
      let waitCycles = 0;
      const check=setInterval(()=>{
        // 发现被静音骗了，或者播放器卡死，强行解脱
        if (audioPlaying && (globalCallAudio.paused || globalCallAudio.ended)) audioPlaying = false;
        
        if(!audioPlaying && audioQueue.length === 0){
          waitCycles++;
          if (waitCycles > 2) { clearInterval(check); resolve(); }
        } else {
          waitCycles = 0;
        }
      },200);
      
      setTimeout(()=>{ 
         clearInterval(check); 
         audioPlaying = false; audioQueue = []; 
         resolve(); 
      }, 20000); 
    });

  }catch(e){
    if(callActive) setCallStatus('出错了，继续说...');
  }finally{
    callSpeaking=false; animateCallWave(false);
    if(callActive) startListening();
  }
}

async function endCall(){
  if(!callActive)return;
  callActive=false;callSpeaking=false;
  clearTimeout(callSilenceTimer);clearInterval(callTimerInterval);
  if(callRecognition){try{callRecognition.abort();}catch(e){}}
  
  if (vadAnimFrame) cancelAnimationFrame(vadAnimFrame);
  if (vadStream) vadStream.getTracks().forEach(t => t.stop());
  if (vadAudioCtx) vadAudioCtx.close();
  vadStream = null; vadAudioCtx = null;
  
  if(document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});
  
  // 👉 挂断时瞬间清空所有积压的语音
  audioQueue = []; 
  audioPlaying = false;
  globalCallAudio.pause();
  globalCallAudio.removeAttribute('src');
  globalCallAudio.load();
  
  setCallStatus('通话结束');
  await new Promise(r=>setTimeout(r,800));
  document.getElementById('callWindow').style.display='none';
  document.getElementById('callBtn').style.color='';
  animateCallWave(false);
  
  const currentCardId = window._callCardId;
  window._callCardId = null;
  
  if(currentCardId){
    const card=messages.find(m=>m.id===currentCardId);
    if(card){
      const m=String(Math.floor(callSeconds/60)).padStart(2,'0');
      const s=String(callSeconds%60).padStart(2,'0');
      card.content='📞 通话 '+m+':'+s;card.callActive=false;
    }
  }
  saveMessages();renderMessages();

  const transcriptToSave=[...callTranscriptLog];
  const durationToSave=callSeconds;
  const startedAtToSave=callStartedAt;
  callTranscriptLog=[];callStartedAt=null;

  if(currentSession){
    const m=String(Math.floor(durationToSave/60)).padStart(2,'0');
    const s=String(durationToSave%60).padStart(2,'0');
    fetch(cfg.base.replace(/\/+$/,'')+'/api/call/save',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        session_id:currentSession.id,
        transcript:transcriptToSave,
        duration:durationToSave,
        started_at:startedAtToSave,
        card_content:'📞 通话 '+m+':'+s,
      }),
    }).then(r=>r.json()).then(d=>{
      if(d.card_id && currentCardId){
        const card=messages.find(m=>m.id===currentCardId);
        if(card){ card.id = d.card_id.toString(); saveMessages(); }
      }
    }).catch(e=>{});
  }
}

async function renderCallRecords(){
  if(!cfg.base||!currentSession)return;
  const res=await fetch(cfg.base.replace(/\/+$/,'')+'/api/call/records?session_id='+currentSession.id).catch(()=>null);
  if(!res||!res.ok)return;
  const records=await res.json();
  const el=document.getElementById('callRecordList');
  if(!el)return;
  if(!records.length){el.innerHTML='<div style="color:var(--td);font-size:12px;padding:12px 0">还没有通话记录</div>';return;}
  el.innerHTML=records.map(r=>{
    const d=new Date(r.started_at);
    const dateStr=d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const dur=String(Math.floor(r.duration/60)).padStart(2,'0')+':'+String(r.duration%60).padStart(2,'0');
    const detailId='cd_'+r.id;
    const lines=(r.transcript||[]).map(m=>{
      const who=m.role==='user'?'你':'他';
      const col=m.role==='user'?'var(--t)':'var(--ac)';
      return`<div><span style="color:${col}">${who}：</span>${esc(m.content)}</div>`;
    }).join('');
    
    return`<div style="padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;justify-content:space-between;cursor:pointer" onclick="toggleCallDetail('${detailId}')">
        <div style="display:flex;gap:10px;align-items:center">
          <span style="font-size:12px;color:var(--t)">📞 ${dateStr}</span>
          <span style="font-size:11px;color:var(--td)">${dur}</span>
        </div>
        <button onclick="deleteCallRecord('${r.id}', '${r.started_at}', event)" style="background:none;border:none;color:#c46;cursor:pointer;font-size:11px">🗑 删除</button>
      </div>
      <div id="${detailId}" style="display:none;margin-top:6px;font-size:11px;color:var(--td);line-height:1.8">${lines}</div>
    </div>`;
  }).join('');
}

async function deleteCallRecord(id, startedAt, e) {
  e.stopPropagation();
  if(!confirm('确定删除这条通话记录吗？对应的聊天卡片也会被清除哦。')) return;
  
  // 1. 先瞬间隐藏侧边栏的通话记录行
  const row = e.target.closest('div[style*="padding:10px 0"]');
  if (row) row.style.display = 'none';
  
  // 2. 👉 修复：不等网络请求，立刻在前端把聊天卡片删掉并刷新！绝对0延迟！
  const st = new Date(startedAt).getTime();
  const card = messages.find(m => m.type === 'call-card' && Math.abs(new Date(m.ts).getTime() - st) < 300000);
  if(card) {
      messages = messages.filter(m => m.id !== card.id);
      saveMessages(); 
      renderMessages(); // 立刻刷新界面，卡片瞬间消失
  }

  // 3. 最后在后台偷偷把数据库里的东西删掉（不用 await 傻等）
  fetch(cfg.base.replace(/\/+$/,'')+'/api/call/records/' + id, { method: 'DELETE' }).catch(()=>{});
  if(card) {
      fetch(cfg.base.replace(/\/+$/,'')+'/api/messages/' + card.id, { method: 'DELETE' }).catch(()=>{});
  }
}


function toggleCallDetail(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'block':'none';}

function makeDraggable(el){
  let sx=0,sy=0;
  const onStart=(e)=>{
    const p=e.touches?e.touches[0]:e;
    sx=p.clientX;sy=p.clientY;
    document.addEventListener('mousemove',onMove);document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('mouseup',onEnd);document.addEventListener('touchend',onEnd);
  };
  const onMove=(e)=>{
    if(e.cancelable)e.preventDefault();
    const p=e.touches?e.touches[0]:e;
    const rect=el.getBoundingClientRect();
    el.style.left=(rect.left+(p.clientX-sx))+'px';
    el.style.top=(rect.top+(p.clientY-sy))+'px';
    el.style.right='auto';el.style.bottom='auto';
    sx=p.clientX;sy=p.clientY;
  };
  const onEnd=()=>{
    document.removeEventListener('mousemove',onMove);document.removeEventListener('touchmove',onMove);
    document.removeEventListener('mouseup',onEnd);document.removeEventListener('touchend',onEnd);
  };
  el.addEventListener('mousedown',onStart);el.addEventListener('touchstart',onStart,{passive:true});
}
// 👉 找回丢失的面板渲染函数
function renderCallsPanel() {
  const el = document.getElementById('panelContent');
  if(!el) return;
  el.innerHTML = `<div class="panel-hdr"><span class="panel-title">通话记录</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
  <div id="callRecordList" style="padding:0 4px"><div style="color:var(--td);font-size:12px;padding:12px 0">加载中...</div></div>`;
  renderCallRecords();
}
