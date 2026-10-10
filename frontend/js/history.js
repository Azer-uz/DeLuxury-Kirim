// History of Submissions
const History = {
  async load() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    try {
      const resp = await fetch('/api/documents/history');
      if (resp.ok) {
        const docs = await resp.json();
        this.render(docs);
      }
    } catch (e) {
      console.error("Error loading history:", e);
    }
  },

  render(docs) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (!docs || docs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            Hozircha saqlangan yoki yuborilgan kirim hujjatlari mavjud emas.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    docs.forEach(d => {
      const isSent = d.status === 'sent';
      const isError = d.status === 'error';
      const statusBadge = isSent 
        ? '<span class="badge badge-synced">✅ MoySklad\'ga yuklandi</span>'
        : isError 
          ? '<span class="badge badge-conflict">❌ Xatolik</span>'
          : '<span class="badge badge-local">⏳ Qoralama</span>';

      const msLink = d.moysklad_url 
        ? `<a href="${d.moysklad_url}" target="_blank" class="btn btn-secondary btn-sm" style="color: #38bdf8; text-decoration: none;">🔗 MoySklad</a>`
        : `<span style="color: var(--text-dim);">-</span>`;

      html += `
        <tr>
          <td><b>${d.doc_number || '-'}</b></td>
          <td>${d.doc_date || '-'}</td>
          <td>${d.counterparty_name || 'Noma\'lum'}</td>
          <td>${d.store_name || 'Asosiy ombor'}</td>
          <td style="text-align: right;"><b>${d.total_items} ta</b></td>
          <td style="text-align: right;">${(d.total_qty || 0).toLocaleString()} dona</td>
          <td style="text-align: right;"><b>$${(d.total_sum_buy || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</b></td>
          <td style="text-align: right; color: #38bdf8;">$${(d.total_sum_sale || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
          <td>${statusBadge}</td>
          <td>${msLink}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="History.viewDetails(${d.id})">👁️ Ko'rish</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  },

  async viewDetails(docId) {
    try {
      const resp = await fetch(`/api/documents/${docId}`);
      if (resp.ok) {
        const doc = await resp.json();
        alert(`Hujjat: ${doc.doc_number}\nPozitsiyalar soni: ${doc.total_items} ta\nKirim summasi: $${doc.total_sum_buy}\nSotish summasi: $${doc.total_sum_sale}\nHolati: ${doc.status}`);
      }
    } catch (e) {
      console.error("Error fetching doc details:", e);
    }
  }
};
