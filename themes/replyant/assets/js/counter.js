(function() {
  var statNumbers = document.querySelectorAll('.stat-number[data-count]');
  if (!statNumbers.length) return;

  // Skip animation for reduced motion — keep original text
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCount(el, target, suffix, delay) {
    setTimeout(function() {
      var duration = 1600;
      var start = performance.now();

      function update(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        var current = Math.round(easeOutCubic(progress) * target);
        el.textContent = current + suffix;
        if (progress < 1) requestAnimationFrame(update);
      }

      requestAnimationFrame(update);
    }, delay);
  }

  var counted = false;
  var countObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting && !counted) {
        counted = true;
        statNumbers.forEach(function(el, i) {
          var target = parseInt(el.getAttribute('data-count'), 10);
          var suffix = el.getAttribute('data-suffix') || '';
          el.textContent = '0' + suffix;
          animateCount(el, target, suffix, i * 200);
        });
        countObserver.disconnect();
      }
    });
  }, { threshold: 0.3 });

  var statBar = document.querySelector('.stat-bar');
  if (statBar) countObserver.observe(statBar);
})();
