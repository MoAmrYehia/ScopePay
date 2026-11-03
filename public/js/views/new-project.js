// New project: upload an agreement, let AI extract cited terms, review and edit
// them, then confirm. Nothing is relied on until the freelancer confirms it.

import { api, fetchSample } from '../api.js';
import { app } from '../state.js';
import { esc, icon, money, clauseChip, toast, busy, readFileBase64, agreementHtml, flashQuote } from '../ui.js';

export async function renderNewProject(view) {
  const state = { step: 1, file: null, draft: null, client: { name: '', email: app.session.defaults.clientEmail || '' } };

  function draw() {
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">New project</div><h1>Start from the agreement</h1>
        <p class="sub">Upload the signed agreement. AI extracts milestones and acceptance conditions, each linked to its clause.</p></div></div>
      <div class="steps"><span class="${state.step === 1 ? 'on' : ''}">1. Agreement</span>›<span class="${state.step === 2 ? 'on' : ''}">2. Review extracted terms</span>›<span>3. Collect evidence</span></div>
      ${state.step === 1 ? stepOne() : stepTwo()}`;
  }

  function stepOne() {
    const ai = app.session.capabilities.ai;
    return `<div class="grid-2"><section class="card card-body" style="display:grid;gap:16px">
        <label class="dropzone" data-drop>${icon('upload')}<br><b>${state.file ? esc(state.file.name) : 'Choose the agreement'}</b><br>PDF, DOCX, TXT or MD · up to 6 MB
          <input type="file" id="agreement-input" class="sr-only" accept=".pdf,.docx,.txt,.md"></label>
        <div class="sample-files">No agreement handy? <button class="btn small" data-action="sample">${icon('file')} Use the sample website agreement</button></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">Client name<input type="text" id="client-name" value="${esc(state.client.name)}" placeholder="From the agreement if left empty"></label>
          <label class="field">Client email for PayPal invoices<input type="email" id="client-email" value="${esc(state.client.email)}" placeholder="client@company.com"></label>
        </div>
        <div class="actions" style="justify-content:flex-end"><button class="btn primary" data-action="extract" ${state.file ? '' : 'disabled'}>${icon('spark')} Extract terms</button></div>
      </section>
      <section class="card card-body" style="display:grid;gap:10px;font-size:13px;color:var(--ink-2)">
        <h3>What the extraction does</h3>
        <p style="margin:0">Finds each milestone, its amount and due date, and splits the work into checkable acceptance conditions.</p>
        <p style="margin:0">Every condition carries the exact clause it came from. Quotes that do not appear verbatim in the agreement are flagged.</p>
        <p style="margin:0">Also captures exclusions and the change-request rate, used later for scope checks.</p>
        <div class="callout ${ai.live ? 'green' : 'amber'}" style="margin:0">${icon(ai.live ? 'spark' : 'alert')}${ai.live ? `Using ${esc(ai.model)}.` : 'Demo mode: rule-based parsing works for the sample format only. Add an AI key for any agreement.'}</div>
      </section></div>`;
  }

  function stepTwo() {
    const { terms, extraction, agreement } = state.draft;
    const sources = terms.milestones.flatMap((m) => m.deliverables.map((d) => d.source)).concat(terms.exclusions.map((e) => e.source), [terms.changePolicy.source]);
    return `<div class="grid-2"><div class="stack">
      ${extraction.warnings.length ? `<div class="callout amber" style="margin:0;align-items:flex-start">${icon('alert')}<div><b>Check before confirming</b><ul class="warning-list">${extraction.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>` : `<div class="callout green" style="margin:0">${icon('check')} All quotes were found verbatim in the agreement.</div>`}
      <section class="card card-body" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <label class="field">Project name<input type="text" id="project-name" value="${esc(terms.projectName)}"></label>
        <label class="field">Client<input type="text" id="client-name" value="${esc(state.client.name || terms.clientName)}"></label>
        <label class="field">Client email<input type="email" id="client-email" value="${esc(state.client.email)}"></label>
      </section>
      ${terms.milestones.map((m, mi) => `<section class="terms-ms">
        <div class="terms-ms-head"><label class="field">Milestone ${mi + 1}<input type="text" data-m="${mi}" data-k="name" value="${esc(m.name)}"></label>
          <label class="field">Amount (${esc(terms.currency)})<input type="number" min="0" step="0.01" data-m="${mi}" data-k="amount" value="${m.amount ?? ''}"></label>
          <label class="field">Due date<input type="date" data-m="${mi}" data-k="dueDate" value="${esc(m.dueDate || '')}"></label></div>
        ${m.deliverables.map((d, di) => `<div class="terms-dl">
          <input type="text" aria-label="Deliverable" data-m="${mi}" data-d="${di}" data-k="title" value="${esc(d.title)}">
          <textarea aria-label="Acceptance condition" data-m="${mi}" data-d="${di}" data-k="criterion" rows="2">${esc(d.criterion)}</textarea>
          <span>${clauseChip(d.source)}</span>
          <button class="remove" data-remove="${mi}:${di}" aria-label="Remove deliverable">${icon('x')}</button></div>`).join('')}
        <div style="padding:10px 14px"><button class="btn small ghost" data-add="${mi}">${icon('plus')} Add acceptance condition</button></div>
      </section>`).join('')}
      <section class="card card-body" style="display:grid;gap:8px">
        <h3>Scope rules</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${terms.exclusions.map((e) => `<span class="chip grey">${esc(e.item)}</span>`).join('') || '<span class="sub">No exclusions found.</span>'}</div>
        <div class="sub" style="margin:0">Change requests: ${terms.changePolicy.hourlyRate ? `${money(terms.changePolicy.hourlyRate, terms.currency)}/hour` : 'no hourly rate found'} ${clauseChip(terms.changePolicy.source)}</div>
      </section>
      <div class="actions" style="justify-content:space-between"><button class="btn" data-action="back">← Back</button>
        <button class="btn primary" data-action="confirm">${icon('check')} Confirm terms and create project</button></div>
    </div>
    <section class="card" style="position:sticky;top:88px"><div class="card-head"><h2>Agreement</h2><span class="sub" style="margin:0">${esc(agreement.filename)}</span></div>
      <div class="agreement" id="agreement-text" style="max-height:70vh">${agreementHtml(agreement.text, sources)}</div></section></div>`;
  }

  function syncFromDom() {
    if (state.step !== 2) {
      state.client.name = view.querySelector('#client-name')?.value.trim() || '';
      state.client.email = view.querySelector('#client-email')?.value.trim() || '';
      return;
    }
    const t = state.draft.terms;
    t.projectName = view.querySelector('#project-name').value.trim();
    state.client.name = view.querySelector('#client-name').value.trim();
    state.client.email = view.querySelector('#client-email').value.trim();
    view.querySelectorAll('[data-m][data-k]').forEach((el) => {
      const m = t.milestones[el.dataset.m];
      const target = el.dataset.d != null ? m.deliverables[el.dataset.d] : m;
      target[el.dataset.k] = el.dataset.k === 'amount' ? (el.value === '' ? null : Number(el.value)) : el.value;
    });
  }

  async function extract(button) {
    syncFromDom();
    await busy(button, async () => {
      const file = state.file;
      state.draft = await api.post('/api/agreements/extract', { filename: file.name, mime: file.type, base64: await readFileBase64(file) });
      state.step = 2;
      draw();
      window.scrollTo(0, 0);
    }, 'Extracting terms…');
  }

  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('clause')) return flashQuote(view.querySelector('#agreement-text'), t.dataset.quote);
    if (t.dataset.remove) {
      syncFromDom();
      const [mi, di] = t.dataset.remove.split(':').map(Number);
      state.draft.terms.milestones[mi].deliverables.splice(di, 1);
      return draw();
    }
    if (t.dataset.add) {
      syncFromDom();
      state.draft.terms.milestones[t.dataset.add].deliverables.push({ id: `dl_new${Date.now()}`, title: 'New deliverable', criterion: '', source: { clauseRef: '', quote: '', verified: false } });
      return draw();
    }
    switch (t.dataset.action) {
      case 'sample':
        syncFromDom();
        state.file = await fetchSample('/samples/agreement-website-redesign.md');
        draw();
        return extract(view.querySelector('[data-action="extract"]'));
      case 'extract':
        return extract(t);
      case 'back':
        syncFromDom();
        state.step = 1;
        return draw();
      case 'confirm':
        syncFromDom();
        return busy(t, async () => {
          const { agreement, terms, extraction } = state.draft;
          const project = await api.post('/api/projects', { name: terms.projectName, client: state.client, agreement, terms, extraction });
          toast('Project created. Add evidence when work is delivered.');
          location.hash = `#/projects/${project.id}`;
        }, 'Creating…');
    }
  });

  view.addEventListener('change', (e) => {
    if (e.target.id === 'agreement-input' && e.target.files[0]) {
      syncFromDom();
      state.file = e.target.files[0];
      draw();
    }
  });
  view.addEventListener('dragover', (e) => { if (e.target.closest('[data-drop]')) e.preventDefault(); });
  view.addEventListener('drop', (e) => {
    if (!e.target.closest('[data-drop]') || !e.dataTransfer.files[0]) return;
    e.preventDefault();
    syncFromDom();
    state.file = e.dataTransfer.files[0];
    draw();
  });

  draw();
}
