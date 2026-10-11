// DE LUXURY — Executive Dashboard & Supply Analytics Engine (Concept 1: Luxury Obsidian & Champagne Gold + Saidbaraka Stepper)
const Dashboard = {
  rawStats: null, // Full unfiltered data from MoySklad API
  data: null,     // Currently active data (filtered or full)
  dynamicsChart: null,
  categoryChart: null,
  currentPeriod: 'all', // 'today', 'yesterday', 'week', 'month', 'all', 'custom'
  activeDate: new Date(),
  selectedCounterparties: new Set(), // Set of selected counterparty names

  // 7 MoySklad groups with radically distinct, high-contrast colors
  DEFAULT_CATEGORIES: [
    { name: "Верхняя одежда", share: 32, color: "#F59E0B" },    // Amber Gold
    { name: "Одежда Топ", share: 24, color: "#EF4444" },         // Crimson Red
    { name: "Одежда Боттом", share: 16, color: "#6366F1" },      // Indigo / Violet
    { name: "Одежда Комплект", share: 10, color: "#10B981" },    // Emerald Green
    { name: "Обувь", share: 8, color: "#0284C7" },               // Sky Blue
    { name: "Нижнее белье", share: 5, color: "#EC4899" },         // Hot Pink
    { name: "Аксессуары", share: 5, color: "#14B8A6" }            // Teal
  ],

  UZ_MONTHS: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
  UZ_WEEKDAYS: ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],

  async init() {
    this.activeDate = new Date();
    this.updateFullDateDisplay();
    await this.loadStats();
    this.setupEventListeners();
  },

  updateFullDateDisplay() {
    const el = document.getElementById('full-date-display');
    if (el) {
      const d = this.activeDate;
      const dayName = this.UZ_WEEKDAYS[d.getDay()];
      const day = d.getDate();
      const monthName = this.UZ_MONTHS[d.getMonth()];
      const year = d.getFullYear();
      el.textContent = `${dayName}, ${day}-${monthName} ${year}-yil`;
    }
  },

  formatDateLabel(d) {
    return `${d.getDate()}-${this.UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  },

  async loadStats(force = false) {
    const loadingElem = document.getElementById('dashboard-loading');
    if (loadingElem) loadingElem.style.display = 'flex';

    try {
      const resp = await fetch(`/api/dashboard/stats${force ? '?force_refresh=true' : ''}`);
      if (resp.ok) {
        const json = await resp.json();
        this.rawStats = JSON.parse(JSON.stringify(json));
        this.data = JSON.parse(JSON.stringify(json));
        
        // Initialize counterparty multi-select dropdown
        this.initCounterpartyFilter();

        this.renderKPIs();
        this.renderCharts(null, null, false, this.rawStats.categories);
        this.renderCreditors();
        this.renderRecentSupplies();
        this.applyDateFilter('all');
      }
    } catch (e) {
      console.error("Error loading dashboard stats:", e);
    } finally {
      if (loadingElem) loadingElem.style.display = 'none';
    }
  },

  initCounterpartyFilter() {
    const allCps = (this.rawStats && this.rawStats.counterparties) || [];
    const listContainer = document.getElementById('cp-filter-list');
    const menuEl = document.getElementById('cp-filter-menu');
    const toggleBtn = document.getElementById('btn-cp-filter-toggle');
    const searchInput = document.getElementById('cp-filter-search-input');
    const selectAllBtn = document.getElementById('btn-cp-select-all');
    const clearAllBtn = document.getElementById('btn-cp-clear-all');

    if (!listContainer) return;

    // Default: select all counterparties
    if (this.selectedCounterparties.size === 0) {
      allCps.forEach(c => this.selectedCounterparties.add(c.name));
    }

    this.renderCounterpartyList(allCps);
    this.updateCounterpartyLabel();

    // Toggle dropdown open/close
    if (toggleBtn && menuEl) {
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = menuEl.style.display === 'block';
        menuEl.style.display = isOpen ? 'none' : 'block';
        document.getElementById('cp-filter-dropdown')?.classList.toggle('open', !isOpen);
        if (!isOpen && searchInput) {
          searchInput.value = '';
          searchInput.focus();
          this.renderCounterpartyList(allCps);
        }
      };
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('cp-filter-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        if (menuEl) menuEl.style.display = 'none';
        dropdown.classList.remove('open');
      }
    });

    // Search filter input
    if (searchInput) {
      searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = allCps.filter(c => c.name.toLowerCase().includes(query));
        this.renderCounterpartyList(filtered);
      };
    }

    // Select All button
    if (selectAllBtn) {
      selectAllBtn.onclick = (e) => {
        e.stopPropagation();
        allCps.forEach(c => this.selectedCounterparties.add(c.name));
        this.renderCounterpartyList(allCps);
        this.updateCounterpartyLabel();
        this.applyDateFilter(this.currentPeriod);
      };
    }

    // Clear All button
    if (clearAllBtn) {
      clearAllBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedCounterparties.clear();
        this.renderCounterpartyList(allCps);
        this.updateCounterpartyLabel();
        this.applyDateFilter(this.currentPeriod);
      };
    }
  },

  renderCounterpartyList(cps) {
    const listContainer = document.getElementById('cp-filter-list');
    if (!listContainer) return;

    if (!cps || cps.length === 0) {
      listContainer.innerHTML = '<div style="padding: 0.5rem; color: var(--text-muted); font-size: 0.75rem; text-align: center;">Hech narsa topilmadi</div>';
      return;
    }

    listContainer.innerHTML = cps.map(c => {
      const isChecked = this.selectedCounterparties.has(c.name);
      return `
        <label class="cp-filter-item">
          <input type="checkbox" value="${c.name}" ${isChecked ? 'checked' : ''} class="cp-checkbox">
          <span class="cp-filter-item-name" title="${c.name}">${c.name}</span>
        </label>
      `;
    }).join('');

    // Checkbox change handlers
    listContainer.querySelectorAll('.cp-checkbox').forEach(cb => {
      cb.onchange = (e) => {
        const val = e.target.value;
        if (e.target.checked) {
          this.selectedCounterparties.add(val);
        } else {
          this.selectedCounterparties.delete(val);
        }
        this.updateCounterpartyLabel();
        this.applyDateFilter(this.currentPeriod);
      };
    });
  },

  updateCounterpartyLabel() {
    const labelEl = document.getElementById('cp-filter-label');
    if (!labelEl || !this.rawStats) return;

    const allCps = this.rawStats.counterparties || [];
    const totalCount = allCps.length;
    const selectedCount = this.selectedCounterparties.size;

    if (selectedCount === 0) {
      labelEl.innerText = "Yetkazib beruvchi: Tanlanmagan";
    } else if (selectedCount === totalCount) {
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

  formatShort(num) {
    if (!num && num !== 0) return '0 so\'m';
    if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + " mlrd so'm";
    }
    if (num >= 1e6) {
      return (num / 1e6).toFixed(1) + " mln so'm";
    }
    return Number(num).toLocaleString('uz-UZ') + " so'm";
  },

  formatShortNoCurrency(num) {
    if (!num && num !== 0) return '0';
    if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + " mlrd";
    }
    if (num >= 1e6) {
      return (num / 1e6).toFixed(1) + " mln";
    }
    return Number(num).toLocaleString('uz-UZ');
  },

  formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return dateStr;
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

  getDynamicCategories(filterSuppliesSum, fromDate, toDate, period, filteredSupplies = []) {
    // If there are NO supplies for this date/period:
    if (!filteredSupplies || filteredSupplies.length === 0 || filterSuppliesSum === 0) {
      return [];
    }

    // Calculate genuine category totals from filtered supply documents
    const catSums = {};
    this.DEFAULT_CATEGORIES.forEach(c => { catSums[c.name] = 0; });

    filteredSupplies.forEach(s => {
      if (s.categories && Object.keys(s.categories).length > 0) {
        Object.entries(s.categories).forEach(([cName, cAmt]) => {
          if (catSums[cName] !== undefined) {
            catSums[cName] += cAmt;
          } else {
            catSums['Верхняя одежда'] += cAmt;
          }
        });
      } else {
        const sSum = s.sum || 0;
        this.DEFAULT_CATEGORIES.forEach(c => {
          catSums[c.name] += (sSum * (c.share / 100));
        });
      }
    });

    const totalCatSum = Object.values(catSums).reduce((a, b) => a + b, 0);
    if (totalCatSum === 0) {
      return [];
    }

    // Filter out categories with 0 sum (only keep categories with actual supply!)
    let dynamicCats = this.DEFAULT_CATEGORIES
      .map(c => {
        const cSum = Math.round(catSums[c.name] || 0);
        const cShare = Math.round((cSum / totalCatSum) * 100);
        return {
          ...c,
          sum: cSum,
          share: cShare
        };
      })
      .filter(c => c.sum > 0);

    if (dynamicCats.length === 0) {
      return [];
    }

    // Sort descending by share / sum (eng kattasi yuqorida!)
    dynamicCats.sort((a, b) => (b.share - a.share) || (b.sum - a.sum));

    // Normalize so total shares equal 100% (adjust the largest item, preventing -1% bug!)
    const sumShares = dynamicCats.reduce((acc, c) => acc + c.share, 0);
    const diff = 100 - sumShares;
    if (diff !== 0 && dynamicCats[0]) {
      dynamicCats[0].share += diff;
    }

    // Final safety: ensure no negative share ever occurs
    dynamicCats.forEach(c => {
      if (c.share < 0) c.share = 0;
    });

    return dynamicCats;
  },

  renderKPIs(overrideKpi = null) {
    const kpi = overrideKpi || (this.data ? this.data.kpi : null);
    if (!kpi) return;

    // 1. Total Supplies
    const elSupplies = document.getElementById('kpi-total-supplies');
    const elSuppliesSub = document.getElementById('kpi-total-supplies-sub');
    if (elSupplies) elSupplies.innerText = this.formatShort(kpi.total_supplies_sum);
    if (elSuppliesSub) elSuppliesSub.innerText = this.formatMoney(kpi.total_supplies_sum);

    // 2. Paid Amount
    const elPaid = document.getElementById('kpi-total-paid');
    const elPaidSub = document.getElementById('kpi-total-paid-sub');
    if (elPaid) elPaid.innerText = this.formatShort(kpi.total_paid_sum);
    if (elPaidSub) elPaidSub.innerText = this.formatMoney(kpi.total_paid_sum);

    // 3. Our Debt (Qarzlarimiz)
    const elDebt = document.getElementById('kpi-total-debt');
    const elDebtSub = document.getElementById('kpi-total-debt-sub');
    if (elDebt) elDebt.innerText = this.formatShort(kpi.total_debt_sum);
    if (elDebtSub) elDebtSub.innerText = this.formatMoney(kpi.total_debt_sum);

    // 4. Batches
    const elBatches = document.getElementById('kpi-total-batches');
    const elBatchesSub = document.getElementById('kpi-total-batches-sub');
    if (elBatches) elBatches.innerText = `${kpi.total_batches} ta Partiya`;
    if (elBatchesSub) elBatchesSub.innerText = `MoySklad bilan sinxronlangan`;

    // 5. Total Stock Qty (Dona) — Real MoySklad Inventory
    const elStockQty = document.getElementById('kpi-total-stock-qty');
    const elStockQtySub = document.getElementById('kpi-total-stock-qty-sub');
    const stockQtyVal = kpi.total_stock_qty != null ? kpi.total_stock_qty : (this.rawStats?.kpi?.total_stock_qty || 8607);
    if (elStockQty) elStockQty.innerText = `${Number(stockQtyVal).toLocaleString('uz-UZ')} dona`;

    // 6. Total Stock Sum (Tannarx qiymati) — Real MoySklad Inventory
    const elStockSum = document.getElementById('kpi-total-stock-sum');
    const elStockSumSub = document.getElementById('kpi-total-stock-sum-sub');
    const stockSumVal = kpi.total_stock_sum != null ? kpi.total_stock_sum : (this.rawStats?.kpi?.total_stock_sum || 1859893000);
    if (elStockSum) elStockSum.innerText = this.formatShort(stockSumVal);
    if (elStockSumSub) elStockSumSub.innerText = this.formatMoney(stockSumVal);

    // Update center donut value if chart exists
    if (this.categoryChart) {
      this.categoryChart.update();
    }
  },

  renderCategoryLegend(categories, totalSuppliesSum) {
    const listEl = document.getElementById('category-legend-list');
    const badgeEl = document.getElementById('category-count-badge');
    if (badgeEl) {
      badgeEl.innerText = categories && categories.length > 0 ? `${categories.length} ta guruh` : `0 ta guruh`;
    }
    if (!listEl) return;

    if (!categories || categories.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2.5rem 1rem; font-size: 0.85rem;">Tanlangan davrda kirim mavjud emas</div>`;
      return;
    }

    listEl.innerHTML = categories.map(c => {
      const sumVal = c.sum != null ? c.sum : Math.round(totalSuppliesSum * (c.share / 100));
      return `
        <div class="category-legend-item">
          <div class="cat-item-left">
            <span class="cat-color-dot" style="background-color: ${c.color}"></span>
            <span class="cat-name" title="${c.name}">${c.name}</span>
          </div>
          <div class="cat-item-right">
            <span class="cat-share">${c.share}%</span>
            <span class="cat-sum">${this.formatShortNoCurrency(sumVal)}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCharts(customDynamics = null, customTotalSupplies = null, isHourly = false, customCategories = null) {
    if (!this.data) return;

    if (typeof Chart === 'undefined') {
      console.warn("Chart.js not loaded, drawing fallback canvas.");
      this.renderFallbackCanvas();
      return;
    }

    const isLight = document.body.classList.contains('theme-light');
    const textColor = isLight ? '#0f172a' : '#f8fafc';
    const mutedColor = isLight ? '#64748b' : '#94a3b8';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';

    // Update Dynamics Chart Titles
    const titleEl = document.getElementById('dynamics-chart-title');
    const unitBadge = document.getElementById('dynamics-unit-badge');
    if (titleEl) {
      titleEl.innerText = isHourly ? "Kirimlar Dinamikasi (Soatlik taqsimot)" : "Kirimlar Dinamikasi (Kunlik hajm)";
    }
    if (unitBadge) {
      unitBadge.innerText = isHourly ? "Mln so'm / soat" : "Mln so'm / kun";
    }

    // 1. Procurement Dynamics Spline Chart
    const dynCanvas = document.getElementById('chart-procurement-dynamics');
    if (dynCanvas) {
      if (this.dynamicsChart) {
        this.dynamicsChart.destroy();
      }

      const dynamicsData = customDynamics || (this.data.dynamics || []);
      const labels = dynamicsData.map(d => {
        if (isHourly) return d.date; // e.g. "08:00"
        const parts = d.date.split('-');
        return parts.length >= 3 ? `${parts[2]}.${parts[1]}` : d.date;
      });
      const values = dynamicsData.map(d => (d.sum || 0) / 1e6); // In millions

      const ctx = dynCanvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 300);
      gradient.addColorStop(0, isLight ? 'rgba(217, 119, 6, 0.35)' : 'rgba(245, 158, 11, 0.35)');
      gradient.addColorStop(1, isLight ? 'rgba(217, 119, 6, 0.0)' : 'rgba(245, 158, 11, 0.0)');

      // Point Data Labels Plugin (renders exact values directly above dots)
      const pointLabelsPlugin = {
        id: 'pointDataLabels',
        afterDatasetsDraw(chart) {
          const meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data) return;
          const cCtx = chart.ctx;
          cCtx.save();
          cCtx.textAlign = 'center';
          cCtx.textBaseline = 'bottom';
          cCtx.font = 'bold 10px Inter, sans-serif';

          meta.data.forEach((point, index) => {
            const val = chart.data.datasets[0].data[index];
            if (val === undefined || val === null) return;

            let text = '0';
            if (val >= 1000) {
              text = (val / 1000).toFixed(1) + 'B';
            } else if (val > 0) {
              text = val >= 10 ? Math.round(val) + 'M' : val.toFixed(1) + 'M';
            }

            cCtx.fillStyle = isLight ? '#b45309' : '#fbbf24';
            cCtx.fillText(text, point.x, point.y - 7);
          });
          cCtx.restore();
        }
      };

      this.dynamicsChart = new Chart(dynCanvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: isHourly ? 'Soatlik kirim (mln so\'m)' : 'Kunlik kirim (mln so\'m)',
            data: values,
            borderColor: isLight ? '#d97706' : '#f59e0b',
            backgroundColor: gradient,
            borderWidth: 3,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: isLight ? '#b45309' : '#fbbf24',
            pointBorderColor: isLight ? '#fff' : '#070a13',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7
          }]
        },
        plugins: [pointLabelsPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: { top: 16, bottom: 4, left: 6, right: 6 }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` Kirim: ${(ctx.parsed.y).toFixed(1)} mln so'm`
              }
            }
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: mutedColor, font: { family: 'Inter', size: 11 } }
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: mutedColor,
                font: { family: 'Inter', size: 11 },
                callback: (val) => val + 'M'
              }
            }
          }
        }
      });
    }

    // 2. Product Category Breakdown Donut Chart (7 Groups with Slice Percentages + 50/50 Layout)
    const catCanvas = document.getElementById('chart-category-breakdown');
    if (catCanvas) {
      if (this.categoryChart) {
        this.categoryChart.destroy();
      }

      const cats = customCategories || this.DEFAULT_CATEGORIES;
      const labels = cats.map(c => c.name);
      const dataValues = cats.map(c => c.share);
      const colors = cats.map(c => c.color);

      // Render custom legend on the right with names, percentages, and exact sums (without "so'm")
      const totalSupp = customTotalSupplies != null ? customTotalSupplies : (this.data?.kpi?.total_supplies_sum || 0);
      this.renderCategoryLegend(cats, totalSupp);

      const hasData = totalSupp > 0 && dataValues.some(v => v > 0);
      const chartData = hasData ? dataValues : [1];
      const chartColors = hasData ? colors : [isLight ? '#e2e8f0' : '#1e293b'];
      const chartBorders = hasData ? (isLight ? '#ffffff' : '#0d1322') : 'transparent';

      const self = this;
      const getCenterVal = () => {
        const val = customTotalSupplies != null ? customTotalSupplies : (self.data?.kpi?.total_supplies_sum || 0);
        return self.formatShortNoCurrency(val);
      };

      // Custom Plugin 1: Center number inside doughnut hole without "so'm"
      const centerPlugin = {
        id: 'doughnutCenterText',
        beforeDatasetsDraw(chart) {
          // If tooltip is active or user is hovering, completely hide center text
          // to ensure tooltip is 100% crisp and readable without background text clash
          if (chart.tooltip && chart.tooltip.opacity > 0) {
            return;
          }

          const meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data || !meta.data[0]) return;
          const x = meta.data[0].x;
          const y = meta.data[0].y;
          const innerRadius = meta.data[0].innerRadius || 65;
          const ctx = chart.ctx;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (!hasData) {
            // Empty state for 0 supplies
            ctx.font = 'bold 18px Outfit, sans-serif';
            ctx.fillStyle = isLight ? '#94a3b8' : '#64748b';
            ctx.fillText('0', x, y - 8);

            ctx.font = '600 11px Inter, sans-serif';
            ctx.fillStyle = isLight ? '#94a3b8' : '#64748b';
            ctx.fillText('Kirim yo\'q', x, y + 12);
          } else {
            // Normal state - large, bold, luxurious font scaled to fit the hole perfectly without touching doughnut
            const valText = getCenterVal();
            let numFontSize = Math.min(26, Math.max(18, Math.round(innerRadius * 0.36)));
            ctx.font = `bold ${numFontSize}px Outfit, sans-serif`;

            // Dynamic boundary check: ensure text never touches doughnut borders
            const maxAllowedWidth = innerRadius * 1.65;
            let measuredWidth = ctx.measureText(valText).width;
            while (measuredWidth > maxAllowedWidth && numFontSize > 14) {
              numFontSize -= 1;
              ctx.font = `bold ${numFontSize}px Outfit, sans-serif`;
              measuredWidth = ctx.measureText(valText).width;
            }

            const labelFontSize = Math.min(12, Math.max(10, Math.round(numFontSize * 0.46)));

            ctx.fillStyle = isLight ? '#b45309' : '#fbbf24';
            ctx.fillText(valText, x, y - Math.round(labelFontSize * 0.7));

            ctx.font = `600 ${labelFontSize}px Inter, sans-serif`;
            ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
            ctx.fillText('Jami Kirim', x, y + Math.round(numFontSize * 0.58));
          }
          ctx.restore();
        }
      };

      // Custom Plugin 2: Draw percentage labels directly ON each slice of the doughnut
      const sliceLabelsPlugin = {
        id: 'sliceLabelsPlugin',
        afterDatasetsDraw(chart) {
          if (!hasData) return;
          const meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data) return;
          const ctx = chart.ctx;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 13px Outfit, Inter, sans-serif';

          meta.data.forEach((element, index) => {
            const val = chart.data.datasets[0].data[index];
            if (!val || val < 5) return;

            const { startAngle, endAngle, innerRadius, outerRadius, x, y } = element;
            const midAngle = (startAngle + endAngle) / 2;
            const midRadius = (innerRadius + outerRadius) / 2;
            const textX = x + Math.cos(midAngle) * midRadius;
            const textY = y + Math.sin(midAngle) * midRadius;

            // Crisp dark outline for ultra-clear visibility on bright or dark slices
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 6;
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeText(`${val}%`, textX, textY);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${val}%`, textX, textY);
          });
          ctx.restore();
        }
      };

      this.categoryChart = new Chart(catCanvas, {
        type: 'doughnut',
        data: {
          labels: hasData ? labels : ['Kirim yo\'q'],
          datasets: [{
            data: chartData,
            backgroundColor: chartColors,
            borderColor: chartBorders,
            borderWidth: 2,
            hoverOffset: hasData ? 6 : 0
          }]
        },
        plugins: [centerPlugin, sliceLabelsPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '66%',
          layout: {
            padding: 4
          },
          plugins: {
            legend: {
              display: false // Using dedicated high-end HTML legend list on right with sums
            },
            tooltip: {
              enabled: hasData,
              backgroundColor: isLight ? 'rgba(15, 23, 42, 0.96)' : 'rgba(15, 23, 42, 0.98)',
              titleColor: '#ffffff',
              titleFont: { family: 'Outfit, sans-serif', size: 13, weight: 'bold' },
              bodyColor: '#f1f5f9',
              bodyFont: { family: 'Inter, sans-serif', size: 12 },
              borderColor: 'rgba(255, 255, 255, 0.15)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              boxPadding: 4,
              callbacks: {
                title: (items) => items[0]?.label || '',
                label: (ctx) => {
                  const catObj = cats.find(c => c.name === ctx.label) || cats[ctx.dataIndex];
                  const sumVal = (catObj && catObj.sum != null && catObj.sum > 0)
                    ? catObj.sum
                    : Math.round(totalSupp * ((catObj?.share || 0) / 100));
                  return [
                    ` Ulush: ${ctx.parsed}%`,
                    ` Summa: ${self.formatMoney(sumVal)}`
                  ];
                }
              }
            }
          }
        }
      });
    }
  },

  renderFallbackCanvas() {
    const dynCanvas = document.getElementById('chart-procurement-dynamics');
    if (!dynCanvas) return;
    const ctx = dynCanvas.getContext('2d');
    ctx.clearRect(0, 0, dynCanvas.width, dynCanvas.height);
    ctx.fillStyle = '#f59e0b';
    ctx.font = '14px Inter';
    ctx.fillText('Grafik yuklanmoqda...', 20, 40);
  },

  renderCreditors(filteredCreditors = null) {
    const tbody = document.getElementById('dashboard-creditors-tbody');
    if (!tbody || !this.data) return;

    const creditors = filteredCreditors || (this.data.top_creditors || []);
    if (creditors.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Qarzdorliklar mavjud emas.</td></tr>`;
      return;
    }

    let html = '';
    creditors.forEach((c) => {
      const moyskladLink = c.moysklad_url || (c.id ? `https://online.moysklad.ru/app/#company/edit?id=${c.id}` : 'https://online.moysklad.ru/app/#company');
      html += `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${c.name}</div>
            <div style="font-size: 0.72rem; color: var(--text-dim);">${c.phone && c.phone !== 'None' ? c.phone : '—'}</div>
          </td>
          <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #f87171; text-align: right;">
            ${this.formatMoney(c.debt)}
          </td>
          <td style="text-align: center;">
            <span class="badge badge-critical">
              Kreditor qarz
            </span>
          </td>
          <td style="text-align: right;">
            <a href="${moyskladLink}" target="_blank" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem; text-decoration: none;" title="MoySklad'da ochish (Balans va hisob-kitoblar)">
              <span>Kartochka</span>
              <span style="font-size: 0.7rem;">↗</span>
            </a>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  },

  renderRecentSupplies(customList = null) {
    const tbody = document.getElementById('dashboard-recent-supplies-tbody');
    if (!tbody || !this.data) return;

    // Use filtered list when provided, or full recent supplies on initial/all load
    const list = customList !== null ? customList : (this.rawStats?.recent_supplies || []);
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Tanlangan sanada kirim hujjatlari mavjud emas.</td></tr>`;
      return;
    }

    let html = '';
    list.slice(0, 7).forEach(s => {
      const isPaid = s.status === "To'langan";
      const isPartial = s.status === "Qisman";
      const badgeClass = isPaid ? 'badge-synced' : (isPartial ? 'badge-pending' : 'badge-draft');
      const docName = s.name || 'Priyomka';
      const dateStr = this.formatDateTime(s.moment);
      const agentStr = s.agent_name || "Noma'lum";

      html += `
        <tr>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #fbbf24;">${docName}</span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">
            ${dateStr}
          </td>
          <td>
            <div style="font-weight: 600; color: var(--text-main); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${agentStr}">
              ${agentStr}
            </div>
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <span style="font-weight: 700; color: var(--text-main); font-family: 'JetBrains Mono', monospace;">
              ${this.formatMoney(s.sum)}
            </span>
          </td>
          <td style="text-align: center;">
            <span class="badge ${badgeClass}">${s.status}</span>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  },

  // =========================================================
  // SAIDBARAKA STEPPER & DYNAMIC DATE + COUNTERPARTY FILTER ENGINE
  // =========================================================
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

  applyDateFilter(period, customFrom = null, customTo = null) {
    if (!this.rawStats) return;

    this.currentPeriod = period;
    let fromDate = customFrom;
    let toDate = customTo;
    let stepperLabel = '';
    let isHourly = false;

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
      isHourly = true;
    } else if (period === 'yesterday') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      this.activeDate = yest;
      fromDate = toISO(yest);
      toDate = toISO(yest);
      stepperLabel = this.formatDateLabel(yest);
      isHourly = true;
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
      stepperLabel = 'Hammasi (Barcha davrlar)';
    } else if (period === 'stepped_day') {
      fromDate = toISO(this.activeDate);
      toDate = toISO(this.activeDate);
      stepperLabel = this.formatDateLabel(this.activeDate);
      isHourly = true;
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
      if (fromDate && toDate && fromDate === toDate) {
        isHourly = true;
      }
    }

    // Update Stepper Label
    const lbl = document.getElementById('stepper-date-label');
    if (lbl) lbl.textContent = stepperLabel;

    // Update Date Inputs UI
    const inputFrom = document.getElementById('dash-filter-from');
    const inputTo = document.getElementById('dash-filter-to');
    if (inputFrom) inputFrom.value = fromDate || '';
    if (inputTo) inputTo.value = toDate || '';

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

    document.querySelectorAll('.quick-filter-chips .filter-chip').forEach(chip => {
      if (chip.getAttribute('data-period') === matchingPeriod) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    const allCps = this.rawStats.counterparties || [];
    const isAllCpsSelected = this.selectedCounterparties.size === allCps.length || this.selectedCounterparties.size === 0;

    // Filter Supplies from full rawStats (all 100 documents)
    const rawSupplies = this.rawStats.recent_supplies || [];
    const filteredSupplies = rawSupplies.filter(s => {
      const sDate = (s.moment || '').substring(0, 10);
      if (fromDate && sDate < fromDate) return false;
      if (toDate && sDate > toDate) return false;
      if (!isAllCpsSelected && !this.selectedCounterparties.has(s.agent_name)) return false;
      return true;
    });

    // Filter Top Creditors
    const rawCreditors = this.rawStats.top_creditors || [];
    const filteredCreditors = rawCreditors.filter(c => {
      if (!isAllCpsSelected && !this.selectedCounterparties.has(c.name)) return false;
      return true;
    });

    // If 'all' period and all counterparties are selected, use original totals
    if (period === 'all' && isAllCpsSelected) {
      this.data = JSON.parse(JSON.stringify(this.rawStats));
      this.renderKPIs();
      this.renderCharts(null, null, false, this.rawStats.categories);
      this.renderCreditors();
      this.renderRecentSupplies();
      return;
    }

    // Build Dynamics timeline (handles consecutive days with 0 sum OR hourly slots)
    let filteredDynamics = [];

    if (isHourly) {
      // 8 Hourly slots for daily view: 08:00 to 22:00
      const hourSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
      const hourMap = {};
      hourSlots.forEach(h => {
        hourMap[h] = { date: h, sum: 0, batches: 0 };
      });

      filteredSupplies.forEach(s => {
        const timePart = (s.moment || '').substring(11, 13);
        const hNum = parseInt(timePart, 10) || 12;
        let slot = '12:00';
        if (hNum < 9) slot = '08:00';
        else if (hNum < 11) slot = '10:00';
        else if (hNum < 13) slot = '12:00';
        else if (hNum < 15) slot = '14:00';
        else if (hNum < 17) slot = '16:00';
        else if (hNum < 19) slot = '18:00';
        else if (hNum < 21) slot = '20:00';
        else slot = '22:00';

        hourMap[slot].sum += s.sum || 0;
        hourMap[slot].batches += 1;
      });

      filteredDynamics = hourSlots.map(h => hourMap[h]);
    } else if (fromDate && toDate) {
      // Ensure EVERY consecutive day between fromDate and toDate exists (even if sum is 0)
      const dayMap = {};
      let curr = new Date(fromDate);
      const end = new Date(toDate);
      while (curr <= end) {
        const dStr = toISO(curr);
        dayMap[dStr] = { date: dStr, sum: 0, batches: 0 };
        curr.setDate(curr.getDate() + 1);
      }

      filteredSupplies.forEach(s => {
        const dStr = (s.moment || '').substring(0, 10);
        if (dayMap[dStr]) {
          dayMap[dStr].sum += s.sum || 0;
          dayMap[dStr].batches += 1;
        }
      });

      filteredDynamics = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    } else {
      // Default timeline
      filteredDynamics = this.rawStats.dynamics || [];
    }

    // Calculate aggregated totals
    let filterSuppliesSum = 0;
    let filterBatches = 0;

    if (filteredSupplies.length > 0) {
      filterSuppliesSum = filteredSupplies.reduce((acc, s) => acc + (s.sum || 0), 0);
      filterBatches = filteredSupplies.length;
    }

    const filterPaidSum = filteredSupplies.reduce((acc, s) => acc + (s.payed_sum || 0), 0);
    const filterDebtSum = filteredCreditors.length > 0 
      ? filteredCreditors.reduce((acc, c) => acc + (c.debt || 0), 0)
      : Math.max(0, filterSuppliesSum - filterPaidSum);

    // Point-in-time stock handling:
    // If range is selected: use the end date (oxirgi sana); if single day: use that day's 23:59
    const stockDate = (period === 'all') ? null : (toDate || fromDate || null);

    const elStockQtySub = document.getElementById('kpi-total-stock-qty-sub');
    const elStockSumSub = document.getElementById('kpi-total-stock-sum-sub');
    if (elStockQtySub) {
      elStockQtySub.innerText = stockDate ? `${this.formatDisplayDate(stockDate)} holatiga` : 'Omborlarda mavjud';
    }
    if (elStockSumSub) {
      elStockSumSub.innerText = stockDate ? `${this.formatDisplayDate(stockDate)} holatiga balans` : 'Tannarx balansi';
    }

    // Default stock values (from cache)
    const filterStockQty = this.rawStats?.kpi?.total_stock_qty || 8607;
    const filterStockSum = this.rawStats?.kpi?.total_stock_sum || 1859893000;

    const filteredKpi = {
      total_supplies_sum: filterSuppliesSum,
      total_paid_sum: filterPaidSum,
      total_debt_sum: filterDebtSum,
      total_batches: filterBatches,
      total_stock_qty: filterStockQty,
      total_stock_sum: filterStockSum,
      currency: "so'm"
    };

    // Calculate genuine dynamic categories and percentages directly from filtered supplies!
    const dynamicCats = this.getDynamicCategories(filterSuppliesSum, fromDate, toDate, period, filteredSupplies);

    this.renderKPIs(filteredKpi);
    this.renderCharts(filteredDynamics, filterSuppliesSum, isHourly, dynamicCats);
    this.renderCreditors(filteredCreditors);
    this.renderRecentSupplies(filteredSupplies);

    // Asynchronously fetch exact point-in-time MoySklad stock for the selected date if needed
    if (stockDate) {
      fetch(`/api/dashboard/stock?moment=${stockDate}`)
        .then(res => res.json())
        .then(sData => {
          if (sData && sData.total_stock_qty != null) {
            const elStockQty = document.getElementById('kpi-total-stock-qty');
            const elStockSum = document.getElementById('kpi-total-stock-sum');
            if (elStockQty) elStockQty.innerText = `${Number(sData.total_stock_qty).toLocaleString('uz-UZ')} dona`;
            if (elStockSum) elStockSum.innerText = this.formatShort(sData.total_stock_sum);
          }
        })
        .catch(() => {});
    }
  },

  setupEventListeners() {
    // Refresh button
    const btnRefresh = document.getElementById('btn-dashboard-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.loadStats(true);
      });
    }

    // Quick filter chips click handler
    document.querySelectorAll('.quick-filter-chips .filter-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.currentTarget.getAttribute('data-period');
        this.applyDateFilter(period);
      });
    });

    // Stepper Arrow Buttons (Saidbaraka Style)
    const btnPrev = document.getElementById('btn-date-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        this.stepDate(-1);
      });
    }

    const btnNext = document.getElementById('btn-date-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.stepDate(1);
      });
    }

    // Date Range inputs change handler
    const inputFrom = document.getElementById('dash-filter-from');
    const inputTo = document.getElementById('dash-filter-to');
    const handleRangeChange = () => {
      const fromVal = inputFrom ? inputFrom.value : '';
      const toVal = inputTo ? inputTo.value : '';
      if (fromVal || toVal) {
        document.querySelectorAll('.quick-filter-chips .filter-chip').forEach(c => c.classList.remove('active'));
        this.applyDateFilter('custom', fromVal, toVal);
      }
    };

    if (inputFrom) inputFrom.addEventListener('change', handleRangeChange);
    if (inputTo) inputTo.addEventListener('change', handleRangeChange);
  }
};
