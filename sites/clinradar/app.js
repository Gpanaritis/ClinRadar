'use strict';

// The contact form: checked here first, then sent as JSON to the ClinRadar server, which checks it again.
const form = document.getElementById('contact-form');
const statusLine = document.getElementById('cf-status');
const submit = document.getElementById('cf-submit');
const counter = document.getElementById('cf-count');
const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]{2,}$/;
const LIMITS = { name: 120, company: 160, email: 254, message: 3000 };

function check(values) {
  const errors = {};
  if (!values.name) errors.name = 'Enter your name.';
  else if (values.name.length > LIMITS.name) errors.name = `Use at most ${LIMITS.name} characters.`;
  if (!values.company) errors.company = 'Enter your company.';
  else if (values.company.length > LIMITS.company) errors.company = `Use at most ${LIMITS.company} characters.`;
  if (!values.email) errors.email = 'Enter your work email.';
  else if (values.email.length > LIMITS.email || !EMAIL.test(values.email)) errors.email = 'Enter a valid email address, like name@company.com.';
  if (!values.message) errors.message = 'Tell us briefly what you would like to discuss.';
  else if (values.message.length > LIMITS.message) errors.message = `Use at most ${LIMITS.message} characters.`;
  if (!values.consent) errors.consent = 'Tick the box so that we may reply to you.';
  return errors;
}

function showErrors(errors) {
  for (const name of ['name', 'company', 'email', 'message', 'consent']) {
    const input = form.elements[name];
    const message = errors[name] || '';
    document.getElementById(`cf-${name}-error`).textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const first = ['name', 'company', 'email', 'message', 'consent'].find(name => errors[name]);
  if (first) form.elements[first].focus();
}

function setStatus(state, text) {
  statusLine.dataset.state = state;
  statusLine.textContent = text;
}

if (form) {
  const values = () => ({
    name: form.elements.name.value.trim(),
    company: form.elements.company.value.trim(),
    email: form.elements.email.value.trim(),
    message: form.elements.message.value.trim(),
    consent: form.elements.consent.checked,
  });

  form.elements.message.addEventListener('input', () => { counter.textContent = String(form.elements.message.value.length); });
  // Clear a field's error as soon as it is corrected.
  form.addEventListener('input', event => {
    const name = event.target.name;
    if (!name || !event.target.hasAttribute('aria-invalid')) return;
    if (!check(values())[name]) {
      event.target.removeAttribute('aria-invalid');
      document.getElementById(`cf-${name}-error`).textContent = '';
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = values();
    const errors = check(data);
    showErrors(errors);
    if (Object.keys(errors).length) {
      setStatus('error', 'Check the highlighted fields.');
      return;
    }
    submit.disabled = true;
    setStatus('pending', 'Sending…');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 400 && body.fields) {
        showErrors(body.fields);
        throw new Error(body.error || 'Check the highlighted fields.');
      }
      if (!response.ok) throw new Error(body.error || `The message could not be sent (error ${response.status}). Try again in a minute.`);
      form.reset();
      counter.textContent = '0';
      setStatus('success', `Thank you, your message has been received (reference ${body.id}). We will reply by email.`);
    } catch (error) {
      setStatus('error', error instanceof TypeError ? 'The message could not be sent: no connection to the server. Try again in a minute.' : error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

// The screenshot opens full size in a dialog.
const dialog = document.getElementById('shot-dialog');
const opener = document.getElementById('open-shot');
if (dialog && opener && typeof dialog.showModal === 'function') {
  opener.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}
