// Interactive Excel-like Grid Engine
const Grid = {
  rows: [],
  baseCounter: 0,
  baseCode: 0,
  activeCell: { rowIndex: 0, colKey: 'product_type' },
  activeDraftId: null,
  isDirty: false,
  autoSaveTimer: null,

  async init() {
    try {
      await this.fetchBaseCounter();
    } catch (e) {
      console.warn("Could not fetch counter:", e);
    }
    if (!this.rows || this.rows.length === 0) {
      this.addEmptyRows(1);
    } else {
      this.recalculateAll();
      this.render();
    }
    this.setupKeyboardEvents();
    this.setupAutoSave();
    this.setupHeaderActions();
    if (typeof this.setupMultiColorModalEvents === 'function') this.setupMultiColorModalEvents();
  },

  async fetchBaseCounter() {
    try {
      const resp = await fetch('/api/articul/counter');
      if (resp.ok) {
        const data = await resp.json();
        this.baseCounter = data.last_number || 0;
        this.baseCode = data.last_code || 0;
        const counterInput = document.getElementById('settings-articul-counter');
        if (counterInput) counterInput.value = this.baseCounter;
        const codeInput = document.getElementById('settings-code-counter');
        if (codeInput) codeInput.value = this.baseCode;
        if (data.duplicate_codes && data.duplicate_codes.length && typeof showToast === 'function') {
          showToast(`⚠️ MoySklad'da takroriy tovar kodlari bor: ${data.duplicate_codes.slice(0, 10).join(', ')}`, 'error');
        }
      }
    } catch (e) {
      console.error("Error fetching articul counter:", e);
    }
  },

  // ================= MODEL GURUHLASH =================
  // Har bir qatorda model_key bor. Bir modelning rang/razmer variantlari (Ctrl+Enter bilan ajratilgan) bir xil
  // model_key ni bo'lishadi va bitta model raqamini oladi. Haqiqiy raqamni yuborishda backend beradi.
  newModelKey() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  isUsefulRow(r) {
    return !!(r && ((r.product_type || '').trim() || (parseFloat(r.price_buy) || 0) > 0));
  },

  getCurrency() {
    if (!References.settings.usd_enabled) return 'UZS';
    return document.getElementById('header-currency')?.value === 'USD' ? 'USD' : 'UZS';
  },

  // USD kirimda tan narx dollarda, sotuv narxi so'mda — ustama shu kurs bilan hisoblanadi
  getRate() {
    if (this.getCurrency() !== 'USD') return 1;
    return parseFloat(document.getElementById('header-rate')?.value) || 0;
  },

  computeModelOrdinals() {
    const ordinals = new Map();
    let productIdx = 0;
    this.rows.forEach(r => {
      if (!r.model_key) r.model_key = this.newModelKey();
      if (this.isUsefulRow(r)) {
        if (!ordinals.has(r.model_key)) ordinals.set(r.model_key, ordinals.size);
        r._product_idx = productIdx++;  // har bir to'ldirilgan qator — bitta tovar (bitta kod)
      } else {
        r._product_idx = null;
      }
    });
    return ordinals;
  },

  // Tovar kodi (taxminiy): MoySklad'dagi oxirgi koddan keyin ketma-ket. Aniq kodni yuborishda backend beradi
  previewCode(row) {
    if (row._product_idx === null || row._product_idx === undefined) return '';
    return String((this.baseCode || 0) + row._product_idx + 1).padStart(5, '0');
  },

  calcRow(rowIdx, ordinals = null) {
    const row = this.rows[rowIdx];
    const map = ordinals || this.computeModelOrdinals();
    const ord = map.has(row.model_key) ? map.get(row.model_key) : null;
    const calc = References.calculateRow(row, ord, this.baseCounter, this.getRate());
    calc.code = this.previewCode(row);
    if (!this.isUsefulRow(row)) {
      // Bo'sh qator — model/artikul/kod ko'rsatilmaydi
      calc.model_code = '';
      calc.articul = '';
      calc.code = '';
    }
    return calc;
  },

  // Bitta qator o'zgarganda boshqa qatorlarning model raqami ham surilishi mumkin — avto kataklarni yangilaymiz
  refreshAutoCells() {
    const ordinals = this.computeModelOrdinals();
    const trs = document.querySelectorAll('#grid-tbody tr');
    this.rows.forEach((row, i) => {
      const calc = this.calcRow(i, ordinals);
      row.model_code = calc.model_code || '';
      row.articul = calc.articul || '';
      row.code = calc.code || '';
      const tr = trs[i];
      if (!tr) return;
      const elModel = tr.querySelector('.cell-model');
      if (elModel) elModel.textContent = row.model_code || '-';
      const elCode = tr.querySelector('.cell-code');
      if (elCode) elCode.textContent = row.code || '-';
      const elArt = tr.querySelector('.cell-articul');
      if (elArt) elArt.textContent = row.articul || '-';
    });
  },

  createEmptyRow(defaultValues = {}) {
    return {
      model_key: defaultValues.model_key || this.newModelKey(),
      country: defaultValues.country || "",
      product_type: defaultValues.product_type || "",
      category: defaultValues.category || "",
      group_name: defaultValues.group_name || "",
      brand: defaultValues.brand || "",
      factory_code: defaultValues.factory_code || "",
      series: defaultValues.series || "",
      collection: defaultValues.collection || "",
      season: defaultValues.season || "",
      size: defaultValues.size || "",
      description: defaultValues.description || "",
      color: defaultValues.color || "",
      colors: Array.isArray(defaultValues.colors) ? defaultValues.colors : (defaultValues.color ? [defaultValues.color] : []),
      model_code: defaultValues.model_code || "",
      code: defaultValues.code || "",
      articul: defaultValues.articul || "",
      full_name: defaultValues.full_name || "",
      quantity: defaultValues.quantity !== undefined ? parseFloat(defaultValues.quantity) : 1,
      price_buy: defaultValues.price_buy !== undefined ? parseFloat(defaultValues.price_buy) : 0,
      price_sale: defaultValues.price_sale !== undefined ? parseFloat(defaultValues.price_sale) : 0,
      markup_pct: defaultValues.markup_pct !== undefined ? parseFloat(defaultValues.markup_pct) : 0,
      sum_buy: defaultValues.sum_buy !== undefined ? parseFloat(defaultValues.sum_buy) : 0,
      sum_sale: defaultValues.sum_sale !== undefined ? parseFloat(defaultValues.sum_sale) : 0,
      ai_generated: defaultValues.ai_generated || false,
      ai_ambiguous: defaultValues.ai_ambiguous || false,
      ai_alternative: defaultValues.ai_alternative || "",
      ai_confidence: defaultValues.ai_confidence !== undefined ? parseFloat(defaultValues.ai_confidence) : 1.0,
      ai_low_confidence_fields: defaultValues.ai_low_confidence_fields || []
    };
  },

  addEmptyRows(count = 1) {
    for (let i = 0; i < count; i++) {
      this.rows.push(this.createEmptyRow());
    }
    this.recalculateAll();
    this.render();
  },

  duplicateRow(index) {
    if (index === undefined || index < 0 || index >= this.rows.length) {
      index = this.rows.length - 1;
    }
    const source = this.rows[index];
    if (!source) return;
    const cloned = JSON.parse(JSON.stringify(source));
    cloned.articul = ""; // will be recomputed sequentially
    cloned.code = "";
    // Nusxa — yangi model (bir modelning rang/razmerlari uchun Ctrl+Enter bilan ajratish ishlatiladi)
    cloned.model_key = this.newModelKey();
    this.rows.splice(index + 1, 0, cloned);
    this.recalculateAll();
    this.render();
  },

  deleteRow(index) {
    if (this.rows.length <= 1) {
      this.rows = [this.createEmptyRow()];
    } else {
      this.rows.splice(index, 1);
    }
    this.recalculateAll();
    this.render();
  },

  clearGrid() {
    if (confirm("Haqiqatan ham jadvaldagi barcha qatorlarni tozalamoqchimisiz?")) {
      this.rows = [];
      this.addEmptyRows(1);
      this.triggerAutoSave();
    }
  },

  applyAlternativeType(rowIndex, newType) {
    if (!this.rows || !this.rows[rowIndex]) return;
    this.rows[rowIndex].product_type = newType;
    this.rows[rowIndex].ai_ambiguous = false;
    this.rows[rowIndex].ai_alternative = "";
    this.rows[rowIndex].last_edited_field = 'product_type';
    this.recalculateAll();
    this.render();
    this.triggerAutoSave();
    if (typeof showToast === 'function') {
      showToast(`Вид товара "${newType}" ga almashtirildi`, "success");
    }
  },

  multiplyPricesBy1000() {
    if (!this.rows || this.rows.length === 0) return;
    let count = 0;
    this.rows.forEach(r => {
      let changed = false;
      if (r.price_buy !== undefined && r.price_buy !== null && parseFloat(r.price_buy) > 0) {
        r.price_buy = Math.round(parseFloat(r.price_buy) * 1000);
        changed = true;
      }
      if (r.price_sale !== undefined && r.price_sale !== null && parseFloat(r.price_sale) > 0) {
        r.price_sale = Math.round(parseFloat(r.price_sale) * 1000);
        changed = true;
      }
      if (changed) count++;
    });

    if (count === 0) {
      if (typeof showToast === 'function') {
        showToast("Jadvalda narx kiritilgan qatorlar topilmadi", "info");
      }
      return;
    }

    this.recalculateAll();
    this.render();
    this.triggerAutoSave();
    if (typeof showToast === 'function') {
      showToast(`⚡ ${count} ta qatordagi narxlarga 3 ta nol qo'shildi (x1000)!`, "success");
    }
  },

  recalculateAll() {
    const ordinals = this.computeModelOrdinals();
    this.rows.forEach((row, i) => {
      // Sync colors array and single color
      if (!row.colors || !Array.isArray(row.colors)) {
        row.colors = row.color ? [row.color] : [];
      } else if (row.colors.length > 0 && !row.color) {
        row.color = row.colors[0];
      }

      const calc = this.calcRow(i, ordinals);
      row.category = calc.category || '';
      row.group_name = calc.group_name || '';
      row.code = calc.code || '';
      row.model_code = calc.model_code || '';
      row.articul = calc.articul || '';
      row.full_name = calc.full_name || '';
      row.markup_pct = calc.markup_pct || 0;
      row.sum_buy = calc.sum_buy || 0;
      row.sum_sale = calc.sum_sale || 0;
    });
    this.updateStats();
  },

  getCurrencySymbol(currency = null) {
    const cur = currency || this.getCurrency();
    if (cur === 'USD') return '$';
    return 'so\'m';
  },

  // currency berilmasa — hujjat (tan narx) valyutasi. Sotuv narxi doim so'mda: formatMoney(x, 'UZS')
  formatMoney(amount, currency = null) {
    const sym = this.getCurrencySymbol(currency);
    const formatted = Number(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: sym === 'so\'m' ? 0 : 2,
      maximumFractionDigits: 2
    });
    if (sym === '$') return `$${formatted}`;
    if (sym === '₽') return `${formatted} ₽`;
    return `${formatted} so'm`;
  },

  updateStats() {
    let totalItems = 0;
    let totalQty = 0;
    let totalSumBuy = 0;
    let totalSumSale = 0;

    this.rows.forEach(r => {
      if (r.product_type || (parseFloat(r.price_buy) || 0) > 0) {
        totalItems++;
      }
      totalQty += parseFloat(r.quantity) || 0;
      totalSumBuy += parseFloat(r.sum_buy) || 0;
      totalSumSale += parseFloat(r.sum_sale) || 0;
    });

    // Tan narx hujjat valyutasida (so'm yoki $), sotuv doim so'mda — foyda va ustama so'mga keltirib hisoblanadi
    const rate = this.getRate() || 0;
    const sumBuyInSale = totalSumBuy * rate;
    const expectedProfit = totalSumSale - sumBuyInSale;
    let avgMarkup = 0;
    if (sumBuyInSale > 0) {
      avgMarkup = Math.round(((totalSumSale / sumBuyInSale) - 1) * 1000) / 10;
    }

    // Update Currency in column headers
    const sym = this.getCurrencySymbol();
    const saleSym = this.getCurrencySymbol('UZS');
    const thPriceBuy = document.getElementById('th-price-buy');
    if (thPriceBuy) thPriceBuy.textContent = `Цена закупа (${sym}) *`;
    const thPriceSale = document.getElementById('th-price-sale');
    if (thPriceSale) thPriceSale.textContent = `Цена продажи (${saleSym}) *`;
    const thSumBuy = document.getElementById('th-sum-buy');
    if (thSumBuy) thSumBuy.textContent = `Сумма закупа (${sym})`;
    const thSumSale = document.getElementById('th-sum-sale');
    if (thSumSale) thSumSale.textContent = `Сумма продажи (${saleSym})`;
    const thColor = document.getElementById('th-color');
    if (thColor) thColor.style.display = References.settings.color_enabled ? '' : 'none';

    // Update DOM safely
    const elItems = document.getElementById('stat-total-items');
    if (elItems) elItems.textContent = `${totalItems} ta`;

    const elQty = document.getElementById('stat-total-qty');
    if (elQty) elQty.textContent = `${totalQty.toLocaleString()} dona`;

    const elSumBuy = document.getElementById('stat-sum-buy');
    if (elSumBuy) elSumBuy.textContent = this.formatMoney(totalSumBuy);

    const elSumSale = document.getElementById('stat-sum-sale');
    if (elSumSale) elSumSale.textContent = this.formatMoney(totalSumSale, 'UZS');

    const elMarkup = document.getElementById('stat-avg-markup');
    if (elMarkup) elMarkup.textContent = `${avgMarkup}%`;

    const elProfit = document.getElementById('stat-expected-profit');
    if (elProfit) elProfit.textContent = this.formatMoney(expectedProfit, 'UZS');
  },

  render() {
    const tbody = document.getElementById('grid-tbody');
    if (!tbody) return;

    // Datalists for autocompletion
    this.ensureDatalists();

    let html = '';
    this.rows.forEach((row, idx) => {
      const isLowConf = (field) => row.ai_low_confidence_fields && row.ai_low_confidence_fields.includes(field);
      const sumBuyVal = this.formatMoney(row.sum_buy || 0);
      const sumSaleVal = this.formatMoney(row.sum_sale || 0, 'UZS');
      const sizePlaceholder = References.settings.size_enabled ? 'S, M, L ⏎Ctrl' : 'M';
      const markupVal = Number(row.markup_pct || 0);

      html += `
        <tr data-row-index="${idx}">
          <td class="cell-num">${idx + 1}</td>
          
          <!-- Mamlakat -->
          <td>
            <input type="text" class="cell-input ${isLowConf('country') ? 'cell-ai-highlight' : ''}" 
                   list="dl-countries" data-field="country" data-row="${idx}" value="${this.escapeHtml(row.country || '')}" placeholder="Турция">
          </td>

          <!-- Mahsulot turi (Вид товара) -->
          <td>
            <input type="text" class="cell-input ${isLowConf('product_type') ? 'cell-ai-highlight' : ''} ${row.ai_ambiguous ? 'cell-ambiguous' : ''}" 
                   list="dl-product-types" data-field="product_type" data-row="${idx}" value="${this.escapeHtml(row.product_type || '')}" placeholder="Tanlang (masalan: Костюм)...">
            ${row.ai_ambiguous && row.ai_alternative ? `
              <div class="alt-suggest-wrap">
                <span style="font-size: 0.72rem; color: #fbbf24;" title="Nomi noaniq yoki bir nechta variant mavjud">⚠️</span>
                <span class="badge-alt-suggest" onclick="Grid.applyAlternativeType(${idx}, '${this.escapeHtml(row.ai_alternative)}')" title="Ushbu variantga almashtirish uchun bosing">
                  🔄 ${this.escapeHtml(row.ai_alternative)}
                </span>
              </div>
            ` : ''}
          </td>

          <!-- Kategoriya (Auto) -->
          <td>
            <span class="cell-auto cell-cat">${this.escapeHtml(row.category || '-')}</span>
          </td>

          <!-- Guruh (Auto) -->
          <td>
            <span class="cell-auto cell-grp">${this.escapeHtml(row.group_name || '-')}</span>
          </td>

          <!-- Brend -->
          <td>
            <input type="text" class="cell-input ${isLowConf('brand') ? 'cell-ai-highlight' : ''}" 
                   list="dl-brands" data-field="brand" data-row="${idx}" value="${this.escapeHtml(row.brand || '')}" placeholder="De Luxury">
          </td>

          <!-- Kod modeli (Zavod artikuli) -->
          <td>
            <input type="text" class="cell-input" 
                   data-field="factory_code" data-row="${idx}" value="${this.escapeHtml(row.factory_code || '')}" placeholder="M-101 / 7788">
          </td>

          <!-- Seriya (seriyadagi dona soni) -->
          <td>
            <input type="text" class="cell-input ${(Grid.requiredFields || []).includes('series') && !row.series ? 'cell-required-empty' : ''}" 
                   list="dl-series" data-field="series" data-row="${idx}" value="${this.escapeHtml(row.series || '')}" placeholder="${(Grid.requiredFields || []).includes('series') ? 'majburiy' : '6 / 8'}" inputmode="numeric">
          </td>

          <!-- Kolleksiya -->
          <td>
            <input type="text" class="cell-input" 
                   list="dl-seasons" data-field="collection" data-row="${idx}" value="${this.escapeHtml(row.collection || '')}" placeholder="AW26">
          </td>

          <!-- Mavsum -->
          <td>
            <input type="text" class="cell-input" 
                   list="dl-season-types" data-field="season" data-row="${idx}" value="${this.escapeHtml(row.season || '')}" placeholder="Весна-Осень">
          </td>

          <!-- O'lcham -->
          <td>
            <input type="text" class="cell-input ${isLowConf('size') ? 'cell-ai-highlight' : ''}" 
                   list="dl-sizes" data-field="size" data-row="${idx}" value="${this.escapeHtml(row.size || '')}" placeholder="${sizePlaceholder}"
                   title="${References.settings.size_enabled ? 'Bir nechta razmer: S, M, L yozib Ctrl+Enter — har biriga alohida qator (bitta model)' : ''}">
          </td>

          <!-- Tavsif / Izoh -->
          <td>
            <input type="text" class="cell-input ${isLowConf('description') ? 'cell-ai-highlight' : ''}" 
                   data-field="description" data-row="${idx}" value="${this.escapeHtml(row.description || '')}" placeholder="Izoh / tavsif">
          </td>

          <!-- Model (Auto) -->
          <td style="text-align: center;">
            <span class="cell-auto cell-model" style="color: #fbbf24; font-weight: 700; letter-spacing: 0.5px; font-family: monospace; display: block; padding: 2px 4px;">${this.escapeHtml(row.model_code || '-')}</span>
          </td>

          <!-- Kod (taxminiy; aniq kodni yuborishda tizim beradi — ketma-ket, unikal) -->
          <td style="text-align: center;">
            <span class="cell-auto cell-code" style="color: #38bdf8; font-weight: 700; letter-spacing: 0.5px;" title="Taxminiy kod. Yuborishda MoySklad bilan tekshirilib, ketma-ket unikal kod beriladi">${this.escapeHtml(row.code || '-')}</span>
          </td>

          <!-- Artikul (Auto) -->
          <td>
            <span class="cell-articul" style="font-family: monospace; font-weight: 700;">${this.escapeHtml(row.articul || '-')}</span>
          </td>

          <!-- Nomi (Auto) -->
          <td>
            <span class="cell-auto cell-name" style="color: #f8fafc; font-family: inherit;">${this.escapeHtml(row.full_name || '-')}</span>
          </td>

          <!-- Soni -->
          <td>
            <input type="number" step="1" min="1" class="cell-input ${isLowConf('quantity') ? 'cell-ai-highlight' : ''}" 
                   data-field="quantity" data-row="${idx}" value="${row.quantity !== undefined && row.quantity !== '' ? row.quantity : 1}" style="text-align: right;">
          </td>

          <!-- Sotib olish narxi -->
          <td>
            <input type="number" step="1" min="0" class="cell-input ${isLowConf('price_buy') ? 'cell-ai-highlight' : ''}" 
                   data-field="price_buy" data-row="${idx}" value="${row.price_buy !== undefined && row.price_buy !== 0 ? row.price_buy : ''}" placeholder="0" style="text-align: right;">
          </td>

          <!-- Nadtsenka % (Endi tahrirlanadigan maydon!) -->
          <td>
            <input type="number" step="0.5" class="cell-input" 
                   data-field="markup_pct" data-row="${idx}" value="${markupVal !== 0 ? markupVal : ''}" placeholder="0%" 
                   style="text-align: right; color: ${markupVal >= 30 ? '#4ade80' : markupVal > 0 ? '#fbbf24' : '#94a3b8'}; font-weight: 700;">
          </td>

          <!-- Sotish narxi -->
          <td>
            <input type="number" step="1" min="0" class="cell-input ${isLowConf('price_sale') ? 'cell-ai-highlight' : ''}" 
                   data-field="price_sale" data-row="${idx}" value="${row.price_sale !== undefined && row.price_sale !== 0 ? row.price_sale : ''}" placeholder="0" style="text-align: right;">
          </td>

          <!-- Summa Buy (Auto) -->
          <td>
            <span class="cell-auto cell-sum-buy" style="text-align: right; display: block;">${sumBuyVal}</span>
          </td>

          <!-- Summa Sale (Auto) -->
          <td>
            <span class="cell-auto cell-sum-sale" style="text-align: right; color: #38bdf8; font-weight: 600; display: block;">${sumSaleVal}</span>
          </td>

          <!-- Rang (Inline Tag Input with Autocomplete & Top 10 Pills - ENG OXIRGI USTUN!) -->
          <td class="cell-color-td" data-row="${idx}" style="${References.settings.color_enabled ? '' : 'display: none;'}">
            <div class="color-tag-cell" id="color-cell-${idx}">
              ${((row.colors && row.colors.length) ? row.colors : (row.color ? [row.color] : [])).map(c => `
                <span class="color-tag-chip">
                  <span>${this.escapeHtml(c)}</span>
                  <span class="color-tag-remove" data-row="${idx}" data-color="${this.escapeHtml(c)}">✕</span>
                </span>
              `).join('')}
              <input type="text" class="color-tag-input ${isLowConf('color') ? 'cell-ai-highlight' : ''}" 
                     data-row="${idx}" 
                     data-field="color_tag_input"
                     placeholder="${((row.colors && row.colors.length) || row.color) ? '+ rang' : 'Rang...'}" 
                     autocomplete="off">
            </div>
          </td>

          <!-- Action -->
          <td style="text-align: center;">
            <div class="row-actions">
              <button class="btn-icon" title="Nusxa olish" onclick="Grid.duplicateRow(${idx})">📑</button>
              <button class="btn-icon delete" title="O'chirish" onclick="Grid.deleteRow(${idx})">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    this.bindCellEvents();
    this.updateStats();
  },

  ensureDatalists() {
    let dlContainer = document.getElementById('grid-datalists');
    if (!dlContainer) {
      dlContainer = document.createElement('div');
      dlContainer.id = 'grid-datalists';
      document.body.appendChild(dlContainer);
    }

    const pts = References.data.product_types || [];
    const brands = References.data.brands || [];
    const seasons = References.data.seasons || [];
    const seasonTypes = References.data.season_types || [];
    const sizes = (References.data.sizes && References.data.sizes.length > 0) ? References.data.sizes.map(s => s.name) : References.defaultSizes;
    const countries = References.data.countries || [];
    const colors = References.data.colors || [];

    dlContainer.innerHTML = `
      <datalist id="dl-product-types">
        ${pts.map(p => `<option value="${this.escapeHtml(p.name)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-brands">
        ${brands.map(b => `<option value="${this.escapeHtml(b.name)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-seasons">
        ${seasons.map(s => `<option value="${this.escapeHtml(s.collection)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-season-types">
        ${seasonTypes.map(st => `<option value="${this.escapeHtml(st.name)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-countries">
        ${countries.map(c => `<option value="${this.escapeHtml(c.name)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-colors">
        ${colors.map(c => `<option value="${this.escapeHtml(c.name)}"></option>`).join('')}
      </datalist>
      <datalist id="dl-series">
        ${(Grid.dictValues?.series || []).map(v => `<option value="${this.escapeHtml(v)}">`).join('')}
      </datalist>
      <datalist id="dl-sizes">
        ${sizes.map(s => `<option value="${this.escapeHtml(s)}"></option>`).join('')}
      </datalist>
    `;
  },

  bindCellEvents() {
    const inputs = document.querySelectorAll('.cell-input');
    inputs.forEach(input => {
      input.addEventListener('input', (e) => {
        const rowIdx = parseInt(e.target.getAttribute('data-row'), 10);
        const field = e.target.getAttribute('data-field');
        let val = e.target.value;

        if (field === 'quantity' || field === 'price_buy' || field === 'price_sale' || field === 'markup_pct') {
          val = parseFloat(val) || 0;
        }

        if (this.rows[rowIdx]) {
          this.rows[rowIdx][field] = val;
          this.rows[rowIdx].last_edited_field = field;

          if (field === 'product_type') {
            this.rows[rowIdx].ai_ambiguous = false;
            this.rows[rowIdx].ai_alternative = "";
            const tr = e.target.closest('tr');
            const altWrap = tr?.querySelector('.alt-suggest-wrap');
            if (altWrap) altWrap.remove();
            e.target.classList.remove('cell-ambiguous');
          }

          // Trigger immediate recalculation for this row
          const calc = this.calcRow(rowIdx);
          this.rows[rowIdx].category = calc.category;
          this.rows[rowIdx].group_name = calc.group_name;
          this.rows[rowIdx].code = calc.code;
          this.rows[rowIdx].model_code = calc.model_code;
          this.rows[rowIdx].articul = calc.articul;
          this.rows[rowIdx].full_name = calc.full_name;
          this.rows[rowIdx].markup_pct = calc.markup_pct;
          this.rows[rowIdx].price_sale = calc.price_sale;
          this.rows[rowIdx].sum_buy = calc.sum_buy;
          this.rows[rowIdx].sum_sale = calc.sum_sale;

          // Update related spans and inputs in same row without full re-render
          const tr = e.target.closest('tr');
          if (tr) {
            const elCat = tr.querySelector('.cell-cat');
            if (elCat) elCat.textContent = calc.category || '-';
            const elGrp = tr.querySelector('.cell-grp');
            if (elGrp) elGrp.textContent = calc.group_name || '-';
            const elName = tr.querySelector('.cell-name');
            if (elName) elName.textContent = calc.full_name || '-';

            // Bidirectional sync for markup_pct and price_sale
            const inpMarkup = tr.querySelector('input[data-field="markup_pct"]');
            if (inpMarkup && field !== 'markup_pct') {
              inpMarkup.value = calc.markup_pct !== 0 ? calc.markup_pct : '';
              inpMarkup.style.color = calc.markup_pct >= 30 ? '#4ade80' : calc.markup_pct > 0 ? '#fbbf24' : '#94a3b8';
            }
            const inpSale = tr.querySelector('input[data-field="price_sale"]');
            if (inpSale && field !== 'price_sale') {
              inpSale.value = calc.price_sale !== 0 ? calc.price_sale : '';
            }

            const elSumBuy = tr.querySelector('.cell-sum-buy');
            if (elSumBuy) elSumBuy.textContent = this.formatMoney(calc.sum_buy);
            const elSumSale = tr.querySelector('.cell-sum-sale');
            if (elSumSale) elSumSale.textContent = this.formatMoney(calc.sum_sale, 'UZS');
          }
          // Model/artikul ustunlari (boshqa qatorlarning model tartibi ham surilishi mumkin)
          this.refreshAutoCells();
          this.updateStats();
          this.triggerAutoSave();
        }

        // Live filter active reference dropdown if open
        if (this.activeDropdown && this.activeDropdown.input === e.target) {
          this.activeDropdown.filterQuery = e.target.value;
          this.activeDropdown.selectedIndex = 0;
          this.activeDropdown.render();
        }
      });

      input.addEventListener('focus', (e) => {
        const rowIdx = parseInt(e.target.getAttribute('data-row'), 10);
        const field = e.target.getAttribute('data-field');
        this.activeCell = { rowIndex: rowIdx, colKey: field };
        document.querySelectorAll('#grid-tbody tr').forEach(r => r.classList.remove('selected'));
        e.target.closest('tr')?.classList.add('selected');
      });
    });

    // Setup Color Tag Inputs
    // Setup Color Tag Inputs & Unified Assistant Panel
    document.querySelectorAll('.color-tag-input').forEach(input => {
      const rowIdx = parseInt(input.getAttribute('data-row'), 10);

      input.addEventListener('focus', () => {
        this.activeCell = { rowIndex: rowIdx, colKey: 'color' };
        document.querySelectorAll('#grid-tbody tr').forEach(r => r.classList.remove('selected'));
        input.closest('tr')?.classList.add('selected');
        this.showColorAssistant(rowIdx, input);
      });

      input.addEventListener('input', () => {
        this.showColorAssistant(rowIdx, input);
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (!this.activeColorPanel?.contains(document.activeElement)) {
            this.hideColorPopups();
          }
        }, 250);
      });

      input.addEventListener('keydown', (e) => {
        // Ctrl + Enter: Apply multi-colors and clone
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          this.applyInlineMultiColors(rowIdx);
          return;
        }

        // Arrow navigation & Enter selection in unified panel
        const panel = document.getElementById('grid-color-assistant-panel');
        if (panel) {
          const items = Array.from(panel.querySelectorAll('.color-suggest-item'));
          let activeIdx = items.findIndex(el => el.classList.contains('active'));

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
              if (activeIdx < items.length - 1) activeIdx++;
              else activeIdx = 0;
              items.forEach((it, idx) => it.classList.toggle('active', idx === activeIdx));
              if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
            }
            return;
          }

          if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
              if (activeIdx > 0) activeIdx--;
              else activeIdx = items.length - 1;
              items.forEach((it, idx) => it.classList.toggle('active', idx === activeIdx));
              if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
            }
            return;
          }

          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (activeIdx >= 0 && items[activeIdx]) {
              const selectedColor = items[activeIdx].getAttribute('data-color');
              this.addInlineColor(rowIdx, selectedColor);
            } else if (input.value.trim()) {
              this.addInlineColor(rowIdx, input.value.trim());
            }
            input.value = '';
            input.focus();
            this.showColorAssistant(rowIdx, input);
            return;
          }
        }

        // If no panel open, but user hits Enter with text
        if (e.key === 'Enter' && input.value.trim()) {
          e.preventDefault();
          e.stopPropagation();
          this.addInlineColor(rowIdx, input.value.trim());
          input.value = '';
          input.focus();
          this.showColorAssistant(rowIdx, input);
          return;
        }

        // ArrowLeft moves to price_sale if empty
        if (e.key === 'ArrowLeft' && !input.value) {
          e.preventDefault();
          const prevEl = document.querySelector(`.cell-input[data-row="${rowIdx}"][data-field="price_sale"]`);
          if (prevEl) { prevEl.focus(); prevEl.select(); }
          return;
        }

        // ArrowRight moves to next row country if empty
        if (e.key === 'ArrowRight' && !input.value && rowIdx < this.rows.length - 1) {
          e.preventDefault();
          const nextEl = document.querySelector(`.cell-input[data-row="${rowIdx + 1}"][data-field="${this.EDITABLE_FIELDS[0]}"]`);
          if (nextEl) { nextEl.focus(); nextEl.select(); }
          return;
        }

        // Backspace on empty input removes last color chip
        if (e.key === 'Backspace' && !input.value) {
          const row = this.rows[rowIdx];
          if (row && row.colors && row.colors.length > 0) {
            row.colors.pop();
            row.color = row.colors.length > 0 ? row.colors[0] : "";
            this.recalculateAll();
            this.render();
            setTimeout(() => {
              const inp = document.querySelector(`.color-tag-input[data-row="${rowIdx}"]`);
              if (inp) {
                inp.focus();
                this.showColorAssistant(rowIdx, inp);
              }
            }, 50);
          }
        }
      });
    });

    // Make clicking anywhere inside .cell-color-td reliably focus input & open assistant
    document.querySelectorAll('.cell-color-td').forEach(td => {
      td.addEventListener('mousedown', (e) => {
        if (e.target.closest('.color-tag-remove')) return;
        const rowIdx = parseInt(td.getAttribute('data-row'), 10);
        const input = td.querySelector('.color-tag-input');
        if (input) {
          setTimeout(() => {
            input.focus();
            this.showColorAssistant(rowIdx, input);
          }, 10);
        }
      });
    });

    // Color Tag Remove click handlers
    document.querySelectorAll('.color-tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowIdx = parseInt(btn.getAttribute('data-row'), 10);
        const colorName = btn.getAttribute('data-color');
        this.removeInlineColor(rowIdx, colorName, e);
      });
    });
  },

  EDITABLE_FIELDS: [
    'country',
    'product_type',
    'brand',
    'factory_code',
    'series',
    'collection',
    'season',
    'size',
    'description',
    'quantity',
    'price_buy',
    'markup_pct',
    'price_sale',
    'color'
  ],

  activeDropdown: null,

  closeReferenceDropdown() {
    const existing = document.getElementById('grid-floating-dropdown');
    if (existing) {
      existing.remove();
    }
    this.activeDropdown = null;
  },

  getReferenceOptions(field) {
    let raw = [];
    if (field === 'product_type') {
      raw = (References.data.product_types || []).map(p => typeof p === 'object' ? p.name : p);
    } else if (field === 'brand') {
      raw = (References.data.brands || []).map(b => typeof b === 'object' ? b.name : b);
    } else if (field === 'collection') {
      raw = (References.data.seasons || []).map(s => typeof s === 'object' ? s.collection : s);
    } else if (field === 'season') {
      raw = (References.data.season_types || []).map(st => typeof st === 'object' ? st.name : st);
    } else if (field === 'size') {
      if (References.data.sizes && References.data.sizes.length > 0) {
        raw = References.data.sizes.map(s => typeof s === 'object' ? s.name : s);
      } else {
        raw = References.defaultSizes || ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
      }
    } else if (field === 'country') {
      raw = (References.data.countries || []).map(c => typeof c === 'object' ? c.name : c);
    } else if (field === 'description') {
      raw = []; // Opisanie (Izoh) matnli maydon, ranglar bu yerga tushmaydi
    }

    const seen = new Set();
    const res = [];
    raw.forEach(item => {
      const s = String(item || '').trim();
      if (s && !seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        res.push(s);
      }
    });
    return res;
  },

  openReferenceDropdown(inputEl, field) {
    this.closeReferenceDropdown();
    const allOptions = this.getReferenceOptions(field);
    if (!allOptions || allOptions.length === 0) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'grid-floating-dropdown';
    dropdown.className = 'grid-floating-dropdown';

    const rect = inputEl.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + window.scrollY + 2}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.style.minWidth = `${Math.max(rect.width, 180)}px`;

    let selectedIdx = 0;
    const currentVal = (inputEl.value || '').toLowerCase().trim();
    const initialMatchIdx = allOptions.findIndex(o => o.toLowerCase() === currentVal);
    if (initialMatchIdx !== -1) {
      selectedIdx = initialMatchIdx;
    }

    const state = {
      el: dropdown,
      input: inputEl,
      field: field,
      options: allOptions,
      filterQuery: '',
      getFiltered: function() {
        const q = (this.filterQuery || '').toLowerCase().trim();
        return q ? allOptions.filter(o => o.toLowerCase().includes(q)) : allOptions;
      },
      selectedIndex: selectedIdx
    };

    const renderList = () => {
      const filtered = state.getFiltered();

      if (filtered.length === 0) {
        dropdown.innerHTML = `<div style="padding: 8px 10px; color: var(--text-dim); font-size: 0.75rem; text-align: center;">Mos keluvchi ma'lumot topilmadi</div>`;
        return;
      }

      if (state.selectedIndex < 0) state.selectedIndex = 0;
      if (state.selectedIndex >= filtered.length) state.selectedIndex = filtered.length - 1;

      dropdown.innerHTML = filtered.map((opt, i) => `
        <div class="grid-dropdown-item ${i === state.selectedIndex ? 'active' : ''}" data-idx="${i}" data-val="${this.escapeHtml(opt)}">
          ${this.escapeHtml(opt)}
        </div>
      `).join('');

      dropdown.querySelectorAll('.grid-dropdown-item').forEach(item => {
        item.onmousedown = (e) => {
          e.preventDefault();
          const chosen = item.getAttribute('data-val');
          this.applyDropdownSelection(inputEl, chosen);
        };
      });

      const activeEl = dropdown.querySelector('.grid-dropdown-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    };

    state.render = renderList;
    this.activeDropdown = state;

    renderList();
    document.body.appendChild(dropdown);
  },

  applyDropdownSelection(inputEl, value) {
    if (!inputEl) return;
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.closeReferenceDropdown();
    inputEl.focus();
    inputEl.select();
  },

  setupKeyboardEvents() {
    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (this.activeDropdown) {
        const dropdownEl = document.getElementById('grid-floating-dropdown');
        if (dropdownEl && !dropdownEl.contains(e.target) && e.target !== this.activeDropdown.input) {
          this.closeReferenceDropdown();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains('cell-input')) return;

      const currentRow = parseInt(activeEl.getAttribute('data-row'), 10);
      const currentField = activeEl.getAttribute('data-field');

      // 1. Alt + ArrowDown -> Open Reference Dropdown (Spisok dannix)
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        this.openReferenceDropdown(activeEl, currentField);
        return;
      }

      // If reference dropdown is currently open:
      if (this.activeDropdown) {
        const currentList = this.activeDropdown.getFiltered();

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.activeDropdown.selectedIndex = Math.min(currentList.length - 1, this.activeDropdown.selectedIndex + 1);
          this.activeDropdown.render();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.activeDropdown.selectedIndex = Math.max(0, this.activeDropdown.selectedIndex - 1);
          this.activeDropdown.render();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const chosen = currentList[this.activeDropdown.selectedIndex];
          if (chosen) {
            this.applyDropdownSelection(activeEl, chosen);
          } else {
            this.closeReferenceDropdown();
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeReferenceDropdown();
          return;
        }
      }

      // Ctrl + Enter (Razmer katagida) -> "S, M, L" ni bitta model ichida alohida qatorlarga ajratish
      if (e.key === 'Enter' && e.ctrlKey && currentField === 'size') {
        e.preventDefault();
        this.applyInlineMultiColors(currentRow);
        return;
      }

      // Ctrl + D -> Duplicate Row
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.duplicateRow(currentRow);
        return;
      }

      const colIdx = this.EDITABLE_FIELDS.indexOf(currentField);

      // Enter -> Move Down to next row, or add row if at the end
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentRow === this.rows.length - 1) {
          this.addEmptyRows(1);
        }
        setTimeout(() => {
          const nextInput = document.querySelector(`.cell-input[data-row="${currentRow + 1}"][data-field="${currentField}"]`);
          if (nextInput) {
            nextInput.focus();
            nextInput.select();
          }
        }, 50);
        return;
      }

      // Arrow Down (without Alt)
      if (e.key === 'ArrowDown' && !e.altKey && activeEl.tagName !== 'SELECT') {
        const nextInput = document.querySelector(`.cell-input[data-row="${currentRow + 1}"][data-field="${currentField}"]`);
        if (nextInput) {
          e.preventDefault();
          nextInput.focus();
          nextInput.select();
        }
        return;
      }

      // Arrow Up (without Alt)
      if (e.key === 'ArrowUp' && !e.altKey && activeEl.tagName !== 'SELECT') {
        const prevInput = document.querySelector(`.cell-input[data-row="${currentRow - 1}"][data-field="${currentField}"]`);
        if (prevInput) {
          e.preventDefault();
          prevInput.focus();
          prevInput.select();
        }
        return;
      }

      // Arrow Right (Excel-style: move right when at the end of text or fully selected)
      if (e.key === 'ArrowRight' && !e.altKey) {
        const isAtEnd = (activeEl.selectionStart === activeEl.selectionEnd) && (activeEl.selectionStart === activeEl.value.length);
        const isAllSelected = (activeEl.selectionStart === 0 && activeEl.selectionEnd === activeEl.value.length);
        if (isAtEnd || isAllSelected || activeEl.type === 'number') {
          e.preventDefault();
          if (colIdx !== -1 && colIdx < this.EDITABLE_FIELDS.length - 1) {
            const nextField = this.EDITABLE_FIELDS[colIdx + 1];
            let nextEl = document.querySelector(`.cell-input[data-row="${currentRow}"][data-field="${nextField}"]`);
            if (!nextEl && (nextField === 'color' || nextField === 'color_tag_input')) {
              nextEl = document.querySelector(`.color-tag-input[data-row="${currentRow}"]`);
            }
            if (nextEl) {
              nextEl.focus();
              if (typeof nextEl.select === 'function') nextEl.select();
            }
          } else if (colIdx === this.EDITABLE_FIELDS.length - 1 && currentRow < this.rows.length - 1) {
            const nextEl = document.querySelector(`.cell-input[data-row="${currentRow + 1}"][data-field="${this.EDITABLE_FIELDS[0]}"]`);
            if (nextEl) {
              nextEl.focus();
              if (typeof nextEl.select === 'function') nextEl.select();
            }
          }
          return;
        }
      }

      // Arrow Left (Excel-style: move left when at start of text or fully selected)
      if (e.key === 'ArrowLeft' && !e.altKey) {
        const isAtStart = (activeEl.selectionStart === 0 && activeEl.selectionEnd === 0);
        const isAllSelected = (activeEl.selectionStart === 0 && activeEl.selectionEnd === activeEl.value.length);
        if (isAtStart || isAllSelected || activeEl.type === 'number') {
          e.preventDefault();
          if (colIdx > 0) {
            const prevField = this.EDITABLE_FIELDS[colIdx - 1];
            const prevEl = document.querySelector(`.cell-input[data-row="${currentRow}"][data-field="${prevField}"]`);
            if (prevEl) { prevEl.focus(); prevEl.select(); }
          } else if (colIdx === 0 && currentRow > 0) {
            const lastField = this.EDITABLE_FIELDS[this.EDITABLE_FIELDS.length - 1];
            const prevEl = document.querySelector(`.cell-input[data-row="${currentRow - 1}"][data-field="${lastField}"]`);
            if (prevEl) { prevEl.focus(); prevEl.select(); }
          }
          return;
        }
      }
    });
  },

  setupAutoSave() {
    // Save draft every 3 seconds if dirty
    setInterval(() => {
      if (this.isDirty) {
        this.saveDraft();
      }
    }, 3000);
  },

  triggerAutoSave() {
    this.isDirty = true;
    const badge = document.getElementById('save-status');
    if (badge) badge.textContent = "O'zgarishlar saqlanmoqda...";
  },

  async saveDraft() {
    try {
      const headerData = {
        date: document.getElementById('header-date')?.value,
        doc_number: this.manualDocNumber ? this.docNumberValue() : '',
        manual_number: !!this.manualDocNumber,
        store_id: document.getElementById('header-store')?.value,
        store_name: document.getElementById('header-store')?.selectedOptions[0]?.text || '',
        counterparty_id: document.getElementById('header-counterparty')?.value,
        counterparty_name: document.getElementById('header-counterparty')?.value ? document.getElementById('header-counterparty').selectedOptions[0].text : '',
        currency: this.getCurrency(),
        rate: this.getCurrency() === 'USD' ? this.getRate() : null,
        draft_id: this.activeDraftId
      };

      const payload = {
        draft_id: this.activeDraftId,
        header: headerData,
        rows: this.rows
      };

      const resp = await fetch('/api/documents/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const res = await resp.json();
        if (res.draft_id) {
          this.activeDraftId = res.draft_id;
        }
        this.isDirty = false;
        const badge = document.getElementById('save-status');
        if (badge) badge.textContent = "Qoralama saqlandi (" + new Date().toLocaleTimeString() + ")";
      }
    } catch (e) {
      console.error("Auto save draft error:", e);
    }
  },

  async loadDraft(draftId = null) {
    try {
      const targetId = draftId || this.activeDraftId;
      const url = targetId ? `/api/documents/draft/${targetId}` : '/api/documents/draft';
      const resp = await fetch(url);
      if (resp.ok) {
        const draft = await resp.json();
        if (draft.id) {
          this.activeDraftId = draft.id;
        }
        if (draft.rows && draft.rows.length > 0) {
          this.rows = draft.rows;
        }
        if (draft.header) {
          if (draft.header.date) document.getElementById('header-date').value = draft.header.date;
          if (draft.header.manual_number && draft.header.doc_number) this.setDocNumberMode(true, String(draft.header.doc_number).replace(/^≈/, ''));
          else this.setDocNumberMode(false);
          if (draft.header.store_id) document.getElementById('header-store').value = draft.header.store_id;
          if (draft.header.counterparty_id) document.getElementById('header-counterparty').value = draft.header.counterparty_id;
          const cur = (draft.header.currency === 'USD' && References.settings.usd_enabled) ? 'USD' : 'UZS';
          const curSelect = document.getElementById('header-currency');
          if (curSelect) curSelect.value = cur;
          const rateInput = document.getElementById('header-rate');
          if (rateInput && draft.header.rate) rateInput.value = draft.header.rate;
          if (typeof syncCurrencyUI === 'function') syncCurrencyUI();
        }
        this.recalculateAll();
        this.render();
      }
    } catch (e) {
      console.error("Load draft error:", e);
    }
  },


  setupHeaderActions() {
    // 1. Fullscreen toggle button
    document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleFullscreen();
    });

    // 2. Save draft button
    document.getElementById('btn-save-draft-top')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.saveDraft();
      if (typeof showToast === 'function') showToast("Qoralama saqlandi!", "success");
    });

    // 3. Clear grid button
    document.getElementById('btn-clear-grid')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearGrid();
    });

    // 4. Back button
    document.getElementById('btn-back-to-supplies')?.addEventListener('click', (e) => {
      e.preventDefault();
      SuppliesList.closeGridReceiptView();
    });

    // 5. Multiply prices by 1000 button
    document.getElementById('btn-multiply-prices-1000')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.multiplyPricesBy1000();
    });

    // 5. Global Escape to close fullscreen or popups
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isFullscreen) this.toggleFullscreen();
        this.hideColorPopups();
        this.closeReferenceDropdown();
      }
    });

    // 6. Global Click to close Color Popups if clicked outside
    document.addEventListener('mousedown', (e) => {
      if (this.activeColorPanel || document.getElementById('grid-color-assistant-panel') || this.activeQuickBar || this.activeColorAutocomplete) {
        const isInsideCell = e.target.closest('.cell-color-td') || e.target.closest('.color-tag-cell');
        const isInsidePanel = e.target.closest('#grid-color-assistant-panel') || e.target.closest('#grid-color-quick-bar') || e.target.closest('#grid-color-autocomplete');
        if (!isInsideCell && !isInsidePanel) {
          this.hideColorPopups();
        }
      }
    });
  },

  // Fullscreen Mode Controller
  isFullscreen: false,

  toggleFullscreen() {
    const gridView = document.getElementById('supplies-grid-view');
    const iconEl = document.getElementById('fullscreen-icon');
    const labelEl = document.getElementById('fullscreen-label');
    if (!gridView) return;

    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      gridView.classList.add('grid-fullscreen-mode');
      document.body.classList.add('grid-fullscreen-active');
      if (iconEl) iconEl.textContent = '🗗';
      if (labelEl) labelEl.textContent = 'Kichraytirish';
      try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (err) {}
    } else {
      gridView.classList.remove('grid-fullscreen-mode');
      document.body.classList.remove('grid-fullscreen-active');
      if (iconEl) iconEl.textContent = '⛶';
      if (labelEl) labelEl.textContent = 'Katta ekran';
      try {
        if (document.exitFullscreen && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (err) {}
    }
  },

  // ================= INLINE MULTI-COLOR & QUICK PILLS SYSTEM =================
  activeColorPanel: null,
  activeQuickBar: null,
  activeColorAutocomplete: null,

  showColorAssistant(rowIdx, inputEl) {
    this.hideColorPopups();
    if (!inputEl) return;
    const cell = inputEl.closest('.cell-color-td') || inputEl.closest('.color-tag-cell') || inputEl;
    if (!cell) return;

    const panel = document.createElement('div');
    panel.className = 'color-popover-panel';
    panel.id = 'grid-color-assistant-panel';

    const cellRect = cell.getBoundingClientRect();
    const panelWidth = 460;
    const panelHeight = 250;

    // Smart Floating Positioning:
    // Color cell is on the right of the table. Position panel to the LEFT of the cell
    // so it is 100% visible on screen without requiring any scrolling.
    let leftPos = cellRect.left - panelWidth - 8;
    if (leftPos < 10) {
      leftPos = Math.max(10, cellRect.right - panelWidth);
    }
    panel.style.left = leftPos + 'px';
    panel.style.width = panelWidth + 'px';

    // Vertical positioning: keep inside viewport (never cut off below screen)
    let topPos = cellRect.top - 10;
    if (topPos + panelHeight > window.innerHeight - 15) {
      topPos = Math.max(10, window.innerHeight - panelHeight - 15);
    }
    if (topPos < 10) topPos = 10;
    panel.style.top = topPos + 'px';

    // Prevent input blur when clicking inside panel
    panel.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const grid = document.createElement('div');
    grid.className = 'color-popover-grid';

    // LEFT COLUMN: Quick popular colors (1-click)
    const colLeft = document.createElement('div');
    colLeft.className = 'color-popover-col-left';
    colLeft.innerHTML = `
      <div class="color-popover-header">
        <span>⚡ Tezkor ranglar</span>
      </div>
      <div class="color-pills-container"></div>
    `;
    const pillsContainer = colLeft.querySelector('.color-pills-container');
    const topColors = (typeof References.getTopColors === 'function')
      ? References.getTopColors()
      : [
          { name: 'Бежевый' }, { name: 'Белый' }, { name: 'Зеленый' }, { name: 'Коричневый' },
          { name: 'Хаки' }, { name: 'Красный' }, { name: 'Серый' }, { name: 'Синий' },
          { name: 'Темно-синий' }, { name: 'Черный' }, { name: 'Мультиколор' }
        ];

    topColors.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-pill-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addInlineColor(rowIdx, c.name);
        inputEl.value = '';
        inputEl.focus();
        this.showColorAssistant(rowIdx, inputEl);
      });
      pillsContainer.appendChild(btn);
    });

    // RIGHT COLUMN: All colors & live search suggestions
    const colRight = document.createElement('div');
    colRight.className = 'color-popover-col-right';

    const q = (inputEl.value || '').trim().toLowerCase();
    const allColors = (References.data && References.data.colors) || [];

    const matches = allColors.filter(c => {
      const name = typeof c === 'object' ? (c.name || '') : String(c);
      const code = typeof c === 'object' ? (c.short_code || '') : '';
      if (!q) return true;
      return name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
    });

    colRight.innerHTML = `
      <div class="color-popover-header">
        <span>🔍 Variantlar</span>
        <span class="color-matches-badge">${matches.length} ta</span>
      </div>
      <ul class="color-suggest-list"></ul>
    `;

    const suggestList = colRight.querySelector('.color-suggest-list');
    if (matches.length === 0) {
      suggestList.innerHTML = `
        <div class="color-no-match">
          "${this.escapeHtml(inputEl.value)}" bo'yicha rang topilmadi.<br>
          <span style="opacity:0.8; font-size:0.7rem; color: #f59e0b;">Enter bosilsa yangi rang sifatida qo'shiladi</span>
        </div>
      `;
    } else {
      matches.forEach((c, idx) => {
        const cName = typeof c === 'object' ? (c.name || '') : String(c);
        const cCode = typeof c === 'object' ? (c.short_code || '') : '';
        const li = document.createElement('li');
        li.className = `color-suggest-item ${idx === 0 ? 'active' : ''}`;
        li.setAttribute('data-color', cName);
        li.innerHTML = `
          <span>${this.escapeHtml(cName)}</span>
          <span class="color-item-code">${this.escapeHtml(cCode)}</span>
        `;
        li.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.addInlineColor(rowIdx, cName);
          inputEl.value = '';
          inputEl.focus();
          this.showColorAssistant(rowIdx, inputEl);
        });
        suggestList.appendChild(li);
      });
    }

    grid.appendChild(colLeft);
    grid.appendChild(colRight);
    panel.appendChild(grid);

    document.body.appendChild(panel);
    this.activeColorPanel = panel;
  },

  showQuickColorBar(rowIdx, inputEl) {
    this.showColorAssistant(rowIdx, inputEl);
  },

  showColorAutocomplete(rowIdx, inputEl) {
    this.showColorAssistant(rowIdx, inputEl);
  },

  hideColorPopups() {
    if (this.activeColorPanel) {
      this.activeColorPanel.remove();
      this.activeColorPanel = null;
    }
    const panel = document.getElementById('grid-color-assistant-panel');
    if (panel) panel.remove();
    if (this.activeQuickBar) {
      this.activeQuickBar.remove();
      this.activeQuickBar = null;
    }
    const qb = document.getElementById('grid-color-quick-bar');
    if (qb) qb.remove();
    if (this.activeColorAutocomplete) {
      this.activeColorAutocomplete.remove();
      this.activeColorAutocomplete = null;
    }
    const ac = document.getElementById('grid-color-autocomplete');
    if (ac) ac.remove();
  },

  addInlineColor(rowIdx, colorName) {
    const clean = String(colorName || '').trim();
    if (!clean) return;
    const row = this.rows[rowIdx];
    if (!row) return;

    if (!row.colors) row.colors = [];
    if (!row.colors.includes(clean)) {
      row.colors.push(clean);
      row.color = row.colors[0];
    }

    // Update row in memory
    const calc = this.calcRow(rowIdx);
    row.articul = calc.articul;
    row.full_name = calc.full_name;

    // Targeted DOM update of this specific row WITHOUT re-rendering table!
    const tr = document.querySelectorAll('#grid-tbody tr')[rowIdx];
    if (tr) {
      const cell = tr.querySelector('.color-tag-cell');
      if (cell) {
        const input = cell.querySelector('.color-tag-input');
        // Remove existing chips
        cell.querySelectorAll('.color-tag-chip').forEach(el => el.remove());
        // Insert chips
        row.colors.forEach(c => {
          const chip = document.createElement('span');
          chip.className = 'color-tag-chip';
          chip.innerHTML = `<span>${this.escapeHtml(c)}</span><span class="color-tag-remove">✕</span>`;
          chip.querySelector('.color-tag-remove').addEventListener('click', (e) => {
            this.removeInlineColor(rowIdx, c, e);
          });
          cell.insertBefore(chip, input);
        });

        if (input) {
          input.value = '';
          input.placeholder = '+ rang';
          input.focus();
        }
      }

      const elArt = tr.querySelector('.cell-articul');
      if (elArt) elArt.textContent = calc.articul || '-';
      const elName = tr.querySelector('.cell-name');
      if (elName) elName.textContent = calc.full_name || '-';
    }

    this.updateStats();
    this.triggerAutoSave();
  },

  removeInlineColor(rowIdx, colorName, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const row = this.rows[rowIdx];
    if (!row || !row.colors) return;

    row.colors = row.colors.filter(c => c !== colorName);
    row.color = row.colors.length > 0 ? row.colors[0] : "";

    const calc = this.calcRow(rowIdx);
    row.articul = calc.articul;
    row.full_name = calc.full_name;

    const tr = document.querySelectorAll('#grid-tbody tr')[rowIdx];
    if (tr) {
      const cell = tr.querySelector('.color-tag-cell');
      if (cell) {
        cell.querySelectorAll('.color-tag-chip').forEach(el => {
          if (el.querySelector('span').textContent === colorName) el.remove();
        });
        const input = cell.querySelector('.color-tag-input');
        if (input) {
          input.placeholder = row.colors.length > 0 ? '+ rang' : 'Rang...';
          input.focus();
        }
      }
      const elArt = tr.querySelector('.cell-articul');
      if (elArt) elArt.textContent = calc.articul || '-';
      const elName = tr.querySelector('.cell-name');
      if (elName) elName.textContent = calc.full_name || '-';
    }

    this.updateStats();
    this.triggerAutoSave();
  },

  applyInlineMultiColors(rowIdx) {
    const row = this.rows[rowIdx];
    if (!row) return;

    // Check if input has pending text
    const input = document.querySelector(`.color-tag-input[data-row="${rowIdx}"]`);
    if (input && input.value.trim()) {
      const text = input.value.trim();
      const _t = text.toLowerCase().trim();
      const match = (References.data.colors || []).find(c => [c.name, c.name_ru, c.name_tr, c.name_en].filter(Boolean).some(n => n.toLowerCase().trim() === _t));
      const cName = match ? match.name : text;
      if (!row.colors) row.colors = [];
      if (!row.colors.includes(cName)) row.colors.push(cName);
      input.value = '';
    }

    this.hideColorPopups();

    const colorOn = References.settings.color_enabled;
    const sizeOn = References.settings.size_enabled;
    const colors = colorOn && row.colors && row.colors.length > 0 ? row.colors : [row.color || ''];
    const sizes = sizeOn ? References.splitSizes(row.size) : [];
    const sizeList = sizes.length > 0 ? sizes : [row.size || ''];
    const combos = [];
    colors.forEach(c => sizeList.forEach(s => combos.push({ color: c, size: s })));

    if (combos.length > 1) {
      if (!row.model_key) row.model_key = this.newModelKey();
      // 1-variant shu qatorda qoladi
      row.color = combos[0].color;
      row.colors = combos[0].color ? [combos[0].color] : [];
      row.size = combos[0].size;

      // Qolgan rang/razmer variantlari — alohida qatorlar, lekin BITTA model (bir xil model_key → bir xil model raqami)
      for (let i = 1; i < combos.length; i++) {
        const clone = JSON.parse(JSON.stringify(row));
        clone.color = combos[i].color;
        clone.colors = combos[i].color ? [combos[i].color] : [];
        clone.size = combos[i].size;
        clone.model_key = row.model_key;
        clone.code = "";
        clone.articul = "";
        clone.custom_articul = false;
        this.rows.splice(rowIdx + i, 0, clone);
      }

      // Check if last row is already an empty row
      const last = this.rows[this.rows.length - 1];
      const isLastEmpty = last && !last.product_type && !last.brand && !last.description && !(parseFloat(last.price_buy) || 0);
      if (!isLastEmpty) {
        this.rows.push(this.createEmptyRow());
      }

      this.recalculateAll();
      this.render();

      if (typeof showToast === 'function') {
        showToast(`⚡ Bitta model bo'yicha ${combos.length} ta variant qatori yaratildi (rang × razmer)!`, "success");
      }

      // Focus on the COUNTRY (Страна) field of the next new empty row!
      const targetRowIndex = this.rows.length - 1;
      setTimeout(() => {
        const nextInput = document.querySelector(`input[data-field="country"][data-row="${targetRowIndex}"]`);
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 80);
    } else {
      // Single color or empty: proceed to next row or create one
      if (rowIdx === this.rows.length - 1) {
        this.addEmptyRows(1);
      }
      setTimeout(() => {
        const nextInput = document.querySelector(`input[data-field="country"][data-row="${rowIdx + 1}"]`);
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 80);
    }
  },

  exportToExcel() {
    if (this.rows.length === 0) return alert("Eksport qilish uchun jadvalda ma'lumot yo'q!");

    const headers = [
      "№",
      "Страна",
      "Вид товара",
      "Категория",
      "Группа",
      "Бренд",
      "Код модели",
      "Серия",
      "Коллекция",
      "Сезон",
      "Размер",
      "Описание",
      "Модель",
      "Код",
      "Артикул",
      "Наименование",
      "Количество",
      "Цена закупа",
      "Цена продажи",
      "Цвет"
    ];

    let tableHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Kirim Hujjati</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  th { background-color: #f59e0b; color: #000000; font-weight: bold; border: 1px solid #cccccc; padding: 6px; }
  td { border: 1px solid #cccccc; padding: 4px; font-family: Arial, sans-serif; font-size: 11pt; }
  .num { mso-number-format: "\\#\\,\\#\\#0"; text-align: right; }
  .center { text-align: center; }
</style>
</head>
<body>
<table border="1">
<thead>
<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
</thead>
<tbody>`;

    this.rows.forEach((r, i) => {
      const colorsStr = (r.colors && r.colors.length > 0) ? r.colors.join(', ') : (r.color || '');
      tableHtml += `<tr>
        <td class="center">${i + 1}</td>
        <td>${this.escapeHtml(r.country || '')}</td>
        <td>${this.escapeHtml(r.product_type || '')}</td>
        <td>${this.escapeHtml(r.category || '')}</td>
        <td>${this.escapeHtml(r.group_name || '')}</td>
        <td>${this.escapeHtml(r.brand || '')}</td>
        <td>${this.escapeHtml(r.factory_code || '')}</td>
        <td>${this.escapeHtml(r.series || '')}</td>
        <td>${this.escapeHtml(r.collection || '')}</td>
        <td>${this.escapeHtml(r.season || '')}</td>
        <td>${this.escapeHtml(r.size || '')}</td>
        <td>${this.escapeHtml(r.description || '')}</td>
        <td class="center">${this.escapeHtml(r.model_code || '')}</td>
        <td class="center">${this.escapeHtml(r.code || '')}</td>
        <td>${this.escapeHtml(r.articul || '')}</td>
        <td><b>${this.escapeHtml(r.full_name || '')}</b></td>
        <td class="num">${r.quantity || 0}</td>
        <td class="num">${r.price_buy || 0}</td>
        <td class="num">${r.price_sale || 0}</td>
        <td>${this.escapeHtml(colorsStr)}</td>
      </tr>`;
    });

    tableHtml += `</tbody></table></body></html>`;

    const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `DeLuxury_Kirim_${dateStr}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  exportToCSV() {
    this.exportToExcel();
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
