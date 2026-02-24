document.querySelectorAll('.service-card').forEach(function(card) {
  var frame = null;
  card.addEventListener('mousemove', function(e) {
    if (frame) return;
    frame = requestAnimationFrame(function() {
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
      frame = null;
    });
  });
});
