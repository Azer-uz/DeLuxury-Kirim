// Kirish (Login) — MoySklad login/paroli bilan. Xodimlarni admin MoySklad'da yaratadi va parolini o'sha yerda o'zgartiradi.
const Auth = {
  user: null,
  _waiters: [],

  async ensureLoggedIn() {
    try {
      const resp = await Auth._rawFetch('/api/auth/me');
      if (resp.ok) {
        const data = await resp.json();
        this.setUser(data.user);
        return this.user;
      }
    } catch (e) {
      console.warn("Auth check failed:", e);
    }
    return this.showLogin();
  },

  showLogin(message = '') {
    let overlay = document.getElementById('auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,0.92);backdrop-filter:blur(6px);';
      overlay.innerHTML = `
        <form id="auth-form" autocomplete="on" style="width:100%;max-width:360px;background:var(--bg-card, #0f172a);border:1px solid var(--border-subtle, #334155);border-radius:14px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          <div class="brand-badge" id="auth-brand" style="margin-bottom:6px;">KIRIM</div>
          <h3 style="margin:0 0 4px;font-size:1.15rem;color:var(--text-main, #f8fafc);">Tizimga kirish</h3>
          <p style="margin:0 0 18px;font-size:0.8rem;color:var(--text-muted, #94a3b8);">MoySklad login va parolingiz bilan kiring</p>
          <label class="form-label" for="auth-login">Login</label>
          <input class="form-control" id="auth-login" name="username" autocomplete="username" placeholder="admin@dokon" required style="margin-bottom:12px;">
          <label class="form-label" for="auth-password">Parol</label>
          <input class="form-control" id="auth-password" name="password" type="password" autocomplete="current-password" required style="margin-bottom:14px;">
          <div id="auth-error" style="display:none;margin-bottom:12px;font-size:0.8rem;color:#f87171;"></div>
          <button type="submit" class="btn btn-gold" id="auth-submit" style="width:100%;justify-content:center;">Kirish</button>
        </form>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#auth-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitLogin();
      });
    }
    overlay.style.display = 'flex';
    const errEl = overlay.querySelector('#auth-error');
    errEl.textContent = message;
    errEl.style.display = message ? 'block' : 'none';
    setTimeout(() => overlay.querySelector('#auth-login')?.focus(), 50);
    return new Promise(resolve => this._waiters.push(resolve));
  },

  async submitLogin() {
    const overlay = document.getElementById('auth-overlay');
    const btn = overlay.querySelector('#auth-submit');
    const errEl = overlay.querySelector('#auth-error');
    btn.disabled = true;
    btn.textContent = 'Tekshirilmoqda...';
    try {
      const resp = await Auth._rawFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: overlay.querySelector('#auth-login').value,
          password: overlay.querySelector('#auth-password').value
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        errEl.textContent = data.detail || 'Kirishda xatolik';
        errEl.style.display = 'block';
        return;
      }
      overlay.querySelector('#auth-password').value = '';
      overlay.style.display = 'none';
      this.setUser(data.user);
      const waiters = this._waiters.splice(0);
      waiters.forEach(w => w(this.user));
    } catch (e) {
      errEl.textContent = "Server bilan bog'lanib bo'lmadi";
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kirish';
    }
  },

  setUser(user) {
    this.user = user;
    if (!user) return;
    const initials = (user.name || user.login || '?').trim().charAt(0).toUpperCase();
    document.querySelectorAll('.user-avatar').forEach(el => { el.textContent = initials; });
    document.querySelectorAll('.user-name').forEach(el => { el.textContent = user.name || user.login; });
    document.querySelectorAll('.user-role').forEach(el => { el.textContent = `${user.is_admin ? 'Administrator' : 'Omborchi'} ▾`; });
    const header = document.querySelector('.admin-dropdown-header');
    if (header) {
      header.innerHTML = `
        <div style="font-weight: 700; color: #fbbf24; font-size: 0.88rem;"></div>
        <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 1px;"></div>`;
      header.children[0].textContent = user.name || user.login;
      header.children[1].textContent = `${user.login} • ${user.is_admin ? 'Administrator' : 'Omborchi'}`;
    }
  },

  async logout() {
    try {
      await Auth._rawFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.reload();
    }
  }
};

// Sessiya tugasa (401) — login oynasini qayta ko'rsatamiz; foydalanuvchi kirgach amalni qaytaradi
Auth._rawFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const resp = await Auth._rawFetch(input, init);
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (resp.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    Auth.showLogin("Sessiya tugadi. Qaytadan kiring.");
  }
  return resp;
};
