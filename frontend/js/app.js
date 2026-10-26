// Main Application Controller
document.addEventListener('DOMContentLoaded', async () => {
  // 0. Setup Theme Toggle (Dark & Light Mode)
  setupThemeToggle();

  // Kirish: MoySklad login/paroli bilan (sessiya bo'lmasa login oynasi chiqadi va shu yerda kutiladi)
  await Auth.ensureLoggedIn();

  // Spravochniklar va kirim sozlamalari — jadval va qoralamalar ularga tayanadi
  try {
    await References.init();
  } catch (e) {
    console.error("References init error:", e);
  }

  // 1. Setup UI tabs and buttons immediately
  setupNavigationTabs();
  setupMainButtons();
  setupQuickAddModals();
  setupAdminDropdown();
  setupAppSettingsForm();
  setupAttributesUI();
  applySettingsUI();
  AIScanner.init();

  // 2. Initialize Dashboard & Supplies
  try {
    if (typeof Dashboard !== 'undefined') {
      await Dashboard.init();
    }
  } catch (e) {
    console.error("Dashboard init error:", e);
  }

  try {
    if (typeof SuppliesList !== 'undefined') {
      await SuppliesList.init();
    }
  } catch (e) {
    console.error("SuppliesList init error:", e);
  }

  // 3. Load MoySklad metadata concurrently
  loadMoySkladMetadata();

  // 4. Initialize Grid
  try {
    await Grid.init();
  } catch (e) {
    console.error("Grid init error:", e);
  }
});

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <div>${message}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// MoySklad metadata & status & next doc number with in-memory caching
let _cachedMsStores = null;
let _cachedMsCounterparties = null;
let _cachedMsStatus = null;

async function loadMoySkladMetadata(options = {}) {
  const { force = false, skipNextDocNumber = false } = options;
  const statusDot = document.getElementById('ms-status-dot');
  const statusText = document.getElementById('ms-status-text');
  const settingsStatus = document.getElementById('settings-ms-status');
  const settingsOrg = document.getElementById('settings-ms-org');

  try {
    // 1. Status (use cache if available and not forced)
    let statusData = _cachedMsStatus;
    if (!statusData || force) {
      const statusResp = await fetch('/api/moysklad/status');
      if (statusResp.ok) {
        statusData = await statusResp.json();
        _cachedMsStatus = statusData;
      }
    }

    if (statusData && statusData.status === 'connected') {
      if (statusDot) statusDot.className = 'status-dot';
      if (statusText) statusText.textContent = `MoySklad: ${statusData.organization_name || 'Ulandi'}`;
      if (settingsStatus) {
        settingsStatus.textContent = '✅ Ulangan (Faol)';
        settingsStatus.className = 'badge badge-synced';
      }
      if (settingsOrg) settingsOrg.textContent = statusData.organization_name || 'DE LUXURY';
    } else if (statusData) {
      if (statusDot) statusDot.className = 'status-dot disconnected';
      if (statusText) statusText.textContent = 'MoySklad: Ulanmadi';
      if (settingsStatus) {
        settingsStatus.textContent = '❌ Xatolik';
        settingsStatus.className = 'badge badge-conflict';
      }
    }

    // 2. Load Stores (Omborlar) - Cached
    let stores = _cachedMsStores;
    if (!stores || force) {
      const storeResp = await fetch('/api/moysklad/stores');
      if (storeResp.ok) {
        stores = await storeResp.json();
        _cachedMsStores = stores;
      }
    }
    if (stores && stores.length > 0) {
      const storeSelect = document.getElementById('header-store');
      if (storeSelect) {
        const curVal = storeSelect.value;
        storeSelect.innerHTML = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        if (curVal) storeSelect.value = curVal;
      }
    }

    // 3. Load Counterparties (Yetkazib beruvchilar) - Cached
    await reloadCounterpartiesDropdown(null, force);

    // 4. Load Next 5-digit Document Number (ONLY when creating new, NOT when opening draft)
    if (!skipNextDocNumber) {
      const nextNumResp = await fetch('/api/moysklad/next-doc-number');
      if (nextNumResp.ok) {
        const nextData = await nextNumResp.json();
        const docInput = document.getElementById('header-doc-number');
        if (docInput && nextData.next_number) {
          docInput.value = nextData.next_number; if (typeof Grid !== 'undefined' && Grid.setDocNumberMode) Grid.setDocNumberMode(false);
        }
      }
    }

  } catch (e) {
    console.error("MoySklad status error:", e);
    if (statusDot) statusDot.className = 'status-dot disconnected';
    if (statusText) statusText.textContent = 'MoySklad: Server xatosi';
  }
}

async function reloadCounterpartiesDropdown(selectedId = null, force = false) {
  let counterparties = _cachedMsCounterparties;
  if (!counterparties || force) {
    const cpResp = await fetch('/api/moysklad/counterparties');
    if (cpResp.ok) {
      counterparties = await cpResp.json();
      _cachedMsCounterparties = counterparties;
    }
  }
  if (counterparties) {
    const cpSelect = document.getElementById('header-counterparty');
    if (cpSelect) {
      let html = `<option value="">Tanlang...</option>`;
      html += counterparties.map(c => `
        <option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>
      `).join('');
      cpSelect.innerHTML = html;
    }
  }
}

// Theme Toggle Engine (Dark Mode & Light Mode with Side-by-Side Sun & Moon)
function setupThemeToggle() {
  const currentTheme = localStorage.getItem('deluxury_theme') || 'dark';
  setTheme(currentTheme === 'light');

  const btnDark = document.getElementById('btn-theme-dark');
  const btnLight = document.getElementById('btn-theme-light');

  if (btnDark) {
    btnDark.addEventListener('click', () => setTheme(false));
  }
  if (btnLight) {
    btnLight.addEventListener('click', () => setTheme(true));
  }
}

function setTheme(isLight) {
  if (isLight) {
    document.body.classList.add('theme-light');
    localStorage.setItem('deluxury_theme', 'light');
  } else {
    document.body.classList.remove('theme-light');
    localStorage.setItem('deluxury_theme', 'dark');
  }

  const btnDark = document.getElementById('btn-theme-dark');
  const btnLight = document.getElementById('btn-theme-light');
  if (btnDark) btnDark.classList.toggle('active', !isLight);
  if (btnLight) btnLight.classList.toggle('active', isLight);

  if (typeof Dashboard !== 'undefined' && Dashboard.renderCharts) {
    Dashboard.renderCharts();
  }
}

