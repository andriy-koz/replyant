(function () {
  var form = document.getElementById('lead-form');
  if (!form) return;

  var msgOk = form.parentElement.querySelector('.lead-msg--success');
  var msgErr = form.parentElement.querySelector('.lead-msg--error');
  var loadedAt = Date.now();
  var cooldown = false;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Honeypot — bots fill hidden fields
    if (form.website.value) return;

    // Timing — reject submissions faster than 2 seconds
    if (Date.now() - loadedAt < 2000) return;

    // Rate limit — one submission per 30 seconds
    if (cooldown) return;

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Sending\u2026';
    msgOk.hidden = true;
    msgErr.hidden = true;

    fetch(form.dataset.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim()
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        form.reset();
        form.hidden = true;
        msgOk.hidden = false;
      })
      .catch(function () {
        msgErr.hidden = false;
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Send It to Me';
        cooldown = true;
        setTimeout(function () { cooldown = false; }, 30000);
      });
  });
})();
