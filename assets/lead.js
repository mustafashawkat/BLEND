/* Blend: where a visitor came from, and the enquiry form.
 *
 * Shared by the home page and /start. Two jobs.
 *
 * 1. Remember where this visitor came from. A link can carry ?src=ig-bio
 *    (or utm_source / utm_campaign, which ad platforms add on their own).
 *    That is kept for 30 days in this browser, so somebody who arrives from
 *    an ad, reads for a while and fills the form in later is still counted
 *    against the ad. A visitor with no code is recorded by the site that
 *    sent them (instagram, google...) or as "direct". A later visit with a
 *    new code replaces the old one: the last thing that brought them back
 *    is the one that earned the lead.
 *
 * 2. The form. One form, two kinds of visitor: a brand, which lands in the
 *    Clients tab, or a creator, which lands in Creators. It renders itself
 *    into any element with id="lead-root"; data-type="creator" opens it on
 *    the creator side, and ?type=creator on the URL does the same.
 *
 * It posts to the Apps Script behind the Blend Leads sheet. The request goes
 * no-cors, as a plain form body, which Apps Script accepts without a
 * preflight; the browser cannot read the reply that way, so a request that
 * leaves without a network error is treated as delivered. Without an
 * endpoint it opens WhatsApp with the enquiry written out instead.
 */
