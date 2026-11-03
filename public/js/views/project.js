// Project page: milestone evidence review, client acceptance, PayPal invoice,
// scope checks with change orders, the cited agreement and the audit trail.

import { api, fetchSample } from '../api.js';
import { app } from '../state.js';
import {
  esc, money, date, ago, icon, VERDICT, milestoneChip, invoiceChip, modeChip, clauseChip,
  toast, openModal, closeModal, busy, agreementHtml, flashQuote, readFileBase64,
} from '../ui.js';

const SAMPLE_AGREEMENT = 'agreement-website-redesign.md';
const SAMPLE_FILES = [
  ['portfolio.png', 'Portfolio page'],
  ['services-v2.png', 'Services page (fixed)'],
];

export async function renderProject(view, id) {
  const state = { project: null, milestoneId: null, tab: 'scope', scopeDraft: '' };
  const base = `/api/projects/${id}`;

  async function load(sync = false) {
    state.project = await api.get(base + (sync ? '?sync=1' : ''));
    const ms = state.project.terms.milestones;
    if (!ms.some((m) => m.id === state.milestoneId)) state.milestoneId = (ms.find((m) => m.status !== 'paid') || ms[0]).id;
  }

  const update = (project) => {
    state.project = project;
    draw();
  };

  try {
    await load(true);
  } catch (error) {
    view.innerHTML = `<div class="empty">${esc(error.message)} <a href="#/">Back to overview</a></div>`;
    return;
  }

  // ---------- rendering --------------------------------------------------------------

  function draw() {
    const p = state.project;
    const scroll = window.scrollY;
    const scopeInput = view.querySelector('#scope-message');
    if (scopeInput) state.scopeDraft = scopeInput.value;
    const m = p.terms.milestones.find((x) => x.id === state.milestoneId);
    view.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">${esc(p.client.name)} · ${money(p.terms.total, p.currency)}</div><h1>${esc(p.name)}</h1>
          <p class="sub">Invoices go to ${esc(p.client.email)} · Agreement ${esc(p.agreement.filename)} · ${extractionNote(p)}</p></div>
        <div class="actions"><a class="btn" href="${esc(p.portalUrl)}" target="_blank" rel="noopener">${icon('external')} Client view</a>
          <button class="btn" data-action="copy-link">${icon('link')} Copy client link</button></div>
      </div>
      ${p.extraction.warnings?.length ? `<div class="callout amber" style="margin:0 0 18px">${icon('alert')}<span>${p.extraction.warnings.map(esc).join(' ')}</span></div>` : ''}
      <div class="milestones" role="tablist">${p.terms.milestones.map((x) => msTab(p, x)).join('')}</div>
      <div class="grid-2">
        <section class="card" aria-label="Acceptance checklist">${milestonePanel(p, m)}</section>
        <div class="stack">${invoiceCard(p, m)}${evidenceCard(p, m)}</div>
      </div>
      <section class="card" style="margin-top:20px">
        <div class="tabs" role="tablist">${[['scope', 'Scope checks'], ['agreement', 'Agreement'], ['activity', 'Activity']].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div id="tab-body">${state.tab === 'scope' ? scopeTab(p) : state.tab === 'agreement' ? agreementTab(p) : activityTab(p)}</div>
      </section>`;
    const input = view.querySelector('#scope-message');
    if (input) input.value = state.scopeDraft;
    window.scrollTo(0, scroll);
    schedulePoll();
  }

  function extractionNote(p) {
    const by = p.extraction.by;
    return by === 'ai' ? `terms extracted by ${esc(p.extraction.model)}` : by === 'sample' ? 'pre-loaded sample terms' : 'terms extracted by demo rules';
  }

  function msTab(p, m) {
    const review = p.reviews[m.id];
    const counts = review ? `${review.counts.met}/${m.deliverables.length} met` : `${m.deliverables.length} criteria`;
    return `<button class="ms-tab ${m.id === state.milestoneId ? 'active' : ''}" role="tab" data-ms="${m.id}">
      <span class="eyebrow">Milestone ${m.index}</span><span class="ms-name">${esc(m.name)}</span>
      <span class="ms-meta"><span>${money(m.amount, p.currency)} · due ${date(m.dueDate)}</span>${milestoneChip(m.status)}</span>
      <span class="ms-meta"><span>${counts}</span></span></button>`;
  }

  function milestonePanel(p, m) {
    const review = p.reviews[m.id];
    const current = p.reviewCurrent[m.id];
    const results = Object.fromEntries((review?.results || []).map((r) => [r.deliverableId, r]));
    const evidence = p.evidence.filter((e) => e.milestoneId === m.id);
    const label = (eid) => `E${evidence.findIndex((e) => e.id === eid) + 1}`;
    const locked = ['approved', 'invoiced', 'paid'].includes(m.status) || m.id === p.terms.milestones[0].id && p.invoices.some((i) => i.sample && i.targetId === m.id);

    const reviewBar = review
      ? `<div class="review-bar"><div class="counts"><span class="ai-mark">${icon('spark')} ${review.by === 'ai' ? 'AI evidence review' : 'Rule-based check (demo)'}</span>
          <span class="chip green">${review.counts.met} met</span>${review.counts.partial ? `<span class="chip amber">${review.counts.partial} partial</span>` : ''}${review.counts.missing ? `<span class="chip red">${review.counts.missing} missing</span>` : ''}
          <span style="color:var(--muted)">· ${esc(review.model)} · ${ago(review.at)}</span></div>
          ${!locked ? `<button class="btn small" data-action="review">${icon('refresh')} Re-run</button>` : ''}</div>
          ${!current && !locked ? `<div class="callout amber" style="margin:12px 22px 0">${icon('alert')} Evidence changed since this review. Re-run it before sharing with the client.</div>` : ''}
          ${review.summary ? `<p class="sub" style="padding:12px 22px 0;margin:0">${esc(review.summary)}</p>` : ''}`
      : `<div class="review-bar"><span>${evidence.length ? `${evidence.length} evidence file(s) ready. Run the review to check them against each clause.` : 'Upload screenshots or documents of the delivered work.'}</span>
          ${!locked ? `<button class="btn primary small" data-action="review" ${evidence.length ? '' : 'disabled'}>${icon('spark')} Run AI review</button>` : ''}</div>`;

    const rows = m.deliverables.map((d) => {
      const r = results[d.id];
      const status = locked && !r ? 'met' : r?.status || 'none';
      const v = VERDICT[status];
      return `<div class="deliverable">
        <span class="verdict ${status}" title="${v.label}">${icon(v.icon)}</span>
        <div><div class="d-title">${esc(d.title)} ${clauseChip(d.source)} ${r ? `<span class="chip ${v.chip}">${v.label}</span>` : ''}</div>
          <div class="d-criterion">${esc(d.criterion)}</div>
          ${r?.reason ? `<div class="d-reason ${r.status}">${esc(r.reason)}${r.missingElements?.length && r.status !== 'met' ? `<br><b>Missing:</b> ${r.missingElements.map(esc).join('; ')}` : ''}</div>` : ''}
          ${r?.evidenceIds?.length ? `<div class="d-evidence">${r.evidenceIds.map((eid) => `<button class="ev-ref" data-evidence="${eid}">${label(eid)} · ${esc(evidence.find((e) => e.id === eid)?.filename || 'removed')}</button>`).join('')}</div>` : ''}
        </div></div>`;
    }).join('');

    return `<div class="card-head"><div><h2>Acceptance checklist</h2><p class="sub" style="margin-top:3px">Milestone ${m.index}: ${esc(m.name)} · ${money(m.amount, p.currency)}</p></div>${milestoneChip(m.status)}</div>
      ${locked && !review ? '' : reviewBar}
      <div>${rows}</div>
      <div class="decision" style="border-radius:0 0 12px 12px">${milestoneFooter(p, m, review, current)}</div>`;
  }

  function milestoneFooter(p, m, review, current) {
    const approval = [...p.approvals].reverse().find((a) => a.kind === 'milestone' && a.targetId === m.id);
    if (approval) {
      const ack = approval.openItemsAcknowledged ? ` They accepted ${approval.openItemsAcknowledged} open item(s) explicitly.` : '';
      return `<div class="callout green" style="margin:0">${icon('check')}<span>Accepted by <b>${esc(approval.name)}</b> on ${date(approval.at)}.${ack}${approval.sample ? ' (sample history)' : ''}</span></div>`;
    }
    const parts = [];
    if (m.status === 'changes_requested' && m.clientComment) parts.push(`<div class="callout amber" style="margin:0">${icon('alert')}<span><b>${esc(m.clientComment.name)}</b> asked for changes: “${esc(m.clientComment.text)}”</span></div>`);
    if (m.status === 'submitted') {
      parts.push(`<div class="callout blue" style="margin:0">${icon('send')}<span>Shared with ${esc(p.client.name)} for acceptance. This page updates when they decide.</span></div>
        <div class="actions"><a class="btn primary" href="${esc(p.portalUrl)}" target="_blank" rel="noopener">${icon('external')} Open client view</a><button class="btn" data-action="copy-link">${icon('link')} Copy link</button></div>`);
      return parts.join('');
    }
    if (!review) return parts.join('') + '<span class="sub" style="margin:0">Run the review, then share the evidence pack with your client.</span>';
    const open = review.counts.partial + review.counts.missing;
    parts.push(`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span class="sub" style="margin:0">${open ? `${open} item(s) still open. Fix them first, or share and let the client decide.` : 'Every acceptance condition is backed by evidence.'}</span>
      <button class="btn ${open ? '' : 'primary'}" data-action="submit" ${current ? '' : 'disabled'}>${icon('send')} Share for client acceptance</button></div>`);
    return parts.join('');
  }

  function evidenceCard(p, m) {
    const evidence = p.evidence.filter((e) => e.milestoneId === m.id);
    const editable = ['in_progress', 'changes_requested', 'submitted'].includes(m.status) && !p.invoices.some((i) => i.sample && i.targetId === m.id);
    const showSamples = editable && p.agreement.filename === SAMPLE_AGREEMENT && m.index === 2;
    return `<section class="card"><div class="card-head"><h2>Evidence</h2><span class="sub" style="margin:0">${evidence.length} file(s)</span></div>
      <div class="card-body">
        ${editable ? `<label class="dropzone" data-drop>${icon('upload')}<br><b>Add screenshots or documents</b><br>PNG, JPG, PDF, DOCX · up to 6 MB
          <input type="file" id="evidence-input" class="sr-only" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md"></label>` : ''}
        ${showSamples ? `<div class="sample-files">Demo files: ${SAMPLE_FILES.map(([f, l]) => `<button class="btn small" data-sample="${f}">${icon('plus')} ${l}</button>`).join('')}</div>` : ''}
        <div class="thumbs">${evidence.map((e, i) => `<div class="thumb"><span class="label">E${i + 1}</span>
          <button class="open" data-evidence="${e.id}" aria-label="Open ${esc(e.filename)}">${e.kind === 'image' ? `<img src="${base}/evidence/${e.id}" alt="${esc(e.filename)}" loading="lazy">` : `<div class="doc">${icon('file')}</div>`}</button>
          <div class="cap"><span title="${esc(e.filename)}">${esc(e.filename)}</span>${editable && m.status !== 'submitted' ? `<button class="remove" data-remove="${e.id}" aria-label="Remove ${esc(e.filename)}">${icon('x')}</button>` : ''}</div></div>`).join('')}</div>
        ${!evidence.length && !editable ? '<div class="empty">No evidence recorded for this milestone.</div>' : ''}
      </div></section>`;
  }

  function invoiceCard(p, m) {
    const invoice = p.invoices.find((i) => i.kind === 'milestone' && i.targetId === m.id);
    if (!invoice) {
      return `<section class="card card-body"><div style="display:flex;gap:10px;align-items:flex-start">${icon('wallet')}<div><h3>PayPal invoice</h3>
        <p class="sub">Created automatically when ${esc(p.client.name)} accepts this milestone (agreement §6.2). Amount: ${money(m.amount, p.currency)}.</p></div></div></section>`;
    }
    return `<section class="card"><div class="card-head"><h2>PayPal invoice</h2>${invoiceChip(invoice.status)}</div><div class="card-body">${invoiceBody(p, invoice)}</div></section>`;
  }

  function invoiceBody(p, invoice) {
    const actions = [];
    if (invoice.status === 'CREATE_FAILED') actions.push(`<button class="btn primary" data-inv="retry" data-id="${invoice.id}">${icon('refresh')} Retry creating in PayPal</button>`);
    if (invoice.status === 'DRAFT') actions.push(`<button class="btn paypal" data-inv="send" data-id="${invoice.id}">Send via PayPal</button>`);
    if (['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING'].includes(invoice.status)) {
      if (invoice.payerUrl) actions.push(`<a class="btn" href="${esc(invoice.payerUrl)}" target="_blank" rel="noopener">${icon('external')} Payer view</a>`);
      if (invoice.mode === 'sandbox') actions.push(`<button class="btn" data-inv="refresh" data-id="${invoice.id}">${icon('refresh')} Refresh status</button>`);
      actions.push(`<button class="btn" data-inv="remind" data-id="${invoice.id}">${icon('bell')} Draft reminder</button>`);
      if (invoice.mode === 'simulated') actions.push(`<button class="btn" data-inv="simulate" data-id="${invoice.id}">Simulate payment</button>`);
    }
    return `<div class="invoice-box">
      <div class="inv-line"><span><b>${esc(invoice.number || 'Pending number')}</b><br><span class="sub">${esc(invoice.title)}</span></span><span class="amount">${money(invoice.amount, p.currency)}</span></div>
      <div class="inv-line"><span class="sub" style="margin:0">Approved by ${esc(invoice.approvedBy)}, ${date(invoice.approvedAt)}</span>${modeChip(invoice.mode)}</div>
      ${invoice.error ? `<div class="callout red" style="margin:0">${icon('alert')}${esc(invoice.error)}</div>` : ''}
      ${invoice.paidAt ? `<div class="callout green" style="margin:0">${icon('check')} Paid ${date(invoice.paidAt)}</div>` : ''}
      ${invoice.reminders?.length ? `<div class="sub" style="margin:0">${invoice.reminders.length} reminder(s) sent, last ${ago(invoice.reminders.at(-1).at)}</div>` : ''}
      ${invoice.mode === 'sandbox' && ['SENT', 'UNPAID'].includes(invoice.status) ? '<div class="sub" style="margin:0">Pay with the sandbox buyer account. Status updates by webhook, or refresh.</div>' : ''}
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}</div>`;
  }

  function scopeTab(p) {
    const examples = ['Can you also add a blog where we post studio news?', 'Please make sure the contact page shows our office address.', 'Could you write the copy for the About page too?'];
    return `<div class="card-body" style="border-bottom:1px solid var(--border);display:grid;gap:10px">
        <label class="field" for="scope-message">Paste a client request. AI checks it against the agreement and drafts a change order when it is extra work.</label>
        <textarea id="scope-message" placeholder="e.g. “Could you also add an online shop?”"></textarea>
        <div class="actions" style="justify-content:space-between"><div class="actions">${examples.map((x) => `<button class="btn small" data-example="${esc(x)}">${esc(x.length > 42 ? x.slice(0, 40) + '…' : x)}</button>`).join('')}</div>
          <button class="btn primary" data-action="scope">${icon('scope')} Check against agreement</button></div></div>
      ${p.scopeChecks.map((c) => scopeItem(p, c)).join('') || '<div class="empty">No requests checked yet.</div>'}`;
  }

  function scopeItem(p, c) {
    const v = { in_scope: ['In scope', 'green'], out_of_scope: ['Out of scope', 'red'], unclear: ['Unclear', 'amber'] }[c.verdict];
    const order = c.changeOrder;
    const invoice = p.invoices.find((i) => i.kind === 'change_order' && i.targetId === c.id);
    let orderHtml = '';
    if (order) {
      const statusChip = { draft: 'grey', sent: 'blue', approved: 'green', declined: 'red', invoiced: 'blue', paid: 'green' }[order.status];
      orderHtml = `<div class="co"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>Change order: ${esc(order.title)}</b><span class="chip ${statusChip}">${esc(order.status)}</span></div>
        <div class="sub" style="margin:0">${esc(order.description)}</div>
        ${order.status === 'draft' ? `<div class="co-grid"><span class="sub" style="margin:0">Rate from §${esc(p.terms.changePolicy?.source?.clauseRef || '?')}: ${order.rate ? money(order.rate, p.currency) + '/h' : 'not set'}</span>
          <label class="field">Hours<input type="number" min="0.5" step="0.5" value="${order.hours}" data-co-hours="${c.id}"></label>
          <label class="field">Price<input type="number" min="1" step="1" value="${order.amount ?? ''}" data-co-amount="${c.id}"></label></div>
          <div class="actions"><button class="btn primary" data-action="send-co" data-id="${c.id}">${icon('send')} Send to client for approval</button></div>`
        : `<div class="inv-line"><span class="sub" style="margin:0">${order.hours} h${order.rate ? ` × ${money(order.rate, p.currency)}` : ''}</span><b>${money(order.amount, p.currency)}</b></div>`}
        ${invoice ? `<div style="border-top:1px solid var(--border);padding-top:10px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><b>PayPal invoice</b>${invoiceChip(invoice.status)}</div>${invoiceBody(p, invoice)}</div>` : ''}</div>`;
    }
    return `<div class="scope-item"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="chip ${v[1]}">${v[0]}</span>${clauseChip(c.source)}<span class="sub" style="margin:0">${c.by === 'ai' ? 'AI check' : 'demo rules'} · ${ago(c.at)}</span></div>
      <q>${esc(c.message)}</q><div>${esc(c.reason)}</div>${orderHtml}</div>`;
  }

  function agreementTab(p) {
    const sources = [...p.terms.milestones.flatMap((m) => [m.source, ...m.deliverables.map((d) => d.source)]), ...p.terms.exclusions.map((e) => e.source), p.terms.changePolicy?.source, ...p.scopeChecks.map((c) => c.source)];
    return `<div class="agreement" id="agreement-text">${agreementHtml(p.agreement.text, sources)}</div>`;
  }

  function activityTab(p) {
    return `<ul class="activity">${p.activity.map((a) => `<li><span class="ico">${icon('pulse')}</span><div>${esc(a.text)}<time>${ago(a.at)} · ${new Date(a.at).toLocaleString()}</time></div></li>`).join('')}</ul>`;
  }

  // ---------- polling (client decisions, PayPal payments) ------------------------------

  function schedulePoll() {
    clearInterval(app.timer);
    const p = state.project;
    const waiting = p.terms.milestones.some((m) => m.status === 'submitted') ||
      p.scopeChecks.some((c) => c.changeOrder?.status === 'sent') ||
      p.invoices.some((i) => ['SENT', 'UNPAID', 'PAYMENT_PENDING'].includes(i.status) && i.mode === 'sandbox');
    if (!waiting) return;
    app.timer = setInterval(async () => {
      if (document.hidden || document.querySelector('.overlay') || !view.isConnected) return;
      const before = state.project.updatedAt;
      try {
        await load(true);
        if (state.project.updatedAt !== before) {
          draw();
          toast('Updated: new activity from your client or PayPal.');
        }
      } catch { /* keep polling */ }
    }, 6000);
  }

  // ---------- actions --------------------------------------------------------------------

  async function uploadFiles(files) {
    for (const file of files) {
      const body = { milestoneId: state.milestoneId, filename: file.name, mime: file.type, base64: await readFileBase64(file) };
      update(await api.post(`${base}/evidence`, body));
    }
    toast(`${files.length} file(s) added. Run the review to check them.`);
  }

  function showEvidence(eid) {
    const e = state.project.evidence.find((x) => x.id === eid);
    if (!e) return;
    const body = e.kind === 'image'
      ? `<img class="full" src="${base}/evidence/${e.id}" alt="${esc(e.filename)}">`
      : `<p><a href="${base}/evidence/${e.id}" target="_blank" rel="noopener">${icon('external')} Open ${esc(e.filename)}</a></p><pre style="white-space:pre-wrap;font-size:12px;max-height:50vh;overflow:auto">${esc(e.text.slice(0, 4000))}</pre>`;
    openModal(e.filename, body + (e.note ? `<p class="sub">${esc(e.note)}</p>` : ''), { wide: e.kind === 'image' });
  }

  async function reminderFlow(invoiceId, button) {
    const draft = await busy(button, () => api.post(`${base}/invoices/${invoiceId}/reminder-draft`), 'Drafting…');
    if (!draft) return;
    const modal = openModal('Payment reminder', `
      <p class="sub" style="margin:0">Drafted by ${app.session.capabilities.ai.live ? 'AI' : 'a template'}. Edit it, then PayPal sends it with the invoice link.</p>
      <label class="field">Subject<input type="text" id="rm-subject" value="${esc(draft.subject)}"></label>
      <label class="field">Note<textarea id="rm-note" rows="5">${esc(draft.note)}</textarea></label>
      <div class="actions" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rm-send">${icon('send')} Send reminder via PayPal</button></div>`);
    modal.querySelector('#rm-send').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const project = await api.post(`${base}/invoices/${invoiceId}/remind`, { subject: modal.querySelector('#rm-subject').value, note: modal.querySelector('#rm-note').value });
      closeModal();
      update(project);
      toast('Reminder sent through PayPal.');
    }, 'Sending…'));
  }

  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t || !view.contains(t)) return;
    const p = state.project;

    if (t.dataset.ms) { state.milestoneId = t.dataset.ms; return draw(); }
    if (t.dataset.tab) { state.tab = t.dataset.tab; return draw(); }
    if (t.dataset.evidence) return showEvidence(t.dataset.evidence);
    if (t.dataset.example) { const input = view.querySelector('#scope-message'); input.value = t.dataset.example; return input.focus(); }
    if (t.classList.contains('clause') && t.dataset.quote) {
      state.tab = 'agreement';
      draw();
      if (!flashQuote(view.querySelector('#agreement-text'), t.dataset.quote)) toast('That quote is not verbatim in the agreement.', 'error');
      return;
    }
    if (t.dataset.remove) return busy(t, async () => update(await api.del(`${base}/evidence/${t.dataset.remove}`)));
    if (t.dataset.sample) return busy(t, async () => uploadFiles([await fetchSample(`/samples/evidence/${t.dataset.sample}`)]), 'Adding…');

    switch (t.dataset.action) {
      case 'copy-link':
        await navigator.clipboard?.writeText(p.portalUrl).catch(() => {});
        return toast('Client review link copied.');
      case 'review':
        return busy(t, async () => { update(await api.post(`${base}/milestones/${state.milestoneId}/review`)); toast('Review complete.'); }, 'Reviewing evidence…');
      case 'submit':
        return busy(t, async () => { update(await api.post(`${base}/milestones/${state.milestoneId}/submit`)); toast('Shared with your client. Open the client view to approve.'); }, 'Sharing…');
      case 'scope': {
        const message = view.querySelector('#scope-message').value;
        return busy(t, async () => { state.scopeDraft = ''; view.querySelector('#scope-message').value = ''; update(await api.post(`${base}/scope-checks`, { message })); }, 'Checking…');
      }
      case 'send-co': {
        const hours = Number(view.querySelector(`[data-co-hours="${t.dataset.id}"]`).value);
        const amount = Number(view.querySelector(`[data-co-amount="${t.dataset.id}"]`).value);
        return busy(t, async () => { update(await api.post(`${base}/scope-checks/${t.dataset.id}/send`, { hours, amount })); toast('Change order sent to the client view.'); }, 'Sending…');
      }
    }

    const inv = t.dataset.inv;
    if (!inv) return;
    const route = `${base}/invoices/${t.dataset.id}`;
    if (inv === 'remind') return reminderFlow(t.dataset.id, t);
    const labels = { send: 'Sending via PayPal…', refresh: 'Checking PayPal…', simulate: 'Paying…', retry: 'Creating…' };
    const paths = { send: 'send', refresh: 'refresh', simulate: 'simulate-payment', retry: 'retry' };
    return busy(t, async () => {
      update(await api.post(`${route}/${paths[inv]}`));
      const invoice = state.project.invoices.find((i) => i.id === t.dataset.id);
      toast(inv === 'send' ? `Invoice ${invoice.number} sent through PayPal.` : `Invoice status: ${invoice.status.toLowerCase()}.`);
    }, labels[inv]);
  });

  view.addEventListener('change', (e) => {
    if (e.target.id === 'evidence-input' && e.target.files.length) busy(null, () => uploadFiles([...e.target.files]));
    const id = e.target.dataset.coHours;
    if (id) {
      const order = state.project.scopeChecks.find((c) => c.id === id)?.changeOrder;
      const amount = view.querySelector(`[data-co-amount="${id}"]`);
      if (order?.rate) amount.value = Math.round(Number(e.target.value) * order.rate);
    }
  });

  view.addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('drag'); } });
  view.addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('drag'));
  view.addEventListener('drop', (e) => {
    const z = e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('drag');
    if (e.dataTransfer.files.length) busy(null, () => uploadFiles([...e.dataTransfer.files]));
  });

  draw();
}