// Navigation Tabs
function setupNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetId = tab.getAttribute('data-tab');
      // Yangi kirim ustida ishlab turgan bo'lsa — bo'limdan chiqishdan oldin qoralama darhol saqlanadi
      if (typeof Grid !== 'undefined' && Grid.isDirty) {
        Grid.flushDraft().then(() => { if (typeof showToast === 'function' && Grid.hasUsefulRows()) showToast('💾 Kirim qoralama sifatida saqlandi — "Yangi Kirim" bilan davom ettirasiz', 'info'); });
      }
      
      // Update tab buttons
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update contents
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(targetId)?.classList.add('active');

      // Lazy load tab contents
      if (targetId === 'tab-dashboard') {
        if (typeof Dashboard !== 'undefined') Dashboard.loadStats();
      } else if (targetId === 'tab-supplies') {
        if (typeof SuppliesList !== 'undefined') {
          SuppliesList.closeGridReceiptView();
          SuppliesList.loadSupplies();
        }
      } else if (targetId === 'tab-references') {
        renderReferencesUI('ref-product-types');
      } else if (targetId === 'tab-settings') {
        AttributesUI.load();
      }
    });
  });

  // Reference Subtabs
  document.querySelectorAll('.ref-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ref-subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const subtab = btn.getAttribute('data-reftab');
      renderReferencesUI(subtab);
    });
  });
}

