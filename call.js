// ═══════════════════════════════════════
//  通话系统 (防死锁版v2 — 竞态修复 + 语言自动识别 + 看门狗)
// ═══════════════════════════════════════
let callActive=false,callRecognition=null,callTimerInterval=null,callSeconds=0;
let callSilenceTimer=null,callTranscriptLog=[],callSpeaking=false;
let callStartedAt=null,ringTimer=null;
let currentCallToken = null; 

// 🆕 防死锁：记录 callSpeaking 何时变为 true
let callSpeakingStartTime = 0;
// 🆕 防死锁：看门狗定时器
let watchdogTimer = null;

let vadAudioCtx = null, vadAnalyser = null, vadStream = null, vadMic = null;
let vadRecorder = null, vadChunks = [];
let isDetectingSpeech = false, vadSilenceTimer = null, vadAnimFrame = null;
let speechStartTime = 0; 
const VAD_THRESHOLD = 4; 

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

// ═══════════════════════════════════════
// 🆕 核心防死锁：状态看门狗
// 每3秒检查一次，如果发现状态卡死就强制重置
// ═══════════════════════════════════════
function startWatchdog() {
  stopWatchdog();
  watchdogTimer = setInterval(() => {
    if (!callActive) { stopWatchdog(); return; }
    
    const now = Date.now();
    
    // 检查1: audioPlaying 卡死
    // 如果 audioPlaying=true 但音频实际上已经停了（paused 或 ended），强制释放
    if (audioPlaying) {
      if (globalCallAudio.paused || globalCallAudio.ended || globalCallAudio.src === SILENT_B64 || !globalCallAudio.src) {
        console.warn('[看门狗] audioPlaying 卡死，强制释放');
        audioPlaying = false;
        // 尝试继续播放队列或回到 keepAlive
        if (audioQueue.length > 0) {
          drainAudioQueue();
        } else {
          keepAliveAudio();
        }
      }
    }
    
    // 检查2: callSpeaking 卡死（超过30秒未释放）
    // v2: 从20秒延长到30秒，因为AI思考+TTS生成可能需要更久
    if (callSpeaking && callSpeakingStartTime > 0 && (now - callSpeakingStartTime > 30000)) {
      console.warn('[看门狗] callSpeaking 卡死超过30秒，强制释放');
      callSpeaking = false;
      callSpeakingStartTime = 0;
      audioPlaying = false;
      audioQueue = [];
      animateCallWave(false);
      if (callActive) {
        setCallStatus('恢复中...');
        setTimeout(() => { if(callActive) startListening(); }, 500);
      }
    }
    
    // 检查3: SpeechRecognition 丢失（PC端）
    // 如果通话活跃、没在说话、没在播音、但 callRecognition 是 null，说明监听器丢了
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 768;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && !isMobile && callActive && !callSpeaking && !callRecognition) {
      console.warn('[看门狗] SpeechRecognition 丢失，重新启动');
      startListening();
    }
    
  }, 3000);
}

function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
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
  if(pipVideo && document.pictureInPictureEnabled && !document.pictureInPictureElement) {
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
  currentCallToken = Date.now(); 
  
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
  
  // 🆕 启动看门狗
  startWatchdog();
  
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
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 768;
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  
  if(SR && !isMobile) {
    // 先清理旧的
    if (callRecognition) {
      try { callRecognition.abort(); } catch(e) {}
      callRecognition = null;
    }
    
    callRecognition=new SR();
    // ✅ v2修复：不设置 lang，让浏览器自动识别语言
    // 浏览器原生SpeechRecognition不设lang时会自动检测中英文
    // 之前错误地绑定到cfg.ttsLang导致用户说中文被强制用英文识别
    // callRecognition.lang 不设置 = 使用浏览器默认（自动检测）
    callRecognition.continuous=false;
    callRecognition.interimResults=true;
    let finalText='';
    
    // 🆕 防死锁：SpeechRecognition 启动后 8 秒无结果自动重启
    // 防止连不上语音服务器时一直卡在"监听"状态
    let startTimeout = setTimeout(() => {
      if (callRecognition && callActive && !callSpeaking) {
        console.warn('[SR] 8秒无结果，自动重启');
        try { callRecognition.abort(); } catch(e) {}
      }
    }, 8000);
    
    callRecognition.onstart=()=>{
      if(callActive) {setCallStatus('在听...');animateCallWave(false);}
    };
    callRecognition.onresult=(e)=>{
      if(!callActive || callSpeaking) return; 
      
      // 收到结果了，清掉超时定时器
      clearTimeout(startTimeout);

      finalText='';let interim='';
      for(const r of e.results){if(r.isFinal)finalText+=r[0].transcript;else interim+=r[0].transcript;}
      
      const currentText = finalText || interim;
      if(currentText) {
        setCallStatus('你：' + currentText);
        animateCallWave(true);
        clearTimeout(callSilenceTimer);
        callSilenceTimer = setTimeout(() => {
          if (callRecognition) { try { callRecognition.abort(); } catch(e){} }
          sendCallMessage(currentText);
        }, 1500);
      }
    };
    
    // 🆕 防死锁：onerror 中清空引用，让看门狗能检测到丢失
    callRecognition.onerror=(e)=>{
      clearTimeout(startTimeout);
      console.warn('[SR] onerror:', e.error);
      callRecognition = null; // 让看门狗能检测到
      if(callActive && !callSpeaking) setTimeout(startListening, 1000);
    };
    
    // 🆕 防死锁：onend 中清空引用
    callRecognition.onend=()=>{
      clearTimeout(startTimeout);
      callRecognition = null; // 让看门狗能检测到
      if(callActive && !callSpeaking) setTimeout(startListening, 500);
    };
    
    try{ callRecognition.start(); } catch(e){ 
      callRecognition = null;
      setTimeout(startListening, 1000); 
    }
  } else {
    startVADListening();
  }
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
         if(callActive) setCallStatus('他在想...');
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
      speechStartTime = Date.now(); 
      vadChunks = [];
      if(vadRecorder.state === 'inactive') vadRecorder.start();
      setCallStatus('听你说话...');
      animateCallWave(true);
    }
    clearTimeout(vadSilenceTimer);
    vadSilenceTimer = null;

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
      }, 1200); 
    }
  }
}