(function () {
  var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbz-vNtR-vB_Zr-hJ2WsfDfNUJ0wlf06Bsixbt4okyjrc6sogoi9E250mpg2KFS23DFh/exec';
  var WHATSAPP = '201107409572';
  var KEY = 'blend_src';
  var DAYS = 30;

  /* ---------- 1. where they came from ---------- */
  function store(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function stored() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Date.now() - v.t < DAYS * 864e5) return v;
    } catch (e) {}
    return null;
  }
  function hostLabel(url) {
    try {
      var h = new URL(url).hostname.replace(/^www\./, '').replace(/^(l|lm|m)\./, '');
      if (/instagram\./.test(h)) return 'instagram';
      if (/facebook\.|fb\.me/.test(h)) return 'facebook';
      if (/google\./.test(h)) return 'google';
      if (/whatsapp|wa\.me/.test(h)) return 'whatsapp';
      if (/linkedin\./.test(h)) return 'linkedin';
      if (/tiktok\./.test(h)) return 'tiktok';
      return h;
    } catch (e) { return ''; }
  }
  var q = new URLSearchParams(location.search);
  var ref = document.referrer && document.referrer.indexOf(location.origin) !== 0
    ? hostLabel(document.referrer) : '';
  var code = q.get('src') || q.get('utm_source') || '';
  if (code) {
    var medium = q.get('utm_medium');
    store({ src: medium ? code + '/' + medium : code,
            campaign: q.get('utm_campaign') || q.get('campaign') || '',
            referrer: ref, page: location.pathname, t: Date.now() });
  } else if (!stored()) {
    store({ src: ref || 'direct', campaign: '', referrer: ref,
            page: location.pathname, t: Date.now() });
  }
  function origin() {
    return stored() || { src: ref || 'direct', campaign: '', referrer: ref, page: location.pathname };
  }

  /* ---------- 2. the form ---------- */
  var root = document.getElementById('lead-root');
  if (!root) return;
  var opened = Date.now();

  root.innerHTML =
    '<form class="lead" novalidate>' +
    ' <div class="lf-who" role="group" aria-label="Who are you?">' +
    '  <button type="button" data-who="client" aria-pressed="true">I’m a brand</button>' +
    '  <button type="button" data-who="creator" aria-pressed="false">I’m a creator</button>' +
    ' </div>' +
    ' <div class="lf-grid">' +
    '  <label>Name <input name="name" autocomplete="name" maxlength="120"></label>' +
    '  <label data-for="client">Company <input name="company" autocomplete="organization" maxlength="120"></label>' +
    '  <label data-for="creator" hidden>City or area <input name="city" autocomplete="address-level2" maxlength="80"></label>' +
    '  <label>WhatsApp <input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" placeholder="+20"></label>' +
    '  <label>Email <span class="opt">optional</span> <input name="email" type="email" autocomplete="email" maxlength="160"></label>' +
    '  <label data-for="creator" hidden>Instagram or TikTok <input name="handle" maxlength="120" placeholder="@"></label>' +
    '  <label data-for="creator" hidden>A video you made <span class="opt">a link</span> <input name="sample" type="url" inputmode="url" maxlength="300" placeholder="https://"></label>' +
    ' </div>' +
    ' <fieldset class="lf-chips" data-for="client" data-group="needs">' +
    '  <legend>What do you need?</legend>' +
    chip('needs', 'UGC video') + chip('needs', 'Web page') + chip('needs', 'Page audit') +
    chip('needs', 'Ushers and events') +
    ' </fieldset>' +
    ' <label class="lf-wide" data-for="client">Budget <span class="opt">roughly, in EGP</span>' +
    '  <select name="budget">' +
    '   <option value="">Choose one</option>' +
    '   <option>Under 10,000</option><option>10,000 to 25,000</option>' +
    '   <option>25,000 to 50,000</option><option>50,000 to 100,000</option>' +
    '   <option>Over 100,000</option><option>Not sure yet</option>' +
    '  </select></label>' +
    ' <fieldset class="lf-chips" data-for="creator" data-group="segments" hidden>' +
    '  <legend>Who are you on camera?</legend>' +
    chip('segments', 'Mother') + chip('segments', 'Father') + chip('segments', 'Adult') +
    chip('segments', 'Whole family') + chip('segments', 'Child (under 18)') +
    ' </fieldset>' +
    ' <fieldset class="lf-chips" data-for="creator" data-group="age" hidden>' +
    '  <legend>Age of the person filming</legend>' +
    radio('age', '18 or over') + radio('age', 'Under 18') +
    ' </fieldset>' +
    ' <div class="lf-parent" data-parent hidden>' +
    '  <p>Under eighteen, a parent applies, a parent signs, and a parent is on the shoot.</p>' +
    '  <div class="lf-grid">' +
    '   <label>Parent’s name <input name="parent_name" maxlength="120"></label>' +
    '   <label>Parent’s WhatsApp <input name="parent_phone" type="tel" inputmode="tel" maxlength="40" placeholder="+20"></label>' +
    '  </div>' +
    '  <label class="lf-consent"><input type="checkbox" name="parent_consent" value="yes">' +
    '   <span>I am the parent or guardian and I am the one applying.</span></label>' +
    ' </div>' +
    ' <label class="lf-wide"><span data-for="client">The product, the dates, anything we should know</span>' +
    '  <span data-for="creator" hidden>Anything else we should know</span>' +
    '  <textarea name="message" rows="4" maxlength="2000"></textarea></label>' +
    ' <div class="lf-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
    ' <button class="btn lf-send" type="submit">Send</button>' +
    ' <p class="lf-status" role="status" aria-live="polite"></p>' +
    '</form>';

  function chip(name, value) {
    return '<label><input type="checkbox" name="' + name + '" value="' + value + '"><span>' + value + '</span></label>';
  }
  function radio(name, value) {
    return '<label><input type="radio" name="' + name + '" value="' + value + '"><span>' + value + '</span></label>';
  }

  var form = root.querySelector('form');
  var f = form.elements;
  var status = form.querySelector('.lf-status');
  var send = form.querySelector('.lf-send');
  var parentBox = form.querySelector('[data-parent]');
  var who = (q.get('type') || root.getAttribute('data-type') || 'client') === 'creator' ? 'creator' : 'client';

  function say(t, bad) { status.textContent = t; status.classList.toggle('err', !!bad); }

  function setWho(w) {
    who = w;
    [].forEach.call(form.querySelectorAll('.lf-who button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-who') === w));
    });
    [].forEach.call(form.querySelectorAll('[data-for]'), function (el) {
      el.hidden = el.getAttribute('data-for') !== w;
    });
    parentBox.hidden = !(w === 'creator' && checked('age') === 'Under 18');
    say('');
    document.dispatchEvent(new CustomEvent('lead:who', { detail: w }));
  }
  function checked(name) {
    var c = form.querySelector('input[name="' + name + '"]:checked');
    return c ? c.value : '';
  }
  function all(name) {
    return [].slice.call(form.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (c) { return c.value; }).join(', ');
  }
  function mark(el, bad) { el.setAttribute('aria-invalid', bad ? 'true' : 'false'); return bad; }

  form.addEventListener('click', function (e) {
    var b = e.target.closest('.lf-who button');
    if (b) setWho(b.getAttribute('data-who'));
  });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'age') parentBox.hidden = e.target.value !== 'Under 18';
    if (e.target.name === 'age') form.querySelector('[data-group=age]').classList.remove('bad');
  });
  // a field marked wrong stops looking wrong as soon as it is filled in
  form.addEventListener('input', function (e) {
    var t = e.target;
    if (t.getAttribute('aria-invalid') === 'true' && t.value.trim()) {
      t.setAttribute('aria-invalid', 'false');
      if (status.classList.contains('err')) say('');
    }
  });
  setWho(who);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var o = origin();
    var d = {
      type: who, name: f.name.value.trim(), phone: f.phone.value.trim(),
      email: f.email.value.trim(), message: f.message.value.trim(),
      website: f.website.value, elapsed: String(Date.now() - opened),
      src: o.src || '', campaign: o.campaign || '', referrer: o.referrer || '', page: o.page || ''
    };
    var missing = [];
    if (mark(f.name, !d.name)) missing.push(f.name);
    if (mark(f.phone, !d.phone)) missing.push(f.phone);

    if (who === 'client') {
      d.company = f.company.value.trim();
      d.needs = all('needs');
      d.budget = f.budget.value;
    } else {
      d.city = f.city.value.trim();
      d.handle = f.handle.value.trim();
      d.sample = f.sample.value.trim();
      d.segments = all('segments');
      d.age = checked('age');
      if (mark(f.handle, !d.handle)) missing.push(f.handle);
      var ageBox = form.querySelector('[data-group=age]');
      ageBox.classList.toggle('bad', !d.age);
      if (!d.age) missing.push(ageBox.querySelector('input'));
      if (d.age === 'Under 18') {
        d.parent_name = f.parent_name.value.trim();
        d.parent_phone = f.parent_phone.value.trim();
        d.parent_consent = f.parent_consent.checked ? 'yes' : '';
        if (mark(f.parent_name, !d.parent_name)) missing.push(f.parent_name);
        if (mark(f.parent_phone, !d.parent_phone)) missing.push(f.parent_phone);
        if (!d.parent_consent) missing.push(f.parent_consent);
      }
    }

    if (missing.length) {
      say(who === 'creator' && d.age === 'Under 18' && !d.parent_consent && d.parent_name && d.parent_phone
        ? 'A parent has to tick the box to apply for somebody under eighteen.'
        : 'A few things are missing, marked above.', true);
      missing[0].focus();
      return;
    }

    if (!FORM_ENDPOINT) {
      var text = who === 'client'
        ? 'Hi Blend, I am ' + d.name + (d.company ? ' from ' + d.company : '') + '.' +
          (d.needs ? '\nWe need: ' + d.needs + '.' : '') + (d.message ? '\n\n' + d.message : '')
        : 'Hi Blend, I am ' + d.name + ', a creator' + (d.city ? ' in ' + d.city : '') + '. ' + d.handle +
          (d.message ? '\n\n' + d.message : '');
      say('Opening WhatsApp with your message.');
      location.href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(text);
      return;
    }

    send.disabled = true;
    say('Sending.');
    fetch(FORM_ENDPOINT, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(d) })
      .then(function () {
        form.reset();
        setWho(who);
        say(who === 'client'
          ? 'Thank you. It is with us, and we will reply on WhatsApp.'
          : 'Thank you. We will look at it and get back to you on WhatsApp.');
      })
      .catch(function () {
        say('That did not go through. Message us on WhatsApp instead: +20 110 740 9572', true);
      })
      .then(function () { send.disabled = false; });
  });
})();