// Main Buttons
function setupMainButtons() {
  // Set default document date to now
  const dateInput = document.getElementById('header-date');
  if (dateInput && !dateInput.value) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
  }

  // Valyuta va USD kursi (USD faqat sozlamada yoqilgan bo'lsa ko'rinadi)
  document.getElementById('header-currency')?.addEventListener('change', async () => {
    await syncCurrencyUI();
    Grid.recalculateAll();
    Grid.render();
    Grid.triggerAutoSave();
  });
  document.getElementById('header-rate')?.addEventListener('input', () => {
    Grid.recalculateAll();
    Grid.render();
    Grid.triggerAutoSave();
  });

  // Quick sync button from navbar
  document.getElementById('btn-quick-sync')?.addEventListener('click', async () => {
    showToast("🔄 MoySklad bilan ma'lumotlar yangilanmoqda...", "info");
    if (typeof Dashboard !== 'undefined') {
      await Dashboard.loadStats(true);
    }
    if (typeof SuppliesList !== 'undefined') {
      await SuppliesList.loadSupplies();
    }
    showToast("✅ MoySklad bilan muvaffaqiyatli sinxronlandi!", "success");
  });

  // Quick action from dashboard/navbar to open new receipt
  document.getElementById('btn-quick-new-receipt')?.addEventListener('click', () => {
    document.querySelector('[data-tab="tab-supplies"]')?.click();
    if (typeof SuppliesList !== 'undefined') {
      SuppliesList.openGridReceiptView();
    }
  });

  // Quick link from dashboard to view all supplies
  document.getElementById('btn-view-all-supplies-link')?.addEventListener('click', () => {
    document.querySelector('[data-tab="tab-supplies"]')?.click();
    if (typeof SuppliesList !== 'undefined') {
      SuppliesList.closeGridReceiptView();
    }
  });

  // Add row
  document.getElementById('btn-add-row')?.addEventListener('click', () => {
    Grid.addEmptyRows(1);
  });

  // Add 5 rows
  document.getElementById('btn-add-5-rows')?.addEventListener('click', () => {
    Grid.addEmptyRows(5);
  });

  // Duplicate active row
  document.getElementById('btn-duplicate-row')?.addEventListener('click', () => {
    Grid.duplicateRow(Grid.activeCell.rowIndex);
  });

  // Clear Grid
  document.getElementById('btn-clear-grid')?.addEventListener('click', () => {
    Grid.clearGrid();
  });

  // Save Draft
  document.getElementById('btn-save-draft')?.addEventListener('click', async () => {
    await Grid.saveDraft();
    showToast("💾 Qoralama muvaffaqiyatli saqlandi!", "success");
  });

  // Export CSV
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    Grid.exportToCSV();
  });

  // Refresh History
  document.getElementById('btn-refresh-history')?.addEventListener('click', () => {
    History.load();
    showToast("🔄 Tarix yangilandi", "info");
  });

  // Sync MoySklad Reference Catalog
  document.getElementById('btn-sync-moysklad-refs')?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/references/sync-moysklad', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        await References.init();
        renderReferencesUI('ref-product-types');
        const sm = data.summary || {};
        const lbl = { product_types: 'tur', categories: 'kategoriya', brands: 'brend', season_types: 'sezon', seasons: 'kolleksiya', colors: 'rang', sizes: 'razmer' };
        const parts = Object.keys(sm).map(k => `${lbl[k] || k}: ${sm[k].synced}/${sm[k].total}`).join(', ');
        showToast(`✅ MoySklad bilan solishtirildi — ${parts || (data.synced_categories_count + ' ta kategoriya')}`, 'success');
      }
    } catch (e) {
      showToast("❌ Sinxronlashda xatolik", "error");
    }
  });

  // Update Articul Counter
  document.getElementById('btn-update-counter')?.addEventListener('click', async () => {
    const val = parseInt(document.getElementById('settings-articul-counter').value, 10);
    const codeVal = parseInt(document.getElementById('settings-code-counter')?.value, 10);
    if (isNaN(val) || isNaN(codeVal)) return alert("Noto'g'ri raqam");
    try {
      const resp = await fetch('/api/articul/counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_number: val, last_code: codeVal })
      });
      const data = await resp.json();
      if (resp.ok) {
        Grid.baseCounter = data.last_number;
        Grid.baseCode = data.last_code;
        Grid.recalculateAll();
        Grid.render();
        const pad = n => String(n + 1).padStart(5, '0');
        showToast(`🔢 Keyingi model: ${pad(data.last_number)}, keyingi tovar kodi: ${pad(data.last_code)}`, 'success');
      } else {
        showToast(data.detail || "Xatolik yuz berdi", "error");
      }
    } catch (e) {
      showToast("Xatolik yuz berdi", "error");
    }
  });

  // Test MoySklad connection in settings
  document.getElementById('btn-test-ms-connection')?.addEventListener('click', async () => {
    await loadMoySkladMetadata();
    showToast("MoySklad ulanishi qayta tekshirildi", "info");
  });

  // Validate Only Button
  document.getElementById('btn-validate-only')?.addEventListener('click', async () => {
    const usefulRows = Grid.rows.filter(r => r.product_type || r.price_buy > 0);
    if (usefulRows.length === 0) {
      return alert("Jadvalda tekshirish uchun to'ldirilgan qatorlar yo'q!");
    }

    const resp = await fetch('/api/documents/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: usefulRows, header: collectHeaderData() })
    });
    const res = await resp.json();

    if (res.valid) {
      showToast(`✅ Barcha ${res.total_rows} ta qator to'liq va to'g'ri to'ldirilgan!`, "success");
    } else {
      let errText = res.errors.map(e => e.message).join('\n');
      alert(`⚠️ Hujjatda xatoliklar mavjud:\n\n${errText}`);
    }
  });

  // Submit to MoySklad (Opens confirmation modal)
  document.getElementById('btn-submit-moysklad')?.addEventListener('click', async () => {
    const usefulRows = Grid.rows.filter(r => r.product_type || r.price_buy > 0);
    if (usefulRows.length === 0) {
      return alert("Jadvalda hech bo'lmaganda 1 ta to'ldirilgan tovar qatori bo'lishi kerak!");
    }

    const resp = await fetch('/api/documents/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: usefulRows, header: collectHeaderData() })
    });
    const val = await resp.json();

    const modal = document.getElementById('modal-submit-confirm');
    const modalBody = document.getElementById('submit-modal-body');
    const storeName = document.getElementById('header-store')?.selectedOptions[0]?.text || 'Asosiy Ombor';
    const cpName = document.getElementById('header-counterparty')?.selectedOptions[0]?.text || 'Noma\'lum';
    const docNumber = Grid.manualDocNumber
      ? `${Grid.docNumberValue()} <small style="color: var(--text-muted);">(qo'lda)</small>`
      : `<span style="color: #38bdf8;">yuborishda beriladi</span> <small style="color: var(--text-muted);">(taxminan ${Grid.docNumberValue() || '—'})</small>`;
    const suspects = Grid.suspectSummary ? Grid.suspectSummary() : [];

    let totalQty = 0;
    let totalSumBuy = 0;
    let totalSumSale = 0;
    usefulRows.forEach(r => {
      totalQty += parseFloat(r.quantity) || 0;
      totalSumBuy += parseFloat(r.sum_buy) || 0;
      totalSumSale += parseFloat(r.sum_sale) || 0;
    });

    if (!val.valid) {
      modalBody.innerHTML = `
        <div style="background-color: var(--accent-red-bg); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem; border: 1px solid var(--accent-red);">
          <h4 style="color: #f87171; margin-bottom: 0.5rem;">❌ Hujjatda to'ldirilmagan yoki xato maydonlar bor:</h4>
          <ul style="padding-left: 1.25rem; font-size: 0.85rem; color: #fca5a5;">
            ${val.errors.map(e => `<li>${e.message}</li>`).join('')}
          </ul>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted);">
          Iltimos, yuqoridagi qatorlarni to'g'rilab, qayta yuboring.
        </p>
      `;
      document.getElementById('btn-final-confirm-submit').style.display = 'none';
    } else {
      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; background-color: var(--bg-input); padding: 1rem; border-radius: var(--radius-md);">
            <div>📄 Приемка №: <b>${docNumber}</b></div>
            <div>🏢 Ombor: <b>${storeName}</b></div>
            <div>🤝 Kontragent: <b>${cpName}</b></div>
            <div>📦 Qatorlar: <b>${usefulRows.length} ta</b></div>
            <div>🔢 Jami dona: <b>${totalQty.toLocaleString()} dona</b></div>
            <div>💵 Tan narx (Kirim): <b>${Grid.formatMoney(totalSumBuy)}</b></div>
            <div>🏷️ Sotish summasi: <b style="color: #38bdf8;">${Grid.formatMoney(totalSumSale)}</b></div>
          </div>
          ${suspects.length ? `
          <div style="background: rgba(234, 179, 8, 0.12); border: 1px solid rgba(234, 179, 8, 0.5); padding: 0.75rem 1rem; border-radius: var(--radius-md);">
            <h4 style="color: #eab308; margin-bottom: 0.4rem; font-size: 0.9rem;">⚠️ ${suspects.length} ta shubhali qiymat (yuborishga to'sqinlik qilmaydi, lekin tekshiring):</h4>
            <ul style="padding-left: 1.2rem; font-size: 0.8rem; color: #fde68a; max-height: 150px; overflow-y: auto;">
              ${suspects.slice(0, 40).map(s => `<li>${s.row}-qator: ${s.msg}</li>`).join('')}${suspects.length > 40 ? `<li>... yana ${suspects.length - 40} ta</li>` : ''}
            </ul>
          </div>` : ''}
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">
            Tasdiqlasangiz: MoySklad'da mahsulotlar yaratiladi/bog'lanadi, ombor qoldig'iga kiritiladi (Приемка) va Telegram guruhiga bildirishnoma yuboriladi.
          </p>
        </div>
      `;
      document.getElementById('btn-final-confirm-submit').style.display = 'inline-flex';
    }

    modal.classList.add('active');
  });

  // Close modals
  document.getElementById('btn-close-submit-modal')?.addEventListener('click', () => {
    document.getElementById('modal-submit-confirm').classList.remove('active');
  });
  document.getElementById('btn-cancel-submit')?.addEventListener('click', () => {
    document.getElementById('modal-submit-confirm').classList.remove('active');
  });
  document.getElementById('btn-close-success-modal')?.addEventListener('click', () => {
    document.getElementById('modal-success').classList.remove('active');
  });

  // Final submit confirm action
  document.getElementById('btn-final-confirm-submit')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-final-confirm-submit');
    btn.disabled = true;
    btn.textContent = "⏳ MoySklad'ga yuborilmoqda...";

    const usefulRows = Grid.rows.filter(r => r.product_type || r.price_buy > 0);
    // Model raqamlari qoralamaga bog'lanadi — yuborishdan oldin qoralama saqlangan bo'lsin
    if (!Grid.activeDraftId || Grid.isDirty) await Grid.saveDraft();
    const headerData = collectHeaderData();

    try {
      const resp = await fetch('/api/documents/submit-moysklad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: headerData,
          rows: usefulRows
        })
      });

      const data = await resp.json();

      document.getElementById('modal-submit-confirm').classList.remove('active');
      btn.disabled = false;
      btn.textContent = "🚀 Tasdiqlayman & Yuborish";

      if (resp.ok && data.status === 'success') {
        const successModal = document.getElementById('modal-success');
        const successBody = document.getElementById('success-modal-body');

        successBody.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
          <h3 style="font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem; color: #fff;">
            MoySklad'da Приемка yaratildi!
          </h3>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.5rem;">
            Hujjat raqami: <b style="color: #fbbf24;">${data.moysklad_document_name || data.doc_number || data.document_id}</b>${data.auto_number ? ' <small>(MoySklad navbati bo\'yicha)</small>' : ''} | Pozitsiyalar: <b>${data.total_items} ta</b>
          </p>
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            ${data.moysklad_url ? `<a href="${data.moysklad_url}" target="_blank" class="btn btn-gold btn-lg" style="text-decoration: none;">🔗 MoySklad'da ochish</a>` : ''}
          </div>
          <p style="font-size: 0.8rem; color: #34d399; margin-top: 1.25rem;">
            📱 Telegram guruhiga hisobot yuborildi.
          </p>
        `;

        successModal.classList.add('active');

        // Reset Grid (1 row) & refresh next doc number & clear counterparty & reset active draft
        Grid.activeDraftId = null;
        Grid.rows = [];
        Grid.addEmptyRows(1);
        await Grid.fetchBaseCounter();
        Grid.recalculateAll();
        Grid.render();

        const cpSelect = document.getElementById('header-counterparty');
        if (cpSelect) cpSelect.value = '';

        const nextNumResp = await fetch('/api/moysklad/next-doc-number');
        if (nextNumResp.ok) {
          const nextData = await nextNumResp.json();
          const docInput = document.getElementById('header-doc-number');
          if (docInput && nextData.next_number) {
            docInput.value = nextData.next_number; if (typeof Grid !== 'undefined' && Grid.setDocNumberMode) Grid.setDocNumberMode(false);
          }
        }
      } else {
        // Qoralama o'chirilmaydi: tuzatib qayta yuborilganda aynan shu artikullar ishlatiladi
        const detail = data.detail;
        if (detail && typeof detail === 'object' && Array.isArray(detail.errors)) {
          alert(`⚠️ ${detail.message || 'Xatolik'}\n\n` + detail.errors.map(e => e.message).join('\n'));
        } else {
          alert(detail || data.message || "MoySklad'ga yuborishda xatolik yuz berdi");
        }
      }
    } catch (e) {
      console.error("Submission error:", e);
      btn.disabled = false;
      btn.textContent = "🚀 Tasdiqlayman & Yuborish";
      alert("Tarmoq xatosi yuz berdi.");
    }
  });

  // Start new receipt button in success modal
  document.getElementById('btn-start-new-receipt')?.addEventListener('click', async () => {
    document.getElementById('modal-success').classList.remove('active');
    Grid.rows = [];
    Grid.addEmptyRows(1);
    await Grid.fetchBaseCounter();
    Grid.recalculateAll();
    Grid.render();

    const cpSelect = document.getElementById('header-counterparty');
    if (cpSelect) cpSelect.value = '';

    const nextNumResp = await fetch('/api/moysklad/next-doc-number');
    if (nextNumResp.ok) {
      const nextData = await nextNumResp.json();
      const docInput = document.getElementById('header-doc-number');
      if (docInput && nextData.next_number) {
        docInput.value = nextData.next_number; if (typeof Grid !== 'undefined' && Grid.setDocNumberMode) Grid.setDocNumberMode(false);
      }
    }
  });
}

// Quick Add Modals (Kontragent, Ierarxiya Add/Edit, Excel Import)
function setupQuickAddModals() {
  // 1. Quick Add Counterparty
  const modalCp = document.getElementById('modal-quick-cp');
  document.getElementById('btn-quick-add-cp')?.addEventListener('click', () => {
    const nameEl = document.getElementById('modal-cp-name');
    const phoneEl = document.getElementById('modal-cp-phone');
    const groupEl = document.getElementById('modal-cp-group');
    const descEl = document.getElementById('modal-cp-desc');
    if (nameEl) nameEl.value = '';
    if (phoneEl) phoneEl.value = '';
    if (groupEl) groupEl.value = '';
    if (descEl) descEl.value = '';
    if (modalCp) {
      modalCp.classList.add('active');
      setTimeout(() => nameEl?.focus(), 50);
    }
  });

  document.getElementById('btn-close-cp-modal')?.addEventListener('click', () => modalCp?.classList.remove('active'));
  document.getElementById('btn-cancel-cp')?.addEventListener('click', () => modalCp?.classList.remove('active'));

  document.getElementById('btn-save-cp')?.addEventListener('click', async () => {
    const name = document.getElementById('modal-cp-name')?.value.trim();
    if (!name) return alert("Yetkazib beruvchi nomini kiriting!");
    const phone = document.getElementById('modal-cp-phone')?.value.trim();
    const group = document.getElementById('modal-cp-group')?.value.trim();
    const desc = document.getElementById('modal-cp-desc')?.value.trim();

    const saveBtn = document.getElementById('btn-save-cp');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saqlanmoqda...";
    }

    try {
      const resp = await fetch('/api/moysklad/counterparties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, group, description: desc })
      });
      const data = await resp.json();
      if (resp.ok && data.status === 'created') {
        modalCp?.classList.remove('active');
        const createdId = data.counterparty?.id;
        // Ro'yxat keshdan chiziladi — yangi kontragentni keshga qo'shamiz, aks holda u tanlanmay qoladi
        if (createdId) {
          _cachedMsCounterparties = (_cachedMsCounterparties || []).filter(c => c.id !== createdId);
          _cachedMsCounterparties.unshift({ id: createdId, name: data.counterparty.name || name, phone: phone || "" });
        }
        await reloadCounterpartiesDropdown(createdId);
        const headerCp = document.getElementById('header-counterparty');
        if (headerCp && createdId) {
          headerCp.value = createdId;
        }
        if (typeof SuppliesList !== 'undefined') {
          SuppliesList.loadSupplies();
        }
        showToast(`✅ "${name}" MoySklad'da muvaffaqiyatli yaratildi va tanlandi!`, "success");
      } else {
        alert(data.message || "Kontragent yaratishda xatolik yuz berdi");
      }
    } catch (e) {
      alert("Tarmoq xatosi yuz berdi");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = "<span>💾</span> MoySklad'da yaratish";
      }
    }
  });

  // 2. ProductType (Ierarxiya) Add/Edit Modal
  const modalPt = document.getElementById('modal-pt-edit');
  document.getElementById('btn-close-pt-modal')?.addEventListener('click', () => modalPt.classList.remove('active'));
  document.getElementById('btn-cancel-pt')?.addEventListener('click', () => modalPt.classList.remove('active'));

  document.getElementById('btn-save-pt')?.addEventListener('click', async () => {
    const idVal = document.getElementById('pt-edit-id').value;
    const name = document.getElementById('pt-edit-name').value.trim();
    const category = document.getElementById('pt-edit-category').value.trim();
    const group = document.getElementById('pt-edit-group').value.trim();

    if (!name) return alert("Mahsulot turi nomini kiriting!");
    if (!group) return alert("Guruhni tanlang!");

    const payload = {
      id: idVal ? parseInt(idVal, 10) : null,
      name,
      category,
      group
    };

    try {
      const resp = await fetch('/api/references/product-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        modalPt.classList.remove('active');
        await References.init();
        renderReferencesUI('ref-product-types');
        Grid.recalculateAll();
        Grid.render();
        showToast(`"${name}" ierarxiyasi saqlandi!`, "success");
      }
    } catch (e) {
      alert("Xatolik yuz berdi");
    }
  });

  // 3. Excel/CSV Hierarchy Import Modal
  const modalImport = document.getElementById('modal-import-hierarchy');
  const fileInput = document.getElementById('hierarchy-file-input');
  const filenameSpan = document.getElementById('hierarchy-filename');

  document.getElementById('btn-close-import-modal')?.addEventListener('click', () => modalImport.classList.remove('active'));
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => modalImport.classList.remove('active'));

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      filenameSpan.textContent = `Tanlandi: ${e.target.files[0].name}`;
    }
  });

  document.getElementById('btn-upload-hierarchy-confirm')?.addEventListener('click', async () => {
    if (!fileInput.files || fileInput.files.length === 0) {
      return alert("Iltimos, avval faylni tanlang!");
    }

    const selectedMode = document.querySelector('input[name="hierarchy-import-mode"]:checked')?.value || 'merge';
    if (selectedMode === 'replace') {
      const ok = confirm("⚠️ DIQQAT: 'To'liq almashtirish' rejimi tanlandi!\nBazadagi barcha eski tovar turlari o'chiriladi va faqat yangi fayldagilar qoladi.\n\nHaqiqatan ham davom ettirasizmi?");
      if (!ok) return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const btn = document.getElementById('btn-upload-hierarchy-confirm');
    btn.disabled = true;
    btn.textContent = "Yuklanmoqda...";

    try {
      const resp = await fetch(`/api/references/import-hierarchy-csv?mode=${selectedMode}`, {
        method: 'POST',
        body: formData
      });
      const data = await resp.json();
      btn.disabled = false;
      btn.textContent = "🚀 Import qilish";

      if (resp.ok && data.status === 'success') {
        modalImport.classList.remove('active');
        fileInput.value = '';
        filenameSpan.textContent = '';
        await References.init();
        renderReferencesUI('ref-product-types');
        Grid.recalculateAll();
        Grid.render();
        const modeNotice = selectedMode === 'replace' ? "to'liq almashtirildi" : "yangilandi";
        showToast(`✅ ${data.total} ta mahsulot turi ${modeNotice} (${data.imported_new} ta kiritildi)!`, "success");
      } else {
        alert(data.detail || data.message || "Importda xatolik yuz berdi");
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "🚀 Import qilish";
      alert("Faylni yuklashda xatolik yuz berdi.");
    }
  });
}

// Administrator Profile Dropdown Menu Controller
function setupAdminDropdown() {
  const badge = document.getElementById('user-profile-badge');
  const dropdown = document.getElementById('admin-dropdown-menu');
  if (!badge || !dropdown) return;

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !badge.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // 1. Tizim sozlamalari
  document.getElementById('admin-menu-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    dropdown.style.display = 'none';
    document.querySelector('.nav-tab[data-tab="tab-settings"]')?.click();
  });

  // 2. MoySklad sinxronlash
  document.getElementById('admin-menu-sync')?.addEventListener('click', (e) => {
    e.preventDefault();
    dropdown.style.display = 'none';
    document.getElementById('btn-quick-sync')?.click();
  });

  // 3. Artikul / Kod Sanagichi
  document.getElementById('admin-menu-counter')?.addEventListener('click', (e) => {
    e.preventDefault();
    dropdown.style.display = 'none';
    document.querySelector('.nav-tab[data-tab="tab-settings"]')?.click();
    setTimeout(() => {
      const counterInput = document.getElementById('settings-articul-counter');
      if (counterInput) {
        counterInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        counterInput.focus();
        counterInput.select();
      }
    }, 150);
  });

  // 4. Chiqish
  document.getElementById('admin-menu-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    dropdown.style.display = 'none';
    if (confirm("Haqiqatan ham tizimdan chiqmoqchimisiz?")) {
      if (Grid.isDirty) await Grid.saveDraft();
      await Auth.logout();
    }
  });
}

