// Sign-in and sign-up forms on the public website.

const form = document.querySelector('[data-auth]');
const error = form.querySelector('.form-error');
const button = form.querySelector('button[type=submit]');

function nextUrl() {
  const next = new URLSearchParams(location.search).get('next') || '/app';
  // Only same-site paths, never another origin.
  return /^\/(?!\/)[\w\-/.?=&#]*$/.test(next) ? next : '/app';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const body = Object.fromEntries(new FormData(form));
  const label = button.textContent;
  button.disabled = true;
  button.textContent = form.dataset.auth === 'signup' ? 'Creating account…' : 'Signing in…';
  try {
    const response = await fetch(`/api/auth/${form.dataset.auth}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    location.assign(nextUrl());
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = label;
    form.querySelector('input:not([type=hidden])')?.focus();
  }
});
