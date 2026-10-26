// cp-search.js — "Yetkazib beruvchi" uchun nom bo'yicha qidiruv (883+ kontragent ichidan yozib topish).
// <select id="header-counterparty"> saqlanadi (barcha eski kod u bilan ishlaydi), ustiga qidiruv maydoni qo'yiladi.
(function () {
  function init() {
    const sel = document.getElementById('header-counterparty');
    if (!sel || document.getElementById('header-counterparty-search')) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; min-width:160px; max-width:240px; flex:1;';
    const input = document.createElement('input');
    input.type = 'text'; input.id = 'header-counterparty-search'; input.className = 'form-control'; input.autocomplete = 'off';
    input.placeholder = 'Nomi bo\'yicha qidiring...';
    input.style.cssText = 'height:32px; padding:0.2rem 0.5rem; font-size:0.78rem; width:100%;';
    const list = document.createElement('div');
    list.id = 'header-counterparty-list';
    list.style.cssText = 'display:none; position:absolute; top:100%; left:0; right:0; z-index:500; max-height:260px; overflow:auto; background:var(--bg-card,#0f172a); border:1px solid var(--border-subtle,#334155); border-radius:8px; box-shadow:0 12px 30px rgba(0,0,0,.45); margin-top:4px;';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(input); wrap.appendChild(list); wrap.appendChild(sel);
    sel.style.display = 'none';

    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let active = -1, items = [];
    function syncFromSelect() {
      const opt = sel.options[sel.selectedIndex];
      const txt = (sel.value && opt) ? opt.text.trim() : '';
      if (document.activeElement !== input) input.value = txt;
      input.title = txt;
    }
    function choose(id, text) {
      sel.value = id; input.value = text; list.style.display = 'none'; active = -1;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function render(q) {
      const needle = norm(q); items = [];
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i]; if (!o.value) continue;
        const t = o.text.trim();
        if (!needle || norm(t).includes(needle)) { items.push({ id: o.value, text: t }); if (items.length >= 25) break; }
      }
      if (!items.length) { list.innerHTML = '<div style="padding:8px 10px; font-size:0.78rem; color:var(--text-muted);">Topilmadi. "+" tugmasi bilan yangi kontragent qo\'shing.</div>'; list.style.display = 'block'; return; }
      list.innerHTML = items.map((it, i) => `<div class="cp-item" data-i="${i}" style="padding:7px 10px; font-size:0.8rem; cursor:pointer; border-bottom:1px solid var(--border-subtle,#1e293b); ${i === active ? 'background:var(--bg-hover,#1e293b);' : ''}">${it.text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>`).join('');
      list.style.display = 'block';
      list.querySelectorAll('.cp-item').forEach(el => el.addEventListener('mousedown', (e) => { e.preventDefault(); const it = items[+el.dataset.i]; choose(it.id, it.text); }));
    }
    input.addEventListener('focus', () => { input.select(); render(input.value === (sel.options[sel.selectedIndex]||{}).text ? '' : input.value); });
    input.addEventListener('input', () => { active = -1; render(input.value); if (!input.value.trim()) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); } });
    input.addEventListener('keydown', (e) => {
      if (list.style.display === 'none') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(input.value); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[active >= 0 ? active : 0]; if (it) choose(it.id, it.text); }
      else if (e.key === 'Escape') { list.style.display = 'none'; syncFromSelect(); }
    });
    input.addEventListener('blur', () => { setTimeout(() => { list.style.display = 'none'; syncFromSelect(); }, 150); });
    // Boshqa kod select qiymatini o'zgartirsa (qoralama, AI, yangi kontragent) — matnni yangilab turamiz
    new MutationObserver(syncFromSelect).observe(sel, { childList: true });
    setInterval(syncFromSelect, 700);
    syncFromSelect();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