// Hujjat sarlavhasi (validatsiya va yuborish uchun)
function collectHeaderData() {
  const currency = Grid.getCurrency();
  return {
    doc_number: Grid.manualDocNumber ? Grid.docNumberValue() : '',
    manual_number: !!Grid.manualDocNumber,
    doc_date: document.getElementById('header-date')?.value,
    store_id: document.getElementById('header-store')?.value,
    store_name: document.getElementById('header-store')?.selectedOptions[0]?.text || '',
    counterparty_id: document.getElementById('header-counterparty')?.value,
    counterparty_name: document.getElementById('header-counterparty')?.value ? document.getElementById('header-counterparty').selectedOptions[0].text : '',
    currency: currency,
    rate: currency === 'USD' ? Grid.getRate() : null,
    draft_id: Grid.activeDraftId
  };
}

// Valyuta tanlovi faqat USD yoqilganda ko'rinadi; USD tanlansa kurs maydoni chiqadi (MoySklad kursi bilan to'ldiriladi)
async function syncCurrencyUI() {
  const wrap = document.getElementById('header-currency-wrap');
  const rateWrap = document.getElementById('header-rate-wrap');
  const curSelect = document.getElementById('header-currency');
  const rateInput = document.getElementById('header-rate');
  const usdOn = !!References.settings.usd_enabled;
  if (wrap) wrap.style.display = usdOn ? '' : 'none';
  if (!usdOn && curSelect) curSelect.value = 'UZS';
  const isUsd = usdOn && curSelect?.value === 'USD';
  if (rateWrap) rateWrap.style.display = isUsd ? '' : 'none';
  if (isUsd && rateInput && !parseFloat(rateInput.value)) {
    try {
      const resp = await fetch('/api/moysklad/currency-rate?iso=USD');
      if (resp.ok) {
        const data = await resp.json();
        if (data.rate) rateInput.value = data.rate;
      }
    } catch (e) {
      console.warn("USD rate fetch failed:", e);
    }
  }
}

