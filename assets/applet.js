/* Shared by the teaching applets: the theme switch (the same choice as on the site) and colour helpers for canvases. */
(function () {
  var root = document.documentElement, mq = window.matchMedia('(prefers-color-scheme: dark)');
  function now() { var a = root.getAttribute('data-jpe-theme'); return a === 'dark' || a === 'light' ? a : (mq.matches ? 'dark' : 'light'); }
  function save(v) {
    ['sessionStorage', 'localStorage'].forEach(function (s) { try { if (v === null) window[s].removeItem('jpe-theme'); else window[s].setItem('jpe-theme', v); } catch (e) {} });
  }
  function changed() { document.dispatchEvent(new CustomEvent('jpe-themechange', { detail: { theme: now() } })); }
  var btn = document.getElementById('jpe-theme');
  function label() { if (btn) btn.setAttribute('aria-label', now() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); }
  label();
  if (btn) btn.addEventListener('click', function () {
    var next = now() === 'dark' ? 'light' : 'dark', sys = mq.matches ? 'dark' : 'light';
    root.setAttribute('data-jpe-theme', next);
    save(next === sys ? null : next);
    label(); changed();
  });
  if (mq.addEventListener) mq.addEventListener('change', function () { label(); changed(); });
  window.addEventListener('pageshow', function () { label(); changed(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(changed);
  // colours for canvases: a token's current value, and a colour with transparency
  window.jpeColor = function (name) { return getComputedStyle(root).getPropertyValue(name).trim(); };
  window.jpeAlpha = function (color, a) {
    var h = (color || '').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16); if (isNaN(n)) return color;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
})();
