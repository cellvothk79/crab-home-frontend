let gAudio = new Audio();
let gCurrentSong = null;
let gLyrics = [];
let gPlayQueue = [];
let gQueueIdx = -1;
let isUserScrollingLrc = false;
let scrollTimeout = null;

// 监听音频时间更新
gAudio.addEventListener('timeupdate', () => {
  const current = gAudio.currentTime;
  const duration = gAudio.duration || 30; // 预览默认30秒
  
  // 更新进度条
  const range = document.getElementById('progressRange');
  if (range && !range.matches(':active')) {
      range.value = (current / duration) * 100;
  }
  
  const formatTime = (time) => {
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
  };
  document.getElementById('timeCurrent').textContent = formatTime(current);
  document.getElementById('timeTotal').textContent = formatTime(duration);

  // 歌词高亮跟随
  if (gLyrics.length > 0 && !isUserScrollingLrc) {
      let activeIdx = -1;
      for (let i = 0; i < gLyrics.length; i++) {
          if (current >= gLyrics[i].time) activeIdx = i;
          else break;
      }
      
      const lrcBox = document.getElementById('lrcBox');
      const lines = lrcBox.getElementsByClassName('lrc-line');
      
      for (let i = 0; i < lines.length; i++) {
          lines[i].className = i === activeIdx ? 'lrc-line active' : 'lrc-line';
      }
      
      // 滚动居中
      if (activeIdx !== -1 && lines[activeIdx]) {
          const container = document.getElementById('lrcContainer');
          const offset = lines[activeIdx].offsetTop - container.clientHeight / 2 + 20;
          container.scrollTo({ top: offset, behavior: 'smooth' });
      }
  }
});

// 手动拖动进度条
document.getElementById('progressRange').addEventListener('input', (e) => {
  const duration = gAudio.duration || 30;
  gAudio.currentTime = (e.target.value / 100) * duration;
});

// 监听用户滚动歌词，暂停自动跟随
document.getElementById('lrcContainer').addEventListener('scroll', () => {
    isUserScrollingLrc = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => { isUserScrollingLrc = false; }, 3000);
});

// 播放结束自动下一首
gAudio.addEventListener('ended', playNextSong);

async function searchAndPlay(query, fromAi = false) {
  if (!query) return;
  const prevTitle = document.getElementById('miniTitle').textContent;
  document.getElementById('miniTitle').textContent = '搜索中...';
  document.getElementById('miniPlayer').style.display = 'flex';
  
  try {
    const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/music/search?q=' + encodeURIComponent(query));
    const d = await r.json();
    if (d.results && d.results.length > 0) {
      const song = d.results[0];
      // 注入队列
      gPlayQueue = d.results;
      gQueueIdx = 0;
      await playSong(song, fromAi);
    } else {
      alert('没搜到这首歌');
      document.getElementById('miniTitle').textContent = prevTitle;
    }
  } catch(e) { alert('搜歌失败'); document.getElementById('miniPlayer').style.display = 'none'; }
}

async function playSong(song, fromAi = false) {
  gCurrentSong = song;
  
  // 更新 UI
  document.getElementById('miniTitle').textContent = song.trackName;
  document.getElementById('miniArtist').textContent = song.artistName;
  document.getElementById('miniCover').src = song.artworkUrl;
  
  document.getElementById('fullTitle').textContent = song.trackName;
  document.getElementById('fullArtist').textContent = song.artistName;
  document.getElementById('fullCover').src = song.artworkUrl;
  document.getElementById('playerBg').style.backgroundImage = `url(${song.artworkUrl})`;
  
  // 检查是否已收藏
  checkIsFavorite(song.trackId);

  // 拉取歌词
  document.getElementById('lrcBox').innerHTML = '<div class="lrc-line">歌词加载中...</div>';
  gLyrics = [];
  fetch(cfg.base.replace(/\/+$/, '') + `/api/music/lyrics?track=${encodeURIComponent(song.trackName)}&artist=${encodeURIComponent(song.artistName)}`)
    .then(r => r.json())
    .then(d => {
        if (d.lyrics) {
            gLyrics = parseLRC(d.lyrics);
            document.getElementById('lrcBox').innerHTML = gLyrics.map((l, i) => `<div class="lrc-line" id="lrc_${i}">${esc(l.text)}</div>`).join('');
        } else {
            document.getElementById('lrcBox').innerHTML = '<div class="lrc-line">暂无滚动歌词</div>';
        }
    }).catch(()=>{ document.getElementById('lrcBox').innerHTML = '<div class="lrc-line">暂无滚动歌词</div>'; });

  // 播放
  gAudio.src = song.previewUrl;
  await gAudio.play();
  updatePlayStateUI(true);

  // 告诉 AI (传音入密)
  window._activeMusic = `${song.trackName} - ${song.artistName}`;
  if (!fromAi) {
      // 只有是我主动点歌才告诉AI，AI自己点的就不用告诉他了
      if(typeof stageMessage === 'function') {
          stageMessage(`[系统感知：peri 刚刚点播了《${window._activeMusic}》，正在一起听，你可以自然地聊聊这首歌]`);
          send();
      }
  }
}

function parseLRC(lrcText) {
  const lines = lrcText.split('\n');
  const lrc = [];
  const regex = /\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/;
  for (let line of lines) {
      const match = regex.exec(line);
      if (match) {
          const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
          const text = match[3].trim();
          if (text) lrc.push({ time, text });
      }
  }
  return lrc;
}

