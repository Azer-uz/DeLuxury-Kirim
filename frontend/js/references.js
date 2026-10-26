// References & Manbalar Management with Sorting, Filtering & Excel Import/Export
const References = {
  data: {
    groups: [],
    seasons: [],
    season_types: [],
    sizes: [],
    categories: [],
    product_types: [],
    brands: [],
    colors: [],
    countries: [],
    product_type_map: {},
    season_map: {}
  },

  sortState: {
    column: 'name',
    direction: 'asc' // 'asc' or 'desc'
  },

  filterState: {
    search: '',
    category: '',
    group: '',
    status: ''
  },

  // Ilova sozlamalari (/api/settings): artikulga rang/razmer qo'shilishi, USD kirim va h.k.
  settings: {
    company_name: '',
    color_enabled: true,
    size_enabled: false,
    size_in_name: true,
    usd_enabled: false
  },

  async init() {
    try {
      const [refResp, setResp] = await Promise.all([fetch('/api/references/all'), fetch('/api/settings')]);
      if (refResp.ok) {
        this.data = await refResp.json();
      }
      if (setResp.ok) {
        this.settings = { ...this.settings, ...(await setResp.json()) };
      }
    } catch (e) {
      console.error("Error loading references:", e);
    }
  },

  // Spravochnikda topilmasa bo'sh qaytadi — artikulda "???" ko'rinadi va yuborishda xato beriladi
  getProductTypeInfo(productTypeName) {
    if (!productTypeName) return { category: '', group: '', group_code: '' };
    const pt = this.data.product_type_map[productTypeName.trim()];
    if (pt) {
      return {
        category: pt.category || '',
        group: pt.group || '',
        group_code: pt.group_code || ''
      };
    }
    // Case-insensitive fallback
    const key = Object.keys(this.data.product_type_map).find(
      k => k.toLowerCase() === productTypeName.trim().toLowerCase()
    );
    if (key) {
      const found = this.data.product_type_map[key];
      return {
        category: found.category || '',
        group: found.group || '',
        group_code: found.group_code || ''
      };
    }
    return { category: '', group: '', group_code: '' };
  },

  getSeasonCode(collectionName) {
    if (!collectionName) return '';
    const clean = collectionName.trim();
    if (this.data.season_map[clean]) {
      return this.data.season_map[clean];
    }
    const key = Object.keys(this.data.season_map).find(
      k => k.toLowerCase() === clean.toLowerCase()
    );
    return key ? this.data.season_map[key] : '';
  },

  splitSizes(sizeText) {
    return String(sizeText || '').split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
  },

  normalizeSize(size) {
    return String(size || '').replace(/\s+/g, '').toUpperCase();
  },

  getTopColors() {
    const popular = [
      'Бежевый', 'Белый', 'Зеленый', 'Коричневый', 'Хаки',
      'Красный', 'Серый', 'Синий', 'Темно-синий', 'Черный', 'Мультиколор'
    ];
    const all = this.data.colors || [];
    const list = [];
    popular.forEach(pName => {
      const match = all.find(c => c.name && c.name.trim().toLowerCase() === pName.toLowerCase());
      if (match) {
        list.push(match);
      } else {
        list.push({ name: pName, short_code: '' });
      }
    });
    return list;
  },

  getColorCode(colorName) {
    if (!colorName) return '';
    const clean = colorName.trim().toLowerCase();
    if (clean === 'мультиколор' || clean === 'multicolor' || clean === 'aralash' || clean === 'standart' || clean === 'std') {
      return 'STD';
    }
    const found = (this.data.colors || []).find(c => c.name && c.name.trim().toLowerCase() === clean);
    if (found && found.short_code) {
      return found.short_code.trim().toUpperCase();
    }
    // Spravochnikda kodi yo'q rang — yuborishda xato beriladi
    return '???';
  },

  getTopColors() {
    const list = this.data.colors || [];
    const favs = list.filter(c => c.is_favorite);
    if (favs.length > 0) return favs;
    // Default top 10 fallback
    return list.slice(0, 10);
  },

  /**
   * Qator formulalari (oldindan ko'rish). Haqiqiy model raqamini yuborishda backend beradi.
   *   Модель  = Mavsum kodi + Guruh kodi + (baseCounter + modelOrdinal + 1)
   *   Артикул = Модель [+ Rang kodi] — razmer artikulga kirmaydi (razmer rejimida har bir razmer alohida tovar)
   * modelOrdinal — jadvaldagi model tartibi (bir modelning rang/razmer variantlari bir xil tartibni oladi).
   * rate — USD kirimda kurs: tan narx dollarda, sotuv narxi doim so'mda.
   */
  calculateRow(row, modelOrdinal, baseCounter = 0, rate = 1) {
    const pType = (row.product_type || '').trim();
    const coll = (row.collection || '').trim();
    const brand = (row.brand || '').trim();
    const factoryCode = (row.factory_code || '').trim();
    const desc = (row.description || '').trim();
    const color = (row.color || '').trim();
    const size = (row.size || '').trim();
    const qty = parseFloat(row.quantity) || 0;
    const pBuy = parseFloat(row.price_buy) || 0;
    const pSale = parseFloat(row.price_sale) || 0;
    const buyRate = rate > 0 ? rate : 1;

    const ptInfo = this.getProductTypeInfo(pType);
    const seasonCode = this.getSeasonCode(coll) || '???';
    const groupCode = ptInfo.group_code || '???';

    const zeroPadded = (modelOrdinal === null || modelOrdinal === undefined)
      ? '-----'
      : String(baseCounter + modelOrdinal + 1).padStart(5, '0');
    const calculatedModel = `${seasonCode}${groupCode}${zeroPadded}`;
    const modelCode = (row.custom_model && row.model_code && row.model_code.trim()) ? row.model_code.trim() : calculatedModel;

    const colorCode = this.settings.color_enabled ? this.getColorCode(color) : '';
    const calculatedArticul = modelCode + colorCode;

    // Nomga rang qo'shilmaydi. Brenddan keyin Код модели (Zavod artikuli); razmer rejimida (sozlamaga qarab) oxirida razmer
    const sizeForName = (this.settings.size_enabled && this.settings.size_in_name && this.splitSizes(size).length === 1)
      ? this.normalizeSize(size) : '';
    const nameParts = [pType, desc, brand, factoryCode, sizeForName].filter(Boolean);
    const fullName = nameParts.join(' ').trim();

    let finalSale = pSale;
    let markupPct = parseFloat(row.markup_pct) || 0;
    const buyInSaleCurrency = pBuy * buyRate;

    if (row.last_edited_field === 'markup_pct' && buyInSaleCurrency > 0) {
      finalSale = Math.round(buyInSaleCurrency * (1 + markupPct / 100) * 100) / 100;
    } else if (buyInSaleCurrency > 0 && pSale > 0) {
      markupPct = Math.round(((pSale / buyInSaleCurrency) - 1) * 1000) / 10;
    }

    const sumBuy = Math.round((qty * pBuy) * 100) / 100;
    const sumSale = Math.round((qty * finalSale) * 100) / 100;

    return {
      category: ptInfo.category,
      group_name: ptInfo.group,
      group_code: groupCode,
      season_code: seasonCode,
      // Tovar kodini MoySklad o'zi beradi
      code: '',
      model_code: modelCode,
      calculated_model: calculatedModel,
      factory_code: factoryCode,
      color_code: colorCode,
      articul: row.custom_articul ? row.articul : calculatedArticul,
      calculated_articul: calculatedArticul,
      full_name: fullName,
      price_sale: finalSale,
      markup_pct: markupPct,
      sum_buy: sumBuy,
      sum_sale: sumSale
    };
  }
};

