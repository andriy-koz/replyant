(function() {
  var header = document.querySelector('.site-header');
  if (!header) return;

  var sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:50px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);

  var observer = new IntersectionObserver(function(entries) {
    header.classList.toggle('scrolled', !entries[0].isIntersecting);
  });
  observer.observe(sentinel);
})();
