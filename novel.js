/**
 * novel.js – Novel Reader + TTS Module
 *
 * Exposes: window.NovelModule  (used by pdf.js bridge)
 * Depends: showToast() from index.html shell
 */
(() => {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════ */
  let backend      = localStorage.getItem('novel_backend') || '';
  let chapters     = [];
  let currentIndex = -1;

  // TTS state
  let currentSpeech            = null;
  let currentChunks            = [];
  let currentText              = '';
  let currentChunkIndex        = 0;
  let currentCharIndex         = 0;
  let currentWordIndex         = 0;
  let currentAbsoluteCharIndex = 0;

  let isDraggingProgress = false;
  let lastHighlight      = 0;
  let voices             = [];
  let needsDelay         = false;
  let progressTimer      = null;
  let boundaryFired      = false;
  let isReading          = false;
  let isPaused           = false;  // track pause state manually (Chrome bug workaround)
  let wakeLock           = null;

  /* ══════════════════════════════════════════════════════════
     DOM REFS
  ══════════════════════════════════════════════════════════ */
  const urlInput      = document.getElementById('novelUrlInput');
  const textInput     = document.getElementById('novelTextInput');
  const loadingEl     = document.getElementById('novelLoading');
  const titleEl       = document.getElementById('novelTitle');
  const contentEl     = document.getElementById('novelContent');
  const progressBar   = document.getElementById('novelProgressBar');
  const progressText  = document.getElementById('novelProgressText');
  // novelTtsProgress removed – progress slider now lives in the fixed bottom bar
  const speechLoading = document.getElementById('novelSpeechLoading');
  const chapterSelect = document.getElementById('novelChapterSelect');
  const btnPR         = document.getElementById('novelBtnPauseResume');

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function setLoading(msg) { loadingEl.textContent = msg || ''; }

  function showSpeechLoading(msg = '🔊 Đang chuẩn bị giọng đọc…') {
    speechLoading.textContent = msg;
    speechLoading.classList.remove('hidden');
  }
  function hideSpeechLoading() { speechLoading.classList.add('hidden'); }

  function clearProgressTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  function setPauseBtn(state) {
    if (!btnPR) return;
    // Bottom bar button chỉ hiện icon
    if (state === 'paused')  { btnPR.textContent = '▶'; btnPR.title = 'Tiếp tục'; }
    else if (state === 'playing') { btnPR.textContent = '⏸'; btnPR.title = 'Tạm dừng'; }
    else                     { btnPR.textContent = '▶'; btnPR.title = 'Phát'; }
  }

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');

      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
    alert('bật wavelock');
  } catch (err) {
    console.warn('Không thể bật Wake Lock:', err);
    alert('k thể bật wavelock');
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) {
    console.warn('Không thể tắt Wake Lock:', err);
  }
}

  /* ══════════════════════════════════════════════════════════
     CONTENT RENDER
  ══════════════════════════════════════════════════════════ */
  function renderContentWithSpans(text) {
    let wi = 0;
    contentEl.innerHTML = text.split(/(\s+)/).map(part => {
      if (part === '\n') return '<br>';
      if (/^\s+$/.test(part)) return part;
      return `<span id="nw-${wi++}">${escapeHtml(part)}</span>`;
    }).join('');
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function highlightWord(index) {
    const old = contentEl.querySelector('.novel-highlight');
    if (old) old.classList.remove('novel-highlight');
    const el = document.getElementById('nw-' + index);
    if (el) {
      el.classList.add('novel-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     PROGRESS BAR
  ══════════════════════════════════════════════════════════ */
  function initProgressBar() {
    progressBar.min   = 0;
    progressBar.max   = currentText.length;
    progressBar.value = 0;
    progressBar.style.setProperty('--prg', '0%');
    progressText.textContent = `0 / ${currentText.length}`;
  }

  function updateProgress() {
    progressBar.value = currentAbsoluteCharIndex;
    const pct = progressBar.max > 0
      ? (currentAbsoluteCharIndex / progressBar.max) * 100 : 0;
    progressBar.style.setProperty('--prg', pct + '%');
    progressText.textContent = `${currentAbsoluteCharIndex} / ${progressBar.max}`;
  }

  function getWordIndexFromChar(charIndex, text) {
    return Math.max(0, text.slice(0, charIndex).trim().split(/\s+/).length - 1);
  }

  function seekToChar(absIndex) {
    currentAbsoluteCharIndex = absIndex;
    let total = 0;
    for (let i = 0; i < currentChunks.length; i++) {
      const len = currentChunks[i].length;
      if (absIndex < total + len) {
        currentChunkIndex = i;
        currentCharIndex  = absIndex - total;
        return;
      }
      total += len;
    }
    // Past end
    currentChunkIndex = currentChunks.length;
    currentCharIndex  = 0;
  }

  /* ══════════════════════════════════════════════════════════
     CHUNK BUILDER
  ══════════════════════════════════════════════════════════ */
  function buildChunks(text, size = 1800) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks;
  }

  /* ══════════════════════════════════════════════════════════
     LOAD CONTENT (shared by fetch + paste + bridge)
  ══════════════════════════════════════════════════════════ */
  function loadContent(text, title = '') {
    novelStopRead();
    currentText   = text;
    currentChunks = buildChunks(text);
    titleEl.textContent = title;
    renderContentWithSpans(text);
    initProgressBar();
  }

  /* ══════════════════════════════════════════════════════════
     USE PASTED TEXT
  ══════════════════════════════════════════════════════════ */
  function novelUseInputText() {
    const text = textInput.value.trim();
    if (!text) { showToast('⚠️ Chưa có nội dung'); return; }
    loadContent(text, '📄 Văn bản nhập');
    chapters = []; currentIndex = -1;
    renderChapterSelect();
    showToast('📄 Đã tải nội dung!');
  }

  /* ══════════════════════════════════════════════════════════
     FETCH FROM URL
  ══════════════════════════════════════════════════════════ */
  async function novelFetchChapter() {
    novelStopRead();
    const url = urlInput.value.trim();
    if (!url) { showToast('⚠️ Chưa nhập link chương!'); return; }
    if (!backend) {
      showToast('⚠️ Chưa cấu hình backend!');
      novelOpenSettings();
      return;
    }

    localStorage.setItem('novel_last_url', url);
    setLoading('⏳ Đang tải chương…');
    titleEl.textContent = '';
    contentEl.innerHTML = '';

    try {
      const res  = await fetch(`${backend}/chapter?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      loadContent(data.content || 'Không tìm thấy nội dung', data.title || 'Chương');

      chapters     = data.chapters || [];
      currentIndex = chapters.findIndex(ch => url.includes(ch.chapter));
      renderChapterSelect();
      updateNavButtons();
      showToast('✅ Đã tải chương!');

    } catch (e) {
      showToast('❌ Lỗi: ' + e.message);
      setLoading('');
    }
    setLoading('');
  }

  /* ══════════════════════════════════════════════════════════
     CHAPTER NAV
  ══════════════════════════════════════════════════════════ */
  function renderChapterSelect() {
    chapterSelect.innerHTML = '';
    if (!chapters.length) {
      const opt = document.createElement('option');
      opt.textContent = '— Không có danh sách chương —';
      chapterSelect.appendChild(opt);
      return;
    }
    chapters.forEach((ch, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = ch.title || `Chương ${i + 1}`;
      opt.selected = i === currentIndex;
      chapterSelect.appendChild(opt);
    });
  }

  function updateNavButtons() {
    const prev = document.getElementById('novelBtnPrev');
    const next = document.getElementById('novelBtnNext');
    if (prev) prev.disabled = !chapters.length || currentIndex >= chapters.length - 1;
    if (next) next.disabled = !chapters.length || currentIndex <= 0;
  }

  async function novelGoNext() {
    if (!chapters.length || currentIndex <= 0) { showToast('⚠️ Hết chương mới hơn!'); return; }
    currentIndex--;
    urlInput.value = chapters[currentIndex].url;
    await novelFetchChapter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function novelGoPrev() {
    if (!chapters.length || currentIndex >= chapters.length - 1) { showToast('⚠️ Hết chương cũ hơn!'); return; }
    currentIndex++;
    urlInput.value = chapters[currentIndex].url;
    await novelFetchChapter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  chapterSelect.addEventListener('change', function() {
    const i = parseInt(this.value);
    if (isNaN(i) || !chapters[i]) return;
    currentIndex = i;
    urlInput.value = chapters[i].url;
    novelFetchChapter();
  });

  /* ══════════════════════════════════════════════════════════
     SPEECH ENGINE
  ══════════════════════════════════════════════════════════ */
  function speakNextFromCurrent() {
    if (currentChunkIndex >= currentChunks.length) { isReading = false; return; }

    const resumeOffset = currentCharIndex;
    const chunk        = currentChunks[currentChunkIndex].slice(resumeOffset);
    const voiceIndex   = localStorage.getItem('novel_voice_index');
    const rate         = parseFloat(localStorage.getItem('novel_voice_rate')  || '1');
    const pitch        = parseFloat(localStorage.getItem('novel_voice_pitch') || '1');

    const utt = new SpeechSynthesisUtterance(chunk);
    if (voices[voiceIndex]) { utt.voice = voices[voiceIndex]; utt.lang = voices[voiceIndex].lang; }
    else { utt.lang = 'vi-VN'; }
    utt.rate  = rate;
    utt.pitch = pitch;

    let measureStart = 0;

    utt.onboundary = (ev) => {
      if (!boundaryFired) { boundaryFired = true; clearProgressTimer(); }
      const charInChunk = resumeOffset + ev.charIndex;
      currentCharIndex         = charInChunk;
      currentAbsoluteCharIndex = currentChunks.slice(0, currentChunkIndex).join('').length + charInChunk;
      currentWordIndex         = getWordIndexFromChar(currentAbsoluteCharIndex, currentText);
      const now = Date.now();
      if (now - lastHighlight > 100) { highlightWord(currentWordIndex); updateProgress(); lastHighlight = now; }
      localStorage.setItem('novel_chunk', currentChunkIndex);
      localStorage.setItem('novel_char',  currentCharIndex);
    };

    utt.onstart = () => {
      hideSpeechLoading();
      measureStart = Date.now();
      const savedCps   = parseFloat(localStorage.getItem('novel_cps') || '24');
      const charsPerMs = (savedCps * rate) / 1000;
      const startTime  = Date.now();
      clearProgressTimer();
      boundaryFired = false;
      setTimeout(() => {
        if (boundaryFired) return;
        progressTimer = setInterval(() => {
          if (!speechSynthesis.speaking || speechSynthesis.paused) { clearProgressTimer(); return; }
          const est     = resumeOffset + Math.round((Date.now() - startTime) * charsPerMs);
          const clamped = Math.min(est, resumeOffset + chunk.length - 1);
          currentCharIndex         = clamped;
          currentAbsoluteCharIndex = currentChunks.slice(0, currentChunkIndex).join('').length + clamped;
          currentWordIndex         = getWordIndexFromChar(currentAbsoluteCharIndex, currentText);
          highlightWord(currentWordIndex);
          updateProgress();
        }, 250);
      }, 600);
    };

    utt.onend = () => {
      clearProgressTimer();
      // Calibrate reading speed
      if (measureStart > 0) {
        const elapsed = Date.now() - measureStart;
        if (chunk.length >= 200 && elapsed >= 1000) {
          const measured = (chunk.length / elapsed) * 1000;
          const existing = parseFloat(localStorage.getItem('novel_cps') || '24');
          localStorage.setItem('novel_cps', (existing * 0.3 + measured * 0.7).toFixed(2));
        }
      }
      currentChunkIndex++;
      currentCharIndex = 0;
      localStorage.setItem('novel_chunk', currentChunkIndex);
      localStorage.setItem('novel_char',  0);

      if (currentChunkIndex >= currentChunks.length) {
        isReading = false;
        // Auto-advance to next chapter
        novelGoNext().then(() => {
          if (currentText && currentChunks.length) novelRestartRead();
        });
        return;
      }
      speakNextFromCurrent();
    };

    currentSpeech = utt;
    speechSynthesis.speak(utt);
    isReading = true;
    isPaused  = false;
  }

  function speakLongText(resume = false) {
    const wasSpeaking = speechSynthesis.speaking || speechSynthesis.paused;
    if (wasSpeaking) { speechSynthesis.cancel(); needsDelay = true; }
    if (!resume) { currentChunkIndex = 0; currentCharIndex = 0; currentWordIndex = 0; }
    if (needsDelay) { needsDelay = false; setTimeout(speakNextFromCurrent, 150); }
    else { speakNextFromCurrent(); }
  }

  /* ── Playback controls ─────────────────────────────────── */
  async function novelReadChapter() {
    if (!currentText) { showToast('⚠️ Chưa có nội dung!'); return; }
    await acquireWakeLock();
    showSpeechLoading();
    // Seek from progress bar position
    currentAbsoluteCharIndex = parseInt(progressBar.value || '0');
    seekToChar(currentAbsoluteCharIndex);
    speakLongText(true);
    setPauseBtn('playing');
  }

  async function novelStopRead() {
    await releaseWakeLock();
    clearProgressTimer();
    speechSynthesis.cancel();
    isReading = false;
    isPaused  = false;
    hideSpeechLoading();
    setPauseBtn('stopped');
  }

  function novelTogglePauseResume() {
    if (isPaused) {
      // ─ RESUME ─
      speechSynthesis.resume();
      isPaused = false;
      setPauseBtn('playing');
      // Khởi động lại fallback timer nếu trình duyệt không bắn boundary event
      if (!boundaryFired) {
        const rate       = parseFloat(localStorage.getItem('novel_voice_rate') || '1');
        const savedCps   = parseFloat(localStorage.getItem('novel_cps') || '24');
        const charsPerMs = (savedCps * rate) / 1000;
        const resumeFrom = currentAbsoluteCharIndex;
        const startTime  = Date.now();
        clearProgressTimer();
        progressTimer = setInterval(() => {
          if (!speechSynthesis.speaking || isPaused) { clearProgressTimer(); return; }
          const est = resumeFrom + Math.round((Date.now() - startTime) * charsPerMs);
          currentAbsoluteCharIndex = Math.min(est, currentText.length - 1);
          currentWordIndex = getWordIndexFromChar(currentAbsoluteCharIndex, currentText);
          highlightWord(currentWordIndex);
          updateProgress();
        }, 250);
      }
    } else if (isReading || speechSynthesis.speaking) {
      // ─ PAUSE ─
      clearProgressTimer();
      speechSynthesis.pause();
      isPaused = true;
      setPauseBtn('paused');
    } else {
      // Chưa đọc gì → bắt đầu
      novelReadChapter();
    }
  }

  async function novelRestartRead() {
    await novelStopRead();
    currentChunkIndex = 0; currentCharIndex = 0;
    currentWordIndex  = 0; currentAbsoluteCharIndex = 0;
    progressBar.value = 0;
    progressBar.style.setProperty('--prg', '0%');
    localStorage.removeItem('novel_chunk');
    localStorage.removeItem('novel_char');
    await novelReadChapter();
  }

  /* ── Progress bar interactions ─────────────────────────── */
  progressBar.addEventListener('mousedown', () => {
    isDraggingProgress = true;
    if (speechSynthesis.speaking || speechSynthesis.paused) { speechSynthesis.cancel(); needsDelay = true; }
  });
  progressBar.addEventListener('touchstart', () => {
    isDraggingProgress = true;
    if (speechSynthesis.speaking || speechSynthesis.paused) { speechSynthesis.cancel(); needsDelay = true; }
  });
  progressBar.addEventListener('input', function() {
    seekToChar(parseInt(this.value));
    currentWordIndex = getWordIndexFromChar(currentAbsoluteCharIndex, currentText);
    highlightWord(currentWordIndex);
    updateProgress();
  });
  progressBar.addEventListener('change', function() {
    seekToChar(parseInt(this.value));
    isDraggingProgress = false;
    novelReadChapter();
  });
  progressBar.addEventListener('touchend', function() {
    isDraggingProgress = false;
    seekToChar(parseInt(this.value));
    updateProgress();
    novelReadChapter();
  });

  /* ══════════════════════════════════════════════════════════
     SETTINGS / VOICES
  ══════════════════════════════════════════════════════════ */
  function novelOpenSettings() {
    document.getElementById('novelBackendInput').value = backend;
    const ri = document.getElementById('novelRateInput');
    const pi = document.getElementById('novelPitchInput');
    ri.value = localStorage.getItem('novel_voice_rate')  || '1';
    pi.value = localStorage.getItem('novel_voice_pitch') || '1';
    document.getElementById('novelRateValue').textContent  = ri.value;
    document.getElementById('novelPitchValue').textContent = pi.value;
    loadVoices();
    document.getElementById('novelSettingsPopup').classList.remove('hidden');
  }

  function novelCloseSettings() {
    document.getElementById('novelSettingsPopup').classList.add('hidden');
  }

  function novelSaveSettings() {
    const v = document.getElementById('novelBackendInput').value.trim();
    backend = v;
    localStorage.setItem('novel_backend', v);
    localStorage.setItem('novel_voice_index', document.getElementById('novelVoiceSelect').value);
    localStorage.setItem('novel_voice_rate',  document.getElementById('novelRateInput').value);
    localStorage.setItem('novel_voice_pitch', document.getElementById('novelPitchInput').value);
    novelCloseSettings();
    showToast('✅ Đã lưu cài đặt!');
  }

  function loadVoices() {
    voices = speechSynthesis.getVoices();
    const sel = document.getElementById('novelVoiceSelect');
    sel.innerHTML = '';
    voices.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });
    const saved = localStorage.getItem('novel_voice_index');
    if (saved) sel.value = saved;
  }

  function applyVoiceSettings() {
    const ri = document.getElementById('novelRateInput');
    const pi = document.getElementById('novelPitchInput');
    document.getElementById('novelRateValue').textContent  = ri.value;
    document.getElementById('novelPitchValue').textContent = pi.value;
    localStorage.setItem('novel_voice_index', document.getElementById('novelVoiceSelect').value);
    localStorage.setItem('novel_voice_rate',  ri.value);
    localStorage.setItem('novel_voice_pitch', pi.value);
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); needsDelay = true; setTimeout(speakNextFromCurrent, 150); }
  }

  speechSynthesis.onvoiceschanged = loadVoices;
  document.getElementById('novelVoiceSelect').addEventListener('change', applyVoiceSettings);
  document.getElementById('novelRateInput').addEventListener('input', applyVoiceSettings);
  document.getElementById('novelPitchInput').addEventListener('input', applyVoiceSettings);

  /* ══════════════════════════════════════════════════════════
     KEYBOARD SHORTCUT: Enter on URL input
  ══════════════════════════════════════════════════════════ */
  urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') novelFetchChapter(); });

  /* ══════════════════════════════════════════════════════════
     RESTORE LAST URL on load
  ══════════════════════════════════════════════════════════ */
  window.addEventListener('DOMContentLoaded', () => {
    const lastUrl = localStorage.getItem('novel_last_url');
    if (lastUrl) urlInput.value = lastUrl;
    // Render empty chapter nav
    renderChapterSelect();
    updateNavButtons();
    // Load voices
    loadVoices();
  });

  /* ══════════════════════════════════════════════════════════
     PUBLIC API – consumed by pdf.js bridge
  ══════════════════════════════════════════════════════════ */
  window.NovelModule = {
    /** Load arbitrary text into the reader (bridge from PDF module) */
    loadText(text, title = '') {
      loadContent(text, title);
      chapters = []; currentIndex = -1;
      renderChapterSelect();
      updateNavButtons();
    }
  };

  document.addEventListener('visibilitychange', async () => {
  if (
    document.visibilityState === 'visible' &&
    window.speechSynthesis?.speaking &&
    !wakeLock
  ) {
    await acquireWakeLock();
  }
});

  /* ══════════════════════════════════════════════════════════
     GLOBAL WRAPPERS (called from index.html inline onclick)
  ══════════════════════════════════════════════════════════ */
  window.novelFetchChapter    = novelFetchChapter;
  window.novelUseInputText    = novelUseInputText;
  window.novelOpenSettings    = novelOpenSettings;
  window.novelCloseSettings   = novelCloseSettings;
  window.novelSaveSettings    = novelSaveSettings;
  window.novelReadChapter     = novelReadChapter;
  window.novelTogglePauseResume = novelTogglePauseResume;
  window.novelStopRead        = novelStopRead;
  window.novelRestartRead     = novelRestartRead;
  window.novelGoNext          = novelGoNext;
  window.novelGoPrev          = novelGoPrev;

})();