async function processVADAudio() {
  let myToken = currentCallToken; 
  if (vadChunks.length === 0) { if(callActive) setCallStatus('在听...'); return; }
  const blob = new Blob(vadChunks, { type: 'audio/webm' });
  vadChunks = [];
  
  if (!callActive || myToken !== currentCallToken) return; 
  
  if (blob.size < 2000) { setCallStatus('在听...'); return; }
  
  const fd = new FormData();
  fd.append('audio', blob, 'voice.webm');
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/voice/transcribe', { method: 'POST', body: fd });
    const d = await r.json();
    
    if (!callActive || myToken !== currentCallToken) return;

    let txt = d.text || '';
    const badWords = ['字幕', '观看', '订阅', '点赞', '收藏', '三连', '频道', '谢谢', 'Thank', '欢迎', '收看', '拜拜', '由AI生成', '再见', '不客气', 'AI'];
    if (badWords.some(w => txt.includes(w)) && txt.length < 25) {
        txt = ''; 
    }
    
    if (txt.trim()) {
      setCallStatus('你：' + txt.slice(0, 12) + (txt.length > 12 ? '...' : ''));
      sendCallMessage(txt);
    } else {
      setCallStatus('没听清...');
      setTimeout(() => { if(callActive && !callSpeaking && myToken === currentCallToken) setCallStatus('在听...') }, 1000);
    }
  } catch (err) {
    if (myToken !== currentCallToken || !callActive) return;
    setCallStatus('识别失败');
    setTimeout(() => { if(callActive && !callSpeaking) setCallStatus('在听...') }, 1000);
  }
}

let audioQueue=[];
let audioPlaying=false;
function enqueueAudio(base64,format='mp3'){
  if (!callActive) return; 
  audioQueue.push({base64,format});
  if(!audioPlaying)drainAudioQueue();
}
async function drainAudioQueue(){
  if(audioPlaying||!audioQueue.length) {
      if(!audioPlaying && callActive) keepAliveAudio(); 
      return;
  }
  if (!callActive) return; 

  audioPlaying=true;
  const {base64,format}=audioQueue.shift();
  
  // 🆕 防死锁：单片音频 10 秒超时保护
  let audioTimeout = null;
  
  try{
    const bytes=atob(base64);
    const arr=new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);
    const blob=new Blob([arr],{type:'audio/'+format});
    const url=URL.createObjectURL(blob);
    
    globalCallAudio.loop = false;
    globalCallAudio.src = url;
    
    const cleanup = () => {
      clearTimeout(audioTimeout); // 清掉超时定时器
      globalCallAudio.onended = null;
      globalCallAudio.onerror = null;
      audioPlaying=false;
      URL.revokeObjectURL(url);
      drainAudioQueue();
    };
    
    globalCallAudio.onended = cleanup;
    globalCallAudio.onerror = cleanup;
    
    // 🆕 10秒后如果 onended 还没触发，强制 cleanup
    audioTimeout = setTimeout(() => {
      console.warn('[Audio] 单片播放超过10秒，强制cleanup');
      cleanup();
    }, 10000);
    
    await globalCallAudio.play();
  }catch(e){
    clearTimeout(audioTimeout);
    audioPlaying=false;
    drainAudioQueue();
  }
}

