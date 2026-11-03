// Shared UI helpers: escaping, formatting, icons, toasts, modals, status labels.

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (n, currency = 'USD') =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

export const date = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function ago(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date(iso);
}

const PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 2.5h8.5A1.5 1.5 0 0 1 21 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4zM5 6l11-3 1 3"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>',
  half: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  bell: '<path d="M6 16h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v3.5zM10 19.5h4"/>',
  scope: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-4.5 5-4.5 13 0 18M12 3c4.5 5 4.5 13 0 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || PATHS.file}</svg>`;

export const VERDICT = {
  met: { label: 'Met', chip: 'green', icon: 'check' },
  partial: { label: 'Partial', chip: 'amber', icon: 'half' },
  missing: { label: 'Missing', chip: 'red', icon: 'x' },
  none: { label: 'Not reviewed', chip: 'grey', icon: 'alert' },
};

export const MILESTONE_STATUS = {
  in_progress: ['In progress', 'grey'],
  submitted: ['Awaiting client', 'blue'],
  changes_requested: ['Changes requested', 'amber'],
  approved: ['Accepted', 'green'],
  invoiced: ['Invoiced', 'blue'],
  paid: ['Paid', 'green'],
};
export const milestoneChip = (status) => {
  const [label, color] = MILESTONE_STATUS[status] || [status, 'grey'];
  return `<span class="chip ${color}">${esc(label)}</span>`;
};

export function invoiceChip(status) {
  const map = { DRAFT: 'grey', SENT: 'blue', UNPAID: 'blue', SCHEDULED: 'blue', PAYMENT_PENDING: 'amber', PARTIALLY_PAID: 'amber', PAID: 'green', MARKED_AS_PAID: 'green', CANCELLED: 'red', CREATE_FAILED: 'red', CREATING: 'grey' };
  const label = { UNPAID: 'Sent · unpaid', CREATE_FAILED: 'Not created', MARKED_AS_PAID: 'Paid' }[status] || status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return `<span class="chip ${map[status] || 'grey'}">${esc(label)}</span>`;
}

export const modeChip = (mode) =>
  mode === 'sandbox' ? '<span class="chip blue">PayPal sandbox</span>' : mode === 'sample' ? '<span class="chip grey">Sample history</span>' : '<span class="chip amber">Simulated</span>';

export function clauseChip(source, attrs = '') {
  if (!source?.clauseRef && !source?.quote) return '';
  const unverified = source.quote && !source.verified;
  const title = unverified ? 'Quote not found verbatim in the agreement. Check it.' : source.quote;
  return `<button type="button" class="clause ${unverified ? 'unverified' : ''}" title="${esc(title)}" data-quote="${esc(source.quote)}" ${attrs}>${icon('file')}§${esc(source.clauseRef || '?')}${unverified ? ' · check' : ''}</button>`;
}

export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3800);
}

export function openModal(title, body, { wide = false } = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn small" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${body}</div></div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', escClose);
  document.body.append(overlay);
  overlay.querySelector('[data-close]').focus();
  return overlay.querySelector('.modal');
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
export function closeModal() {
  document.querySelector('.overlay')?.remove();
  document.removeEventListener('keydown', escClose);
}

/** Runs an async action with a busy state on the clicked button. */
export async function busy(button, fn, label) {
  const original = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${label ? esc(label) : original}`;
  }
  try {
    return await fn();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

/** Agreement text with every cited quote highlighted and anchored. */
export function agreementHtml(text, sources) {
  const ranges = [];
  for (const source of sources) {
    const quote = source?.quote?.trim();
    if (!quote) continue;
    const start = text.indexOf(quote);
    if (start >= 0 && !ranges.some((r) => start < r.end && start + quote.length > r.start)) ranges.push({ start, end: start + quote.length, quote });
  }
  ranges.sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  for (const r of ranges) {
    html += esc(text.slice(cursor, r.start)) + `<mark data-q="${esc(r.quote)}">${esc(text.slice(r.start, r.end))}</mark>`;
    cursor = r.end;
  }
  return html + esc(text.slice(cursor));
}

export function flashQuote(root, quote) {
  const mark = [...root.querySelectorAll('mark')].find((m) => m.dataset.q === quote);
  if (!mark) return false;
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  mark.classList.add('flash');
  setTimeout(() => mark.classList.remove('flash'), 1600);
  return true;
}

export function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
