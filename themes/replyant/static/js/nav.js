(function() {
  var header = document.querySelector('.site-header');
  if (!header) return;

  // --- Scroll detection ---
  var sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:50px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);

  var observer = new IntersectionObserver(function(entries) {
    header.classList.toggle('scrolled', !entries[0].isIntersecting);
  });
  observer.observe(sentinel);

  // --- Mobile menu toggle ---
  var toggle = document.querySelector('.mobile-toggle');
  var navLinks = document.querySelector('.nav-links');
  if (!toggle || !navLinks) return;

  function closeMenu() {
    navLinks.classList.remove('active');
    header.classList.remove('menu-open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    navLinks.classList.add('active');
    header.classList.add('menu-open');
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', function() {
    if (navLinks.classList.contains('active')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close on nav link click
  navLinks.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });

  // Close on click outside
  document.addEventListener('click', function(e) {
    if (!header.contains(e.target)) closeMenu();
  });
})();
