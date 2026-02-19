(function() {
  var header = document.querySelector('.site-header');
  if (!header) return;
  var scrolled = false;
  function onScroll() {
    var shouldBeScrolled = window.scrollY > 50;
    if (shouldBeScrolled !== scrolled) {
      scrolled = shouldBeScrolled;
      header.classList.toggle('scrolled', scrolled);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
