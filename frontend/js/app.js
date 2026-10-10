// Main Application Controller
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Setup UI tabs and buttons immediately
  setupNavigationTabs();
  setupMainButtons();
  setupQuickAddModals();
  AIScanner.init();

  // 2. Load MoySklad metadata & next document number concurrently
  loadMoySkladMetadata();

  // 3. Initialize References and Grid
  try {
    await References.init();
  } catch (e) {
    console.error("References init error:", e);
  }

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

// MoySklad metadata & status & next doc number
async function loadMoySkladMetadata() {
  const statusDot = document.getElementById('ms-status-dot');
  const statusText = document.getElementById('ms-status-text');
  const settingsStatus = document.getElementById('settings-ms-status');
  const settingsOrg = document.getElementById('settings-ms-org');

  try {
    const statusResp = await fetch('/api/moysklad/status');
    const statusData = await statusResp.json();

    if (statusData.status === 'connected') {
      if (statusDot) statusDot.className = 'status-dot';
      if (statusText) statusText.textContent = `MoySklad: ${statusData.organization_name || 'Ulandi'}`;
      if (settingsStatus) {
        settingsStatus.textContent = '✅ Ulangan (Faol)';
        settingsStatus.className = 'badge badge-synced';
      }
      if (settingsOrg) settingsOrg.textContent = statusData.organization_name || 'DE LUXURY';
    } else {
      if (statusDot) statusDot.className = 'status-dot disconnected';
      if (statusText) statusText.textContent = 'MoySklad: Ulanmadi';
      if (settingsStatus) {
        settingsStatus.textContent = '❌ Xatolik';
        settingsStatus.className = 'badge badge-conflict';
      }
    }

    // Load Stores (Omborlar)
    const storeResp = await fetch('/api/moysklad/stores');
    if (storeResp.ok) {
      const stores = await storeResp.json();
      const storeSelect = document.getElementById('header-store');
      if (storeSelect) {
        storeSelect.innerHTML = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }
    }

    // Load Counterparties (Yetkazib beruvchilar) — default empty
    await reloadCounterpartiesDropdown();

    // Load Next 5-digit Document Number (e.g. 00035)
    const nextNumResp = await fetch('/api/moysklad/next-doc-number');
    if (nextNumResp.ok) {
      const nextData = await nextNumResp.json();
      const docInput = document.getElementById('header-doc-number');
      if (docInput && (!docInput.value || docInput.value.startsWith('PRX-'))) {
        docInput.value = nextData.next_number || '00035';
      }
    }

  } catch (e) {
    console.error("MoySklad status error:", e);
    if (statusDot) statusDot.className = 'status-dot disconnected';
    if (statusText) statusText.textContent = 'MoySklad: Server xatosi';
  }
}