function togglePlay() {
  if (!gAudio.src) return;
  if (gAudio.paused) { gAudio.play(); updatePlayStateUI(true); }
  else { gAudio.pause(); updatePlayStateUI(false); }
}

function updatePlayStateUI(playing) {
  const btn1 = document.getElementById('miniPlayBtn');
  const btn2 = document.getElementById('mainPlayBtn');
  btn1.textContent = playing ? '⏸' : '▶';
  btn2.textContent = playing ? '⏸️' : '▶️';
  
  const v1 = document.getElementById('miniVinyl');
  const v2 = document.getElementById('fullVinyl');
  if (playing) { v1.classList.add('playing'); v2.classList.add('playing'); }
  else { v1.classList.remove('playing'); v2.classList.remove('playing'); }
}

function playNextSong() {
  if (gPlayQueue.length === 0) return;
  gQueueIdx = (gQueueIdx + 1) % gPlayQueue.length;
  playSong(gPlayQueue[gQueueIdx]);
}

function playPrevSong() {
  if (gPlayQueue.length === 0) return;
  gQueueIdx = (gQueueIdx - 1 + gPlayQueue.length) % gPlayQueue.length;
  playSong(gPlayQueue[gQueueIdx]);
}

function toggleFullPlayer() {
  const fp = document.getElementById('fullPlayer');
  fp.style.display = fp.style.display === 'none' ? 'flex' : 'none';
}

function closeMusicPlayer() {
  document.getElementById('miniPlayer').style.display = 'none';
  document.getElementById('fullPlayer').style.display = 'none';
  gAudio.pause();
  updatePlayStateUI(false);
  window._activeMusic = '';
}

// === 收藏库功能 ===
let myMusicLib = [];
async function checkIsFavorite(trackId) {
  if (!cfg.base || !currentSession) return;
  const btn = document.getElementById('favBtn');
  try {
      const r = await fetch(cfg.base.replace(/\/+$/, '') + '/api/music/library/' + currentSession.id);
      myMusicLib = await r.json();
      const isFav = myMusicLib.some(s => s.itunes_track_id === trackId);
      btn.style.color = isFav ? '#f44336' : '#fff';
      btn.textContent = isFav ? '❤️' : '♡';
  } catch(e){}
}

async function toggleFavoriteSong() {
  if (!gCurrentSong || !cfg.base) return;
  const btn = document.getElementById('favBtn');
  const isFav = btn.textContent === '❤️';
  
  if (isFav) {
      // 取消收藏
      const song = myMusicLib.find(s => s.itunes_track_id === gCurrentSong.trackId);
      if(song) {
          await fetch(cfg.base.replace(/\/+$/, '') + '/api/music/library/' + song.id, { method:'DELETE' });
          btn.style.color = '#fff'; btn.textContent = '♡';
      }
  } else {
      // 收藏
      const payload = {
          session_id: currentSession.id, track_name: gCurrentSong.trackName, artist_name: gCurrentSong.artistName,
          album_name: gCurrentSong.albumName, artwork_url: gCurrentSong.artworkUrl, preview_url: gCurrentSong.previewUrl,
          duration_ms: gCurrentSong.durationMs, itunes_track_id: gCurrentSong.trackId, added_by: 'user'
      };
      await fetch(cfg.base.replace(/\/+$/, '') + '/api/music/library', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      btn.style.color = '#f44336'; btn.textContent = '❤️';
  }
}

// 供主面板调用的音乐库面板
function renderMusicLibPanel() {
  const el = document.getElementById('panelContent');
  el.innerHTML = `
    <div class="panel-hdr"><span class="panel-title">🎧 我们的音乐库</span><button class="h-btn" onclick="closePanel()">关闭</button></div>
    <div style="font-size:11px; color:var(--td); margin-bottom:15px;">点击收藏过的歌曲可直接播放（仅支持30秒高潮试听）</div>
    <div id="musicLibList" style="display:flex; flex-direction:column; gap:10px;">加载中...</div>
  `;
  fetch(cfg.base.replace(/\/+$/, '') + '/api/music/library/' + currentSession.id)
    .then(r=>r.json()).then(data => {
       const list = document.getElementById('musicLibList');
       if(!data.length) { list.innerHTML = '<div style="text-align:center; color:var(--tf); padding:20px;">歌单空空如也，去听歌页面点个爱心吧~</div>'; return; }
       
       // 组装成播放队列
       gPlayQueue = data.map(s => ({
           trackName: s.track_name, artistName: s.artist_name, albumName: s.album_name,
           artworkUrl: s.artwork_url, previewUrl: s.preview_url, durationMs: s.duration_ms, trackId: s.itunes_track_id
       }));

       list.innerHTML = data.map((s, idx) => `
          <div style="display:flex; align-items:center; gap:12px; background:var(--s2); padding:8px; border-radius:8px; cursor:pointer;" onclick="gQueueIdx=${idx}; playSong(gPlayQueue[${idx}]); closePanel();">
             <img src="${s.artwork_url}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;">
             <div style="flex:1; overflow:hidden;">
                <div style="font-size:13px; color:var(--t); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(s.track_name)}</div>
                <div style="font-size:11px; color:var(--td);">${esc(s.artist_name)}</div>
             </div>
             <div style="color:var(--ac); font-size:16px;">▶</div>
          </div>
       `).join('');
    }).catch(()=>{});
}
