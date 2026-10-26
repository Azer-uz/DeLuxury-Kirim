// grid-extras.js — Grid kengaytmalari: qator belgilash + ommaviy amallar, Bekor qilish (undo),
// shubhali qiymatlarni sariq belgilash, hujjat raqami (avto / qo'lda) boshqaruvi.
// grid.js ga tegmasdan Grid obyektini o'raydi (render/bindCellEvents/deleteRow... hook).
(function () {
  if (typeof Grid === 'undefined') return;

  // ───────────────────────── Shubhali qiymat qoidalari ─────────────────────────
  Grid.SUSPECT = {
    price_min_uzs: 1000,      // so'mda narx bundan kichik — x1000 unutilgan
    price_max_uzs: 50000000,  // 50 mln so'mdan katta narx
    markup_max: 300,          // ustama % yuqori chegara
    qty_max: 500,
    ai_conf_min: 0.85,
  };

  // ===== Bazadan (MoySklad) mavjud tovarni qidirib qo'shish =====
  const PS_LOCKED = ['country', 'product_type', 'brand', 'factory_code', 'series', 'collection', 'season', 'size', 'color', 'description'];
  const ProductSearch = {
    items: [], timer: null, seq: 0,
    open() {
      const m = document.getElementById('modal-product-search'); if (!m) return;
      m.classList.add('active');
      const inp = document.getElementById('ps-query'); if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 50); }
      document.getElementById('ps-tbody').innerHTML = '<tr><td colspan="10" style="color: var(--text-muted);">Qidiruv uchun yozing...</td></tr>';
      document.getElementById('ps-status').textContent = '';
    },
    isOpen() { return !!document.getElementById('modal-product-search')?.classList.contains('active'); },
    close() {
      document.getElementById('modal-product-search')?.classList.remove('active');
      if (this.lastAdded !== undefined && this.lastAdded !== null) {
        const idx = this.lastAdded; this.lastAdded = null;
        const fld = this.lastAddedField || 'quantity'; this.lastAddedField = null;
        setTimeout(() => { const q = document.querySelector(fld === 'color' ? `.color-tag-input[data-row="${idx}"]` : `input[data-field="${fld}"][data-row="${idx}"]`); if (q) { q.focus(); if (q.select) q.select(); } }, 60);
      }
    },
    esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
    async search(q) {
      const my = ++this.seq; const st = document.getElementById('ps-status'); const tb = document.getElementById('ps-tbody');
      if ((q || '').trim().length < 2) { tb.innerHTML = '<tr><td colspan="10" style="color: var(--text-muted);">Kamida 2 ta belgi yozing</td></tr>'; return; }
      st.textContent = 'Qidirilmoqda...';
      let d;
      try { const r = await fetch(`/api/moysklad/products/search?q=${encodeURIComponent(q.trim())}`); d = await r.json(); } catch (e) { d = { items: [], error: 'Tarmoq xatosi' }; }
      if (my !== this.seq) return;
      this.items = d.items || [];
      st.textContent = d.error ? ('Xato: ' + d.error) : (this.items.length && d.exact === false ? `Aniq moslik yo'q — o'xshashlari: ${this.items.length} ta` : `${this.items.length} ta topildi`);
      if (!this.items.length) { tb.innerHTML = '<tr><td colspan="10" style="color: var(--text-muted);">Topilmadi</td></tr>'; return; }
      const fmt = (n) => (n || n === 0) ? Number(n).toLocaleString('ru-RU') : '—';
      tb.innerHTML = this.items.map((p, i) => `
        <tr>
          <td><b>${this.esc(p.name)}</b>${p.path ? `<div style="font-size:0.72rem;color:var(--text-muted)">${this.esc(p.path)}</div>` : ''}</td>
          <td style="font-family: monospace;">${this.esc(p.article)}</td>
          <td style="font-family: monospace;">${this.esc(p.code)}</td>
          <td>${this.esc(p.fields?.brand)}</td><td>${this.esc(p.fields?.color)}</td><td>${this.esc(p.fields?.size)}</td>
          <td style="text-align:right">${fmt(p.price_buy)}</td><td style="text-align:right">${fmt(p.price_sale)}</td>
          <td style="text-align:right">${p.stock === undefined || p.stock === null ? '—' : fmt(p.stock)}</td>
          <td style="white-space: nowrap;"><button class="btn btn-primary btn-sm" data-ps-add="${i}" title="Aynan shu tovar (mavjud) — faqat soni/narx">➕ Qo'shish</button>
            <button class="btn btn-secondary btn-sm" data-ps-color="${i}" title="Shu modelga YANGI RANG: model raqami bazadagidek qoladi, yangi rang bilan yangi tovar yaratiladi" style="margin-left: 4px;">🎨 Yangi rang</button></td>
        </tr>`).join('');
      tb.querySelectorAll('[data-ps-add]').forEach(b => b.onclick = () => this.add(parseInt(b.getAttribute('data-ps-add'))));
      tb.querySelectorAll('[data-ps-color]').forEach(b => b.onclick = () => this.addNewColor(parseInt(b.getAttribute('data-ps-color'))));
    },
    add(i) {
      const p = this.items[i]; if (!p) return;
      const f = p.fields || {};
      const row = Grid.createEmptyRow({
        country: f.country || '', product_type: f.product_type || '', brand: f.brand || '', factory_code: f.factory_code || '',
        series: f.series || '', collection: f.collection || '', season: f.season || '', size: f.size || '', color: f.color || '',
        description: '', quantity: 1, price_buy: p.price_buy || 0, price_sale: p.price_sale || 0,
        ms_product_id: p.id, ms_article: p.article || '', ms_code: p.code || '', ms_name: p.name || '', ms_model_code: f.model_code || ''
      });
      row.custom_articul = true; row.articul = p.article || ''; row.code = p.code || ''; row.full_name = p.name || '';
      if (typeof Grid.pushUndo === 'function') Grid.pushUndo('Bazadan tovar qo\'shish');
      // oxirgi qator bo'sh bo'lsa — uning o'rniga
      const last = Grid.rows[Grid.rows.length - 1];
      if (last && !Grid.isUsefulRow(last) && !last.ms_product_id) Grid.rows[Grid.rows.length - 1] = row; else Grid.rows.push(row);
      Grid.recalculateAll(); Grid.render(); Grid.triggerAutoSave();
      if (typeof showToast === 'function') showToast(`📦 Bazadan qo'shildi: ${p.name} (${p.article || p.code})`, 'success');
      this.lastAdded = Grid.rows.length - 1;
      // oyna ochiq qoladi — ketma-ket bir nechta tovar qo'shish uchun; yopilganda oxirgi qo'shilgan qatorning "Soni" katagiga o'tadi
      const st = document.getElementById('ps-status'); if (st) st.textContent = `✅ Qo'shildi: ${p.article || p.code}. Yana qidiring yoki Esc bilan yoping`;
      const inp = document.getElementById('ps-query'); if (inp) { inp.value = ''; inp.focus(); }
      this.items = []; document.getElementById('ps-tbody').innerHTML = '<tr><td colspan="10" style="color: var(--text-muted);">Keyingi tovarni qidiring...</td></tr>';
    },
    // Mavjud modelga yangi rang: model raqami bazadagidek, rang bo'sh (foydalanuvchi tanlaydi), yangi tovar
    addNewColor(i) {
      const p = this.items[i]; if (!p) return;
      const f = p.fields || {};
      let model = (f.model_code || '').trim().toUpperCase();
      if (!model && p.article) {
        const art = String(p.article).trim().toUpperCase();
        const m = art.match(/^([A-Z0-9]{2,4}[A-Z]{2,4}\d{5})/); model = m ? m[1] : art;
      }
      if (!model) { if (typeof showToast === 'function') showToast('Bu tovarda model raqami topilmadi', 'error'); return; }
      // Описание: tovar nomidan tur/brend/kod modeli olib tashlanadi ("Куртка косой карман BV 745 MIGLIORE" -> "косой карман")
      let desc = String(p.name || '');
      [f.product_type, f.brand, f.factory_code, (f.factory_code || '').replace(/-/g, ' '), (f.factory_code || '').replace(/\s+/g, '-')].filter(Boolean).forEach(t => { desc = desc.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '); });
      desc = desc.replace(/\s{2,}/g, ' ').replace(/\s*-\s*\d+\s*$/, '').trim();
      const row = Grid.createEmptyRow({
        country: f.country || '', product_type: f.product_type || '', brand: f.brand || '', factory_code: f.factory_code || '',
        series: f.series || '', collection: f.collection || '', season: f.season || '', size: f.size || '', color: '',
        description: desc, quantity: 1, price_buy: p.price_buy || 0, price_sale: p.price_sale || 0,
        model_code: model, custom_model: true
      });
      if (typeof Grid.pushUndo === 'function') Grid.pushUndo('Mavjud modelga yangi rang');
      const last = Grid.rows[Grid.rows.length - 1];
      if (last && !Grid.isUsefulRow(last) && !last.ms_product_id) Grid.rows[Grid.rows.length - 1] = row; else Grid.rows.push(row);
      Grid.recalculateAll(); Grid.render(); Grid.triggerAutoSave();
      this.lastAdded = Grid.rows.length - 1; this.lastAddedField = 'color';
      if (typeof showToast === 'function') showToast(`🎨 Model ${model} uchun yangi rang qatori qo'shildi — rangni tanlang`, 'success');
      const st = document.getElementById('ps-status'); if (st) st.textContent = `🎨 ${model}: yangi rang qatori qo'shildi. Yana qidiring yoki Esc bilan yoping`;
      const inp = document.getElementById('ps-query'); if (inp) { inp.value = ''; inp.focus(); }
      this.items = []; document.getElementById('ps-tbody').innerHTML = '<tr><td colspan="10" style="color: var(--text-muted);">Keyingi tovarni qidiring...</td></tr>';
    },
    setup() {
      document.getElementById('btn-open-product-search')?.addEventListener('click', () => this.open());
      document.getElementById('btn-close-product-search')?.addEventListener('click', () => this.close());
      document.getElementById('modal-product-search')?.addEventListener('click', (e) => { if (e.target.id === 'modal-product-search') this.close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) { e.preventDefault(); e.stopPropagation(); this.close(); } }, true);
      const inp = document.getElementById('ps-query');
      inp?.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.search(inp.value), 350); });
      inp?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(this.timer); if (this.items.length && document.getElementById('ps-status').textContent.includes('topildi')) this.add(0); else this.search(inp.value); }
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      });
    }
  };
  Grid.ProductSearch = ProductSearch;
  // Mavjud tovar qatorlari: identifikatsiya kataklari qulf, № katagida belgi
  const MODEL_LOCKED = ['product_type', 'brand', 'factory_code', 'collection', 'season'];
  Grid.lockExistingRows = function () {
    document.querySelectorAll('#grid-tbody tr').forEach((tr, i) => {
      const r = this.rows[i]; if (!r) return;
      if (r.custom_model && !r.ms_product_id) {
        tr.classList.add('row-fixed-model');
        tr.querySelectorAll('input, select').forEach(el => {
          const f = el.getAttribute('data-field');
          if (f && MODEL_LOCKED.includes(f)) { el.readOnly = true; el.disabled = el.tagName === 'SELECT'; el.classList.add('cell-locked'); el.title = `Mavjud model ${r.model_code} — bu maydon bazadagidek qoladi`; }
        });
        const num = tr.querySelector('.cell-num');
        if (num && !num.querySelector('.ms-badge')) num.insertAdjacentHTML('beforeend', ` <span class="ms-badge" title="Mavjud model ${r.model_code} uchun yangi rang (yangi tovar yaratiladi)">🎨</span>`);
        return;
      }
      if (!r.ms_product_id) return;
      tr.classList.add('row-existing');
      tr.querySelectorAll('input, select, textarea').forEach(el => {
        const f = el.getAttribute('data-field');
        if (f && PS_LOCKED.includes(f)) { el.readOnly = true; el.disabled = el.tagName === 'SELECT'; el.classList.add('cell-locked'); el.title = "Bazadan tanlangan mavjud tovar — bu maydon MoySklad'dagidek qoladi"; }
      });
      const num = tr.querySelector('.cell-num');
      if (num && !num.querySelector('.ms-badge')) num.insertAdjacentHTML('beforeend', ' <span class="ms-badge" title="Bazadan (MoySklad) tanlangan mavjud tovar">📦</span>');
    });
  };
  // Ctrl+F — capture bosqichida: katak ichidagi handlerlar stopPropagation qilsa ham, brauzer qidiruvi ochilmaydi
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key || '').toLowerCase() !== 'f') return;
    const gridOpen = document.getElementById('supplies-grid-view')?.style.display !== 'none' && document.getElementById('tab-supplies')?.classList.contains('active');
    if (!gridOpen) return;
    e.preventDefault(); e.stopPropagation();
    if (ProductSearch.isOpen()) document.getElementById('ps-query')?.focus(); else ProductSearch.open();
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    ProductSearch.setup();
    const origRender2 = Grid.render.bind(Grid);
    Grid.render = function () { const r = origRender2(); Grid.lockExistingRows(); return r; };
  });

  // ===== Jadvalni surish: tepada qo'shimcha gorizontal skroll (jadval uzun bo'lsa ham qo'l ostida) + g'ildirak tugmasi bilan surish =====
  Grid.setupPanning = function () {
    const box = document.querySelector('#receipt-table')?.closest('.table-responsive');
    if (!box || box.dataset.panReady) return;
    box.dataset.panReady = '1';
    // 1) Yuqori gorizontal skroll (jadval bilan sinxron)
    const proxy = document.createElement('div'); proxy.className = 'grid-hscroll'; proxy.title = "Jadvalni o'ngga/chapga surish";
    const inner = document.createElement('div'); proxy.appendChild(inner);
    box.parentNode.insertBefore(proxy, box);
    const syncWidth = () => {
      const t = document.getElementById('receipt-table'); inner.style.width = (t ? t.scrollWidth : box.scrollWidth) + 'px';
      const scrollable = getComputedStyle(box).overflowX !== 'visible';  // katta ekranda jadval o'zi skroll qilmaydi — sahifa skroll qiladi
      proxy.style.display = scrollable && box.scrollWidth > box.clientWidth + 2 ? '' : 'none';
    };
    document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', () => setTimeout(syncWidth, 100));
    let lock = false;
    proxy.addEventListener('scroll', () => { if (lock) return; lock = true; box.scrollLeft = proxy.scrollLeft; lock = false; });
    box.addEventListener('scroll', () => { if (lock) return; lock = true; proxy.scrollLeft = box.scrollLeft; lock = false; });
    window.addEventListener('resize', syncWidth);
    const origRender = Grid.render.bind(Grid);
    Grid.render = function () { const r = origRender(); setTimeout(syncWidth, 0); return r; };
    setTimeout(syncWidth, 300);
    // 2) Sichqoncha g'ildiragini (o'rta tugma) bosib turib — to'rt tomonga surish
    let pan = null;
    box.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop };
      box.classList.add('grid-panning');
    });
    document.addEventListener('mousemove', (e) => {
      if (!pan) return;
      box.scrollLeft = pan.l - (e.clientX - pan.x);
      box.scrollTop = pan.t - (e.clientY - pan.y);
    });
    const stop = () => { if (pan) { pan = null; box.classList.remove('grid-panning'); } };
    document.addEventListener('mouseup', stop); window.addEventListener('blur', stop);
    box.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    // (g'ildirakni gorizontalga aylantirish olib tashlandi — katta ekran rejimida sahifa skrollini to'sib qo'yardi)
  };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => Grid.setupPanning(), 500); });

  // MoySklad'da majburiy bo'lgan maydonlar va lug'at qiymatlari (Серия, Размерный ряд)
  Grid.requiredFields = Grid.requiredFields || [];
  Grid.dictValues = Grid.dictValues || {};
  Grid.loadAttributeMeta = async function () {
    try {
      const r = await fetch('/api/attributes/required-fields'); if (r.ok) Grid.requiredFields = (await r.json()).fields || [];
    } catch (e) {}
    for (const f of ['series']) {
      try { const r = await fetch(`/api/attributes/dict-values/${f}`); if (r.ok) Grid.dictValues[f] = (await r.json()).values || []; } catch (e) {}
    }
    const th = document.getElementById('th-series');
    if (th) th.textContent = Grid.requiredFields.includes('series') ? 'Серия *' : 'Серия';
    if (typeof Grid.render === 'function' && Array.isArray(Grid.rows) && Grid.rows.length) Grid.render();
  };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => Grid.loadAttributeMeta(), 800); });

  const hasCyr = s => /[Ѐ-ӿ]/.test(s || '');
  const hasLat = s => /[A-Za-z]/.test(s || '');

  Grid.rowSuspects = function (idx, dupMap = null) {
    const r = this.rows[idx];
    const out = [];
    if (!r || !this.isUsefulRow(r)) return out;
    if (r.ai_repeat && !r.ms_product_id && !r.custom_model) out.push({ field: 'product_type', msg: "Nakladnoyda 'Повтор' — bazada bor tovar, lekin Код модели bo'yicha topilmadi: 'Bazadan tovar' (Ctrl+F) bilan tanlang" });
    if (r.ms_product_id) {
      const q = parseFloat(r.quantity) || 0, pb = parseFloat(r.price_buy) || 0, ps = parseFloat(r.price_sale) || 0;
      if (q <= 0) out.push({ field: 'quantity', msg: 'Soni 0' });
      if (pb === 0) out.push({ field: 'price_buy', msg: 'Tan narx kiritilmagan' });
      if (ps === 0) out.push({ field: 'price_sale', msg: 'Sotuv narxi kiritilmagan' });
      return out;  // mavjud tovar — spravochnik tekshiruvlari shart emas
    }
    const S = this.SUSPECT;
    const cur = this.getCurrency();
    const qty = parseFloat(r.quantity) || 0;
    const pb = parseFloat(r.price_buy) || 0;
    const ps = parseFloat(r.price_sale) || 0;
    const mk = parseFloat(r.markup_pct) || 0;
    const rate = this.getRate() || 1;

    if (pb > 0 && cur === 'UZS' && pb < S.price_min_uzs) out.push({ field: 'price_buy', msg: `Tan narx ${pb} — x1000 unutilganga o'xshaydi` });
    if (pb > S.price_max_uzs && cur === 'UZS') out.push({ field: 'price_buy', msg: `Tan narx juda katta (${pb.toLocaleString()})` });
    if (ps > 0 && ps < S.price_min_uzs) out.push({ field: 'price_sale', msg: `Sotuv narxi ${ps} — x1000 unutilganga o'xshaydi` });
    if (ps > S.price_max_uzs) out.push({ field: 'price_sale', msg: `Sotuv narxi juda katta (${ps.toLocaleString()})` });
    if (pb > 0 && ps > 0 && ps < pb * rate) out.push({ field: 'price_sale', msg: `Sotuv narxi tan narxdan past (${ps.toLocaleString()} < ${(pb * rate).toLocaleString()})` });
    if (pb > 0 && ps > 0 && mk === 0) out.push({ field: 'markup_pct', msg: 'Ustama 0%' });
    if (mk > S.markup_max) out.push({ field: 'markup_pct', msg: `Ustama ${mk}% — chegaradan yuqori (${S.markup_max}%)` });
    if (pb === 0) out.push({ field: 'price_buy', msg: 'Tan narx kiritilmagan' });
    if (ps === 0) out.push({ field: 'price_sale', msg: 'Sotuv narxi kiritilmagan' });
    if (qty <= 0) out.push({ field: 'quantity', msg: 'Soni 0' });
    if (qty > S.qty_max) out.push({ field: 'quantity', msg: `Soni ${qty} — juda ko'p` });
    if (qty !== Math.round(qty)) out.push({ field: 'quantity', msg: 'Soni butun son emas' });

    const pt = (r.product_type || '').trim();
    if (pt) {
      const info = References.getProductTypeInfo ? References.getProductTypeInfo(pt) : {};
      if (!info || !info.group_code) out.push({ field: 'product_type', msg: `"${pt}" ierarxiyada yo'q yoki guruh kodi yo'q` });
    } else out.push({ field: 'product_type', msg: 'Вид товара tanlanmagan' });
    const brand = (r.brand || '').trim();
    if (brand) {
      const brands = (References.data?.brands || []).map(b => (typeof b === 'object' ? b.name : b).toLowerCase());
      if (brands.length && !brands.includes(brand.toLowerCase())) out.push({ field: 'brand', msg: `Brend "${brand}" spravochnikda yo'q` });
    }
    const coll = (r.collection || '').trim();
    if (coll && References.getSeasonCode && !References.getSeasonCode(coll)) out.push({ field: 'collection', msg: `Kolleksiya "${coll}" uchun mavsum kodi yo'q` });
    (Grid.requiredFields || []).forEach(f => {
      if (['category', 'product_type', 'model_code', 'collection', 'color', 'season'].includes(f)) return;
      const FL = { series: 'Серия', size: 'Размер', brand: 'Бренд', country: 'Страна', factory_code: 'Код модели', description: 'Описание' };
      if (!String(r[f] || '').trim()) out.push({ field: f, msg: `'${FL[f] || f}' MoySklad'da majburiy — to'ldiring` });
    });
    const ser = String(r.series || '').trim();
    if (ser && (Grid.dictValues?.series || []).length && !Grid.dictValues.series.map(String).includes(ser)) out.push({ field: 'series', msg: `Серия "${ser}" MoySklad lug'atida yo'q (yuborishda yangi qiymat yaratiladi)` });
    const fc = (r.factory_code || '').trim();
    if (fc && hasCyr(fc) && hasLat(fc)) out.push({ field: 'factory_code', msg: 'Kod modelida kirill va lotin aralash (O/0, С/C?)' });
    if (References.settings?.color_enabled) {
      const colors = (References.data?.colors || []).flatMap(c => (typeof c === 'object' ? [c.name, c.name_ru, c.name_tr, c.name_en].filter(Boolean) : [c])).map(n => String(n).toLowerCase());
      const rc = (r.colors && r.colors.length ? r.colors : (r.color ? [r.color] : []));
      rc.forEach(c => { if (colors.length && !colors.includes(String(c).toLowerCase())) out.push({ field: 'color', msg: `Rang "${c}" spravochnikda yo'q` }); });
    }
    if (r.ai_generated && (parseFloat(r.ai_confidence) || 1) < S.ai_conf_min) out.push({ field: 'product_type', msg: `AI ishonchi past (${Math.round((r.ai_confidence || 0) * 100)}%)` });
    (r.ai_low_confidence_fields || []).forEach(f => out.push({ field: f, msg: 'AI bu maydonga ishonchi kam' }));

    const map = dupMap || this.duplicateMap();
    const key = this.rowDupKey(r);
    if (key && map.get(key) > 1) out.push({ field: 'factory_code', msg: 'Bir xil tovar (tur+brend+kod+razmer+rang) boshqa qatorda ham bor' });
    return out;
  };

  Grid.rowDupKey = function (r) {
    if (!this.isUsefulRow(r)) return '';
    const col = (r.colors && r.colors.length ? r.colors.join('|') : (r.color || '')).toLowerCase();
    return [r.product_type, r.brand, r.factory_code, r.size, col].map(x => String(x || '').trim().toLowerCase()).join('§');
  };
  Grid.duplicateMap = function () {
    const m = new Map();
    this.rows.forEach(r => { const k = this.rowDupKey(r); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };

  // Qatorni DOMda sariq belgilash (to'liq re-render qilmasdan)
  Grid.applySuspectToRow = function (idx, dupMap = null) {
    const tr = document.querySelector(`#grid-tbody tr[data-row-index="${idx}"]`);
    if (!tr) return 0;
    tr.querySelectorAll('.cell-suspect').forEach(el => { el.classList.remove('cell-suspect'); el.removeAttribute('data-suspect'); });
    const list = this.rowSuspects(idx, dupMap);
    tr.classList.toggle('row-suspect', list.length > 0);
    const byField = {};
    list.forEach(s => { (byField[s.field] = byField[s.field] || []).push(s.msg); });
    Object.entries(byField).forEach(([field, msgs]) => {
      let el = tr.querySelector(`.cell-input[data-field="${field}"]`);
      if (!el && field === 'color') el = tr.querySelector('.color-tag-cell');
      if (el) { el.classList.add('cell-suspect'); el.setAttribute('data-suspect', msgs.join(' • ')); el.title = msgs.join('\n'); }
    });
    const num = tr.querySelector('.cell-num');
    if (num) num.title = list.map(s => s.msg).join('\n');
    return list.length;
  };

  Grid.refreshSuspects = function () {
    const dup = this.duplicateMap();
    let rows = 0, total = 0;
    this.rows.forEach((_, i) => { const n = this.applySuspectToRow(i, dup); if (n) { rows++; total += n; } });
    const badge = document.getElementById('suspect-badge');
    if (badge) {
      badge.style.display = rows ? 'inline-flex' : 'none';
      badge.innerHTML = `⚠️ ${rows} ta shubhali qator <span style="opacity:.75">(${total})</span>`;
      badge.classList.toggle('active', !!this.suspectFilter);
    }
    if (this.suspectFilter) document.querySelectorAll('#grid-tbody tr').forEach(tr => { tr.style.display = tr.classList.contains('row-suspect') ? '' : 'none'; });
    return { rows, total };
  };
  Grid.suspectFilter = false;
  Grid.toggleSuspectFilter = function () {
    this.suspectFilter = !this.suspectFilter;
    if (!this.suspectFilter) document.querySelectorAll('#grid-tbody tr').forEach(tr => tr.style.display = '');
    this.refreshSuspects();
  };
  Grid.suspectSummary = function () {
    const dup = this.duplicateMap();
    const items = [];
    this.rows.forEach((_, i) => this.rowSuspects(i, dup).forEach(s => items.push({ row: i + 1, ...s })));
    return items;
  };

  // ───────────────────────── Belgilash va ommaviy amallar ─────────────────────────
  Grid.lastSelIdx = null;
  Grid.selectedIdx = function () { return this.rows.map((r, i) => (r._sel ? i : -1)).filter(i => i >= 0); };
  Grid.clearSelection = function () { this.rows.forEach(r => { delete r._sel; }); this.lastSelIdx = null; this.syncSelectionUI(); };
  Grid.setSelected = function (idx, on, withShift = false) {
    if (withShift && this.lastSelIdx !== null) {
      const [a, b] = [Math.min(this.lastSelIdx, idx), Math.max(this.lastSelIdx, idx)];
      for (let i = a; i <= b; i++) if (this.rows[i]) this.rows[i]._sel = on;
    } else if (this.rows[idx]) this.rows[idx]._sel = on;
    this.lastSelIdx = idx;
    this.syncSelectionUI();
  };
  Grid.selectAll = function (on) { this.rows.forEach(r => { if (on) r._sel = true; else delete r._sel; }); this.syncSelectionUI(); };
  Grid.syncSelectionUI = function () {
    document.querySelectorAll('#grid-tbody tr').forEach((tr, i) => {
      const on = !!(this.rows[i] && this.rows[i]._sel);
      tr.classList.toggle('row-selected', on);
      const cb = tr.querySelector('.row-check'); if (cb) cb.checked = on;
    });
    const n = this.selectedIdx().length;
    const bar = document.getElementById('bulk-bar');
    if (bar) { bar.style.display = n ? 'flex' : 'none'; const c = document.getElementById('bulk-count'); if (c) c.textContent = `${n} ta qator tanlandi`; }
    const all = document.getElementById('grid-check-all');
    if (all) { all.checked = n > 0 && n === this.rows.length; all.indeterminate = n > 0 && n < this.rows.length; }
    const undoBtn = document.getElementById('btn-undo'); if (undoBtn) undoBtn.disabled = !this.undoStack.length;
  };

  // Undo
  Grid.undoStack = [];
  Grid.pushUndo = function (label) {
    this.undoStack.push({ label, rows: JSON.parse(JSON.stringify(this.rows)) });
    if (this.undoStack.length > 20) this.undoStack.shift();
    const undoBtn = document.getElementById('btn-undo'); if (undoBtn) { undoBtn.disabled = false; undoBtn.title = `Bekor qilish: ${label} (Ctrl+Z)`; }
  };
  Grid.undo = function () {
    const last = this.undoStack.pop();
    if (!last) { if (typeof showToast === 'function') showToast('Bekor qiladigan amal yo\'q', 'info'); return; }
    this.rows = last.rows;
    this.rows.forEach(r => { delete r._sel; });   // qaytgan qatorlar belgilangan holda qolmasin
    this.lastSelIdx = null;
    this.recalculateAll(); this.render(); this.triggerAutoSave();
    if (typeof showToast === 'function') showToast(`↶ Bekor qilindi: ${last.label}`, 'info');
  };

  // Ommaviy amal: tanlangan qatorlar (yo'q bo'lsa — hammasi, agar allowAll)
  Grid.targetIdx = function (allowAll = true) {
    const sel = this.selectedIdx();
    if (sel.length) return sel;
    return allowAll ? this.rows.map((_, i) => i) : [];
  };
  Grid.bulkDelete = async function () {
    const sel = this.selectedIdx();
    if (!sel.length) return;
    if (!(await confirmAt(`${sel.length} ta qator o'chirilsinmi?`))) return;
    this.pushUndo(`${sel.length} ta qatorni o'chirish`);
    this.rows = this.rows.filter(r => !r._sel);
    if (!this.rows.length) this.rows = [this.createEmptyRow()];
    this.lastSelIdx = null;
    this.recalculateAll(); this.render(); this.triggerAutoSave();
    if (typeof showToast === 'function') showToast(`🗑️ ${sel.length} ta qator o'chirildi (Ctrl+Z — qaytarish)`, 'success');
  };
  Grid.bulkScalePrices = function (factor, which = 'both') {
    const idx = this.targetIdx(true);
    const lbl = factor >= 1 ? `×${factor}` : `÷${Math.round(1 / factor)}`;
    this.pushUndo(`narx ${lbl} (${idx.length} qator)`);
    let n = 0;
    idx.forEach(i => {
      const r = this.rows[i]; let ch = false;
      if ((which === 'both' || which === 'buy') && parseFloat(r.price_buy) > 0) { r.price_buy = Math.round(parseFloat(r.price_buy) * factor * 100) / 100; ch = true; }
      if ((which === 'both' || which === 'sale') && parseFloat(r.price_sale) > 0) { r.price_sale = Math.round(parseFloat(r.price_sale) * factor * 100) / 100; ch = true; }
      if (ch) { r.last_edited_field = 'price_sale'; n++; }
    });
    if (!n) { this.undoStack.pop(); if (typeof showToast === 'function') showToast('Narx kiritilgan qator topilmadi', 'info'); return; }
    this.recalculateAll(); this.render(); this.triggerAutoSave();
    if (typeof showToast === 'function') showToast(`⚡ ${n} ta qatorda narx ${lbl}`, 'success');
  };
  Grid.bulkSetMarkup = function () {
    const idx = this.targetIdx(false);
    if (!idx.length) return;
    const v = prompt(`${idx.length} ta qator uchun ustama % (tan narxdan sotuv narxi hisoblanadi):`, '50');
    if (v === null || v === '') return;
    const pct = parseFloat(v); if (isNaN(pct)) return;
    this.pushUndo(`ustama ${pct}% (${idx.length} qator)`);
    idx.forEach(i => { const r = this.rows[i]; r.markup_pct = pct; r.last_edited_field = 'markup_pct'; });
    this.recalculateAll(); this.render(); this.triggerAutoSave();
  };
  Grid.bulkFill = async function () {
    const idx = this.targetIdx(false);
    if (!idx.length) return;
    const field = document.getElementById('bulk-field')?.value;
    const val = (document.getElementById('bulk-value')?.value || '').trim();
    if (!field) return;
    if (field === 'color') {
      if (!val) return;
      this.pushUndo(`rang "${val}" (${idx.length} qator)`);
      idx.forEach(i => { const r = this.rows[i]; r.colors = r.colors || []; if (!r.colors.includes(val)) r.colors.push(val); r.color = r.colors[0]; });
    } else {
      const label = document.getElementById('bulk-field')?.selectedOptions[0]?.text || field;
      const mode = (field === 'quantity') ? 'replace' : (document.getElementById('bulk-mode')?.value || 'replace');
      if (mode !== 'replace' && !val) return showToast("Qo'shiladigan matnni yozing", 'error');
      if (mode === 'replace' && !val && !(await confirmAt(`${idx.length} ta qatorda "${label}" tozalansinmi?`))) return;
      // append/prepend: "yoqali" + "(2)" -> "yoqali (2)"; bo'sh bo'lsa -> "(2)"; allaqachon shu matn bilan tugasa/boshlansa — qayta qo'shilmaydi
      const combine = (cur) => {
        cur = String(cur || '').trim();
        if (mode === 'append') return cur.endsWith(val) ? cur : (cur ? `${cur} ${val}` : val);
        if (mode === 'prepend') return cur.startsWith(val) ? cur : (cur ? `${val} ${cur}` : val);
        return val;
      };
      this.pushUndo(`${label} ${mode === 'replace' ? '=' : mode === 'append' ? '+= (oxiriga)' : '+= (boshiga)'} "${val}" (${idx.length} qator)`);
      idx.forEach(i => { const r = this.rows[i]; r[field] = (field === 'quantity') ? (parseFloat(val) || 0) : combine(r[field]); r.last_edited_field = field; if (field === 'product_type') { r.ai_ambiguous = false; r.ai_alternative = ''; } });
    }
    this.recalculateAll(); this.render(); this.triggerAutoSave();
    if (typeof showToast === 'function') showToast(`✅ ${idx.length} ta qator yangilandi`, 'success');
  };
  Grid.bulkDuplicate = function () {
    const sel = this.selectedIdx();
    if (!sel.length) return;
    this.pushUndo(`${sel.length} ta qator nusxasi`);
    const clones = sel.map(i => { const c = JSON.parse(JSON.stringify(this.rows[i])); c.articul = ''; c.code = ''; c.model_key = this.newModelKey(); delete c._sel; return c; });
    this.rows.splice(Math.max(...sel) + 1, 0, ...clones);
    this.recalculateAll(); this.render(); this.triggerAutoSave();
  };

  // ───────────────────────── Hujjat raqami: avto (standart) / qo'lda ─────────────────────────
  Grid.manualDocNumber = false;
  Grid.setDocNumberMode = function (manual, value = '') {
    this.manualDocNumber = !!manual;
    const inp = document.getElementById('header-doc-number');
    const lbl = document.getElementById('doc-number-mode');
    const btn = document.getElementById('btn-doc-number-manual');
    if (!inp) return;
    if (manual) {
      inp.readOnly = false; inp.style.opacity = '1'; inp.value = value || inp.value.replace(/^≈/, '');
      inp.title = "Qo'lda kiritilgan raqam — MoySklad'da band bo'lsa yuborilmaydi";
      if (lbl) lbl.textContent = "qo'lda"; if (btn) btn.textContent = '🔄 avto';
      inp.focus(); inp.select();
    } else {
      inp.readOnly = true; inp.style.opacity = '.85';
      if (!inp.value.startsWith('≈')) inp.value = '≈' + inp.value.replace(/^≈/, '');
      inp.title = "Raqam yuborish lahzasida MoySklad'dagi oxirgi bo'sh raqamdan beriladi (taxminiy ko'rsatilgan)";
      if (lbl) lbl.textContent = 'avto'; if (btn) btn.textContent = '✏️';
    }
  };
  Grid.docNumberValue = function () { return (document.getElementById('header-doc-number')?.value || '').replace(/^≈/, '').trim(); };

  // ───────────────────────── Hooklar ─────────────────────────
  const origRender = Grid.render;
  Grid.render = function () {
    origRender.call(this);
    // Belgilash katagi (№ dan keyin)
    document.querySelectorAll('#grid-tbody tr').forEach((tr, i) => {
      if (tr.querySelector('.cell-sel')) return;
      const td = document.createElement('td');
      td.className = 'cell-sel';
      td.innerHTML = `<input type="checkbox" class="row-check" data-row="${i}" title="Belgilash (Shift — diapazon)">`;
      const num = tr.querySelector('td.cell-num');
      if (num) num.insertAdjacentElement('afterend', td); else tr.prepend(td);
      td.querySelector('input').addEventListener('click', (e) => { this.setSelected(i, e.target.checked, e.shiftKey); });
    });
    this.syncSelectionUI();
    this.refreshSuspects();
    // Hujjat raqami maydoni holati
    const inp = document.getElementById('header-doc-number');
    if (inp && !this.manualDocNumber && inp.value && !inp.value.startsWith('≈')) this.setDocNumberMode(false);
  };

  const origBind = Grid.bindCellEvents;
  Grid.bindCellEvents = function () {
    origBind.call(this);
    document.querySelectorAll('.cell-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-row'), 10);
        if (!isNaN(idx)) { this.applySuspectToRow(idx); this.refreshSuspectsBadgeOnly(); }
      });
    });
  };
  Grid.refreshSuspectsBadgeOnly = function () {
    const rows = document.querySelectorAll('#grid-tbody tr.row-suspect').length;
    const badge = document.getElementById('suspect-badge');
    if (badge) { badge.style.display = rows ? 'inline-flex' : 'none'; badge.innerHTML = `⚠️ ${rows} ta shubhali qator`; }
  };

  const origDelete = Grid.deleteRow;
  Grid.deleteRow = function (index) { this.pushUndo(`${index + 1}-qatorni o'chirish`); origDelete.call(this, index); this.triggerAutoSave(); };
  const origClear = Grid.clearGrid;
  Grid.clearGrid = function () { const before = JSON.parse(JSON.stringify(this.rows)); origClear.call(this); if (this.rows.length === 1 && before.length) { this.undoStack.push({ label: 'jadvalni tozalash', rows: before }); } };
  Grid.multiplyPricesBy1000 = function () { this.bulkScalePrices(1000, 'both'); };

  const origLoad = Grid.loadDraft;
  Grid.loadDraft = async function (id) { const r = await origLoad.call(this, id); this.rows.forEach(x => delete x._sel); this.undoStack = []; this.syncSelectionUI(); return r; };

  // Klaviatura: Ctrl+Z (katak tahririda emas), Ctrl+Delete — tanlanganlarni o'chirish, Ctrl+A tashqarida — hammasini belgilash
  document.addEventListener('keydown', (e) => {
    const inInput = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT');
    const gridOpen = document.getElementById('supplies-grid-view')?.style.display !== 'none';
    if (!gridOpen) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && (!inInput || document.activeElement.type === 'checkbox')) { e.preventDefault(); Grid.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') { e.preventDefault(); Grid.bulkDelete(); }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inInput) { e.preventDefault(); Grid.selectAll(true); }
    if (e.key === 'Escape' && Grid.selectedIdx().length) Grid.clearSelection();
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('grid-check-all')?.addEventListener('change', (e) => Grid.selectAll(e.target.checked));
    document.getElementById('btn-bulk-delete')?.addEventListener('click', () => Grid.bulkDelete());
    document.getElementById('btn-bulk-x1000')?.addEventListener('click', () => Grid.bulkScalePrices(1000, document.getElementById('bulk-price-which')?.value || 'both'));
    document.getElementById('btn-bulk-d1000')?.addEventListener('click', () => Grid.bulkScalePrices(0.001, document.getElementById('bulk-price-which')?.value || 'both'));
    document.getElementById('btn-bulk-markup')?.addEventListener('click', () => Grid.bulkSetMarkup());
    document.getElementById('btn-bulk-fill')?.addEventListener('click', () => Grid.bulkFill());
    document.getElementById('btn-bulk-dup')?.addEventListener('click', () => Grid.bulkDuplicate());
    document.getElementById('btn-bulk-clear-sel')?.addEventListener('click', () => Grid.clearSelection());
    document.getElementById('btn-undo')?.addEventListener('click', () => Grid.undo());
    document.getElementById('suspect-badge')?.addEventListener('click', () => Grid.toggleSuspectFilter());
    document.getElementById('bulk-value')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') Grid.bulkFill(); });
    const modeSel = document.getElementById('bulk-mode');
    const syncMode = () => { const f = document.getElementById('bulk-field')?.value; if (modeSel) modeSel.style.display = (f === 'quantity' || f === 'color') ? 'none' : ''; };
    document.getElementById('bulk-field')?.addEventListener('change', syncMode); syncMode();
    document.getElementById('bulk-field')?.addEventListener('change', (e) => {
      const v = document.getElementById('bulk-value'); if (!v) return;
      const dl = { product_type: 'dl-product-types', brand: 'dl-brands', collection: 'dl-seasons', season: 'dl-season-types', size: 'dl-sizes', country: 'dl-countries', color: 'dl-colors' }[e.target.value];
      if (dl) v.setAttribute('list', dl); else v.removeAttribute('list');
    });
    document.getElementById('btn-doc-number-manual')?.addEventListener('click', () => {
      if (Grid.manualDocNumber) { Grid.setDocNumberMode(false); return; }
      const v = prompt("Qo'lda hujjat raqami (odatda kerak emas — raqam yuborishda avtomatik beriladi):", Grid.docNumberValue());
      if (v === null) return;
      if (v.trim()) Grid.setDocNumberMode(true, v.trim());
    });
  });
})();
