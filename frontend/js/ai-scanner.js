// AI Invoice Scanner (Gemini) — rasm tanlash, brauzerda JPEG'ga keltirish (HEIC/katta fayl muammosi yo'q),
// chap/o'ng burish, kattalashtirib ko'rish (lightbox), uzun nakladnoyni 2 bo'lakda o'qish, aniq xato sababi.
const AIScanner = {
  selectedFile: null,     // yuboriladigan JPEG (normallashtirilgan)
  sourceBitmap: null,     // asl rasm (ImageBitmap yoki HTMLImageElement)
  rotation: 0,            // 0/90/180/270
  scannedRows: [],
  scannedMeta: {},
  isAnalyzing: false,
  MAX_PX: 2400,

  init() { this.bindEvents(); this.bindLightbox(); },

  bindEvents() {
    const dropzone = document.getElementById('ai-dropzone');
    document.getElementById('btn-open-ai-modal')?.addEventListener('click', () => this.openModal());
    document.getElementById('btn-close-ai-modal')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btn-cancel-ai')?.addEventListener('click', () => this.closeModal());
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files?.length) this.handleFileSelected(e.dataTransfer.files[0]); });
    }
    [document.getElementById('ai-file-input'), document.getElementById('ai-camera-input')].forEach(inp => {
      inp?.addEventListener('change', (e) => { if (e.target.files?.length) this.handleFileSelected(e.target.files[0]); });
    });
    // Clipboard'dan rasm (Ctrl+V) — modal ochiq bo'lsa
    document.addEventListener('paste', (e) => {
      if (!document.getElementById('modal-ai-scanner')?.classList.contains('active')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); this.handleFileSelected(item.getAsFile()); }
    });
    document.getElementById('btn-ai-reselect')?.addEventListener('click', () => this.resetToDropzone());
    document.getElementById('btn-ai-rotate')?.addEventListener('click', () => this.rotate(90));
    document.getElementById('btn-ai-rotate-left')?.addEventListener('click', () => this.rotate(-90));
    document.getElementById('btn-ai-zoom')?.addEventListener('click', () => this.openLightbox());
    document.getElementById('ai-preview-img')?.addEventListener('click', () => this.openLightbox());
    document.getElementById('btn-start-ai-scan')?.addEventListener('click', () => this.startAnalysis());
    document.getElementById('btn-ai-rescan')?.addEventListener('click', () => this.backToPreview());
    document.getElementById('btn-apply-ai-rows')?.addEventListener('click', () => this.applyRowsToGrid());
  },

  openModal() { document.getElementById('modal-ai-scanner')?.classList.add('active'); this.resetState(); },
  closeModal() { document.getElementById('modal-ai-scanner')?.classList.remove('active'); },

  _zones(view) {
    const z = { drop: 'ai-dropzone', preview: 'ai-preview-zone', loading: 'ai-loading-zone', results: 'ai-results-zone' };
    Object.entries(z).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.style.display = k === view ? (k === 'drop' || k === 'loading' ? 'flex' : 'block') : 'none'; });
    const btnStart = document.getElementById('btn-start-ai-scan'), btnApply = document.getElementById('btn-apply-ai-rows'), btnRescan = document.getElementById('btn-ai-rescan');
    if (btnStart) { btnStart.style.display = view === 'results' ? 'none' : 'inline-flex'; btnStart.disabled = view !== 'preview'; btnStart.style.opacity = view === 'preview' ? '1' : '0.6'; btnStart.innerHTML = '⚡ Tahlilni boshlash'; }
    if (btnApply) btnApply.style.display = view === 'results' ? 'inline-flex' : 'none';
    if (btnRescan) btnRescan.style.display = view === 'results' ? 'inline-flex' : 'none';
    const c1000 = document.getElementById('ai-multiply-1000-container'); if (c1000 && view !== 'results') c1000.style.display = 'none';
  },
  resetState() {
    this.selectedFile = null; this.sourceBitmap = null; this.rotation = 0; this.scannedRows = []; this.scannedMeta = {}; this.isAnalyzing = false;
    ['ai-file-input', 'ai-camera-input'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const chk = document.getElementById('ai-chk-split'); if (chk) chk.checked = false;
    this._zones('drop');
  },
  resetToDropzone() { this.resetState(); },
  backToPreview() { this.scannedRows = []; this._zones('preview'); },

  // 'Повтор' belgili qatorlar: bazadan (MoySklad) Код модели bo'yicha qidiriladi.
  //  - shu rang bazada bor -> mavjud tovar (ms_product_id, faqat soni/narx)
  //  - model bor, rang yo'q -> mavjud modelga yangi rang (custom_model, model raqami bazadagidek)
  //  - topilmasa -> qator shubhali belgilanadi (qo'lda "Bazadan tovar")
  async linkRepeats(rows) {
    const norm = s => String(s || '').toLowerCase().replace(/[\s\-_.,/]+/g, '');
    const colorNames = (c) => { const refs = (typeof References !== 'undefined' && References.data?.colors) || []; const n = norm(c); const hit = refs.find(x => typeof x === 'object' && [x.name, x.name_ru, x.name_tr, x.name_en].filter(Boolean).some(v => norm(v) === n)); return hit ? [hit.name, hit.name_ru, hit.name_tr, hit.name_en].filter(Boolean).map(norm) : [n]; };
    const byCode = {}; let linked = 0, newColor = 0, missing = 0;
    for (const r of rows) {
      const fc = (r.factory_code || '').trim(); if (!fc) { missing++; r.ai_repeat_result = 'missing'; continue; }
      const key = norm(fc);
      if (!byCode[key]) {
        try { const res = await fetch(`/api/moysklad/products/search?q=${encodeURIComponent(fc)}`); const d = await res.json(); byCode[key] = (d.items || []).filter(p => norm(p.fields?.factory_code) === key || norm(p.article).startsWith(key)); }
        catch (e) { byCode[key] = []; }
      }
      const cands = byCode[key];
      if (!cands.length) { missing++; r.ai_repeat_result = 'missing'; continue; }
      const cn = colorNames(r.color);
      const same = cands.find(p => cn.includes(norm(p.fields?.color)));
      if (same) {
        Object.assign(r, { ms_product_id: same.id, ms_article: same.article || '', ms_code: same.code || '', ms_name: same.name || '', ms_model_code: same.fields?.model_code || '', custom_articul: true, articul: same.article || '', code: same.code || '', full_name: same.name || '',
          product_type: same.fields?.product_type || r.product_type, brand: same.fields?.brand || r.brand, size: same.fields?.size || r.size, series: same.fields?.series || r.series, collection: same.fields?.collection || r.collection, season: same.fields?.season || r.season, color: same.fields?.color || r.color, colors: [same.fields?.color || r.color] });
        if (!(parseFloat(r.price_buy) > 0)) r.price_buy = same.price_buy || 0; if (!(parseFloat(r.price_sale) > 0)) r.price_sale = same.price_sale || 0;
        r.ai_repeat_result = 'existing'; linked++;
      } else {
        const p = cands[0]; let model = (p.fields?.model_code || '').toUpperCase(); if (!model) { const m = String(p.article || '').toUpperCase().match(/^([A-Z0-9]{2,4}[A-Z]{2,4}\d{5})/); model = m ? m[1] : ''; }
        if (model) { Object.assign(r, { custom_model: true, model_code: model, product_type: p.fields?.product_type || r.product_type, brand: p.fields?.brand || r.brand, series: p.fields?.series || r.series, collection: p.fields?.collection || r.collection, season: p.fields?.season || r.season }); r.ai_repeat_result = 'new_color'; newColor++; }
        else { missing++; r.ai_repeat_result = 'missing'; }
      }
    }
    if (typeof Grid !== 'undefined') { Grid.recalculateAll(); Grid.render(); Grid.triggerAutoSave(); }
    if (typeof showToast === 'function') showToast(`♻️ Повтор: ${linked} ta mavjud tovar bog'landi, ${newColor} ta mavjud modelga yangi rang${missing ? `, ${missing} ta bazada topilmadi (qo'lda "Bazadan tovar")` : ''}`, missing ? 'warning' : 'success');
  },

  // ── Rasmni tayyorlash ──
  async handleFileSelected(file) {
    if (!file) return;
    const isImage = file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name || '');
    if (!isImage) { alert("Iltimos, rasm faylini yuklang (JPG, PNG, WEBP, HEIC)."); return; }
    const fn = document.getElementById('ai-filename'); if (fn) fn.textContent = file.name || 'rasm';
    this.rotation = 0;
    try {
      this.sourceBitmap = await this._decode(file);
    } catch (e) {
      console.warn('Brauzer rasmni ochа olmadi, asl fayl yuboriladi:', e);
      this.sourceBitmap = null;
      this.selectedFile = file; // server (pillow-heif) urinib ko'radi
      const img = document.getElementById('ai-preview-img'); if (img) img.src = URL.createObjectURL(file);
      this._size(file.size, '(brauzer ocha olmadi — serverda ochiladi)');
      this._zones('preview');
      return;
    }
    await this.rebuild();
    this._zones('preview');
  },
  async _decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* HEIC va h.k. */ }
    }
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  },
  // Asl rasm → burish + kichraytirish → JPEG
  async rebuild() {
    if (!this.sourceBitmap) return;
    const sw = this.sourceBitmap.width, sh = this.sourceBitmap.height;
    const rot = ((this.rotation % 360) + 360) % 360;
    const scale = Math.min(1, this.MAX_PX / Math.max(sw, sh));
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = rot % 180 ? h : w; canvas.height = rot % 180 ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(this.sourceBitmap, -w / 2, -h / 2, w, h);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    this.selectedFile = new File([blob], 'invoice.jpg', { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = document.getElementById('ai-preview-img'); if (img) img.src = url;
    const lb = document.getElementById('lb-img'); if (lb && document.getElementById('ai-lightbox')?.classList.contains('active')) { lb.src = url; this.lbFit(); }
    this._size(blob.size, `${canvas.width}×${canvas.height}${rot ? `, ${rot}°` : ''}`);
    // uzun (baland) rasm — 2 bo'lak taklifi
    const chk = document.getElementById('ai-chk-split'); if (chk && !chk.dataset.touched) chk.checked = canvas.height / canvas.width > 1.6;
  },
  _size(bytes, extra = '') {
    const el = document.getElementById('ai-filesize'); if (!el) return;
    el.textContent = (bytes > 1024 * 1024 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(0) + ' KB') + (extra ? ' · ' + extra : '');
  },
  async rotate(deg) {
    if (!this.sourceBitmap) { if (typeof showToast === 'function') showToast("Bu rasmni brauzerda burib bo'lmaydi", 'error'); return; }
    this.rotation += deg;
    await this.rebuild();
  },

  // ── Lightbox (kattalashtirish, surish, burish) ──
  lb: { zoom: 1, x: 0, y: 0, drag: null },
  bindLightbox() {
    const box = document.getElementById('ai-lightbox'), stage = document.getElementById('lb-stage'), img = document.getElementById('lb-img');
    if (!box || !stage || !img) return;
    document.getElementById('lb-close')?.addEventListener('click', () => this.closeLightbox());
    document.getElementById('lb-zoom-in')?.addEventListener('click', () => this.lbZoom(1.25));
    document.getElementById('lb-zoom-out')?.addEventListener('click', () => this.lbZoom(0.8));
    document.getElementById('lb-zoom-fit')?.addEventListener('click', () => this.lbFit());
    document.getElementById('lb-rotate-left')?.addEventListener('click', () => this.rotate(-90));
    document.getElementById('lb-rotate-right')?.addEventListener('click', () => this.rotate(90));
    stage.addEventListener('wheel', (e) => { e.preventDefault(); this.lbZoom(e.deltaY < 0 ? 1.15 : 0.87); }, { passive: false });
    stage.addEventListener('mousedown', (e) => { this.lb.drag = { sx: e.clientX, sy: e.clientY, ox: this.lb.x, oy: this.lb.y }; stage.classList.add('dragging'); });
    window.addEventListener('mousemove', (e) => { if (!this.lb.drag) return; this.lb.x = this.lb.drag.ox + (e.clientX - this.lb.drag.sx); this.lb.y = this.lb.drag.oy + (e.clientY - this.lb.drag.sy); this.lbApply(); });
    window.addEventListener('mouseup', () => { this.lb.drag = null; stage.classList.remove('dragging'); });
    // sensorli: bir barmoq — surish, ikki barmoq — zoom
    let pinch = null;
    stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) this.lb.drag = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: this.lb.x, oy: this.lb.y }; else if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: this.lb.zoom }; }, { passive: true });
    stage.addEventListener('touchmove', (e) => { if (e.touches.length === 1 && this.lb.drag) { this.lb.x = this.lb.drag.ox + (e.touches[0].clientX - this.lb.drag.sx); this.lb.y = this.lb.drag.oy + (e.touches[0].clientY - this.lb.drag.sy); this.lbApply(); } else if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); this.lb.zoom = Math.min(8, Math.max(0.1, pinch.z * d / pinch.d)); this.lbApply(); } }, { passive: true });
    stage.addEventListener('touchend', () => { this.lb.drag = null; pinch = null; });
    document.addEventListener('keydown', (e) => { if (!box.classList.contains('active')) return; if (e.key === 'Escape') this.closeLightbox(); if (e.key === '+' || e.key === '=') this.lbZoom(1.25); if (e.key === '-') this.lbZoom(0.8); });
    img.addEventListener('load', () => this.lbFit());
  },
  openLightbox() {
    const src = document.getElementById('ai-preview-img')?.src; if (!src) return;
    const img = document.getElementById('lb-img'); img.src = src;
    document.getElementById('ai-lightbox')?.classList.add('active');
    setTimeout(() => this.lbFit(), 30);
  },
  closeLightbox() { document.getElementById('ai-lightbox')?.classList.remove('active'); },
  lbFit() {
    const stage = document.getElementById('lb-stage'), img = document.getElementById('lb-img');
    if (!stage || !img || !img.naturalWidth) return;
    this.lb.zoom = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight, 1);
    this.lb.x = 0; this.lb.y = 0; this.lbApply();
  },
  lbZoom(f) { this.lb.zoom = Math.min(8, Math.max(0.1, this.lb.zoom * f)); this.lbApply(); },
  lbApply() {
    const img = document.getElementById('lb-img'); if (!img) return;
    img.style.transform = `translate(calc(-50% + ${this.lb.x}px), calc(-50% + ${this.lb.y}px)) scale(${this.lb.zoom})`;
    const l = document.getElementById('lb-zoom-label'); if (l) l.textContent = Math.round(this.lb.zoom * 100) + '%';
  },

  // ── Tahlil ──
  async _post(file) {
    const fd = new FormData(); fd.append('file', file);
    const resp = await fetch('/api/ai/scan-invoice', { method: 'POST', body: fd });
    let data = {};
    try { data = await resp.json(); } catch (_) {}
    if (!resp.ok) throw new Error((data && (data.detail?.message || data.detail || data.message)) || `Server xatosi ${resp.status}`);
    return data;
  },
  // Uzun nakladnoy: rasmni ustma-ust tushadigan 2 bo'lakka bo'lish (yuqori 58% / pastki 58%)
  async _splitFiles() {
    if (!this.selectedFile) return [];
    const bmp = await this._decode(this.selectedFile);
    const parts = [];
    const cut = Math.round(bmp.height * 0.58);
    for (const [y, h] of [[0, cut], [bmp.height - cut, cut]]) {
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, y, bmp.width, h, 0, 0, bmp.width, h);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      parts.push(new File([blob], 'part.jpg', { type: 'image/jpeg' }));
    }
    return parts;
  },
  _rowKey(r) { return [r.product_type, r.factory_code || r.model_code || r.articul, r.brand, r.size, r.quantity, r.price_buy].map(x => String(x ?? '').trim().toLowerCase()).join('|'); },

  async startAnalysis() {
    if (!this.selectedFile) { document.getElementById('ai-file-input')?.click(); return; }
    if (this.isAnalyzing) return;
    this.isAnalyzing = true;
    this._zones('loading');
    const split = document.getElementById('ai-chk-split')?.checked;
    try {
      let data;
      if (split) {
        const parts = await this._splitFiles();
        const [a, b] = await Promise.all(parts.map(p => this._post(p)));
        const rows = [...(a.rows || [])];
        const seen = new Set(rows.map(r => this._rowKey(r)));
        (b.rows || []).forEach(r => { const k = this._rowKey(r); if (!seen.has(k)) { seen.add(k); rows.push(r); } });
        data = { status: rows.length ? 'success' : 'warning', rows, kontragent: a.kontragent || b.kontragent, phone: a.phone || b.phone, date: a.date || b.date,
                 message: rows.length ? '' : (a.message || b.message) };
      } else {
        data = await this._post(this.selectedFile);
      }
      this.isAnalyzing = false;
      if (data.status === 'success' && data.rows?.length) {
        this.scannedRows = data.rows;
        this.scannedMeta = { kontragent: data.kontragent || '', phone: data.phone || '', date: data.date || '' };
        this.renderResults(data.rows, this.scannedMeta);
      } else {
        const msg = data.message || "Rasmda tovar qatorlarini aniqlab bo'lmadi.";
        this._zones('preview');
        const btnStart = document.getElementById('btn-start-ai-scan'); if (btnStart) btnStart.innerHTML = '⚡ Qayta tahlil qilish';
        alert(msg + "\n\nMaslahat: rasmni kattalashtirib (🔍) matn o'qilishini tekshiring, kerak bo'lsa buring; uzun jadvalda '2 bo'lakda o'qish'ni yoqing.");
        if (typeof showToast === 'function') showToast(msg, 'error');
      }
    } catch (e) {
      console.error('AI scan error:', e);
      this.isAnalyzing = false;
      this._zones('preview');
      const btnStart = document.getElementById('btn-start-ai-scan'); if (btnStart) btnStart.innerHTML = '⚡ Qayta tahlil qilish';
      alert('Rasmni tahlil qilishda xatolik: ' + (e.message || 'tarmoq xatosi'));
    }
  },

  renderResults(rows, meta = {}) {
    this._zones('results');
    const badge = document.getElementById('ai-results-badge');
    if (badge) {
      let t = `✨ ${rows.length} ta tovar qatori aniqlandi`;
      if (meta.kontragent) t += ` | 🤝 Kontragent: <b>${meta.kontragent}</b>`;
      if (meta.phone) t += ` | 📞 Tel: <b>${meta.phone}</b>`;
      const low = rows.filter(r => (r.ai_confidence || 1) < 0.85).length;
      if (low) t += ` | <span style="color:#fbbf24">⚠️ ${low} ta qatorda ishonch past — jadvalda sariq</span>`;
      badge.innerHTML = t;
    }
    const c1000 = document.getElementById('ai-multiply-1000-container'), chk = document.getElementById('ai-chk-multiply-1000');
    if (c1000 && chk) {
      c1000.style.display = 'flex';
      const prices = rows.map(r => r.price_buy || r.price_sale || 0).filter(p => p > 0);
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      chk.checked = avg > 0 && avg < 1500;
    }
    const tbody = document.getElementById('ai-results-tbody'); if (!tbody) return;
    tbody.innerHTML = rows.map((r, i) => {
      const conf = Math.round((r.ai_confidence || 1) * 100);
      return `<tr>
        <td style="color: var(--text-muted); text-align: center;">${i + 1}</td>
        <td><b>${r.product_type || '-'}</b>${r.ai_ambiguous && r.ai_alternative ? `<div style="font-size: 0.72rem; color: #fbbf24; margin-top: 2px;">⚠️ Variant: <b>${r.ai_alternative}</b></div>` : ''}</td>
        <td><span style="font-family: monospace; font-size: 0.75rem;">${r.articul || r.model_code || '-'}</span></td>
        <td>${r.brand || '-'}</td>
        <td><span class="kbd">${r.size || 'M'}</span></td>
        <td style="text-align: right; font-weight: 700;">${r.quantity}${r.raw_quantity && r.raw_quantity !== String(r.quantity) ? `<small style="display: block; font-size: 0.68rem; color: var(--text-muted); font-weight: normal;">${r.raw_quantity}</small>` : ''}</td>
        <td style="text-align: right; color: var(--text-muted);">${(r.price_buy || 0).toLocaleString()}</td>
        <td style="text-align: right; color: #38bdf8; font-weight: 700;">${(r.price_sale || 0).toLocaleString()}</td>
        <td style="text-align: center;"><span class="badge ${conf >= 85 ? 'badge-synced' : 'badge-local'}" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">${conf}%</span></td>
      </tr>`;
    }).join('');
  },

  applyRowsToGrid() {
    if (!this.scannedRows?.length) return;
    if (this.scannedMeta?.kontragent) {
      const cp = document.getElementById('header-counterparty');
      if (cp) { const needle = this.scannedMeta.kontragent.trim().toLowerCase(); for (let i = 0; i < cp.options.length; i++) { const t = cp.options[i].text.toLowerCase(); if (t.includes(needle) || needle.includes(t)) { cp.selectedIndex = i; break; } } }
    }
    if (this.scannedMeta?.date) {
      const d = document.getElementById('header-date');
      if (d && !d.value) { try { const dt = new Date(this.scannedMeta.date); if (!isNaN(dt.getTime())) d.value = dt.toISOString().slice(0, 16); } catch (_) {} }
    }
    const mult = document.getElementById('ai-chk-multiply-1000')?.checked;
    const allColors = (typeof References !== 'undefined' && References.data?.colors) || [];
    // Bir model (model_group) — bitta model_key: ranglar bitta model raqamini oladi (Ctrl+Enter bilan ajratilgandek)
    const groupKeys = {};
    this.scannedRows.forEach(r => {
      if (r.model_group !== undefined && r.model_group !== null && typeof Grid !== 'undefined' && Grid.newModelKey) {
        if (!groupKeys[r.model_group]) groupKeys[r.model_group] = Grid.newModelKey();
        r.model_key = groupKeys[r.model_group];
      }
      delete r.model_group; delete r.same_model_as_prev;
    });
    this.scannedRows.forEach(r => {
      if (mult) { if (parseFloat(r.price_buy) > 0) r.price_buy = Math.round(parseFloat(r.price_buy) * 1000); if (parseFloat(r.price_sale) > 0) r.price_sale = Math.round(parseFloat(r.price_sale) * 1000); }
      const raw = r.factory_code || r.model_code || ''; r.factory_code = raw; r.model_code = raw;
      const desc = (r.description || '').trim();
      if (desc && allColors.some(c => (typeof c === 'object' ? c.name : c).toLowerCase() === desc.toLowerCase())) { if (!r.color) r.color = desc; if (!r.colors?.length) r.colors = [desc]; r.description = ''; }
      if (r.color && !r.colors?.length) r.colors = [r.color];
    });
    if (typeof Grid !== 'undefined') {
      if (Grid.pushUndo) Grid.pushUndo(`AI: ${this.scannedRows.length} qator qo'shish`);
      const existing = Grid.rows.filter(r => r.product_type || r.price_buy > 0);
      Grid.rows = [...existing, ...this.scannedRows];
      Grid.recalculateAll(); Grid.render(); Grid.triggerAutoSave();
      // 'Повтор' qatorlari — bazadan Код модели bo'yicha qidirib bog'lash (fonda)
      const repeats = this.scannedRows.filter(r => r.ai_repeat);
      if (repeats.length) this.linkRepeats(repeats);
    }
    this.closeModal();
    if (typeof showToast === 'function') showToast(`✨ ${this.scannedRows.length} ta qator jadvalga joylandi${this.scannedMeta?.kontragent ? ` (Kontragent: ${this.scannedMeta.kontragent})` : ''}${mult ? ' [x1000]' : ''}`, 'success');
  }
};
document.getElementById('ai-chk-split')?.addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
