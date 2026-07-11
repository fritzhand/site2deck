/* Deck navigation (brand-neutral).
   One <section class="slide"> per slide; total derived from the DOM.
   Keys: arrows / space / PageUp / PageDown / Home / End. Click zones:
   right 38% next, left 22% prev. URL hash (#5) deep-links a slide.
   Touch: horizontal-dominant swipes change slides; vertical scroll and
   panning inside scrollable tables (.menu) are left alone. */
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var stage = document.getElementById('stage');
  var progress = document.getElementById('progress');
  var curEl = document.getElementById('cur');
  var total = slides.length;
  document.getElementById('total').textContent = pad(total);
  var i = 0;

  // Stamp the brand lockup (top-right) onto every non-cover slide by cloning the
  // #mark-tpl template. The template's <img> is inlined by the standalone build,
  // so the clone carries the data-URI logo — works via file:// and standalone.
  var markTpl = document.getElementById('mark-tpl');
  if (markTpl) {
    slides.forEach(function (s) {
      if (s.classList.contains('cover') || s.querySelector('.mark')) return;
      s.appendChild(markTpl.content.cloneNode(true));
    });
  }

  // Footer page indicator on content slides; title/divider slides keep their line.
  slides.forEach(function (s, idx) {
    if (s.querySelector('.title-wrap')) return;
    var foot = s.querySelector('.slide-foot');
    if (!foot) return;
    var sp = foot.querySelectorAll('span');
    if (sp[1]) sp[1].textContent = 'Page ' + (idx + 1) + ' / ' + total;
  });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function show(n) {
    i = Math.max(0, Math.min(total - 1, n));
    slides.forEach(function (s, idx) { var on = idx === i; s.classList.toggle('active', on); if (on) s.scrollTop = 0; });
    curEl.textContent = pad(i + 1);
    progress.style.width = ((i + 1) / total * 100) + '%';
    if (location.hash !== '#' + (i + 1)) history.replaceState(null, '', '#' + (i + 1));
  }
  function go(d) { show(i + d); }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(total - 1); }
  });
  document.getElementById('next').addEventListener('click', function () { go(1); });
  document.getElementById('prev').addEventListener('click', function () { go(-1); });
  stage.addEventListener('click', function (e) {
    if (e.target.closest('.controls') || e.target.closest('a') || window.getSelection().toString()) return;
    var x = e.clientX / window.innerWidth;
    if (x > 0.62) go(1); else if (x < 0.22) go(-1);
  });

  var touchX = null, touchY = null, touchPan = false;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { touchX = null; return; }
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
    touchPan = !!(e.target.closest && e.target.closest('.menu'));
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (touchX === null || touchPan) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Deep-link: respond to hash changes (browser back/forward, pasted #N link).
  window.addEventListener('hashchange', function () {
    var n = parseInt((location.hash || '').replace('#', ''), 10);
    if (!isNaN(n) && n - 1 !== i) show(n - 1);
  });

  var start = parseInt((location.hash || '').replace('#', ''), 10);
  show(isNaN(start) ? 0 : start - 1);
})();
