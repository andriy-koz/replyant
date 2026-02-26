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

  // --- Mobile menu ---
  var toggle = document.querySelector('.mobile-toggle');
  var mobileMenu = document.querySelector('.mobile-menu');
  if (!toggle || !mobileMenu) return;

  function closeMenu() {
    mobileMenu.classList.remove('active');
    header.classList.remove('menu-open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
    mobileMenu.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
  }

  function openMenu() {
    mobileMenu.classList.add('active');
    header.classList.add('menu-open');
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
    mobileMenu.setAttribute('aria-hidden', 'false');
    document.body.classList.add('menu-open');
  }

  toggle.addEventListener('click', function() {
    if (mobileMenu.classList.contains('active')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close on nav link click
  mobileMenu.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', closeMenu);
  });

  // Close on overlay background click (not on links)
  mobileMenu.addEventListener('click', function(e) {
    if (!e.target.closest('a')) closeMenu();
  });

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeMenu();
  });

  // Close menu if viewport resizes past mobile breakpoint
  window.matchMedia('(max-width: 768px)').addEventListener('change', function(e) {
    if (!e.matches) closeMenu();
  });
})();