// UI Render for Manbalar & Ierarxiya

// ================= Umumiy tahrirlash oynasi (Manbalar) =================
const RefEdit = {
  kinds: {
    group:       { title: 'Guruhni tahrirlash',    url: (id) => `/api/references/group/${id}`,       fields: [['name', 'Guruh nomi'], ['code', 'Artikul kodi (3 harf)']] },
    season:      { title: 'Kolleksiyani tahrirlash', url: (id) => `/api/references/season/${id}`,    fields: [['collection', 'Kolleksiya (AW26)'], ['code', 'Artikul kodi (A26)']] },
    seasonType:  { title: 'Sezonni tahrirlash',    url: (id) => `/api/references/season-type/${id}`, fields: [['name', 'Sezon nomi']] },
    size:        { title: 'Razmerni tahrirlash',   url: (id) => `/api/references/size-item/${id}`,   fields: [['name', 'Razmer']] },
    brand:       { title: 'Brendni tahrirlash',    url: (id) => `/api/references/brand/${id}`,       fields: [['name', 'Brend nomi']] },
    country:     { title: 'Mamlakatni tahrirlash', url: (id) => `/api/references/country/${id}`,     fields: [['name', 'Mamlakat nomi']] },
    color:       { title: 'Rangni tahrirlash',     url: (id) => `/api/references/color/${id}`,       fields: [['name', 'Rang nomi (asosiy, turkcha)'], ['name_ru', 'Ruscha nomi'], ['name_en', 'Inglizcha nomi'], ['short_code', '3 harfli kod'], ['code_no', '№ No']] },
  },
  open(kind, id, current, refreshTab) {
    const k = this.kinds[kind]; if (!k) return;
    let m = document.getElementById('ref-edit-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'ref-edit-modal'; m.className = 'modal';
      m.innerHTML = `<div class="modal-content" style="max-width:460px;"><div class="modal-header"><h3 id="ref-edit-title"></h3><button class="btn-icon" onclick="document.getElementById('ref-edit-modal').classList.remove('active')">✖</button></div>
        <div class="modal-body" id="ref-edit-body"></div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:0.5rem; padding:0.75rem 1rem;"><button class="btn btn-secondary" onclick="document.getElementById('ref-edit-modal').classList.remove('active')">Bekor</button><button class="btn btn-primary" id="ref-edit-save">💾 Saqlash</button></div></div>`;
      document.body.appendChild(m);
    }
    m.querySelector('#ref-edit-title').textContent = k.title;
    m.querySelector('#ref-edit-body').innerHTML = k.fields.map(([f, label]) => `<label class="form-label" style="margin-top:0.5rem;">${label}</label><input class="form-control" data-f="${f}" value="${String(current[f] ?? '').replace(/"/g, '&quot;')}">`).join('');
    m.querySelector('#ref-edit-save').onclick = async () => {
      const body = {}; m.querySelectorAll('[data-f]').forEach(i => { body[i.dataset.f] = i.value.trim(); });
      const res = await fetch(k.url(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(d.detail || 'Saqlab bo\'lmadi', 'error');
      m.classList.remove('active'); await References.init(); renderReferencesUI(refreshTab); showToast('Saqlandi', 'success');
    };
    m.classList.add('active');
    setTimeout(() => m.querySelector('[data-f]')?.focus(), 50);
  },
  async remove(kind, id, label, refreshTab) {
    const k = this.kinds[kind]; if (!k) return;
    if (!confirm(`"${label}" o'chirilsinmi?`)) return;
    const res = await fetch(k.url(id), { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return showToast(d.detail || 'O\'chirib bo\'lmadi', 'error');
    await References.init(); renderReferencesUI(refreshTab); showToast('O\'chirildi', 'success');
  }
};
function refBtns(kind, obj, label, tab) {
  const cur = JSON.stringify(obj).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  return `<button class="btn-icon" title="Tahrirlash" onclick='RefEdit.open("${kind}", ${obj.id}, JSON.parse(this.dataset.cur), "${tab}")' data-cur="${cur}">✏️</button>
          <button class="btn-icon delete" title="O'chirish" onclick='RefEdit.remove("${kind}", ${obj.id}, this.dataset.label, "${tab}")' data-label="${String(label).replace(/"/g, '&quot;')}">🗑️</button>`;
}

function renderReferencesUI(activeTab = 'ref-product-types') {
  const container = document.getElementById('ref-content-container');
  if (!container) return;

  if (activeTab === 'ref-product-types') {
    renderHierarchySubtab(container);
  } else if (activeTab === 'ref-groups') {
    renderGroupsSubtab(container);
  } else if (activeTab === 'ref-seasons') {
    renderSeasonsSubtab(container);
  } else if (activeTab === 'ref-season-types') {
    renderSeasonTypesSubtab(container);
  } else if (activeTab === 'ref-sizes') {
    renderSizesSubtab(container);
  } else if (activeTab === 'ref-brands') {
    renderBrandsSubtab(container);
  } else if (activeTab === 'ref-colors') {
    renderColorsSubtab(container);
  } else if (activeTab === 'ref-countries') {
    renderCountriesSubtab(container);
  }
}

// 1. Ierarxiya Subtab with Sorting, Filtering, CRUD, and Import/Export
function renderHierarchySubtab(container) {
  const allProductTypes = References.data.product_types || [];
  const categoriesList = [...new Set(allProductTypes.map(p => p.category).filter(Boolean))].sort();
  const groupsList = (References.data.groups || []).map(g => g.name).sort();

  // Filter items
  let filtered = allProductTypes.filter(pt => {
    const q = References.filterState.search.toLowerCase();
    const matchSearch = !q || (
      pt.name.toLowerCase().includes(q) ||
      (pt.category && pt.category.toLowerCase().includes(q)) ||
      (pt.group && pt.group.toLowerCase().includes(q)) ||
      (pt.group_code && pt.group_code.toLowerCase().includes(q))
    );
    const matchCat = !References.filterState.category || pt.category === References.filterState.category;
    const matchGroup = !References.filterState.group || pt.group === References.filterState.group;
    const matchStatus = !References.filterState.status || (
      References.filterState.status === 'synced' ? pt.status === 'synced' : pt.status !== 'synced'
    );
    return matchSearch && matchCat && matchGroup && matchStatus;
  });

  // Sort items
  const { column, direction } = References.sortState;
  filtered.sort((a, b) => {
    let valA = (a[column] || '').toString().toLowerCase();
    let valB = (b[column] || '').toString().toLowerCase();
    if (column === 'id') {
      valA = a.id || 0;
      valB = b.id || 0;
      return direction === 'asc' ? valA - valB : valB - valA;
    }
    const cmp = valA.localeCompare(valB, 'ru');
    return direction === 'asc' ? cmp : -cmp;
  });

  const getSortIcon = (col) => {
    if (References.sortState.column !== col) return '⇅';
    return References.sortState.direction === 'asc' ? '▲' : '▼';
  };

  let html = `
    <!-- Action and Filter Bar -->
    <div style="display: flex; gap: 0.75rem; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 1rem;">
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; flex: 1;">
        <input type="text" id="ref-search-input" class="form-control" placeholder="Qidirish (masalan Футболка, Куртка)..." 
               value="${References.filterState.search}" style="max-width: 240px;">
        
        <!-- Category Filter -->
        <select class="form-control" id="ref-filter-category" style="max-width: 180px;">
          <option value="">Barcha Kategoriyalar</option>
          ${categoriesList.map(c => `<option value="${c}" ${References.filterState.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>

        <!-- Group Filter -->
        <select class="form-control" id="ref-filter-group" style="max-width: 180px;">
          <option value="">Barcha Guruhlar</option>
          ${groupsList.map(g => `<option value="${g}" ${References.filterState.group === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>

        <!-- Status Filter -->
        <select class="form-control" id="ref-filter-status" style="max-width: 150px;">
          <option value="">Barcha Holatlar</option>
          <option value="synced" ${References.filterState.status === 'synced' ? 'selected' : ''}>✅ Mos keldi</option>
          <option value="local" ${References.filterState.status === 'local' ? 'selected' : ''}>📦 Lokal</option>
        </select>
      </div>

      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <button class="btn btn-primary btn-sm" id="btn-open-pt-add-modal">
          <span>➕</span> Yangi Mahsulot turi
        </button>
        <a href="/api/references/export-hierarchy-csv" class="btn btn-secondary btn-sm" style="text-decoration: none;">
          <span>📥</span> CSV Shablon
        </a>
        <button class="btn btn-secondary btn-sm" id="btn-open-import-modal">
          <span>📤</span> Excel/CSV Import
        </button>
      </div>
    </div>

    <!-- Header Stats -->
    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
      <span>Ko'rsatilmoqda: <b>${filtered.length}</b> ta / Jami: <b>${allProductTypes.length}</b> ta</span>
      <span>Saralash: <b>${References.sortState.column}</b> (${References.sortState.direction.toUpperCase()})</span>
    </div>

    <!-- Hierarchy Table -->
    <div style="max-height: 520px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th style="width: 40px; cursor: pointer;" onclick="References.toggleSort('id')">
              № <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('id')}</span>
            </th>
            <th style="cursor: pointer;" onclick="References.toggleSort('name')">
              Вид товара <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('name')}</span>
            </th>
            <th style="cursor: pointer;" onclick="References.toggleSort('category')">
              Категория <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('category')}</span>
            </th>
            <th style="cursor: pointer;" onclick="References.toggleSort('group')">
              Группа <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('group')}</span>
            </th>
            <th style="cursor: pointer;" onclick="References.toggleSort('group_code')">
              Guruh Kodi <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('group_code')}</span>
            </th>
            <th style="cursor: pointer;" onclick="References.toggleSort('status')">
              MoySklad Holati <span style="font-size: 0.7rem; color: #38bdf8;">${getSortIcon('status')}</span>
            </th>
            <th style="width: 100px; text-align: center;">Amallar</th>
          </tr>
        </thead>
        <tbody id="ref-pt-tbody">
  `;

  if (filtered.length === 0) {
    html += `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          Qidiruv yoki filtr bo'yicha mahsulot turi topilmadi.
        </td>
      </tr>
    `;
  } else {
    filtered.forEach((pt, i) => {
      html += `
        <tr>
          <td>${i + 1}</td>
          <td><b>${pt.name}</b></td>
          <td>${pt.category || '<span style="color: var(--text-dim);">-</span>'}</td>
          <td>${pt.group || '<span style="color: var(--text-dim);">-</span>'}</td>
          <td><span class="kbd" style="font-weight: 700; color: #fbbf24;">${pt.group_code}</span></td>
          <td><span class="badge ${pt.status === 'synced' ? 'badge-synced' : 'badge-local'}">${pt.status === 'synced' ? '✅ Mos keldi' : '📦 Lokal'}</span></td>
          <td style="text-align: center;">
            <div class="row-actions">
              <button class="btn-icon" title="Tahrirlash" onclick="openProductTypeEditModal(${pt.id})">✏️</button>
              <button class="btn-icon delete" title="O'chirish" onclick="deleteProductTypeItem(${pt.id}, '${pt.name}')">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Bind Filters
  document.getElementById('ref-search-input')?.addEventListener('input', (e) => {
    References.filterState.search = e.target.value;
    renderHierarchySubtab(container);
  });
  document.getElementById('ref-filter-category')?.addEventListener('change', (e) => {
    References.filterState.category = e.target.value;
    renderHierarchySubtab(container);
  });
  document.getElementById('ref-filter-group')?.addEventListener('change', (e) => {
    References.filterState.group = e.target.value;
    renderHierarchySubtab(container);
  });
  document.getElementById('ref-filter-status')?.addEventListener('change', (e) => {
    References.filterState.status = e.target.value;
    renderHierarchySubtab(container);
  });

  // Open Add modal
  document.getElementById('btn-open-pt-add-modal')?.addEventListener('click', () => {
    openProductTypeAddModal();
  });

  // Open Import modal
  document.getElementById('btn-open-import-modal')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-import-hierarchy');
    if (modal) modal.classList.add('active');
  });
}

References.toggleSort = function(col) {
  if (this.sortState.column === col) {
    this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
  } else {
    this.sortState.column = col;
    this.sortState.direction = 'asc';
  }
  const container = document.getElementById('ref-content-container');
  if (container) renderHierarchySubtab(container);
};

// 2. Groups Subtab
function renderGroupsSubtab(container) {
  const list = References.data.groups || [];
  let html = `
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Группа (Guruh)</th>
            <th>Артикул Kodi (3 harf)</th>
            <th>Holat</th>
            <th style="width:90px;">Amallar</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((g, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><b>${g.name}</b></td>
        <td><span class="kbd" style="font-size: 0.9rem; font-weight: 700; color: #fbbf24;">${g.code}</span></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td>${refBtns('group', g, g.name, 'ref-groups')}</td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// 3. Seasons (Mavsum Kolleksiya) Subtab
function renderSeasonsSubtab(container) {
  const list = References.data.seasons || [];
  let html = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input type="text" id="new-season-coll" class="form-control" placeholder="Yangi kolleksiya (masalan SS27)" style="max-width: 200px;">
      <input type="text" id="new-season-code" class="form-control" placeholder="Kodi (masalan S27)" style="max-width: 150px;">
      <button class="btn btn-primary btn-sm" id="btn-add-season-ref">➕ Qo'shish</button>
    </div>
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Коллекция</th>
            <th>Артикул Kodi</th>
            <th>Holat</th>
            <th style="width:90px;">Amallar</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((s, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><b>${s.collection}</b></td>
        <td><span class="kbd" style="font-size: 0.9rem; font-weight: 700; color: #38bdf8;">${s.code}</span></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td>${refBtns('season', s, s.collection, 'ref-seasons')}</td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('btn-add-season-ref')?.addEventListener('click', async () => {
    const col = document.getElementById('new-season-coll').value.trim();
    const cod = document.getElementById('new-season-code').value.trim();
    if (!col || !cod) return alert("Kolleksiya va kodni kiriting!");
    const res = await fetch('/api/references/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: col, code: cod })
    });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-seasons');
      showToast("Mavsum kodi saqlandi!", "success");
    }
  });
}

// 4. Season Types (Sezonlar: Весна-Осень, Зима, etc.) Subtab
function renderSeasonTypesSubtab(container) {
  const list = References.data.season_types || [];
  let html = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input type="text" id="new-season-type-name" class="form-control" placeholder="Yangi sezon nomi (masalan: Демисезон)..." style="max-width: 250px;">
      <button class="btn btn-primary btn-sm" id="btn-add-season-type">➕ Sezon qo'shish</button>
    </div>
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Sezon (Fasl Nomi)</th>
            <th>Holat</th>
            <th style="width: 80px; text-align: center;">Amal</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((st, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><b>${st.name}</b></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td style="text-align: center;">
          <button class="btn-icon" title="Tahrirlash" onclick='RefEdit.open("seasonType", ${st.id}, {name: this.dataset.n}, "ref-season-types")' data-n="${String(st.name).replace(/"/g, '&quot;')}">✏️</button> <button class="btn-icon delete" title="O'chirish" onclick="deleteSeasonTypeItem(${st.id})">🗑️</button>
        </td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('btn-add-season-type')?.addEventListener('click', async () => {
    const name = document.getElementById('new-season-type-name').value.trim();
    if (!name) return alert("Sezon nomini kiriting!");
    const res = await fetch('/api/references/season-type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-season-types');
      showToast("Sezon muvaffaqiyatli qo'shildi!", "success");
    }
  });
}

// 5. Sizes (Razmerlar / O'lchamlar) Subtab
function renderSizesSubtab(container) {
  const list = References.data.sizes || [];
  let html = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input type="text" id="new-size-name" class="form-control" placeholder="Yangi o'lcham (masalan: 58, 6XL)..." style="max-width: 250px;">
      <button class="btn btn-primary btn-sm" id="btn-add-size-item">➕ Razmer qo'shish</button>
    </div>
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Razmer (O'lcham)</th>
            <th>Holat</th>
            <th style="width: 80px; text-align: center;">Amal</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((sz, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><span class="kbd" style="font-size: 0.95rem; font-weight: 700; color: #38bdf8;">${sz.name}</span></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td style="text-align: center;">
          <button class="btn-icon" title="Tahrirlash" onclick='RefEdit.open("size", ${sz.id}, {name: this.dataset.n}, "ref-sizes")' data-n="${String(sz.name).replace(/"/g, '&quot;')}">✏️</button> <button class="btn-icon delete" title="O'chirish" onclick="deleteSizeItem(${sz.id})">🗑️</button>
        </td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('btn-add-size-item')?.addEventListener('click', async () => {
    const name = document.getElementById('new-size-name').value.trim();
    if (!name) return alert("Razmer nomini kiriting!");
    const res = await fetch('/api/references/size-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-sizes');
      showToast("Razmer muvaffaqiyatli qo'shildi!", "success");
    }
  });
}

// 6. Brands Subtab
function renderBrandsSubtab(container) {
  const list = References.data.brands || [];
  let html = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input type="text" id="new-brand-name" class="form-control" placeholder="Yangi brend nomi..." style="max-width: 250px;">
      <button class="btn btn-primary btn-sm" id="btn-add-brand-ref">➕ Brend qo'shish</button>
    </div>
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Brend Nomi</th>
            <th>Holat</th>
            <th style="width:90px;">Amallar</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((b, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><b>${b.name}</b></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td>${refBtns('brand', b, b.name, 'ref-brands')}</td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('btn-add-brand-ref')?.addEventListener('click', async () => {
    const name = document.getElementById('new-brand-name').value.trim();
    if (!name) return alert("Brend nomini kiriting!");
    const res = await fetch('/api/references/brand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-brands');
      showToast("Brend muvaffaqiyatli qo'shildi!", "success");
    }
  });
}

// 7. Colors Subtab with 3-letter Code & Top 10 Favorite Management
function renderColorsSubtab(container) {
  const list = References.data.colors || [];
  const favCount = list.filter(c => c.is_favorite).length;

  let html = `
    <!-- Top Action & New Color Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <input type="text" id="new-color-name" class="form-control" placeholder="Rang nomi, turkcha (Siyah)..." style="max-width: 170px;">
        <input type="text" id="new-color-code" class="form-control" placeholder="3 ta harf (SAF)..." maxlength="5" style="max-width: 130px; text-transform: uppercase;">
        <input type="text" id="new-color-tr" class="form-control" placeholder="Ruscha (Черный)..." style="max-width: 150px;">
        <input type="number" id="new-color-no" class="form-control" placeholder="№ No..." style="max-width: 80px;">
        <button class="btn btn-primary btn-sm" id="btn-add-color-ref">➕ Rang qo'shish</button>
      </div>
      <div style="font-size: 0.85rem; color: var(--text-muted); background: var(--bg-hover); padding: 0.35rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
        ⭐ Tezkor (Top 10) ranglar: <b style="color: #f59e0b;" id="ref-fav-count">${favCount}</b> ta tanlangan
      </div>
    </div>

    <!-- Colors Table -->
    <div style="max-height: 480px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table" style="width: 100%;">
        <thead>
          <tr>
            <th style="width: 60px;">№ No</th>
            <th>Rang Nomi</th>
            <th style="width: 190px;">Ruscha / Inglizcha</th>
            <th style="width: 160px;">3 Harfli Kod (Artikul uchun)</th>
            <th style="width: 140px; text-align: center;">⭐ Tezkor (Top 10)</th>
            <th style="width: 90px; text-align: center;">Holat</th>
          </tr>
        </thead>
        <tbody id="ref-colors-tbody">
  `;

  list.forEach((c) => {
    const isFav = !!c.is_favorite;
    html += `
      <tr data-color-id="${c.id}">
        <td><span class="kbd">${c.code_no || '-'}</span></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--border-subtle); background: ${c.rgb || (c.name === 'Белый' ? '#ffffff' : (c.name === 'Черный' ? '#000000' : '#888888'))};"></span>
            <b>${c.name}</b>
          </div>
        </td>
        <td style="font-size:0.8rem; color: var(--text-muted);">${c.name_ru || '—'}${c.name_en ? ` <span style="opacity:.7">/ ${c.name_en}</span>` : ''} <button class="btn-icon" title="Tahrirlash (nom, ruscha, inglizcha, kod)" onclick='RefEdit.open("color", ${c.id}, JSON.parse(this.dataset.cur), "ref-colors")' data-cur="${JSON.stringify({name: c.name, name_ru: c.name_ru || '', name_en: c.name_en || '', short_code: c.short_code || '', code_no: c.code_no || ''}).replace(/"/g, '&quot;')}">✏️</button></td>
        <td>
          <input type="text" 
            class="form-control color-short-code-input" 
            data-id="${c.id}" 
            data-old="${c.short_code || ''}" 
            value="${c.short_code || ''}" 
            maxlength="5" 
            style="font-family: monospace; font-weight: 700; text-transform: uppercase; width: 90px; padding: 0.2rem 0.5rem; font-size: 0.85rem;"
            placeholder="KOD">
        </td>
        <td style="text-align: center;">
          <button type="button" 
            class="btn btn-sm btn-toggle-fav-color ${isFav ? 'btn-primary' : 'btn-secondary'}" 
            data-id="${c.id}"
            style="padding: 0.2rem 0.55rem; font-size: 0.78rem; font-weight: 600;">
            ${isFav ? '⭐ Asosiy' : '☆ Oddiy'}
          </button>
        </td>
        <td style="text-align: center;"><span class="badge badge-synced">✅ Faol</span></td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Add new color handler
  document.getElementById('btn-add-color-ref')?.addEventListener('click', async () => {
    const name = document.getElementById('new-color-name').value.trim();
    const short_code = document.getElementById('new-color-code').value.trim().toUpperCase();
    const code_no = document.getElementById('new-color-no').value.trim();

    if (!name || !short_code) {
      alert("Rang nomi va 3 harfli qisqa kod kiritilishi shart!");
      return;
    }

    try {
      const res = await fetch('/api/references/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, short_code, code_no: code_no ? parseInt(code_no) : null, name_ru: (document.getElementById('new-color-tr')?.value || '').trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || "Rang qo'shishda xatolik yuz berdi!");
        return;
      }
      await References.init();
      renderColorsSubtab(container);
      if (typeof showToast === 'function') showToast("Yangi rang muvaffaqiyatli qo'shildi!", "success");
    } catch (err) {
      alert("Server bilan bog'lanishda xatolik!");
    }
  });

  // Toggle favorite handler
  container.querySelectorAll('.btn-toggle-fav-color').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-id');
      try {
        const res = await fetch(`/api/references/color/toggle-favorite/${id}`, { method: 'POST' });
        if (res.ok) {
          await References.init();
          renderColorsSubtab(container);
        }
      } catch (err) {
        console.error(err);
      }
    });
  });

  // Short code blur/change handler with duplicate check
  container.querySelectorAll('.color-short-code-input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.getAttribute('data-id');
      const oldVal = input.getAttribute('data-old') || '';
      const newVal = input.value.trim().toUpperCase();
      if (!newVal) {
        input.value = oldVal;
        return;
      }
      if (newVal === oldVal) return;

      try {
        const res = await fetch(`/api/references/color/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ short_code: newVal })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.detail || "Kod yangilashda xatolik!");
          input.value = oldVal;
          return;
        }
        input.setAttribute('data-old', newVal);
        await References.init();
        if (typeof showToast === 'function') showToast(`Rang kodi '${newVal}' ga o'zgartirildi!`, "success");
      } catch (err) {
        alert("Server bilan bog'lanishda xatolik!");
        input.value = oldVal;
      }
    });
  });
}

// 8. Countries Subtab
function renderCountriesSubtab(container) {
  const list = References.data.countries || [];
  let html = `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input type="text" id="new-country-name" class="form-control" placeholder="Yangi mamlakat..." style="max-width: 250px;">
      <button class="btn btn-primary btn-sm" id="btn-add-country-ref">➕ Mamlakat qo'shish</button>
    </div>
    <div style="max-height: 450px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="history-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Mamlakat Nomi</th>
            <th>Holat</th>
            <th style="width:90px;">Amallar</th>
          </tr>
        </thead>
        <tbody>
  `;
  list.forEach((cnt, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><b>${cnt.name}</b></td>
        <td><span class="badge badge-synced">✅ Faol</span></td>
        <td>${refBtns('country', cnt, cnt.name, 'ref-countries')}</td>
      </tr>
    `;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('btn-add-country-ref')?.addEventListener('click', async () => {
    const name = document.getElementById('new-country-name').value.trim();
    if (!name) return alert("Mamlakat nomini kiriting!");
    const res = await fetch('/api/references/country', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-countries');
      showToast("Mamlakat muvaffaqiyatli qo'shildi!", "success");
    }
  });
}

// ================= CRUD MODAL HANDLERS =================
function openProductTypeAddModal() {
  const modal = document.getElementById('modal-pt-edit');
  document.getElementById('pt-modal-title').textContent = "➕ Yangi Mahsulot turi & Ierarxiya";
  document.getElementById('pt-edit-id').value = "";
  document.getElementById('pt-edit-name').value = "";
  document.getElementById('pt-edit-category').value = "";

  populateGroupSelect();
  populateCategoryDatalist();
  if (modal) modal.classList.add('active');
}

function openProductTypeEditModal(id) {
  const pt = (References.data.product_types || []).find(p => p.id === id);
  if (!pt) return;

  const modal = document.getElementById('modal-pt-edit');
  document.getElementById('pt-modal-title').textContent = "✏️ Mahsulot turini tahrirlash";
  document.getElementById('pt-edit-id').value = pt.id;
  document.getElementById('pt-edit-name').value = pt.name;
  document.getElementById('pt-edit-category').value = pt.category || "";

  populateGroupSelect(pt.group);
  populateCategoryDatalist();
  if (modal) modal.classList.add('active');
}

function populateGroupSelect(selectedGroup = "") {
  const groupSelect = document.getElementById('pt-edit-group');
  if (!groupSelect) return;
  const groups = References.data.groups || [];
  groupSelect.innerHTML = `<option value="">Guruhni tanlang...</option>` +
    groups.map(g => `<option value="${g.name}" ${g.name === selectedGroup ? 'selected' : ''}>${g.name} (${g.code})</option>`).join('');
}

function populateCategoryDatalist() {
  const dl = document.getElementById('dl-all-categories');
  if (!dl) return;
  const cats = References.data.categories || [];
  dl.innerHTML = cats.map(c => `<option value="${c.name}"></option>`).join('');
}

async function deleteProductTypeItem(id, name) {
  if (!confirm(`Haqiqatan ham "${name}" mahsulot turini o'chirmoqchimisiz?`)) return;
  try {
    const res = await fetch(`/api/references/product-type/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await References.init();
      renderReferencesUI('ref-product-types');
      showToast(`"${name}" o'chirildi!`, "info");
    }
  } catch (e) {
    showToast("O'chirishda xatolik yuz berdi", "error");
  }
}

async function deleteSeasonTypeItem(id) {
  if (!confirm("Ushbu sezonni o'chirmoqchimisiz?")) return;
  const res = await fetch(`/api/references/season-type/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await References.init();
    renderReferencesUI('ref-season-types');
    showToast("Sezon o'chirildi", "info");
  }
}

async function deleteSizeItem(id) {
  if (!confirm("Ushbu razmerni o'chirmoqchimisiz?")) return;
  const res = await fetch(`/api/references/size-item/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await References.init();
    renderReferencesUI('ref-sizes');
    showToast("Razmer o'chirildi", "info");
  }
}
