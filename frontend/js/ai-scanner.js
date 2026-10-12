// AI Invoice Scanner using Google Gemini 3.8 Flash
const AIScanner = {
  selectedFile: null,
  scannedRows: [],
  isAnalyzing: false,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const dropzone = document.getElementById('ai-dropzone');
    const fileInput = document.getElementById('ai-file-input');
    const btnOpen = document.getElementById('btn-open-ai-modal');
    const btnClose = document.getElementById('btn-close-ai-modal');
    const btnCancel = document.getElementById('btn-cancel-ai');
    const btnStart = document.getElementById('btn-start-ai-scan');
    const btnReselect = document.getElementById('btn-ai-reselect');
    const btnRotate = document.getElementById('btn-ai-rotate');
    const btnApply = document.getElementById('btn-apply-ai-rows');

    btnOpen?.addEventListener('click', () => this.openModal());
    btnClose?.addEventListener('click', () => this.closeModal());
    btnCancel?.addEventListener('click', () => this.closeModal());

    // Drag & Drop
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handleFileSelected(e.dataTransfer.files[0]);
        }
      });
    }

    // File and Camera inputs change
    const cameraInput = document.getElementById('ai-camera-input');
    [fileInput, cameraInput].forEach(inp => {
      inp?.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleFileSelected(e.target.files[0]);
        }
      });
    });

    // Reselect image
    btnReselect?.addEventListener('click', () => {
      this.resetToDropzone();
    });

    // Rotate image 90 degrees
    btnRotate?.addEventListener('click', () => {
      this.rotateSelectedImage();
    });

    // Start Analysis button
    btnStart?.addEventListener('click', () => {
      this.startAnalysis();
    });

    // Apply rows to table
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
    this.selectedFile = null;
    this.scannedRows = [];
    this.isAnalyzing = false;

    const dropzone = document.getElementById('ai-dropzone');
    const previewZone = document.getElementById('ai-preview-zone');
    const loadingZone = document.getElementById('ai-loading-zone');
    const resultsZone = document.getElementById('ai-results-zone');
    const btnStart = document.getElementById('btn-start-ai-scan');
    const btnApply = document.getElementById('btn-apply-ai-rows');
    const fileInput = document.getElementById('ai-file-input');

    if (dropzone) dropzone.style.display = 'flex';
    if (previewZone) previewZone.style.display = 'none';
    if (loadingZone) loadingZone.style.display = 'none';
    if (resultsZone) resultsZone.style.display = 'none';

    if (btnStart) {
      btnStart.style.display = 'inline-flex';
      btnStart.disabled = true;
      btnStart.style.opacity = '0.6';
      btnStart.innerHTML = '⚡ Tahlilni boshlash';
    }

    const container1000 = document.getElementById('ai-multiply-1000-container');
    if (container1000) container1000.style.display = 'none';

    if (btnApply) btnApply.style.display = 'none';
    if (fileInput) fileInput.value = '';
    const cameraInput = document.getElementById('ai-camera-input');
    if (cameraInput) cameraInput.value = '';
  },

  resetToDropzone() {
    this.selectedFile = null;
    const dropzone = document.getElementById('ai-dropzone');
    const previewZone = document.getElementById('ai-preview-zone');
    const loadingZone = document.getElementById('ai-loading-zone');
    const resultsZone = document.getElementById('ai-results-zone');
    const btnStart = document.getElementById('btn-start-ai-scan');
    const btnApply = document.getElementById('btn-apply-ai-rows');
    const fileInput = document.getElementById('ai-file-input');

    if (dropzone) dropzone.style.display = 'flex';
    if (previewZone) previewZone.style.display = 'none';
    if (loadingZone) loadingZone.style.display = 'none';
    if (resultsZone) resultsZone.style.display = 'none';

    if (btnStart) {
      btnStart.style.display = 'inline-flex';
      btnStart.disabled = true;
      btnStart.style.opacity = '0.6';
      btnStart.innerHTML = '⚡ Tahlilni boshlash';
    }
    const container1000 = document.getElementById('ai-multiply-1000-container');
    if (container1000) container1000.style.display = 'none';

    if (btnApply) btnApply.style.display = 'none';
    if (fileInput) fileInput.value = '';
    const cameraInput = document.getElementById('ai-camera-input');
    if (cameraInput) cameraInput.value = '';
  },

  handleFileSelected(file) {
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert("Iltimos, faqat rasm faylini yuklang (JPG, PNG, WEBP).");
      return;
    }

    this.selectedFile = file;

    // Show preview zone, hide dropzone
    const dropzone = document.getElementById('ai-dropzone');
    const previewZone = document.getElementById('ai-preview-zone');
    const previewImg = document.getElementById('ai-preview-img');
    const filenameEl = document.getElementById('ai-filename');
    const filesizeEl = document.getElementById('ai-filesize');
    const btnStart = document.getElementById('btn-start-ai-scan');

    if (dropzone) dropzone.style.display = 'none';
    if (previewZone) previewZone.style.display = 'block';

    if (previewImg) {
      previewImg.src = URL.createObjectURL(file);
    }
    if (filenameEl) {
      filenameEl.textContent = file.name;
    }
    if (filesizeEl) {
      const sizeKb = (file.size / 1024).toFixed(1);
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      filesizeEl.textContent = file.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
    }

    // Enable start scan button
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.style.opacity = '1';
      btnStart.innerHTML = '⚡ Tahlilni boshlash';
    }
  },

  rotateSelectedImage() {
    if (!this.selectedFile) return;

    const img = new Image();
    const objectUrl = URL.createObjectURL(this.selectedFile);
    img.src = objectUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(90 * Math.PI / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      canvas.toBlob((blob) => {
        if (!blob) return;
        this.selectedFile = new File([blob], this.selectedFile.name, { type: 'image/jpeg' });
        const previewImg = document.getElementById('ai-preview-img');
        if (previewImg) previewImg.src = URL.createObjectURL(blob);
        const filesizeEl = document.getElementById('ai-filesize');
        if (filesizeEl) {
          const sizeKb = (blob.size / 1024).toFixed(1);
          filesizeEl.textContent = `${sizeKb} KB (90° burildi)`;
        }
      }, 'image/jpeg', 0.92);
    };
  },

  async startAnalysis() {
    if (!this.selectedFile) {
      // If no file yet, open file picker
      document.getElementById('ai-file-input')?.click();
      return;
    }

    if (this.isAnalyzing) return;
    this.isAnalyzing = true;

    const previewZone = document.getElementById('ai-preview-zone');
    const loadingZone = document.getElementById('ai-loading-zone');
    const resultsZone = document.getElementById('ai-results-zone');
    const btnStart = document.getElementById('btn-start-ai-scan');

    if (previewZone) previewZone.style.display = 'none';
    if (resultsZone) resultsZone.style.display = 'none';
    if (loadingZone) loadingZone.style.display = 'flex';

    if (btnStart) {
      btnStart.disabled = true;
      btnStart.innerHTML = '<span class="ai-btn-spinner"></span> Tahlil qilinmoqda...';
    }

    const formData = new FormData();
    formData.append('file', this.selectedFile);

    try {
      const resp = await fetch('/api/ai/scan-invoice', {
        method: 'POST',
        body: formData
      });

      const data = await resp.json();

      if (loadingZone) loadingZone.style.display = 'none';
      this.isAnalyzing = false;

      if (resp.ok && data.status === 'success' && data.rows && data.rows.length > 0) {
        this.scannedRows = data.rows;
        this.scannedMeta = {
          kontragent: data.kontragent || '',
          phone: data.phone || '',
          date: data.date || ''
        };
        this.renderResults(data.rows, this.scannedMeta);
      } else {
        const errorMsg = data.message || "Rasmda tovar qatorlarini aniqlab bo'lmadi. Iltimos, tiniqroq rasm yuklang.";
        alert(errorMsg);
        if (typeof showToast === 'function') {
          showToast(errorMsg, 'error');
        }
        if (previewZone) previewZone.style.display = 'block';
        if (btnStart) {
          btnStart.disabled = false;
          btnStart.innerHTML = '⚡ Qayta tahlil qilish';
        }
      }
    } catch (e) {
      console.error("AI scan error:", e);
      if (loadingZone) loadingZone.style.display = 'none';
      this.isAnalyzing = false;
      const networkMsg = "Rasmni tahlil qilishda server yoki tarmoq xatosi yuz berdi.";
      alert(networkMsg);
      if (typeof showToast === 'function') {
        showToast(networkMsg, 'error');
      }
      if (previewZone) previewZone.style.display = 'block';
      if (btnStart) {
        btnStart.disabled = false;
        btnStart.innerHTML = '⚡ Qayta tahlil qilish';
      }
    }
  },

  renderResults(rows, meta = {}) {
    const resultsZone = document.getElementById('ai-results-zone');
    const resultsBadge = document.getElementById('ai-results-badge');
    const tbody = document.getElementById('ai-results-tbody');
    const btnStart = document.getElementById('btn-start-ai-scan');
    const btnApply = document.getElementById('btn-apply-ai-rows');

    if (resultsZone) resultsZone.style.display = 'block';
    if (resultsBadge) {
      let badgeText = `✨ ${rows.length} ta tovar qatori aniqlandi`;
      if (meta.kontragent) {
        badgeText += ` | 🤝 Kontragent: <b>${meta.kontragent}</b>`;
      }
      if (meta.phone) {
        badgeText += ` | 📞 Tel: <b>${meta.phone}</b>`;
      }
      resultsBadge.innerHTML = badgeText;
    }

    if (btnStart) btnStart.style.display = 'none';
    if (btnApply) btnApply.style.display = 'inline-flex';

    // Auto-detect wholesale pricing (if average price < 1500 UZS, auto-check x1000 checkbox)
    const container1000 = document.getElementById('ai-multiply-1000-container');
    const chk1000 = document.getElementById('ai-chk-multiply-1000');
    if (container1000 && chk1000) {
      container1000.style.display = 'flex';
      const pricesWithVal = rows.map(r => r.price_buy || r.price_sale || 0).filter(p => p > 0);
      const avgPrice = pricesWithVal.length > 0 ? (pricesWithVal.reduce((a, b) => a + b, 0) / pricesWithVal.length) : 0;
      chk1000.checked = avgPrice > 0 && avgPrice < 1500;
    }

    if (!tbody) return;

    let html = '';
    rows.forEach((r, i) => {
      const conf = Math.round((r.ai_confidence || 1.0) * 100);
      const confBadgeClass = conf >= 85 ? 'badge-synced' : 'badge-local';

      html += `
        <tr>
          <td style="color: var(--text-muted); text-align: center;">${i + 1}</td>
          <td>
            <b>${r.product_type || '-'}</b>
            ${r.ai_ambiguous && r.ai_alternative ? `
              <div style="font-size: 0.72rem; color: #fbbf24; margin-top: 2px; display: flex; align-items: center; gap: 3px;">
                <span>⚠️</span>
                <span>Variant: <b>${r.ai_alternative}</b></span>
              </div>
            ` : ''}
          </td>
          <td><span style="font-family: monospace; font-size: 0.75rem;">${r.articul || r.model_code || '-'}</span></td>
          <td>${r.brand || '-'}</td>
          <td><span class="kbd">${r.size || 'M'}</span></td>
          <td style="text-align: right; font-weight: 700;">
            ${r.quantity}
            ${r.raw_quantity && r.raw_quantity !== String(r.quantity) ? `<small style="display: block; font-size: 0.68rem; color: var(--text-muted); font-weight: normal;">${r.raw_quantity}</small>` : ''}
          </td>
          <td style="text-align: right; color: var(--text-muted);">${(r.price_buy || 0).toLocaleString()}</td>
          <td style="text-align: right; color: #38bdf8; font-weight: 700;">${(r.price_sale || 0).toLocaleString()}</td>
          <td style="text-align: center;">
            <span class="badge ${confBadgeClass}" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">
              ${conf}%
            </span>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  },

  applyRowsToGrid() {
    if (!this.scannedRows || this.scannedRows.length === 0) return;

    // Auto-select Counterparty if identified from invoice
    if (this.scannedMeta && this.scannedMeta.kontragent) {
      const cpSelect = document.getElementById('header-counterparty');
      if (cpSelect) {
        const needle = this.scannedMeta.kontragent.trim().toLowerCase();
        for (let i = 0; i < cpSelect.options.length; i++) {
          const optText = cpSelect.options[i].text.toLowerCase();
          if (optText.includes(needle) || needle.includes(optText)) {
            cpSelect.selectedIndex = i;
            break;
          }
        }
      }
    }

    // Auto-set Date if valid datetime
    if (this.scannedMeta && this.scannedMeta.date) {
      const dateInput = document.getElementById('header-date');
      if (dateInput && !dateInput.value) {
        try {
          const d = new Date(this.scannedMeta.date);
          if (!isNaN(d.getTime())) {
            dateInput.value = d.toISOString().slice(0, 16);
          }
        } catch (_) {}
      }
    }

    // Check if x1000 multiplier should be applied
    const chk1000 = document.getElementById('ai-chk-multiply-1000');
    const shouldMultiply1000 = chk1000 && chk1000.checked;

    // Normalize: If description is a color name, move to color and keep description clean!
    const allColors = (typeof References !== 'undefined' && References.data && References.data.colors) || [];
    this.scannedRows.forEach(r => {
      // Multiply by 1000 if user opted in
      if (shouldMultiply1000) {
        if (r.price_buy !== undefined && r.price_buy !== null && parseFloat(r.price_buy) > 0) {
          r.price_buy = Math.round(parseFloat(r.price_buy) * 1000);
        }
        if (r.price_sale !== undefined && r.price_sale !== null && parseFloat(r.price_sale) > 0) {
          r.price_sale = Math.round(parseFloat(r.price_sale) * 1000);
        }
      }

      // Ensure factory_code (Kod modeli / Zavod artikuli) is set
      const rawCode = r.factory_code || r.model_code || '';
      r.factory_code = rawCode;
      r.model_code = rawCode;

      const descClean = (r.description || '').trim();
      if (descClean) {
        const isColor = allColors.some(c => (typeof c === 'object' ? c.name : c).toLowerCase() === descClean.toLowerCase());
        if (isColor) {
          if (!r.color) r.color = descClean;
          if (!r.colors || r.colors.length === 0) r.colors = [descClean];
          r.description = '';
        }
      }
      if (r.color && (!r.colors || r.colors.length === 0)) {
        r.colors = [r.color];
      }
    });

    // Filter out initial blank rows from grid if user hasn't typed in them
    const existingUsefulRows = (typeof Grid !== 'undefined' && Grid.rows) 
      ? Grid.rows.filter(r => r.product_type || r.price_buy > 0) 
      : [];
    
    if (typeof Grid !== 'undefined') {
      Grid.rows = [...existingUsefulRows, ...this.scannedRows];
      Grid.recalculateAll();
      Grid.render();
      Grid.triggerAutoSave();
    }

    this.closeModal();
    if (typeof showToast === 'function') {
      const cpNotice = this.scannedMeta?.kontragent ? ` (Kontragent: ${this.scannedMeta.kontragent})` : '';
      const multNotice = shouldMultiply1000 ? " [x1000 qo'shildi]" : "";
      showToast(`✨ ${this.scannedRows.length} ta tovar qatori${cpNotice}${multNotice} jadvalga muvaffaqiyatli joylandi!`, 'success');
    }
  }
};
