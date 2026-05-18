/**
 * pdf.js – PDF Extractor Module
 *
 * Exposes: window.PdfModule  (optional, for cross-module bridge)
 * Depends: pdf.js lib (cdnjs), showToast() from index.html shell,
 *          switchTab() from index.html shell
 */
(() => {
  'use strict';

  /* ── Setup pdf.js worker ─────────────────────────────────── */
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ── DOM refs ────────────────────────────────────────────── */
  const dropzone    = document.getElementById('pdfDropzone');
  const fileInput   = document.getElementById('pdfFileInput');
  const fileChip    = document.getElementById('pdfFileChip');
  const fileNameEl  = document.getElementById('pdfFileName');
  const removeBtn   = document.getElementById('pdfRemoveBtn');
  const output      = document.getElementById('pdfOutput');
  const statusEl    = document.getElementById('pdfStatus');
  const progressWrap= document.getElementById('pdfProgressWrap');
  const progressBar = document.getElementById('pdfProgressBar');
  const progressLbl = document.getElementById('pdfProgressLabel');
  const progressPct = document.getElementById('pdfProgressPct');
  const stats       = document.getElementById('pdfStats');
  const btnExtract  = document.getElementById('pdfBtnExtract');
  const btnCopy     = document.getElementById('pdfBtnCopy');
  const btnDownload = document.getElementById('pdfBtnDownload');
  const btnSend     = document.getElementById('pdfBtnSendReader');
  const btnClear    = document.getElementById('pdfBtnClear');

  let selectedFile = null;

  /* ── Status helper ───────────────────────────────────────── */
  function setStatus(msg, type = '') {
    statusEl.textContent = msg;
    statusEl.className = 'pdf-status' + (type ? ' ' + type : '');
  }

  /* ── File validation & select ────────────────────────────── */
  function selectFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setStatus('⚠️ Vui lòng chọn file PDF hợp lệ.', 'err');
      showToast('⚠️ Chỉ chấp nhận file PDF!');
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name;
    fileChip.classList.add('visible');
    btnExtract.disabled = false;
    setStatus(`Đã chọn: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    clearOutput();
  }

  /* ── Dropzone events ─────────────────────────────────────── */
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  fileInput.addEventListener('change', e => selectFile(e.target.files[0]));

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    selectFile(e.dataTransfer.files[0]);
  });

  // Global drop anywhere
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') selectFile(f);
  });

  removeBtn.addEventListener('click', e => { e.stopPropagation(); clearAll(); });

  /* ── Extract ─────────────────────────────────────────────── */
  async function extractText() {
    if (!selectedFile) { showToast('⚠️ Chưa chọn file PDF!'); return; }
    if (typeof pdfjsLib === 'undefined') {
      showToast('❌ PDF.js chưa tải xong, thử lại!');
      return;
    }

    btnExtract.disabled = true;
    btnExtract.textContent = '⏳ Đang xử lý…';
    progressWrap.classList.add('visible');
    stats.classList.remove('visible');
    output.value = '';
    btnCopy.disabled = btnDownload.disabled = btnSend.disabled = true;

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it => it.str).join(' ').replace(/ {2,}/g, ' ').trim();
        fullText += pageText + '\n\n';

        const pct = Math.round((i / pdf.numPages) * 100);
        progressBar.style.width = pct + '%';
        progressLbl.textContent = `Trang ${i} / ${pdf.numPages}`;
        progressPct.textContent = pct + '%';
        setStatus(`⏳ Trang ${i}/${pdf.numPages}…`);
      }

      const result = fullText.trim();
      output.value = result;

      // Stats
      const words = result.split(/\s+/).filter(Boolean).length;
      document.getElementById('pdfStatPages').textContent = pdf.numPages;
      document.getElementById('pdfStatWords').textContent = words.toLocaleString('vi-VN');
      document.getElementById('pdfStatChars').textContent = result.length.toLocaleString('vi-VN');
      stats.classList.add('visible');

      setStatus('✅ Trích xuất thành công!', 'ok');
      showToast('✅ Trích xuất hoàn tất!');
      btnCopy.disabled = btnDownload.disabled = btnSend.disabled = false;

    } catch (err) {
      console.error('[pdf.js module]', err);
      setStatus('❌ Lỗi đọc PDF: ' + err.message, 'err');
      showToast('❌ Có lỗi xảy ra!');
    } finally {
      btnExtract.disabled = false;
      btnExtract.innerHTML = '⚡ Trích xuất';
      progressBar.style.width = '100%';
    }
  }

  /* ── Copy ────────────────────────────────────────────────── */
  async function copyText() {
    if (!output.value) { showToast('⚠️ Không có nội dung.'); return; }
    try {
      await navigator.clipboard.writeText(output.value);
    } catch {
      output.select();
      document.execCommand('copy');
    }
    showToast('📋 Đã sao chép!');
    setStatus('📋 Đã sao chép!', 'ok');
  }

  /* ── Download ────────────────────────────────────────────── */
  function downloadText() {
    if (!output.value) { showToast('⚠️ Không có nội dung.'); return; }
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: (selectedFile ? selectedFile.name.replace(/\.pdf$/i, '') : 'output') + '.txt'
    });
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇ Đang tải xuống…');
  }

  /* ── Bridge: send to Novel Reader ────────────────────────── */
  function sendToReader() {
    const text = output.value.trim();
    if (!text) { showToast('⚠️ Không có nội dung để gửi.'); return; }

    // Delegate to NovelModule via public API
    if (window.NovelModule && typeof window.NovelModule.loadText === 'function') {
      const title = selectedFile ? selectedFile.name.replace(/\.pdf$/i, '') : 'PDF';
      window.NovelModule.loadText(text, title);
      // Switch to novel tab
      if (typeof switchTab === 'function') switchTab('novel');
      showToast('📖 Đã gửi sang Novel Reader!');
    } else {
      showToast('⚠️ Novel Reader chưa sẵn sàng.');
    }
  }

  /* ── Clear ───────────────────────────────────────────────── */
  function clearOutput() {
    output.value = '';
    progressBar.style.width = '0%';
    progressWrap.classList.remove('visible');
    stats.classList.remove('visible');
    btnCopy.disabled = btnDownload.disabled = btnSend.disabled = true;
  }

  function clearAll() {
    selectedFile = null;
    fileInput.value = '';
    fileChip.classList.remove('visible');
    fileNameEl.textContent = '–';
    btnExtract.disabled = true;
    clearOutput();
    setStatus('Chưa chọn file');
    showToast('🗑 Đã xoá tất cả');
  }

  /* ── Wire up button clicks ───────────────────────────────── */
  btnExtract.addEventListener('click', extractText);
  btnCopy.addEventListener('click', copyText);
  btnDownload.addEventListener('click', downloadText);
  btnSend.addEventListener('click', sendToReader);
  btnClear.addEventListener('click', clearAll);

  /* ── Public API ──────────────────────────────────────────── */
  window.PdfModule = { selectFile, extractText, clearAll };

})();