async function sendCallMessage(text){
  let myToken = currentCallToken;
  if(!callActive||!text.trim()||callSpeaking)return;
  
  clearTimeout(callSilenceTimer);
  if(callRecognition){try{callRecognition.abort();}catch(e){}}
  callRecognition = null; // 🆕 清引用
  
  callTranscriptLog.push({role:'user',content:text,ts:new Date().toISOString()});
  setCallStatus('他在想...');animateCallWave(false);
  callSpeaking=true; 
  callSpeakingStartTime = Date.now(); // 🆕 记录开始时间，给看门狗用
  audioQueue=[];audioPlaying=false;

  // 🆕 v2: SSE流完成标志——只有这个为true才说明AI的回复真正发完了
  let sseComplete = false;

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
      if(!callActive || myToken !== currentCallToken) break; 
      const {done,value}=await reader.read();
      if(done) break;
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
    
    if(callActive && myToken === currentCallToken && sseBuf.startsWith('data: ')){
      try{
        const evt=JSON.parse(sseBuf.slice(6));
        if(evt.type==='audio')enqueueAudio(evt.audio,evt.format||'mp3');
        if(evt.type==='done')fullReply=evt.fullReply||fullReply;
      }catch(e){}
    }

    // 🆕 v2: SSE流已经读完了（reader.read() 返回 done=true），标记完成
    sseComplete = true;

    if(fullReply && callActive && myToken === currentCallToken) {
        callTranscriptLog.push({role:'assistant',content:fullReply,ts:new Date().toISOString()});
    }

    // ═══════════════════════════════════════
    // 🆕 v2 核心修复：等待音频播放真正结束
    // 旧版问题：每200ms检查一次，连续3次(600ms)没音频就退出
    //   → 如果AI的TTS音频包之间间隔>600ms，会误判为播完
    //   → 导致callSpeaking过早释放，用户语音和AI音频交叉
    // 新版：SSE流已经结束（sseComplete=true），所以不会再有新音频包
    //   只需等audioQueue清空 + 当前音频播完即可
    // ═══════════════════════════════════════
    await new Promise(resolve=>{
      const check=setInterval(()=>{
        if(!callActive || myToken !== currentCallToken) { 
          clearInterval(check); resolve(); return; 
        }
        // 修正audioPlaying可能卡死的情况
        if (audioPlaying && (globalCallAudio.paused || globalCallAudio.ended)) {
          audioPlaying = false;
        }
        // SSE已结束 + 没有正在播放 + 队列为空 = 真正播完了
        if(!audioPlaying && audioQueue.length === 0){
          clearInterval(check); resolve();
        }
      },200);
      // 安全网：最多等30秒（v2从15秒延长，因为长回复TTS可能较久）
      setTimeout(()=>{ clearInterval(check); audioPlaying = false; audioQueue = []; resolve(); }, 30000); 
    });

  }catch(e){
    if(callActive) setCallStatus('出错了，继续说...');
  }finally{
    // 🆕 防死锁核心修复：无条件释放 callSpeaking！
    callSpeaking = false;
    callSpeakingStartTime = 0;
    animateCallWave(false);
    if (callActive && myToken === currentCallToken) {
      startListening();
    }
  }
}

async function endCall(){
  if(!callActive)return;
  callActive=false;callSpeaking=false;
  callSpeakingStartTime = 0;
  currentCallToken = null; 
  clearTimeout(callSilenceTimer);clearInterval(callTimerInterval);
  
  // 🆕 停止看门狗
  stopWatchdog();
  
  if(callRecognition){try{callRecognition.abort();}catch(e){}}
  callRecognition = null;
  
  if (vadAnimFrame) cancelAnimationFrame(vadAnimFrame);
  if (vadRecorder) { vadRecorder.onstop = null; if(vadRecorder.state !== 'inactive') vadRecorder.stop(); } 
  if (vadStream) vadStream.getTracks().forEach(t => t.stop());
  if (vadAudioCtx && vadAudioCtx.state !== 'closed') vadAudioCtx.close();
  vadStream = null; vadAudioCtx = null;
  
  if(document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});
  
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

function renderCallsPanel() {
  const el = document.getElementById('panelContent');
  if(!el) return;
  el.innerHTML = `<div class="panel-hdr"><span class="panel-title">通话记录</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
  <div id="callRecordList" style="padding:0 4px"><div style="color:var(--td);font-size:12px;padding:12px 0">加载中...</div></div>`;
  renderCallRecords();
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
  
  const row = e.target.closest('div[style*="padding:10px 0"]');
  if (row) row.style.display = 'none';
  
  const st = new Date(startedAt).getTime();
  const card = messages.find(m => m.type === 'call-card' && Math.abs(new Date(m.ts).getTime() - st) < 300000);
  if(card) {
      messages = messages.filter(m => m.id !== card.id);
      saveMessages(); renderMessages(); 
  }

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