async function reloadCounterpartiesDropdown(selectedId = null) {
  const cpResp = await fetch('/api/moysklad/counterparties');
  if (cpResp.ok) {
    const counterparties = await cpResp.json();
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

// Navigation Tabs
function setupNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetId = tab.getAttribute('data-tab');
      
      // Update tab buttons
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update contents
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(targetId)?.classList.add('active');

      // Lazy load tab contents
      if (targetId === 'tab-history') {
        History.load();
      } else if (targetId === 'tab-references') {
        renderReferencesUI('ref-product-types');
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

  // Currency change listener
  document.getElementById('header-currency')?.addEventListener('change', () => {
    Grid.updateStats();
    Grid.render();
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
        showToast(`✅ MoySklad katalogi bilan sinxronlandi (${data.synced_categories_count} ta kategoriya)`, 'success');
      }
    } catch (e) {
      showToast("❌ Sinxronlashda xatolik", "error");
    }
  });

  // Update Articul Counter
  document.getElementById('btn-update-counter')?.addEventListener('click', async () => {
    const val = parseInt(document.getElementById('settings-articul-counter').value, 10);
    if (isNaN(val)) return alert("Noto'g'ri raqam");
    try {
      const resp = await fetch('/api/articul/counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_number: val })
      });
      if (resp.ok) {
        Grid.baseCounter = val;
        Grid.recalculateAll();
        Grid.render();
        showToast(`🔢 Артикул ketma-ket raqami ${val} ga yangilandi!`, 'success');
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
      body: JSON.stringify({ rows: usefulRows })
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
      body: JSON.stringify({ rows: usefulRows })
    });
    const val = await resp.json();

    const modal = document.getElementById('modal-submit-confirm');
    const modalBody = document.getElementById('submit-modal-body');
    const storeName = document.getElementById('header-store')?.selectedOptions[0]?.text || 'Asosiy Ombor';
    const cpName = document.getElementById('header-counterparty')?.selectedOptions[0]?.text || 'Noma\'lum';
    const docNumber = document.getElementById('header-doc-number')?.value || '00035';

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
    const headerData = {
      doc_number: document.getElementById('header-doc-number')?.value,
      doc_date: document.getElementById('header-date')?.value,
      store_id: document.getElementById('header-store')?.value,
      store_name: document.getElementById('header-store')?.selectedOptions[0]?.text || '',
      counterparty_id: document.getElementById('header-counterparty')?.value,
      counterparty_name: document.getElementById('header-counterparty')?.selectedOptions[0]?.text || '',
      currency: document.getElementById('header-currency')?.value || 'UZS'
    };

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
            Hujjat raqami: <b>${data.moysklad_document_name || data.document_id}</b> | Pozitsiyalar: <b>${data.total_items} ta</b>
          </p>
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            ${data.moysklad_url ? `<a href="${data.moysklad_url}" target="_blank" class="btn btn-gold btn-lg" style="text-decoration: none;">🔗 MoySklad'da ochish</a>` : ''}
          </div>
          <p style="font-size: 0.8rem; color: #34d399; margin-top: 1.25rem;">
            📱 Telegram guruhiga hisobot yuborildi.
          </p>
        `;

        successModal.classList.add('active');

        // Reset Grid & refresh next doc number
        Grid.rows = [];
        Grid.addEmptyRows(5);
        await Grid.fetchBaseCounter();
        const nextNumResp = await fetch('/api/moysklad/next-doc-number');
        if (nextNumResp.ok) {
          const nextData = await nextNumResp.json();
          document.getElementById('header-doc-number').value = nextData.next_number || '00035';
        }
      } else {
        alert(data.detail || data.message || "MoySklad'ga yuborishda xatolik yuz berdi");
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
    const nextNumResp = await fetch('/api/moysklad/next-doc-number');
    if (nextNumResp.ok) {
      const nextData = await nextNumResp.json();
      document.getElementById('header-doc-number').value = nextData.next_number || '00035';
    }
  });
}

// Quick Add Modals (Kontragent, Ierarxiya Add/Edit, Excel Import)
function setupQuickAddModals() {
  // 1. Quick Add Counterparty
  const modalCp = document.getElementById('modal-quick-cp');
  document.getElementById('btn-quick-add-cp')?.addEventListener('click', () => {
    document.getElementById('cp-new-name').value = '';
    document.getElementById('cp-new-phone').value = '';
    document.getElementById('cp-new-desc').value = '';
    if (modalCp) modalCp.classList.add('active');
  });

  document.getElementById('btn-close-cp-modal')?.addEventListener('click', () => modalCp.classList.remove('active'));
  document.getElementById('btn-cancel-cp')?.addEventListener('click', () => modalCp.classList.remove('active'));

  document.getElementById('btn-save-new-cp')?.addEventListener('click', async () => {
    const name = document.getElementById('cp-new-name').value.trim();
    if (!name) return alert("Kontragent nomini kiriting!");
    const phone = document.getElementById('cp-new-phone').value.trim();
    const desc = document.getElementById('cp-new-desc').value.trim();

    try {
      const resp = await fetch('/api/moysklad/counterparties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, description: desc })
      });
      const data = await resp.json();
      if (resp.ok && data.status === 'created') {
        modalCp.classList.remove('active');
        const createdId = data.counterparty?.id;
        await reloadCounterpartiesDropdown(createdId);
        showToast(`✅ "${name}" MoySklad'da muvaffaqiyatli yaratildi va tanlandi!`, "success");
      } else {
        alert(data.message || "Kontragent yaratishda xatolik yuz berdi");
      }
    } catch (e) {
      alert("Tarmoq xatosi yuz berdi");
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

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const btn = document.getElementById('btn-upload-hierarchy-confirm');
    btn.disabled = true;
    btn.textContent = "Yuklanmoqda...";

    try {
      const resp = await fetch('/api/references/import-hierarchy-csv', {
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
        showToast(`✅ ${data.total} ta mahsulot turi yangilandi (${data.imported_new} yangi, ${data.updated} o'zgartirildi)!`, "success");
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