// Sozlamalar bo'limi: kirim rejimlari (faqat admin o'zgartiradi) va brend nomi
function applySettingsUI() {
  const s = References.settings;
  const isAdmin = !!Auth.user?.is_admin;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val; else el.value = val ?? '';
    el.disabled = !isAdmin;
  };
  setVal('set-color-enabled', s.color_enabled);
  setVal('set-size-enabled', s.size_enabled);
  setVal('set-size-in-name', s.size_in_name);
  setVal('set-usd-enabled', s.usd_enabled);
  setVal('set-color-lang', s.color_primary_lang || 'ru');
  // Standart kolleksiya / sezon — Manbalar ro'yxatidan tanlanadi
  const fillSel = (id, items, cur, emptyLabel) => {
    const el = document.getElementById(id); if (!el) return;
    const opts = [`<option value="">${emptyLabel}</option>`].concat(items.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}" ${v === cur ? 'selected' : ''}>${v}</option>`));
    if (cur && !items.includes(cur)) opts.push(`<option value="${String(cur).replace(/"/g, '&quot;')}" selected>${cur} (ro'yxatda yo'q)</option>`);
    el.innerHTML = opts.join(''); el.disabled = !isAdmin;
  };
  fillSel('set-default-collection', (References.data?.seasons || []).map(x => x.collection).filter(Boolean), s.default_collection || '', '— eng oxirgi kolleksiya —');
  fillSel('set-default-season', (References.data?.season_types || []).map(x => x.name).filter(Boolean), s.default_season || '', "— bo'sh —");
  setVal('set-company-name', s.company_name);
  setVal('set-allowed-logins', s.allowed_logins);
  setVal('set-tg-enabled', s.telegram_enabled);
  setVal('set-tg-token', s.telegram_bot_token);
  setVal('set-tg-admins', s.telegram_admin_ids);
  setVal('set-tg-managers', s.telegram_manager_ids);
  const tgHint = document.getElementById('tg-token-hint');
  if (tgHint) tgHint.textContent = s.telegram_bot_token_set ? "Token saqlangan (niqoblangan ko'rinishda). Almashtirish uchun yangisini yozing." : "Token kiritilmagan — bildirishnomalar yuborilmaydi.";
  ['btn-tg-test', 'btn-tg-save', 'btn-tg-clear'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = isAdmin ? '' : 'none'; });
  refreshTelegramStatus();
  const saveBtn = document.getElementById('btn-save-app-settings');
  if (saveBtn) saveBtn.style.display = isAdmin ? '' : 'none';
  const counterBtn = document.getElementById('btn-update-counter');
  if (counterBtn) counterBtn.style.display = isAdmin ? '' : 'none';
  const hint = document.getElementById('set-admin-hint');
  if (hint) hint.style.display = isAdmin ? 'none' : '';

  renderArticulExample(s.color_enabled, s.size_enabled);

  if (s.company_name) {
    document.title = `${s.company_name} — Kirim & Ta'minot Hub`;
    document.querySelectorAll('.brand-badge, #settings-ms-org').forEach(el => { el.textContent = s.company_name; });
  }
  syncCurrencyUI();
}

