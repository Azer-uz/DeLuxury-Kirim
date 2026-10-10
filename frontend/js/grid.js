// Interactive Excel-like Grid Engine
const Grid = {
  rows: [],
  baseCounter: 500,
  activeCell: { rowIndex: 0, colKey: 'product_type' },
  isDirty: false,
  autoSaveTimer: null,

  async init() {
    try {
      await this.fetchBaseCounter();
    } catch (e) {
      console.warn("Could not fetch counter:", e);
    }
    try {
      await this.loadDraft();
    } catch (e) {
      console.warn("Could not load draft:", e);
    }
    if (!this.rows || this.rows.length === 0) {
      this.addEmptyRows(5);
    } else {
      this.recalculateAll();
      this.render();
    }
    this.setupKeyboardEvents();
    this.setupAutoSave();
  },

  async fetchBaseCounter() {
    try {
      const resp = await fetch('/api/articul/counter');
      if (resp.ok) {
        const data = await resp.json();
        this.baseCounter = data.last_number || 500;
        const counterInput = document.getElementById('settings-articul-counter');
        if (counterInput) counterInput.value = this.baseCounter;
      }
    } catch (e) {
      console.error("Error fetching articul counter:", e);
    }
  },

  createEmptyRow(defaultValues = {}) {
    return {
      country: defaultValues.country || "Турция",
      product_type: defaultValues.product_type || "",
      category: defaultValues.category || "",
      group_name: defaultValues.group_name || "",
      brand: defaultValues.brand || "De Luxury",
      collection: defaultValues.collection || "AW26",
      season: defaultValues.season || "Весна-Осень",
      size: defaultValues.size || "M",
      description: defaultValues.description || "",
      model_code: defaultValues.model_code || "",
      articul: defaultValues.articul || "",
      full_name: defaultValues.full_name || "",
      quantity: defaultValues.quantity !== undefined ? parseFloat(defaultValues.quantity) : 1,
      price_buy: defaultValues.price_buy !== undefined ? parseFloat(defaultValues.price_buy) : 0,
      price_sale: defaultValues.price_sale !== undefined ? parseFloat(defaultValues.price_sale) : 0,
      markup_pct: defaultValues.markup_pct !== undefined ? parseFloat(defaultValues.markup_pct) : 0,
      sum_buy: defaultValues.sum_buy !== undefined ? parseFloat(defaultValues.sum_buy) : 0,
      sum_sale: defaultValues.sum_sale !== undefined ? parseFloat(defaultValues.sum_sale) : 0,
      ai_generated: defaultValues.ai_generated || false,
      ai_confidence: defaultValues.ai_confidence !== undefined ? parseFloat(defaultValues.ai_confidence) : 1.0,
      ai_low_confidence_fields: defaultValues.ai_low_confidence_fields || []
    };
  },

  addEmptyRows(count = 1) {
    for (let i = 0; i < count; i++) {
      const lastRow = this.rows[this.rows.length - 1] || {};
      const newRow = this.createEmptyRow({
        country: lastRow.country || "Турция",
        brand: lastRow.brand || "De Luxury",
        collection: lastRow.collection || "AW26",
        season: lastRow.season || "Весна-Осень"
      });
      this.rows.push(newRow);
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
      this.addEmptyRows(5);
      this.triggerAutoSave();
    }
  },

  recalculateAll() {
    this.rows.forEach((row, i) => {
      const calc = References.calculateRow(row, i, this.baseCounter);
      row.category = calc.category || '';
      row.group_name = calc.group_name || '';
      row.articul = calc.articul || '';
      row.full_name = calc.full_name || '';
      row.markup_pct = calc.markup_pct || 0;
      row.sum_buy = calc.sum_buy || 0;
      row.sum_sale = calc.sum_sale || 0;
    });
    this.updateStats();
  },

  getCurrencySymbol() {
    const cur = document.getElementById('header-currency')?.value || 'UZS';
    if (cur === 'USD') return '$';
    if (cur === 'RUB') return '₽';
    return 'so\'m';
  },

  formatMoney(amount) {
    const sym = this.getCurrencySymbol();
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

    const expectedProfit = totalSumSale - totalSumBuy;
    let avgMarkup = 0;
    if (totalSumBuy > 0) {
      avgMarkup = Math.round(((totalSumSale / totalSumBuy) - 1) * 1000) / 10;
    }

    // Update Currency in column headers
    const sym = this.getCurrencySymbol();
    const thPriceBuy = document.getElementById('th-price-buy');
    if (thPriceBuy) thPriceBuy.textContent = `Цена закупа (${sym}) *`;
    const thPriceSale = document.getElementById('th-price-sale');
    if (thPriceSale) thPriceSale.textContent = `Цена продажи (${sym}) *`;
    const thSumBuy = document.getElementById('th-sum-buy');
    if (thSumBuy) thSumBuy.textContent = `Сумма закупа (${sym})`;
    const thSumSale = document.getElementById('th-sum-sale');
    if (thSumSale) thSumSale.textContent = `Сумма продажи (${sym})`;

    // Update DOM safely
    const elItems = document.getElementById('stat-total-items');
    if (elItems) elItems.textContent = `${totalItems} ta`;

    const elQty = document.getElementById('stat-total-qty');
    if (elQty) elQty.textContent = `${totalQty.toLocaleString()} dona`;

    const elSumBuy = document.getElementById('stat-sum-buy');
    if (elSumBuy) elSumBuy.textContent = this.formatMoney(totalSumBuy);

    const elSumSale = document.getElementById('stat-sum-sale');
    if (elSumSale) elSumSale.textContent = this.formatMoney(totalSumSale);

    const elMarkup = document.getElementById('stat-avg-markup');
    if (elMarkup) elMarkup.textContent = `${avgMarkup}%`;

    const elProfit = document.getElementById('stat-expected-profit');
    if (elProfit) elProfit.textContent = this.formatMoney(expectedProfit);
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
      const sumSaleVal = this.formatMoney(row.sum_sale || 0);
      const markupVal = Number(row.markup_pct || 0);

      html += `
        <tr data-row-index="${idx}">
          <td class="cell-num">${idx + 1}</td>
          
          <!-- Mamlakat -->
          <td>
            <input type="text" class="cell-input ${isLowConf('country') ? 'cell-ai-highlight' : ''}" 
                   list="dl-countries" data-field="country" data-row="${idx}" value="${this.escapeHtml(row.country || '')}">
          </td>

          <!-- Mahsulot turi (Вид товара) -->
          <td>
            <input type="text" class="cell-input ${isLowConf('product_type') ? 'cell-ai-highlight' : ''}" 
                   list="dl-product-types" data-field="product_type" data-row="${idx}" value="${this.escapeHtml(row.product_type || '')}" placeholder="Tanlang...">
          </td>

          <!-- Kategoriya (Auto) -->
          <td>
            <span class="cell-auto">${this.escapeHtml(row.category || '-')}</span>
          </td>

          <!-- Guruh (Auto) -->
          <td>
            <span class="cell-auto">${this.escapeHtml(row.group_name || '-')}</span>
          </td>

          <!-- Brend -->
          <td>
            <input type="text" class="cell-input ${isLowConf('brand') ? 'cell-ai-highlight' : ''}" 
                   list="dl-brands" data-field="brand" data-row="${idx}" value="${this.escapeHtml(row.brand || '')}">
          </td>

          <!-- Kolleksiya -->
          <td>
            <input type="text" class="cell-input" 
                   list="dl-seasons" data-field="collection" data-row="${idx}" value="${this.escapeHtml(row.collection || 'AW26')}">
          </td>

          <!-- Mavsum -->
          <td>
            <input type="text" class="cell-input" 
                   list="dl-season-types" data-field="season" data-row="${idx}" value="${this.escapeHtml(row.season || 'Весна-Осень')}">
          </td>

          <!-- O'lcham -->
          <td>
            <input type="text" class="cell-input ${isLowConf('size') ? 'cell-ai-highlight' : ''}" 
                   list="dl-sizes" data-field="size" data-row="${idx}" value="${this.escapeHtml(row.size || 'M')}">
          </td>

          <!-- Tavsif / Rang -->
          <td>
            <input type="text" class="cell-input ${isLowConf('description') ? 'cell-ai-highlight' : ''}" 
                   list="dl-colors" data-field="description" data-row="${idx}" value="${this.escapeHtml(row.description || '')}" placeholder="Rang / tavsif">
          </td>

          <!-- Model Kodi -->
          <td>
            <input type="text" class="cell-input" data-field="model_code" data-row="${idx}" value="${this.escapeHtml(row.model_code || '')}" placeholder="Model">
          </td>

          <!-- Artikul (Auto) -->
          <td>
            <span class="cell-articul">${this.escapeHtml(row.articul || '-')}</span>
          </td>

          <!-- Nomi (Auto) -->
          <td>
            <span class="cell-auto" style="color: #f8fafc; font-family: inherit;">${this.escapeHtml(row.full_name || '-')}</span>
          </td>

          <!-- Soni -->
          <td>
            <input type="number" step="1" min="1" class="cell-input ${isLowConf('quantity') ? 'cell-ai-highlight' : ''}" 
                   data-field="quantity" data-row="${idx}" value="${row.quantity !== undefined ? row.quantity : 1}" style="text-align: right;">
          </td>

          <!-- Sotib olish narxi -->
          <td>
            <input type="number" step="1" min="0" class="cell-input ${isLowConf('price_buy') ? 'cell-ai-highlight' : ''}" 
                   data-field="price_buy" data-row="${idx}" value="${row.price_buy !== undefined ? row.price_buy : 0}" style="text-align: right;">
          </td>

          <!-- Sotish narxi -->
          <td>
            <input type="number" step="1" min="0" class="cell-input ${isLowConf('price_sale') ? 'cell-ai-highlight' : ''}" 
                   data-field="price_sale" data-row="${idx}" value="${row.price_sale !== undefined ? row.price_sale : 0}" style="text-align: right;">
          </td>

          <!-- Nadtsenka % (Auto) -->
          <td>
            <span class="cell-auto" style="text-align: right; color: ${markupVal >= 100 ? '#34d399' : '#fbbf24'};">${markupVal}%</span>
          </td>

          <!-- Summa Buy (Auto) -->
          <td>
            <span class="cell-auto" style="text-align: right;">${sumBuyVal}</span>
          </td>

          <!-- Summa Sale (Auto) -->
          <td>
            <span class="cell-auto" style="text-align: right; color: #38bdf8;">${sumSaleVal}</span>
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

        if (field === 'quantity' || field === 'price_buy' || field === 'price_sale') {
          val = parseFloat(val) || 0;
        }

        if (this.rows[rowIdx]) {
          this.rows[rowIdx][field] = val;
          // Trigger immediate recalculation for this row
          const calc = References.calculateRow(this.rows[rowIdx], rowIdx, this.baseCounter);
          this.rows[rowIdx].category = calc.category;
          this.rows[rowIdx].group_name = calc.group_name;
          this.rows[rowIdx].articul = calc.articul;
          this.rows[rowIdx].full_name = calc.full_name;
          this.rows[rowIdx].markup_pct = calc.markup_pct;
          this.rows[rowIdx].sum_buy = calc.sum_buy;
          this.rows[rowIdx].sum_sale = calc.sum_sale;

          // Update related spans in same row without full re-render
          const tr = e.target.closest('tr');
          if (tr) {
            const spans = tr.querySelectorAll('.cell-auto, .cell-articul');
            if (spans.length >= 6) {
              spans[0].textContent = calc.category || '-';
              spans[1].textContent = calc.group_name || '-';
              spans[2].textContent = calc.articul || '-';
              spans[3].textContent = calc.full_name || '-';
              spans[4].textContent = `${calc.markup_pct}%`;
              spans[5].textContent = `$${calc.sum_buy.toFixed(2)}`;
              if (spans[6]) spans[6].textContent = `$${calc.sum_sale.toFixed(2)}`;
            }
          }
          this.updateStats();
          this.triggerAutoSave();
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
  },

  setupKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains('cell-input')) return;

      const currentRow = parseInt(activeEl.getAttribute('data-row'), 10);
      const currentField = activeEl.getAttribute('data-field');

      // Ctrl + D -> Duplicate Row
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.duplicateRow(currentRow);
        return;
      }

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

      // Arrow Down
      if (e.key === 'ArrowDown' && activeEl.tagName !== 'SELECT') {
        const nextInput = document.querySelector(`.cell-input[data-row="${currentRow + 1}"][data-field="${currentField}"]`);
        if (nextInput) {
          e.preventDefault();
          nextInput.focus();
        }
        return;
      }

      // Arrow Up
      if (e.key === 'ArrowUp' && activeEl.tagName !== 'SELECT') {
        const prevInput = document.querySelector(`.cell-input[data-row="${currentRow - 1}"][data-field="${currentField}"]`);
        if (prevInput) {
          e.preventDefault();
          prevInput.focus();
        }
        return;
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
        doc_number: document.getElementById('header-doc-number')?.value,
        store_id: document.getElementById('header-store')?.value,
        store_name: document.getElementById('header-store')?.selectedOptions[0]?.text || '',
        counterparty_id: document.getElementById('header-counterparty')?.value,
        counterparty_name: document.getElementById('header-counterparty')?.selectedOptions[0]?.text || '',
        currency: document.getElementById('header-currency')?.value || 'USD'
      };

      const payload = {
        header: headerData,
        rows: this.rows
      };

      const resp = await fetch('/api/documents/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        this.isDirty = false;
        const badge = document.getElementById('save-status');
        if (badge) badge.textContent = "Qoralama saqlandi (" + new Date().toLocaleTimeString() + ")";
      }
    } catch (e) {
      console.error("Auto save draft error:", e);
    }
  },

  async loadDraft() {
    try {
      const resp = await fetch('/api/documents/draft');
      if (resp.ok) {
        const draft = await resp.json();
        if (draft.rows && draft.rows.length > 0) {
          this.rows = draft.rows;
        }
        if (draft.header) {
          if (draft.header.date) document.getElementById('header-date').value = draft.header.date;
          if (draft.header.doc_number) document.getElementById('header-doc-number').value = draft.header.doc_number;
          if (draft.header.currency) document.getElementById('header-currency').value = draft.header.currency;
        }
      }
    } catch (e) {
      console.error("Load draft error:", e);
    }
  },

  exportToCSV() {
    if (this.rows.length === 0) return alert("Eksport qilish uchun jadvalda ma'lumot yo'q!");

    const headers = [
      "№", "Страна", "Вид товара", "Категория", "Группа", "Бренд", "Коллекция",
      "Сезон", "Размер", "Описание", "Код модели", "Артикул", "Наименование",
      "Количество", "Цена закупа", "Цена продажи", "Надценка %", "Сумма закупа", "Сумма продажи"
    ];

    const rowsData = this.rows.map((r, i) => [
      i + 1,
      r.country || "",
      r.product_type || "",
      r.category || "",
      r.group_name || "",
      r.brand || "",
      r.collection || "",
      r.season || "",
      r.size || "",
      r.description || "",
      r.model_code || "",
      r.articul || "",
      r.full_name || "",
      r.quantity || 0,
      r.price_buy || 0,
      r.price_sale || 0,
      r.markup_pct || 0,
      r.sum_buy || 0,
      r.sum_sale || 0
    ]);

    let csvContent = "\uFEFF"; // UTF-8 BOM
    csvContent += headers.join(";") + "\r\n";
    rowsData.forEach(row => {
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";") + "\r\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `DeLuxury_Kirim_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
