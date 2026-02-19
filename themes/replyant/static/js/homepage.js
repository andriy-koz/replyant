(function() {
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach(function(el) {
      el.classList.add('revealed');
    });
    return;
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach(function(el) {
    observer.observe(el);
  });

  // Handle bfcache (back button)
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) {
      document.querySelectorAll('.reveal').forEach(function(el) {
        el.classList.add('revealed');
      });
    }
  });
})();