async function refreshTelegramStatus() {
  const badge = document.getElementById('tg-status-badge');
  const uname = document.getElementById('tg-status-username');
  if (!badge) return;
  try {
    const r = await fetch('/api/telegram/status');
    const d = await r.json();
    if (!d.configured) { badge.textContent = '⚪ Bot ulanmagan'; badge.style.cssText = 'background: var(--bg-hover); color: var(--text-muted);'; uname.textContent = ''; }
    else if (!d.valid) { badge.textContent = '❌ Token noto\'g\'ri'; badge.style.cssText = 'background: rgba(248,113,113,.15); color: #f87171;'; uname.textContent = ''; }
    else if (!d.enabled) { badge.textContent = '⏸ O\'chirilgan'; badge.style.cssText = 'background: rgba(251,191,36,.15); color: #fbbf24;'; uname.textContent = '@' + d.username; }
    else { badge.textContent = '✅ Bot Faol'; badge.className = 'badge badge-synced'; badge.style.cssText = ''; uname.textContent = '@' + d.username + (d.recipients.length ? ` · ${d.recipients.length} ta qabul qiluvchi` : ' · qabul qiluvchi yo\'q'); }
  } catch (e) { badge.textContent = '❓ Holat noma\'lum'; }
}

function setupTelegramSettings() {
  const payload = () => ({
    telegram_enabled: document.getElementById('set-tg-enabled')?.checked,
    telegram_bot_token: document.getElementById('set-tg-token')?.value || '',
    telegram_admin_ids: document.getElementById('set-tg-admins')?.value || '',
    telegram_manager_ids: document.getElementById('set-tg-managers')?.value || '',
  });
  document.getElementById('btn-tg-save')?.addEventListener('click', async () => {
    const resp = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
    const data = await resp.json();
    if (!resp.ok) return showToast(data.detail || "Saqlab bo'lmadi", 'error');
    References.settings = data; applySettingsUI(); showToast('Telegram sozlamalari saqlandi', 'success');
  });
  document.getElementById('btn-tg-test')?.addEventListener('click', async () => {
    const b = document.getElementById('btn-tg-test'); b.disabled = true;
    try {
      const p = payload();
      const resp = await fetch('/api/telegram/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: p.telegram_bot_token, ids: [p.telegram_admin_ids, p.telegram_manager_ids].filter(Boolean).join(',') }) });
      const data = await resp.json();
      showToast(resp.ok ? `${data.message} (@${data.username})` : (data.detail || 'Yuborilmadi'), resp.ok ? 'success' : 'error');
    } finally { b.disabled = false; }
  });
  document.getElementById('btn-tg-clear')?.addEventListener('click', async () => {
    if (!confirm("Bot tokeni o'chirilsinmi? Bildirishnomalar to'xtaydi. Keyin yangi token kiritishingiz mumkin.")) return;
    const resp = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegram_bot_token: ' ', telegram_enabled: false }) });
    const data = await resp.json();
    if (!resp.ok) return showToast(data.detail || "O'chirib bo'lmadi", 'error');
    References.settings = data; applySettingsUI(); showToast('Bot uzildi', 'success');
  });
}
document.addEventListener('DOMContentLoaded', setupTelegramSettings);

