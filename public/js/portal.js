// Client portal: the client reviews delivered evidence against the agreement,
// accepts or requests changes, approves change orders, and pays via PayPal.
// Access is by the private token in the URL fragment (never sent as a referrer).

import { api } from './api.js';
import { esc, money, date, ago, icon, VERDICT, milestoneChip, invoiceChip, modeChip, clauseChip, toast, openModal, busy, agreementHtml, flashQuote } from './ui.js';

const token = location.hash.slice(1);
const root = document.getElementById('portal');
const base = `/api/portal/${encodeURIComponent(token)}`;
let data = null;
let signer = '';

async function load(sync = false) {
  data = await api.get(base + (sync ? '?sync=1' : ''));
}

function draw() {
  const d = data;
  const nameInput = root.querySelector('[data-signer]');
  if (nameInput) signer = nameInput.value;
  const submitted = d.terms.milestones.filter((m) => m.status === 'submitted');
  const pendingOrders = d.changeOrders.filter((c) => c.status === 'sent');
  const openInvoices = d.invoices.filter((i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status));
  const paidTotal = d.invoices.filter((i) => ['PAID', 'MARKED_AS_PAID'].includes(i.status)).reduce((n, i) => n + i.amount, 0);
  const waiting = submitted.length + pendingOrders.length + openInvoices.length;
  root.innerHTML = `
    <header class="portal-top"><div class="inner"><span class="logo"><span class="logo-mark">S</span>ScopePay</span>
      <span class="secure">${icon('shield')}<span>Private review link for ${esc(d.client.name)}</span></span></div></header>
    ${!d.payments.live ? `<div class="mode-banner"><div class="inner" style="max-width:1000px;padding-left:24px;padding-right:24px">${icon('alert')}<span>Demo mode. Invoices are simulated and no money moves.</span></div></div>` : ''}
    <div class="portal-band"><div class="inner">
      <div><p class="sub" style="margin:0 0 4px">Review request from ${esc(d.freelancer)}</p><h1>${esc(d.name)}</h1>
        <p class="sub">Each item links to the clause of your agreement it comes from. You decide what is accepted.</p></div>
      <dl><dt>Contract value</dt><dd>${money(d.terms.total, d.currency)}</dd><dt>Paid to date</dt><dd>${money(paidTotal, d.currency)}</dd><dt>Needs your decision</dt><dd>${waiting}</dd></dl>
    </div></div>
    <div class="portal">
      ${!waiting ? `<div class="callout green">${icon('check')}<span>Nothing needs your attention right now.</span></div>` : ''}
      ${submitted.map(reviewCard).join('')}
      ${pendingOrders.map(changeOrderCard).join('')}
      ${d.invoices.length ? invoicesCard() : ''}
      <section class="card"><div class="card-head"><h2>Payment schedule</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Milestone</th><th class="hide-sm">Due</th><th>Status</th><th class="num">Amount</th></tr></thead>
        <tbody>${d.terms.milestones.map((m) => `<tr><td>${m.index}. ${esc(m.name)}<small>${m.deliverables.length} acceptance conditions</small></td><td class="hide-sm">${date(m.dueDate)}</td><td>${milestoneChip(m.status)}</td><td class="num">${money(m.amount, d.currency)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${money(d.terms.total, d.currency)}</td></tr></tfoot></table></div></section>
      <details class="card"><summary class="card-head" style="cursor:pointer;border-bottom:0"><h2>Your agreement</h2><span class="sub" style="margin:0">${esc(d.agreement.filename)}</span></summary>
        <div class="agreement" id="agreement-text" style="border-top:1px solid var(--line)">${agreementHtml(d.agreement.text, d.terms.milestones.flatMap((m) => m.deliverables.map((x) => x.source)).concat(d.changeOrders.map((c) => c.source)))}</div></details>
      <p class="sub" style="text-align:center">Your decisions are recorded with your name and the time. Payments are processed by PayPal; ScopePay never sees your card or bank details.</p>
    </div>`;
  const input = root.querySelector('[data-signer]');
  if (input) input.value = signer;
}

function reviewCard(m) {
  const d = data;
  const review = d.reviews[m.id];
  const results = Object.fromEntries((review?.results || []).map((r) => [r.deliverableId, r]));
  const evidence = d.evidence.filter((e) => e.milestoneId === m.id);
  const open = review ? review.counts.partial + review.counts.missing : 0;
  return `<section class="card" aria-label="Review ${esc(m.name)}">
    <div class="card-head"><div><div class="request-label">Ready for your acceptance</div><h2 style="margin-top:2px">Milestone ${m.index}: ${esc(m.name)}</h2></div><span style="font-size:20px;font-weight:500">${money(m.amount, d.currency)}</span></div>
    ${review ? `<div class="review-bar"><div class="counts"><span class="ai-mark">${icon('spark')} Evidence check</span><span class="chip green">${review.counts.met} met</span>${review.counts.partial ? `<span class="chip amber">${review.counts.partial} partial</span>` : ''}${review.counts.missing ? `<span class="chip red">${review.counts.missing} missing</span>` : ''}</div><span class="review-meta">Prepared by ${review.by === 'ai' ? 'AI' : 'demo rules'} to help you review. You make the decision.</span></div>` : ''}
    <div class="card-body"><h3 style="margin-bottom:10px">Delivered work</h3><div class="gallery">${evidence.map((e, i) => `<div class="thumb"><span class="label">E${i + 1}</span><button class="open" data-evidence="${e.id}">${e.kind === 'image' ? `<img src="${base}/evidence/${e.id}" alt="${esc(e.filename)}" loading="lazy">` : `<div class="doc">${icon('file')}</div>`}</button><div class="cap"><span>${esc(e.filename)}</span></div></div>`).join('')}</div></div>
    <div style="border-top:1px solid var(--line)">${m.deliverables.map((x) => {
      const r = results[x.id];
      const v = VERDICT[r?.status || 'none'];
      return `<div class="deliverable"><span class="verdict ${r?.status || 'none'}">${icon(v.icon)}</span><div><div class="d-title">${esc(x.title)} ${clauseChip(x.source)} <span class="chip ${v.chip}">${v.label}</span></div>
        <div class="d-criterion">${esc(x.criterion)}</div>${r?.reason ? `<div class="d-reason ${r.status}">${esc(r.reason)}</div>` : ''}
        ${r?.evidenceIds?.length ? `<div class="d-evidence">${r.evidenceIds.map((eid) => `<button class="ev-ref" data-evidence="${eid}">E${evidence.findIndex((e) => e.id === eid) + 1}</button>`).join('')}</div>` : ''}</div></div>`;
    }).join('')}</div>
    <div class="decision">
      ${open ? `<label class="check"><input type="checkbox" data-ack="${m.id}"> I have seen the ${open} open item(s) above and accept this milestone anyway.</label>` : ''}
      <div class="decision-row"><label class="field">Your full name<input type="text" data-signer placeholder="e.g. Dana Ortiz" autocomplete="name"></label>
        <button class="btn primary" data-approve="${m.id}">${icon('check')} Accept milestone</button></div>
      <div class="decision-row"><label class="field">Or describe what needs to change<input type="text" data-comment="${m.id}" placeholder="e.g. Please add the Growth package to Services"></label>
        <button class="btn" data-changes="${m.id}">Request changes</button></div>
      <p class="sub" style="margin:0">Accepting records your approval under §6.2 of the agreement and issues a PayPal invoice for ${money(m.amount, d.currency)}.</p>
    </div></section>`;
}

function changeOrderCard(c) {
  return `<section class="card"><div class="card-head"><div><div class="request-label">Change request for your approval</div><h2 style="margin-top:2px">${esc(c.title)}</h2></div><span style="font-size:20px;font-weight:500">${money(c.amount, data.currency)}</span></div>
    <div class="card-body" style="display:grid;gap:10px"><div><b>You asked:</b> <q>${esc(c.message)}</q></div>
      <div>${esc(c.reason)} ${clauseChip(c.source)}</div><div class="sub" style="margin:0">${esc(c.description)} Estimate: ${c.hours} h${c.rate ? ` at ${money(c.rate, data.currency)}/h` : ''}</div></div>
    <div class="decision"><div class="decision-row"><label class="field">Your full name<input type="text" data-signer placeholder="e.g. Dana Ortiz"></label>
      <button class="btn primary" data-co="${c.id}" data-approve-co="1">${icon('check')} Approve change order</button><button class="btn" data-co="${c.id}">Decline</button></div></div></section>`;
}

function invoicesCard() {
  const d = data;
  return `<section class="card"><div class="card-head"><h2>Invoices</h2></div><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Status</th><th class="num">Amount</th><th class="num"><span class="sr-only">Action</span></th></tr></thead><tbody>${d.invoices.map((i) => `<tr>
    <td>${esc(i.title)}<small>No. ${esc(i.number || 'pending')} ${modeChip(i.mode)}</small></td><td>${invoiceChip(i.status)}</td><td class="num">${money(i.amount, d.currency)}</td>
    <td class="num">${['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status)
      ? i.payerUrl ? `<a class="btn paypal" href="${esc(i.payerUrl)}" target="_blank" rel="noopener">Pay with PayPal</a>` : '<span class="sub">Simulated: payment is recorded by the freelancer</span>'
      : i.status === 'DRAFT' ? '<span class="sub">Being prepared</span>' : i.paidAt ? `<span class="sub">Paid ${date(i.paidAt)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.classList.contains('clause') && t.dataset.quote) {
    root.querySelector('details').open = true;
    return flashQuote(root.querySelector('#agreement-text'), t.dataset.quote);
  }
  if (t.dataset.evidence) {
    const ev = data.evidence.find((x) => x.id === t.dataset.evidence);
    return openModal(ev.filename, ev.kind === 'image' ? `<img class="full" src="${base}/evidence/${ev.id}" alt="${esc(ev.filename)}">` : `<a href="${base}/evidence/${ev.id}" target="_blank" rel="noopener">Open ${esc(ev.filename)}</a>`, { wide: true });
  }
  const name = t.closest('section')?.querySelector('[data-signer]')?.value.trim() || '';
  if (t.dataset.approve) {
    const ack = root.querySelector(`[data-ack="${t.dataset.approve}"]`);
    return busy(t, async () => {
      data = await api.post(`${base}/milestones/${t.dataset.approve}/approve`, { name, acknowledgeOpenItems: ack ? ack.checked : false });
      signer = '';
      draw();
      toast('Accepted. Your PayPal invoice is being issued.');
    }, 'Recording…');
  }
  if (t.dataset.changes) {
    const comment = root.querySelector(`[data-comment="${t.dataset.changes}"]`).value.trim();
    if (!comment) return toast('Describe what needs to change.', 'error');
    return busy(t, async () => { data = await api.post(`${base}/milestones/${t.dataset.changes}/request-changes`, { name: name || 'Client', comment }); draw(); toast('Sent to the freelancer.'); });
  }
  if (t.dataset.co) {
    return busy(t, async () => { data = await api.post(`${base}/change-orders/${t.dataset.co}/decision`, { name, approve: Boolean(t.dataset.approveCo) }); draw(); toast(t.dataset.approveCo ? 'Change order approved. A PayPal invoice will follow.' : 'Change order declined.'); });
  }
});

try {
  if (!token) throw new Error('This review link is incomplete.');
  await load(true);
  draw();
  setInterval(async () => {
    if (document.hidden || document.activeElement?.matches('input') || document.querySelector('.overlay')) return;
    const before = JSON.stringify(data);
    try {
      await load(true);
      if (JSON.stringify(data) !== before) draw();
    } catch { /* keep polling */ }
  }, 7000);
} catch (error) {
  root.innerHTML = `<div class="empty" style="padding:80px">${esc(error.message)}</div>`;
}
