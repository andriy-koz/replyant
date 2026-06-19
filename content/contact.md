---
title: "Contact"
description: "Tell us about your AI initiative. Replyant designs and ships agents and automation that move real business metrics — usually in 6-12 weeks."
---

Tell us about your AI initiative. We reply within one business day, and the first conversation is always with an engineer — not a sales rep.

Useful detail to share: the workflow you want to change, the metric you want to move, and the constraints you are working inside. The more concrete the picture, the more useful the first call.

<div class="contact-grid">
  <form id="contact-form" class="contact-form" data-api="{{< param "leadsAPI" >}}">
    <input type="hidden" name="source" value="contact">

    <label for="contact-name">Your name <span aria-hidden="true">*</span></label>
    <input type="text" id="contact-name" name="name" required placeholder="Full name" autocomplete="name">

    <label for="contact-email">Work email <span aria-hidden="true">*</span></label>
    {{/* Placeholder avoids email-like strings that Cloudflare's Email Address Obfuscation auto-wraps. */}}
    <input type="email" id="contact-email" name="email" required placeholder="Work email address" autocomplete="email">

    <label for="contact-company">Company</label>
    <input type="text" id="contact-company" name="company" placeholder="Company or team" autocomplete="organization">

    <label for="contact-project-type">Project type</label>
    <select id="contact-project-type" name="project_type">
      <option value="AI Agents">AI Agents</option>
      <option value="Automation">Automation</option>
      <option value="Strategy">Strategy</option>
      <option value="Other">Other</option>
    </select>

    <label for="contact-message">What are you trying to build? <span aria-hidden="true">*</span></label>
    <textarea id="contact-message" name="message" rows="6" required placeholder="The workflow, the metric, the constraints."></textarea>

    <div class="lead-hp" aria-hidden="true" tabindex="-1" style="position:absolute; left:-9999px; opacity:0; height:0; width:0; overflow:hidden;">
      <label for="contact-website">Website</label>
      <input type="text" id="contact-website" name="website" autocomplete="off" tabindex="-1">
    </div>

    <button type="submit" class="btn btn-primary">Send the brief</button>
    <p class="lead-msg lead-msg--success" hidden>Got it — we will reply within one business day.</p>
    <p class="lead-msg lead-msg--error" hidden>Something went wrong. Please try again, or email us directly.</p>
  </form>

  <aside class="contact-aside">
    <h2 class="contact-aside-heading">Prefer a calendar?</h2>
    <!-- TODO: Replace with Cal.com / Calendly iframe. Example: -->
    <!-- <iframe src="https://cal.com/replyant/intro" width="100%" height="600" frameborder="0"></iframe> -->
    <div class="calendar-placeholder">
      <p>Prefer to book directly? <a href="mailto:hello@replyant.com">Email us</a> and we will send a calendar link.</p>
    </div>

    <h2 class="contact-aside-heading">What to expect</h2>
    <ul class="contact-list">
      <li><strong>Reply within one business day.</strong> Usually faster.</li>
      <li><strong>First call: 30 minutes with an engineer.</strong> No deck, no scripted pitch.</li>
      <li><strong>If we are not the right fit, we will say so.</strong> And point you somewhere that is.</li>
    </ul>
  </aside>
</div>

<script>
(function () {
  var form = document.getElementById('contact-form');
  if (!form) return;

  var msgOk = form.querySelector('.lead-msg--success');
  var msgErr = form.querySelector('.lead-msg--error');
  var loadedAt = Date.now();
  var cooldown = false;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (form.website.value) return;
    if (Date.now() - loadedAt < 2000) return;
    if (cooldown) return;

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    var originalLabel = btn.textContent;
    btn.textContent = 'Sending…';
    msgOk.hidden = true;
    msgErr.hidden = true;

    fetch(form.dataset.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'contact',
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        company: form.company.value.trim(),
        project_type: form.project_type.value,
        message: form.message.value.trim()
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        form.reset();
        msgOk.hidden = false;
      })
      .catch(function () {
        msgErr.hidden = false;
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = originalLabel;
        cooldown = true;
        setTimeout(function () { cooldown = false; }, 30000);
      });
  });
})();
</script>