// ================= MoySklad доп. поля (Sozlamalar) =================
const AttributesUI = {
  data: null,
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  typeLabel: (t) => ({ customentity: 'Spravochnik', string: 'Qisqa matn', text: 'Uzun matn', long: 'Butun son', double: 'Kasr son', boolean: 'Ha/Yo\'q', time: 'Sana', link: 'Havola', file: 'Fayl' }[t] || t),

  async load() {
    const tbody = document.getElementById('attributes-tbody');
    if (!tbody) return;
    try {
      const resp = await fetch('/api/attributes');
      const data = await resp.json();
      if (!resp.ok) {
        tbody.innerHTML = `<tr><td colspan="5" style="color: #f87171;">${this.esc(data.detail || 'Xatolik')}</td></tr>`;
        return;
      }
      this.data = data;
      this.render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #f87171;">Server bilan bog'lanib bo'lmadi</td></tr>`;
    }
  },

  render() {
    const d = this.data;
    const isAdmin = !!Auth.user?.is_admin;
    const usedBy = {};
    d.app_fields.forEach(f => {
      const m = d.mapping[f.key];
      if (m && m.enabled && m.attr_id) (usedBy[m.attr_id] = usedBy[m.attr_id] || []).push(f.label.split(' (')[0]);
    });

    // Ogohlantirishlar: tashqi o'zgarishlar va bog'lanish muammolari
    const alerts = [];
    const ch = d.changes;
    if (ch && (ch.added.length || ch.removed.length || ch.changed.length)) {
      const lines = [
        ...ch.added.map(a => `➕ qo'shildi: ${this.esc(a.name)} (${this.typeLabel(a.type)})`),
        ...ch.removed.map(a => `➖ o'chirildi: ${this.esc(a.name)}`),
        ...ch.changed.map(c => `✏️ o'zgardi: ${this.esc(c.before.name)} → ${this.esc(c.after.name)}${c.before.required !== c.after.required ? (c.after.required ? ' (majburiy bo\'ldi)' : ' (majburiy emas)') : ''}`)
      ];
      alerts.push(`<div style="background: rgba(251,191,36,0.12); border: 1px solid #fbbf24; border-radius: var(--radius-md); padding: 0.6rem 0.8rem; font-size: 0.8rem; margin-bottom: 0.6rem;"><b>⚠️ MoySklad'da maydonlar tashqaridan o'zgargan:</b><br>${lines.join('<br>')}</div>`);
    }
    if (d.problems && d.problems.length) {
      alerts.push(`<div style="background: var(--accent-red-bg, rgba(248,113,113,0.12)); border: 1px solid #f87171; border-radius: var(--radius-md); padding: 0.6rem 0.8rem; font-size: 0.8rem; margin-bottom: 0.6rem;"><b>❌ Kirim yuborishga to'sqinlik qiladi:</b><br>${d.problems.map(p => this.esc(p)).join('<br>')}</div>`);
    }
    document.getElementById('attributes-alerts').innerHTML = alerts.join('');

    // MoySklad maydonlari jadvali
    document.getElementById('attributes-tbody').innerHTML = d.attributes.length ? d.attributes.map(a => `
      <tr>
        <td><b>${this.esc(a.name)}</b></td>
        <td>${this.typeLabel(a.type)}${a.dictionary_id ? ` <span style="color: var(--text-dim);" title="${this.esc((d.dictionaries.find(x => x.id === a.dictionary_id) || {}).name || '')}">📚</span>` : ''}</td>
        <td style="text-align: center;">${isAdmin ? `<input type="checkbox" data-attr-req="${a.id}" ${a.required ? 'checked' : ''}>` : (a.required ? '✓' : '')}</td>
        <td style="font-size: 0.72rem; color: ${usedBy[a.id] ? '#34d399' : 'var(--text-dim)'};">${usedBy[a.id] ? '✅ ' + usedBy[a.id].join(', ') : '—'}</td>
        <td style="text-align: right; white-space: nowrap;">${isAdmin ? `<button class="btn-icon" title="Nomini o'zgartirish" data-attr-rename="${a.id}">✏️</button> <button class="btn-icon delete" title="MoySklad'dan o'chirish" data-attr-del="${a.id}">🗑️</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="color: var(--text-dim);">MoySklad\'da доп. поля yo\'q</td></tr>';

    // Bog'lanish jadvali
    const options = (sel) => `<option value="">— yozilmaydi —</option>` + d.attributes.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${this.esc(a.name)} (${this.typeLabel(a.type)})</option>`).join('');
    document.getElementById('attributes-map-tbody').innerHTML = d.app_fields.map(f => {
      const m = d.mapping[f.key] || {};
      const missing = m.attr_id && !d.attributes.find(a => a.id === m.attr_id);
      return `<tr>
        <td>${this.esc(f.label)}</td>
        <td><select class="form-control" data-map-attr="${f.key}" ${isAdmin ? '' : 'disabled'} style="height: 28px; padding: 0.1rem 0.3rem; font-size: 0.78rem;">${options(m.attr_id)}</select>${missing ? '<div style="color:#f87171;font-size:0.72rem;">MoySklad\'da topilmadi</div>' : ''}</td>
        <td style="text-align: center;"><input type="checkbox" data-map-on="${f.key}" ${m.enabled ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}></td>
      </tr>`;
    }).join('');

    document.getElementById('attributes-create').style.display = isAdmin ? '' : 'none';
    document.getElementById('btn-attributes-map-save').style.display = isAdmin ? '' : 'none';
    const dictSel = document.getElementById('attr-new-dict');
    if (dictSel) dictSel.innerHTML = `<option value="">— yangi spravochnik yaratish —</option>` + d.dictionaries.map(x => `<option value="${x.id}">${this.esc(x.name)}</option>`).join('');
    this.bind();
  },

  bind() {
    document.querySelectorAll('[data-attr-del]').forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute('data-attr-del');
      const a = this.data.attributes.find(x => x.id === id);
      if (!confirm(`"${a?.name}" maydonini MoySklad'dan o'chirasizmi?\nBarcha tovarlardagi shu maydon qiymatlari yo'qoladi. Bu amalni qaytarib bo'lmaydi.`)) return;
      let resp = await fetch(`/api/attributes/${id}`, { method: 'DELETE' });
      let data = await resp.json();
      if (resp.status === 409 && confirm(`${data.detail}\n\nBaribir o'chirilsinmi? (bog'lanish ham o'chadi)`)) {
        resp = await fetch(`/api/attributes/${id}?force=1`, { method: 'DELETE' });
        data = await resp.json();
      }
      showToast(resp.ok ? "🗑️ Maydon MoySklad'dan o'chirildi" : (data.detail || 'Xatolik'), resp.ok ? 'success' : 'error');
      this.load();
    });
    document.querySelectorAll('[data-attr-rename]').forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute('data-attr-rename');
      const a = this.data.attributes.find(x => x.id === id);
      const name = prompt("Maydonning yangi nomi (MoySklad'da o'zgaradi):", a?.name || '');
      if (!name || name.trim() === a?.name) return;
      const resp = await fetch(`/api/attributes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      const data = await resp.json();
      showToast(resp.ok ? '✏️ Nomi o\'zgartirildi' : (data.detail || 'Xatolik'), resp.ok ? 'success' : 'error');
      this.load();
    });
    document.querySelectorAll('[data-attr-req]').forEach(cb => cb.onchange = async () => {
      const resp = await fetch(`/api/attributes/${cb.getAttribute('data-attr-req')}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ required: cb.checked }) });
      if (!resp.ok) { showToast((await resp.json()).detail || 'Xatolik', 'error'); cb.checked = !cb.checked; }
      else this.load();
    });
  }
};

