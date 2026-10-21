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

  const hasCyr = s => /[Ѐ-ӿ]/.test(s || '');
  const hasLat = s => /[A-Za-z]/.test(s || '');

  Grid.rowSuspects = function (idx, dupMap = null) {
    const r = this.rows[idx];
    const out = [];
    if (!r || !this.isUsefulRow(r)) return out;
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
    const fc = (r.factory_code || '').trim();
    if (fc && hasCyr(fc) && hasLat(fc)) out.push({ field: 'factory_code', msg: 'Kod modelida kirill va lotin aralash (O/0, С/C?)' });
    if (References.settings?.color_enabled) {
      const colors = (References.data?.colors || []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());
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
    this.recalculateAll(); this.render(); this.triggerAutoSave();
    if (typeof showToast === 'function') showToast(`↶ Bekor qilindi: ${last.label}`, 'info');
  };

  // Ommaviy amal: tanlangan qatorlar (yo'q bo'lsa — hammasi, agar allowAll)
  Grid.targetIdx = function (allowAll = true) {
    const sel = this.selectedIdx();
    if (sel.length) return sel;
    return allowAll ? this.rows.map((_, i) => i) : [];
  };
  Grid.bulkDelete = function () {
    const sel = this.selectedIdx();
    if (!sel.length) return;
    if (!confirm(`${sel.length} ta qator o'chirilsinmi?`)) return;
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
  Grid.bulkFill = function () {
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
      if (!val && !confirm(`${idx.length} ta qatorda "${label}" tozalansinmi?`)) return;
      this.pushUndo(`${label} = "${val}" (${idx.length} qator)`);
      idx.forEach(i => { const r = this.rows[i]; r[field] = (field === 'quantity') ? (parseFloat(val) || 0) : val; r.last_edited_field = field; if (field === 'product_type') { r.ai_ambiguous = false; r.ai_alternative = ''; } });
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
