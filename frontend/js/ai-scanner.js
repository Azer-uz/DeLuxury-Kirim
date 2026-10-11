// AI Invoice Scanner using Google Gemini Flash
const AIScanner = {
  scannedRows: [],

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const dropzone = document.getElementById('ai-dropzone');
    const fileInput = document.getElementById('ai-file-input');
    const btnOpen = document.getElementById('btn-open-ai-modal');
    const btnClose = document.getElementById('btn-close-ai-modal');
    const btnCancel = document.getElementById('btn-cancel-ai');
    const btnApply = document.getElementById('btn-apply-ai-rows');

    btnOpen?.addEventListener('click', () => this.openModal());
    btnClose?.addEventListener('click', () => this.closeModal());
    btnCancel?.addEventListener('click', () => this.closeModal());

    // Drag & Drop
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.processFile(e.dataTransfer.files[0]);
      }
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.processFile(e.target.files[0]);
      }
    });

    btnApply?.addEventListener('click', () => {
      this.applyRowsToGrid();
    });
  },

  openModal() {
    const modal = document.getElementById('modal-ai-scanner');
    if (modal) modal.classList.add('active');
    this.resetState();
  },

  closeModal() {
    const modal = document.getElementById('modal-ai-scanner');
    if (modal) modal.classList.remove('active');
  },

  resetState() {
    this.scannedRows = [];
    document.getElementById('ai-dropzone').style.display = 'flex';
    document.getElementById('ai-progress-state').style.display = 'none';
    document.getElementById('ai-results-preview').style.display = 'none';
    document.getElementById('btn-apply-ai-rows').style.display = 'none';
    const fileInput = document.getElementById('ai-file-input');
    if (fileInput) fileInput.value = '';
  },

  async processFile(file) {
    if (!file) return;

    // Show progress
    document.getElementById('ai-dropzone').style.display = 'none';
    document.getElementById('ai-progress-state').style.display = 'block';
    document.getElementById('ai-progress-text').textContent = `Gemini AI "${file.name}" rasmini o'qimoqda...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/api/ai/scan-invoice', {
        method: 'POST',
        body: formData
      });

      const data = await resp.json();

      document.getElementById('ai-progress-state').style.display = 'none';

      if (resp.ok && data.status === 'success' && data.rows && data.rows.length > 0) {
        this.scannedRows = data.rows;
        this.renderPreview(data.rows);
      } else {
        alert(data.message || "Rasmda tovar qatorlarini aniqlab bo'lmadi.");
        document.getElementById('ai-dropzone').style.display = 'flex';
      }
    } catch (e) {
      console.error("AI scan error:", e);
      alert("Rasmni tahlil qilishda tarmoq xatosi yuz berdi.");
      document.getElementById('ai-progress-state').style.display = 'none';
      document.getElementById('ai-dropzone').style.display = 'flex';
    }
  },

  renderPreview(rows) {
    document.getElementById('ai-results-preview').style.display = 'block';
    document.getElementById('btn-apply-ai-rows').style.display = 'inline-flex';
    document.getElementById('ai-detected-count').textContent = rows.length;

    const tbody = document.getElementById('ai-preview-tbody');
    let html = '';

    rows.forEach((r, i) => {
      const conf = Math.round((r.ai_confidence || 1.0) * 100);
      const confColor = conf >= 85 ? '#34d399' : '#fbbf24';

      html += `
        <tr>
          <td><b>${r.product_type || '-'}</b></td>
          <td>${r.brand || '-'}</td>
          <td><span class="kbd">${r.size || 'M'}</span></td>
          <td>${r.description || '-'}</td>
          <td style="text-align: right;"><b>${r.quantity}</b></td>
          <td style="text-align: right;">$${(r.price_buy || 0).toFixed(2)}</td>
          <td style="text-align: right; color: #38bdf8;">$${(r.price_sale || 0).toFixed(2)}</td>
          <td><span style="color: ${confColor}; font-weight: 600;">${conf}%</span></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  },

  applyRowsToGrid() {
    if (!this.scannedRows || this.scannedRows.length === 0) return;

    // Normalize: If description is a color name, move to color and keep description clean!
    const allColors = (typeof References !== 'undefined' && References.data && References.data.colors) || [];
    this.scannedRows.forEach(r => {
      const descClean = (r.description || '').trim();
      if (descClean) {
        const isColor = allColors.some(c => (typeof c === 'object' ? c.name : c).toLowerCase() === descClean.toLowerCase());
        if (isColor) {
          if (!r.color) r.color = descClean;
          if (!r.colors || r.colors.length === 0) r.colors = [descClean];
          r.description = ''; // Rang opisaniyada qolmasligi kerak!
        }
      }
      if (r.color && (!r.colors || r.colors.length === 0)) {
        r.colors = [r.color];
      }
    });

    // Filter out initial blank rows from grid if user hasn't typed in them
    const existingUsefulRows = Grid.rows.filter(r => r.product_type || r.price_buy > 0);
    
    Grid.rows = [...existingUsefulRows, ...this.scannedRows];
    Grid.recalculateAll();
    Grid.render();
    Grid.triggerAutoSave();

    this.closeModal();
    showToast(`✨ ${this.scannedRows.length} ta tovar qatori AI orqali jadvalga muvaffaqiyatli joylandi!`, 'success');
  }
};