function setupAttributesUI() {
  document.getElementById('btn-attributes-refresh')?.addEventListener('click', () => AttributesUI.load());
  document.getElementById('attr-new-type')?.addEventListener('change', (e) => {
    document.getElementById('attr-new-dict-wrap').style.display = e.target.value === 'customentity' ? '' : 'none';
  });
  document.getElementById('attr-new-dict')?.addEventListener('change', (e) => {
    document.getElementById('attr-new-dict-name').style.display = e.target.value ? 'none' : '';
  });
  document.getElementById('btn-attr-create')?.addEventListener('click', async () => {
    const name = document.getElementById('attr-new-name').value.trim();
    const type = document.getElementById('attr-new-type').value;
    const dictId = document.getElementById('attr-new-dict').value;
    const dictName = document.getElementById('attr-new-dict-name').value.trim();
    if (!name) return showToast('Maydon nomini kiriting', 'error');
    if (type === 'customentity' && !dictId && !dictName) return showToast('Spravochnikni tanlang yoki yangi nom kiriting', 'error');
    if (!confirm(`MoySklad'da "${name}" (${AttributesUI.typeLabel(type)}) maydoni yaratilsinmi?`)) return;
    const resp = await fetch('/api/attributes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, required: document.getElementById('attr-new-required').checked, dictionary_id: dictId || null, new_dictionary_name: dictId ? null : (dictName || name) })
    });
    const data = await resp.json();
    if (!resp.ok) return showToast(data.detail || 'Xatolik', 'error');
    showToast(`✅ "${name}" MoySklad'da yaratildi`, 'success');
    document.getElementById('attr-new-name').value = '';
    document.getElementById('attr-new-dict-name').value = '';
    AttributesUI.data = data;
    AttributesUI.render();
  });
  document.getElementById('btn-attributes-map-save')?.addEventListener('click', async () => {
    const mapping = {};
    document.querySelectorAll('[data-map-attr]').forEach(sel => {
      const key = sel.getAttribute('data-map-attr');
      mapping[key] = { attr_id: sel.value || null, enabled: document.querySelector(`[data-map-on="${key}"]`)?.checked };
    });
    const resp = await fetch('/api/attributes/map', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping }) });
    const data = await resp.json();
    if (!resp.ok) return showToast(data.detail || 'Xatolik', 'error');
    showToast("✅ Bog'lanish saqlandi", 'success');
    AttributesUI.load();
  });
}

// Sozlamalarda artikul namunasi: razmer artikulga kirmaydi, faqat tovarlar sonini ko'paytiradi
function renderArticulExample(colorOn, sizeOn) {
  const example = document.getElementById('set-articul-example');
  const hint = document.getElementById('set-articul-hint');
  if (example) example.textContent = colorOn ? 'A26TOP00724BLK' : 'A26TOP00724';
  if (hint) {
    const colors = colorOn ? 4 : 1;
    const sizes = sizeOn ? 5 : 1;
    hint.textContent = `Masalan: 1 model${colorOn ? ' × 4 rang' : ''}${sizeOn ? ' × 5 razmer' : ''} = 1 model raqami, `
      + `${colors} artikul, ${colors * sizes} tovar (har birining kodi va shtrixkodini MoySklad beradi).`;
  }
}

function setupAppSettingsForm() {
  ['set-color-enabled', 'set-size-enabled'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      renderArticulExample(
        document.getElementById('set-color-enabled')?.checked,
        document.getElementById('set-size-enabled')?.checked
      );
    });
  });

  document.getElementById('btn-save-app-settings')?.addEventListener('click', async () => {
    const payload = {
      color_enabled: document.getElementById('set-color-enabled')?.checked,
      size_enabled: document.getElementById('set-size-enabled')?.checked,
      size_in_name: document.getElementById('set-size-in-name')?.checked,
      usd_enabled: document.getElementById('set-usd-enabled')?.checked,
      color_primary_lang: document.getElementById('set-color-lang')?.value || 'ru',
      default_collection: document.getElementById('set-default-collection')?.value || '',
      default_season: document.getElementById('set-default-season')?.value || '',
      company_name: document.getElementById('set-company-name')?.value || '',
      allowed_logins: document.getElementById('set-allowed-logins')?.value || ''
    };
    const resp = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) {
      showToast(data.detail || "Sozlamalarni saqlab bo'lmadi", "error");
      return;
    }
    References.settings = { ...References.settings, ...data };
    applySettingsUI();
    Grid.recalculateAll();
    Grid.render();
    showToast("✅ Kirim sozlamalari saqlandi", "success");
  });
}
