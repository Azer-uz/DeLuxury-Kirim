// password-eye.js — barcha parol maydonlariga "ko'z" tugmasi (ko'rsatish / yashirish).
// Avtomatik: sahifadagi va keyin qo'shilgan (modal, JS forma) har bir input[type=password] ga ulanadi.
// Ulash: <script src="/js/password-eye.js"></script> — boshqa hech narsa kerak emas.
(function () {
  if (window.__pwEyeInstalled) return;
  window.__pwEyeInstalled = true;

  var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  var style = document.createElement("style");
  style.textContent =
    ".pw-eye-wrap{position:relative;display:block;vertical-align:middle;max-width:100%;}" +
    ".pw-eye-wrap>input{padding-right:46px!important;}" +
    ".pw-eye-btn{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:none;background:transparent;" +
    "color:inherit;opacity:.55;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;padding:0;margin:0;line-height:0;}" +
    ".pw-eye-btn:hover,.pw-eye-btn:focus-visible{opacity:1;outline:none;background:rgba(127,127,127,.12);}";
  document.head.appendChild(style);

  function attach(input) {
    if (input.dataset.pwEye) return;
    input.dataset.pwEye = "1";
    var wrap = document.createElement("span");
    wrap.className = "pw-eye-wrap";
    // inputning tashqi margin'i o'ramga o'tadi (joylashuv o'zgarmasin)
    var cs = window.getComputedStyle(input);
    wrap.style.marginBottom = cs.marginBottom; wrap.style.marginTop = cs.marginTop;
    input.style.marginBottom = "0"; input.style.marginTop = "0";
    if (input.style.flex) { wrap.style.flex = input.style.flex; input.style.flex = ""; }
    // O'ram inputning joyini aynan egallaydi: to'liq kenglikdagi input → 100%, kichik input → o'z kengligi (px)
    var parentW = input.parentNode.clientWidth || 0, w = input.offsetWidth || 0;
    if (cs.display === "block" || cs.display === "flex" || (parentW && w >= parentW - 4)) wrap.style.width = "100%";
    else if (w) wrap.style.width = w + "px";
    if (cs.display !== "block" && cs.display !== "flex") wrap.style.display = "inline-block";
    input.style.width = "100%"; input.style.boxSizing = "border-box";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "pw-eye-btn"; btn.tabIndex = -1;
    btn.setAttribute("aria-label", "Parolni ko'rsatish"); btn.title = "Parolni ko'rsatish / yashirish";
    btn.innerHTML = EYE;
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });   // fokus inputda qolsin
    btn.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Parolni yashirish" : "Parolni ko'rsatish");
      try { input.focus(); var v = input.value; input.setSelectionRange(v.length, v.length); } catch (e) {}
    });
    wrap.appendChild(btn);
  }

  function scan(root) {
    var list = (root && root.querySelectorAll ? root : document).querySelectorAll("input[type=password]:not([data-pw-eye])");
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) scan(added[j]);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
