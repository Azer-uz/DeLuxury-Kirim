// DE LUXURY — MoySklad Supplies (Kirimlar / Priyomkalar) Management Module
const SuppliesList = {
  data: [],                 // Full dataset from MoySklad API (all documents)
  filteredData: [],         // Currently filtered & sorted dataset
  total: 0,
  allCounterparties: [],    // Unique counterparties list
  selectedCounterparties: new Set(),
  cpFilterCustom: false,   // foydalanuvchi kontragent filtrini o'zi tanlaganmi (yo'q bo'lsa — doim hammasi, yangilari ham)
  currentPeriod: 'all',     // 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'stepped_day' | 'stepped_week' | 'stepped_month' | 'custom'
  activeDate: new Date(),
  UZ_MONTHS: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
  fromDate: '',
  toDate: '',
  searchTerm: '',
  statusFilter: '',
  sortKey: 'moment',        // Default sort by date
  sortOrder: 'desc',        // Default descending (newest first)
  page: 1,
  pageSize: 50,

  async init() {
    this.setupListeners();
    this.setupSortHeaders();
    await this.loadSupplies();
    this.applyDateFilter('all');
  },

  async loadSupplies() {
    const loadingBadge = document.getElementById('supplies-loading-badge');
    if (loadingBadge) loadingBadge.style.display = 'inline-block';

    try {
      // Fetch all supplies from MoySklad (up to 1000 items in single payload)
      const resp = await fetch('/api/dashboard/supplies?limit=1000');
      if (resp.ok) {
        const res = await resp.json();
        this.data = res.rows || [];
        this.total = res.total || this.data.length;

        // Build list of unique counterparties
        this.buildCounterpartiesList();

        // Apply filters and sorting
        this.applyDateFilter(this.currentPeriod || 'all');
      }
    } catch (e) {
      console.error("Error loading supplies list:", e);
    } finally {
      if (loadingBadge) loadingBadge.style.display = 'none';
    }
  },

  buildCounterpartiesList() {
    const cpSet = new Set();
    this.data.forEach(s => {
      if (s.agent_name && s.agent_name !== "Noma'lum") {
        cpSet.add(s.agent_name);
      }
    });
    this.allCounterparties = Array.from(cpSet).sort((a, b) => a.localeCompare(b));

    // Filtr tanlanmagan bo'lsa — hammasi (yangi paydo bo'lgan kontragent/qoralama ham yashirinmasin)
    if (!this.cpFilterCustom || this.selectedCounterparties.size === 0) {
      this.selectedCounterparties = new Set(this.allCounterparties);
      this.cpFilterCustom = false;
    }

    this.renderCounterpartyDropdownList(this.allCounterparties);
    this.updateCounterpartyLabel();
  },

  renderCounterpartyDropdownList(list) {
    const container = document.getElementById('supplies-cp-filter-list');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div style="padding: 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-align: center;">Hech narsa topilmadi</div>';
      return;
    }

    container.innerHTML = list.map(name => {
      const isChecked = this.selectedCounterparties.has(name);
      return `
        <label class="cp-filter-item">
          <input type="checkbox" value="${name}" ${isChecked ? 'checked' : ''} class="supp-cp-checkbox">
          <span class="cp-filter-item-name" title="${name}">${name}</span>
        </label>
      `;
    }).join('');

    // Checkbox click handlers
    container.querySelectorAll('.supp-cp-checkbox').forEach(cb => {
      cb.onchange = (e) => {
        const val = e.target.value;
        if (e.target.checked) {
          this.selectedCounterparties.add(val);
        } else {
          this.selectedCounterparties.delete(val);
        }
        this.cpFilterCustom = this.selectedCounterparties.size > 0 && this.selectedCounterparties.size < this.allCounterparties.length;
        // If user unchecked everything, reset to all so table never empties unexpectedly
        if (this.selectedCounterparties.size === 0) {
          this.allCounterparties.forEach(name => this.selectedCounterparties.add(name));
          this.renderCounterpartyDropdownList(this.allCounterparties);
        }
        this.updateCounterpartyLabel();
        this.applyFiltersAndSort();
      };
    });
  },

  updateCounterpartyLabel() {
    const labelEl = document.getElementById('supplies-cp-filter-label');
    if (!labelEl) return;

    const totalCount = this.allCounterparties.length;
    const selectedCount = this.selectedCounterparties.size;

    if (selectedCount === 0 || selectedCount === totalCount) {
      labelEl.innerText = "Yetkazib beruvchi: Barchasi";
    } else if (selectedCount === 1) {
      const name = Array.from(this.selectedCounterparties)[0];
      labelEl.innerText = `Yetkazib beruvchi: ${name}`;
    } else {
      labelEl.innerText = `Yetkazib beruvchi: ${selectedCount} ta tanlangan`;
    }
  },

  formatMoney(num) {
    if (!num && num !== 0) return '0 so\'m';
    return Number(num).toLocaleString('uz-UZ', { maximumFractionDigits: 0 }) + " so'm";
  },

  formatDateTime(momentStr) {
    if (!momentStr) return '—';
    const clean = momentStr.replace('T', ' ');
    const parts = clean.split(' ');
    const dateParts = (parts[0] || '').split('-');
    if (dateParts.length === 3) {
      const [year, month, day] = dateParts;
      const time = parts[1] ? parts[1].substring(0, 5) : '00:00';
      return `${day}.${month}.${year} ${time}`;
    }
    return clean.substring(0, 16);
  },

  stepDate(delta) {
    if (this.currentPeriod === 'month' || this.currentPeriod === 'stepped_month') {
      this.activeDate.setMonth(this.activeDate.getMonth() + delta);
      this.applyDateFilter('stepped_month');
    } else if (this.currentPeriod === 'week' || this.currentPeriod === 'stepped_week') {
      this.activeDate.setDate(this.activeDate.getDate() + delta * 7);
      this.applyDateFilter('stepped_week');
    } else {
      this.activeDate.setDate(this.activeDate.getDate() + delta);
      this.applyDateFilter('stepped_day');
    }
  },

  formatDateLabel(d) {
    const day = d.getDate();
    const month = this.UZ_MONTHS[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month} ${year}`;
  },

  applyDateFilter(period, customFrom = null, customTo = null) {
    this.currentPeriod = period;
    let fromDate = customFrom;
    let toDate = customTo;
    let stepperLabel = '';

    const toISO = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const realToday = new Date();

    if (period === 'today') {
      this.activeDate = new Date();
      fromDate = toISO(this.activeDate);
      toDate = toISO(this.activeDate);
      stepperLabel = this.formatDateLabel(this.activeDate);
    } else if (period === 'yesterday') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      this.activeDate = yest;
      fromDate = toISO(yest);
      toDate = toISO(yest);
      stepperLabel = this.formatDateLabel(yest);
    } else if (period === 'week') {
      this.activeDate = new Date();
      const weekStart = new Date(this.activeDate);
      weekStart.setDate(weekStart.getDate() - 6);
      fromDate = toISO(weekStart);
      toDate = toISO(this.activeDate);
      stepperLabel = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth()+1).padStart(2, '0')} — ${String(this.activeDate.getDate()).padStart(2, '0')}.${String(this.activeDate.getMonth()+1).padStart(2, '0')}.${this.activeDate.getFullYear()}`;
    } else if (period === 'month') {
      this.activeDate = new Date();
      const monthStart = new Date(this.activeDate.getFullYear(), this.activeDate.getMonth(), 1);
      const monthEnd = new Date(this.activeDate.getFullYear(), this.activeDate.getMonth() + 1, 0);
      fromDate = toISO(monthStart);
      toDate = toISO(monthEnd);
      stepperLabel = `${this.UZ_MONTHS[this.activeDate.getMonth()]} ${this.activeDate.getFullYear()}`;
    } else if (period === 'all') {
      this.activeDate = new Date();
      fromDate = null;
      toDate = null;
      stepperLabel = 'Barchasi';
    } else if (period === 'stepped_day') {
      fromDate = toISO(this.activeDate);
      toDate = toISO(this.activeDate);
      stepperLabel = this.formatDateLabel(this.activeDate);
    } else if (period === 'stepped_week') {
      const weekStart = new Date(this.activeDate);
      weekStart.setDate(weekStart.getDate() - 6);
      fromDate = toISO(weekStart);
      toDate = toISO(this.activeDate);
      stepperLabel = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth()+1).padStart(2, '0')} — ${String(this.activeDate.getDate()).padStart(2, '0')}.${String(this.activeDate.getMonth()+1).padStart(2, '0')}.${this.activeDate.getFullYear()}`;
    } else if (period === 'stepped_month') {
      const monthStart = new Date(this.activeDate.getFullYear(), this.activeDate.getMonth(), 1);
      const monthEnd = new Date(this.activeDate.getFullYear(), this.activeDate.getMonth() + 1, 0);
      fromDate = toISO(monthStart);
      toDate = toISO(monthEnd);
      stepperLabel = `${this.UZ_MONTHS[this.activeDate.getMonth()]} ${this.activeDate.getFullYear()}`;
    } else if (period === 'custom') {
      stepperLabel = `${fromDate || '...'} — ${toDate || '...'}`;
    }

    // Update Stepper Label
    const lbl = document.getElementById('supp-stepper-date-label');
    if (lbl) lbl.textContent = stepperLabel;

    // Update Date Inputs UI
    const inputFrom = document.getElementById('supplies-filter-from');
    const inputTo = document.getElementById('supplies-filter-to');
    if (inputFrom) inputFrom.value = fromDate || '';
    if (inputTo) inputTo.value = toDate || '';

    this.fromDate = fromDate || '';
    this.toDate = toDate || '';

    // Update active chip UI
    let matchingPeriod = period;
    if (period === 'stepped_day') {
      const todayISO = toISO(realToday);
      const activeISO = toISO(this.activeDate);
      const yest = new Date(); yest.setDate(yest.getDate() - 1);
      const yestISO = toISO(yest);
      if (activeISO === todayISO) matchingPeriod = 'today';
      else if (activeISO === yestISO) matchingPeriod = 'yesterday';
      else matchingPeriod = null;
    }

    document.querySelectorAll('[data-supp-period]').forEach(chip => {
      if (chip.getAttribute('data-supp-period') === matchingPeriod) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    this.applyFiltersAndSort();
  },

  applyFiltersAndSort() {
    let result = [...this.data];

    // 1. Date / Period Filter
    if (this.fromDate || this.toDate) {
      result = result.filter(s => {
        const sDate = (s.moment || '').substring(0, 10);
        if (this.fromDate && sDate < this.fromDate) return false;
        if (this.toDate && sDate > this.toDate) return false;
        return true;
      });
    }

    // 2. Search Term Filter (Document Number, Agent Name, Store Name, Status)
    if (this.searchTerm) {
      const rawQuery = this.searchTerm.toLowerCase().trim();
      const cleanQuery = rawQuery.replace(/[№#]/g, '').trim();
      const tokens = cleanQuery.split(/\s+/).filter(Boolean);
      const digitsOnly = rawQuery.replace(/\D/g, '');

      result = result.filter(s => {
        const docName = String(s.name || '').toLowerCase();
        const docDigits = docName.replace(/\D/g, '');
        const agentName = String(s.agent_name || '').toLowerCase();
        const storeName = String(s.store_name || '').toLowerCase();
        const statusStr = String(s.status || '').toLowerCase();
        const combinedText = `${docName} ${agentName} ${storeName} ${statusStr}`;

        // Match exact or partial digit sequence for document number (e.g. typing "36" matches "00036")
        if (digitsOnly && (docDigits === digitsOnly || docDigits.endsWith(digitsOnly) || docName.includes(digitsOnly))) {
          if (tokens.length === 0 || tokens.every(t => /^\d+$/.test(t))) {
            return true;
          }
        }

        // All tokens must be present in any searchable attribute
        return tokens.every(token => {
          const tokenDigits = token.replace(/\D/g, '');
          if (tokenDigits && (docDigits === tokenDigits || docDigits.endsWith(tokenDigits) || docName.includes(tokenDigits))) {
            return true;
          }
          return combinedText.includes(token);
        });
      });
    }

    // 3. Counterparty Filter
    if (this.selectedCounterparties.size > 0 && this.selectedCounterparties.size < this.allCounterparties.length) {
      result = result.filter(s => this.selectedCounterparties.has(s.agent_name));
    }
    // If selectedCounterparties is 0 or all, show all (never empty)

    // 4. Status Filter
    if (this.statusFilter) {
      result = result.filter(s => s.status === this.statusFilter);
    }

    // 5. Full Dataset Sorting (across all 100/500+ matching items)
    result.sort((a, b) => {
      let valA = a[this.sortKey];
      let valB = b[this.sortKey];

      if (this.sortKey === 'name') {
        // Numeric document number sorting (e.g. 00036 vs 00001)
        const numA = parseInt(String(valA || '').replace(/\D/g, '') || '0', 10);
        const numB = parseInt(String(valB || '').replace(/\D/g, '') || '0', 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          return this.sortOrder === 'asc' ? numA - numB : numB - numA;
        }
        return this.sortOrder === 'asc'
          ? String(valA || '').localeCompare(String(valB || ''))
          : String(valB || '').localeCompare(String(valA || ''));
      }

      if (this.sortKey === 'sum' || this.sortKey === 'payed_sum' || this.sortKey === 'debt') {
        const numA = Number(valA) || 0;
        const numB = Number(valB) || 0;
        return this.sortOrder === 'asc' ? numA - numB : numB - numA;
      }

      if (this.sortKey === 'moment') {
        const timeA = new Date(String(valA || '').replace(' ', 'T')).getTime() || 0;
        const timeB = new Date(String(valB || '').replace(' ', 'T')).getTime() || 0;
        return this.sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      }

      // Default string comparison
      valA = String(valA || '');
      valB = String(valB || '');
      return this.sortOrder === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    });

    this.filteredData = result;
    this.page = 1;
    this.render();
  },

  render() {
    const tbody = document.getElementById('supplies-tbody');
    const totalCountBadge = document.getElementById('supplies-total-count');
    if (!tbody) return;

    const totalItems = this.filteredData.length;
    if (totalCountBadge) {
      totalCountBadge.innerText = `${totalItems} ta hujjat`;
    }

    // 1. Calculate Totals across all filtered items
    let sumTotal = 0;
    let paidTotal = 0;
    let debtTotal = 0;
    this.filteredData.forEach(s => {
      sumTotal += Number(s.sum) || 0;
      paidTotal += Number(s.payed_sum) || 0;
      debtTotal += Number(s.debt) || 0;
    });

    const elSum = document.getElementById('supp-foot-sum');
    if (elSum) elSum.textContent = this.formatMoney(sumTotal);
    const elPaid = document.getElementById('supp-foot-paid');
    if (elPaid) elPaid.textContent = this.formatMoney(paidTotal);
    const elDebt = document.getElementById('supp-foot-debt');
    if (elDebt) elDebt.textContent = this.formatMoney(debtTotal);

    if (!this.filteredData || totalItems === 0) {
      const pageIndicator = document.getElementById('supp-page-indicator');
      if (pageIndicator) pageIndicator.textContent = '0 из 0';
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem;">
            <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔍</div>
            <div style="font-weight: 600; color: var(--text-main);">Hech qanday priyomka hujjati topilmadi</div>
            <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 0.25rem;">Qidiruv yoki filtr parametrlarini o'zgartirib ko'ring</div>
          </td>
        </tr>
      `;
      return;
    }

    // 2. Pagination Calculation
    let effectivePageSize = this.pageSize === 'all' ? totalItems : (parseInt(this.pageSize, 10) || 50);
    if (effectivePageSize <= 0) effectivePageSize = 50;
    const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
    if (this.page > totalPages) this.page = totalPages;
    if (this.page < 1) this.page = 1;

    const startIdx = (this.page - 1) * effectivePageSize;
    const endIdx = Math.min(totalItems, startIdx + effectivePageSize);
    const pageItems = (this.pageSize === 'all') ? this.filteredData : this.filteredData.slice(startIdx, endIdx);

    const pageIndicator = document.getElementById('supp-page-indicator');
    if (pageIndicator) {
      pageIndicator.textContent = `${startIdx + 1}-${endIdx} из ${totalItems}`;
    }

    const btnFirst = document.getElementById('supp-page-first');
    const btnPrev = document.getElementById('supp-page-prev');
    const btnNext = document.getElementById('supp-page-next');
    const btnLast = document.getElementById('supp-page-last');
    if (btnFirst) btnFirst.disabled = this.page <= 1;
    if (btnPrev) btnPrev.disabled = this.page <= 1;
    if (btnNext) btnNext.disabled = this.page >= totalPages;
    if (btnLast) btnLast.disabled = this.page >= totalPages;

    let html = '';
    pageItems.forEach((s) => {
      const isDraft = s.is_draft || s.status === "Qoralama";
      const isPaid = s.status === "To'langan";
      const isPartial = s.status === "Qisman";

      const statusBadge = isDraft
        ? '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 600;">🟡 Qoralama</span>'
        : (isPaid
          ? '<span class="badge badge-synced">✅ To\'langan</span>'
          : (isPartial
            ? '<span class="badge badge-local">⏳ Qisman</span>'
            : '<span class="badge badge-conflict">⚠️ To\'lanmagan</span>'));

      const actionsCell = isDraft
        ? `<div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
             <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); SuppliesList.openDraft(${s.draft_id})" style="color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); padding: 0.2rem 0.5rem; font-size: 0.74rem;" title="Qoralamani tahrirlash">
               <span>✏️ Ochish</span>
             </button>
             <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); SuppliesList.deleteDraft(${s.draft_id})" style="color: #f87171; border-color: rgba(239, 68, 68, 0.3); padding: 0.2rem 0.4rem; font-size: 0.74rem;" title="O'chirish">
               <span>🗑️</span>
             </button>
           </div>`
        : (s.moysklad_url
          ? `<a href="${s.moysklad_url}" target="_blank" class="btn btn-secondary btn-sm" style="color: #38bdf8; text-decoration: none; padding: 0.25rem 0.55rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;" title="MoySklad tizimida ochish"><span>MoySklad</span><span style="font-size: 0.7rem;">↗</span></a>`
          : `<span style="color: var(--text-dim);">-</span>`);

      const formattedDate = this.formatDateTime(s.moment);
      const rowStyle = isDraft ? 'style="background: rgba(245, 158, 11, 0.12); border-left: 4px solid #f59e0b; cursor: pointer;" onclick="SuppliesList.openDraft(' + s.draft_id + ')"' : '';

      html += `
        <tr ${rowStyle}>
          <td>
            ${isDraft ? `
              <span style="display:inline-flex; align-items:center; gap:5px; font-weight:800; font-family:'JetBrains Mono',monospace; color:#d97706;">
                📝 <span>${s.name || '-'}</span>
                <span style="background:#f59e0b; color:#fff; font-size:9.5px; font-weight:800; padding:2px 6px; border-radius:4px; letter-spacing:0.5px;">CHALA</span>
              </span>
            ` : `
              <span class="kbd" style="font-weight: 700; color: #fbbf24; font-family: 'JetBrains Mono', monospace;">
                ${s.name || '-'}
              </span>
            `}
          </td>
          <td style="font-size: 0.82rem; color: var(--text-muted); white-space: nowrap;">${formattedDate}</td>
          <td>
            <div style="font-weight: 600; color: var(--text-main); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${s.agent_name || ''}">
              ${s.agent_name || "Noma'lum"}
            </div>
          </td>
          <td style="color: var(--text-muted); font-size: 0.82rem;">${s.store_name || '-'}</td>
          <td style="text-align: right; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--text-main);">
            ${this.formatMoney(s.sum)}
          </td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #34d399;">
            ${this.formatMoney(s.payed_sum)}
          </td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: ${s.debt > 0 ? '#f87171' : 'var(--text-dim)'}; font-weight: ${s.debt > 0 ? '700' : '400'};">
            ${this.formatMoney(s.debt)}
          </td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: center;">${actionsCell}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  },

  setupSortHeaders() {
    const table = document.getElementById('supplies-table');
    if (!table) return;

    const headers = table.querySelectorAll('th.sortable-th');
    headers.forEach(th => {
      th.onclick = () => {
        const key = th.getAttribute('data-sort');
        if (!key) return;

        if (this.sortKey === key) {
          // Toggle sort order
          this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          // Number / doc order defaults to asc, sums & dates default to desc
          this.sortOrder = (key === 'name' || key === 'agent_name' || key === 'store_name') ? 'asc' : 'desc';
        }

        // Update icons
        headers.forEach(h => {
          const hKey = h.getAttribute('data-sort');
          const iconSpan = h.querySelector('.sort-icon');
          if (hKey === this.sortKey) {
            h.classList.add('active-sort');
            if (iconSpan) iconSpan.innerText = this.sortOrder === 'asc' ? '▲' : '▼';
          } else {
            h.classList.remove('active-sort');
            if (iconSpan) iconSpan.innerText = '⇅';
          }
        });

        this.applyFiltersAndSort();
      };
    });
  },

  setupListeners() {
    // 1. Date Stepper (◀ / ▶)
    const btnPrev = document.getElementById('btn-supp-date-prev');
    const btnNext = document.getElementById('btn-supp-date-next');
    if (btnPrev) {
      btnPrev.onclick = (e) => {
        e.stopPropagation();
        this.stepDate(-1);
      };
    }
    if (btnNext) {
      btnNext.onclick = (e) => {
        e.stopPropagation();
        this.stepDate(1);
      };
    }

    // 2. Quick Period Chips
    document.querySelectorAll('[data-supp-period]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const period = btn.getAttribute('data-supp-period');
        this.applyDateFilter(period);
      };
    });

    // 3. Date Range Inputs
    const fromInput = document.getElementById('supplies-filter-from');
    const toInput = document.getElementById('supplies-filter-to');
    const handleDateRangeChange = () => {
      const fromVal = fromInput ? fromInput.value : '';
      const toVal = toInput ? toInput.value : '';
      if (fromVal || toVal) {
        this.applyDateFilter('custom', fromVal, toVal);
      }
    };

    if (fromInput) fromInput.onchange = handleDateRangeChange;
    if (toInput) toInput.onchange = handleDateRangeChange;

    // 3. Search Input
    const searchInput = document.getElementById('supplies-search-input');
    if (searchInput) {
      let debounce = null;
      const doSearch = () => {
        this.searchTerm = searchInput.value.trim();
        this.applyFiltersAndSort();
      };
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(doSearch, 150);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(debounce);
          doSearch();
        }
      });
    }

    // 4. Counterparty Dropdown
    const cpToggleBtn = document.getElementById('btn-supplies-cp-toggle');
    const cpMenuEl = document.getElementById('supplies-cp-filter-menu');
    const cpSearchInput = document.getElementById('supplies-cp-search-input');
    const cpSelectAllBtn = document.getElementById('btn-supplies-cp-select-all');
    const cpClearAllBtn = document.getElementById('btn-supplies-cp-clear-all');

    if (cpToggleBtn && cpMenuEl) {
      cpToggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = cpMenuEl.style.display === 'block';
        cpMenuEl.style.display = isOpen ? 'none' : 'block';
        document.getElementById('supplies-cp-filter-dropdown')?.classList.toggle('open', !isOpen);
        if (!isOpen && cpSearchInput) {
          cpSearchInput.value = '';
          cpSearchInput.focus();
          this.renderCounterpartyDropdownList(this.allCounterparties);
        }
      };
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('supplies-cp-filter-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        if (cpMenuEl) cpMenuEl.style.display = 'none';
        dropdown.classList.remove('open');
      }
    });

    if (cpSearchInput) {
      cpSearchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = this.allCounterparties.filter(name => name.toLowerCase().includes(q));
        this.renderCounterpartyDropdownList(filtered);
      };
    }

    if (cpSelectAllBtn) {
      cpSelectAllBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedCounterparties = new Set(this.allCounterparties); this.cpFilterCustom = false;
        this.renderCounterpartyDropdownList(this.allCounterparties);
        this.updateCounterpartyLabel();
        this.applyFiltersAndSort();
      };
    }

    if (cpClearAllBtn) {
      cpClearAllBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedCounterparties = new Set(this.allCounterparties); this.cpFilterCustom = false;
        this.renderCounterpartyDropdownList(this.allCounterparties);
        this.updateCounterpartyLabel();
        this.applyFiltersAndSort();
      };
    }

    // 5. Status Filter
    const statusSelect = document.getElementById('supplies-filter-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        this.statusFilter = e.target.value;
        this.applyFiltersAndSort();
      });
    }

    // Back button inside Grid Receipt view
    const btnBackToSupplies = document.getElementById('btn-back-to-supplies');
    if (btnBackToSupplies) {
      btnBackToSupplies.addEventListener('click', async () => {
        if (typeof Grid !== 'undefined') await Grid.flushDraft();
        this.closeGridReceiptView();
      });
    }

    // Pagination Listeners
    document.getElementById('supp-page-first')?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page = 1;
        this.render();
      }
    });

    document.getElementById('supp-page-prev')?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page--;
        this.render();
      }
    });

    document.getElementById('supp-page-next')?.addEventListener('click', () => {
      let effectivePageSize = this.pageSize === 'all' ? this.filteredData.length : (parseInt(this.pageSize, 10) || 50);
      const totalPages = Math.ceil(this.filteredData.length / effectivePageSize);
      if (this.page < totalPages) {
        this.page++;
        this.render();
      }
    });

    document.getElementById('supp-page-last')?.addEventListener('click', () => {
      let effectivePageSize = this.pageSize === 'all' ? this.filteredData.length : (parseInt(this.pageSize, 10) || 50);
      const totalPages = Math.ceil(this.filteredData.length / effectivePageSize);
      if (this.page < totalPages) {
        this.page = totalPages;
        this.render();
      }
    });

    document.getElementById('supp-page-size')?.addEventListener('change', (e) => {
      this.pageSize = e.target.value;
      this.page = 1;
      this.render();
    });
  },

  filterBySupplier(supplierName) {
    const tabSuppliesBtn = document.querySelector('[data-tab="tab-supplies"]');
    if (tabSuppliesBtn) tabSuppliesBtn.click();

    this.selectedCounterparties.clear();
    this.selectedCounterparties.add(supplierName); this.cpFilterCustom = true;
    this.updateCounterpartyLabel();
    this.applyFiltersAndSort();
  },

  async openGridReceiptView() {
    const suppliesView = document.getElementById('supplies-list-view');
    const gridView = document.getElementById('supplies-grid-view');
    if (suppliesView) suppliesView.style.display = 'none';
    if (gridView) {
      gridView.style.display = 'block';
      // MoySklad ma'lumotlari va taxminiy raqam — fonda (jadval kutmaydi)
      if (typeof loadMoySkladMetadata === 'function') loadMoySkladMetadata().catch(() => {});
      fetch('/api/moysklad/next-doc-number').then(r => r.ok ? r.json() : null).then(nextData => {
        const docInput = document.getElementById('header-doc-number');
        if (docInput && nextData && nextData.next_number && !(typeof Grid !== 'undefined' && Grid.manualDocNumber)) {
          docInput.value = nextData.next_number; if (typeof Grid !== 'undefined' && Grid.setDocNumberMode) Grid.setDocNumberMode(false);
        }
      }).catch((e) => console.warn("Could not fetch next doc number:", e));

      if (typeof Grid !== 'undefined' && Grid.hasUsefulRows()) {
        // Tugallanmagan kirim bor — davom ettiramiz (yangi boshlash uchun "Tozalash")
        Grid.recalculateAll();
        Grid.render();
        if (typeof showToast === 'function') showToast('↩️ Tugallanmagan kirim davom etmoqda. Yangi boshlash uchun "Tozalash" tugmasi', 'info');
      } else {
        // Reset currency to UZS (default)
        const curSelect = document.getElementById('header-currency');
        if (curSelect) curSelect.value = 'UZS';
        if (typeof syncCurrencyUI === 'function') syncCurrencyUI();

        // Reset grid to exactly 1 clean empty row on opening new receipt
        if (typeof Grid !== 'undefined') {
          Grid.activeDraftId = null;
          Grid.isDirty = false;
          Grid.rows = [Grid.createEmptyRow()];
          Grid.recalculateAll();
          Grid.render();
          Grid.fetchBaseCounter().then(() => { Grid.recalculateAll(); Grid.render(); }).catch(() => {});
        }
      }
    }
  },

  async openDraft(draftId) {
    if (!draftId) return;
    try {
      const resp = await fetch(`/api/documents/draft/${draftId}`);
      if (!resp.ok) {
        alert("Qoralama topilmadi!");
        return;
      }
      const data = await resp.json();

      const suppliesView = document.getElementById('supplies-list-view');
      const gridView = document.getElementById('supplies-grid-view');
      if (suppliesView) suppliesView.style.display = 'none';
      if (gridView) gridView.style.display = 'block';

      // MoySklad ma'lumotlari (ombor/kontragent ro'yxati) — FONDA; keshda bo'lsa darhol
      const metaP = (typeof loadMoySkladMetadata === 'function') ? loadMoySkladMetadata({ skipNextDocNumber: true }).catch(() => {}) : Promise.resolve();

      // Populate headers from saved draft
      if (data.header) {
        if (data.header.date) {
          const dateEl = document.getElementById('header-date');
          if (dateEl) dateEl.value = data.header.date;
        }
        if (data.header.manual_number && data.header.doc_number) {
          Grid.setDocNumberMode(true, String(data.header.doc_number).replace(/^≈/, ''));
        } else {
          // Avto rejim: taxminiy raqam fonda yuklanadi, haqiqiysi yuborishda MoySklad navbati bo'yicha beriladi
          Grid.setDocNumberMode(false);
          fetch('/api/moysklad/next-doc-number').then(r => r.ok ? r.json() : null).then(d => {
            const docEl = document.getElementById('header-doc-number');
            if (d && d.next_number && docEl && !Grid.manualDocNumber) { docEl.value = d.next_number; Grid.setDocNumberMode(false); }
          }).catch(() => {});
        }
        // Ombor/kontragent ro'yxati fonda kelganda ham tanlov saqlanib qolsin
        const applyHeaderSelects = () => {
          if (data.header.store_id) {
            const stEl = document.getElementById('header-store');
            if (stEl) stEl.value = data.header.store_id;
          }
          if (data.header.counterparty_id) {
            const cpEl = document.getElementById('header-counterparty');
            if (cpEl) { cpEl.value = data.header.counterparty_id; cpEl.dispatchEvent(new Event('change', { bubbles: true })); }
          }
        };
        applyHeaderSelects();
        metaP.then(() => { applyHeaderSelects(); Grid.isDirty = false; });
        const curEl = document.getElementById('header-currency');
        if (curEl) curEl.value = (data.header.currency === 'USD' && References.settings.usd_enabled) ? 'USD' : 'UZS';
        const rateEl = document.getElementById('header-rate');
        if (rateEl && data.header.rate) rateEl.value = data.header.rate;
        if (typeof syncCurrencyUI === 'function') syncCurrencyUI();
      }

      // Populate Grid rows
      if (typeof Grid !== 'undefined') {
        Grid.activeDraftId = data.id || draftId;
        Grid.rows = (data.rows && data.rows.length > 0) ? data.rows : [Grid.createEmptyRow()];
        Grid.isDirty = false;
        Grid.recalculateAll();
        Grid.render();   // jadval DARHOL ko'rinadi
        // Model raqami/kod hisoblagichi — fonda (MoySklad assortimentini o'qiydi, sekin bo'lishi mumkin)
        Grid.fetchBaseCounter().then(() => { if (Grid.activeDraftId === (data.id || draftId)) { Grid.recalculateAll(); Grid.render(); Grid.isDirty = false; } }).catch(() => {});
      }

      if (typeof showToast === 'function') {
        showToast(`📂 Qoralama #${data.header?.doc_number || draftId} ochildi`, "info");
      }
    } catch (e) {
      console.error("Error opening draft:", e);
      alert("Qoralamani ochishda xatolik yuz berdi");
    }
  },

  async deleteDraft(draftId) {
    if (!draftId) return;
    if (!(await confirmAt("Haqiqatan ham ushbu qoralamani o'chirmoqchimisiz?"))) return;

    try {
      const resp = await fetch(`/api/documents/draft/${draftId}`, { method: 'DELETE' });
      if (resp.ok) {
        if (typeof showToast === 'function') {
          showToast("🗑️ Qoralama o'chirildi", "success");
        }
        await this.loadSupplies();
      } else {
        alert("Qoralamani o'chirishda xatolik yuz berdi");
      }
    } catch (e) {
      console.error("Error deleting draft:", e);
      alert("Qoralamani o'chirishda xatolik");
    }
  },

  closeGridReceiptView() {
    const suppliesView = document.getElementById('supplies-list-view');
    const gridView = document.getElementById('supplies-grid-view');
    if (gridView) gridView.style.display = 'none';
    if (suppliesView) {
      suppliesView.style.display = 'block';
      this.loadSupplies();
    }
  }
};
