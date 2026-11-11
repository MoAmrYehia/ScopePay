// Freelancer workspace: shell, hash router, overview, invoices and activity pages.

import { api } from './api.js';
import { esc, money, balance, date, icon, invoiceChip, modeChip, toast, pageBand } from './ui.js';
import { renderProject } from './views/project.js';
import { renderNewProject } from './views/new-project.js';
import { app } from './state.js';
import { ledgerGrid, twoLine } from './grid.js';

const NAV = [
  ['#/', 'Overview'],
  ['#/projects', 'Projects'],
  ['#/invoices', 'Invoices'],
  ['#/activity', 'Activity'],
];

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'S';

function accountMenu() {
  const { user, freelancer } = app.session;
  if (user) {
    return `<div class="menu-wrap"><button class="avatar" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-label="Account menu for ${esc(user.name)}">${esc(initials(user.name))}</button>
      <div class="menu" role="menu" hidden>
        <div class="menu-head"><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div>
        <a role="menuitem" href="#/settings">Settings</a>
        <a role="menuitem" href="/">ScopePay website</a>
        <button role="menuitem" data-action="signout">Sign out</button>
      </div></div>`;
  }
  return `<div class="menu-wrap"><button class="avatar" data-action="menu" aria-haspopup="true" aria-expanded="false" aria-label="Demo menu">${esc(initials(freelancer.name))}</button>
    <div class="menu" role="menu" hidden>
      <div class="menu-head"><b>Demo workspace</b><span>Signed in as the sample freelancer</span></div>
      <a role="menuitem" href="/signup">Create your account</a>
      <button role="menuitem" data-action="reset">Reset demo</button>
      <a role="menuitem" href="/">Leave the demo</a>
    </div></div>`;
}

function shell(active) {
  const caps = app.session.capabilities;
  const ai = caps.ai.live ? `AI review: ${caps.ai.provider === 'anthropic' ? 'Claude' : 'OpenAI'}` : 'AI review: demo rules';
  const pay = caps.payments.live ? `PayPal sandbox${caps.payments.webhooks ? ' with webhooks' : ''}` : 'PayPal: simulated';
  const servicesDemo = !caps.ai.live || !caps.payments.live;
  const notes = [];
  if (app.session.demo) notes.push('You are in the live demo. Changes stay in this browser for 7 days. <a href="/signup">Create a free account</a> to keep your own projects.');
  if (servicesDemo) notes.push(`${!caps.payments.live ? 'Invoices are simulated and no money moves. ' : ''}${!caps.ai.live ? 'Evidence checks use file names instead of AI.' : ''}`);
  return `
    <header class="topnav"><div class="inner">
      <a class="logo" href="#/" aria-label="ScopePay overview"><span class="logo-mark">S</span>ScopePay</a>
      <nav class="main-nav" aria-label="Main">${NAV.map(([href, label]) => `<a href="${href}" class="${active === label ? 'active' : ''}" ${active === label ? 'aria-current="page"' : ''}>${label}${label === 'Projects' ? `<span class="nav-count">${app.projects.length}</span>` : ''}</a>`).join('')}</nav>
      <div class="nav-right">
        <span class="status-item"><span class="led ${caps.ai.live ? 'live' : ''}"></span>${esc(ai)}</span>
        <span class="status-item"><span class="led ${caps.payments.live ? 'live' : ''}"></span>${esc(pay)}</span>
        ${accountMenu()}
      </div>
    </div></header>
    ${notes.length ? `<div class="mode-banner"><div class="inner">${icon('alert')}<span>${notes.join(' ')}</span></div></div>` : ''}
    <main id="view"></main>
    <div class="footer-note"><span>Payments are processed by PayPal. ScopePay never stores card or bank details.</span><span><a href="/privacy">Privacy</a> &nbsp; <a href="/terms">Terms</a></span></div>`;
}

// --- derived numbers --------------------------------------------------------------

const allInvoices = () => app.projects.flatMap((p) => p.invoices.map((i) => ({ ...i, project: p })));
const isPaid = (i) => ['PAID', 'MARKED_AS_PAID'].includes(i.status);
const isOutstanding = (i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING'].includes(i.status);
const sum = (list) => list.reduce((n, i) => n + i.amount, 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function nextStep(p) {
  for (const i of p.invoices) if (i.status === 'DRAFT') return ['green', `${i.title} approved. Invoice ready to send.`];
  for (const m of p.terms.milestones) {
    const review = p.reviews[m.id];
    if (m.status === 'changes_requested') return ['amber', `${p.client.name} asked for changes on ${m.name}.`];
    if (m.status === 'submitted') return ['blue', `${m.name} is waiting for the client's acceptance.`];
    if (m.status === 'in_progress' && review && review.counts.missing + review.counts.partial) {
      return ['amber', `${m.name}: ${review.counts.missing} missing, ${review.counts.partial} partial.`];
    }
    if (m.status === 'in_progress') return ['', `${m.name}: collect evidence and run the review.`];
  }
  const unpaid = p.invoices.find(isOutstanding);
  if (unpaid) return ['blue', `${unpaid.title}: waiting for payment.`];
  return ['green', 'All milestones paid.'];
}

function projectRow(p) {
  const ms = p.terms.milestones;
  const paid = ms.filter((m) => m.status === 'paid');
  const [tone, text] = nextStep(p);
  return `<a class="project-row" href="#/projects/${p.id}">
    <div><div class="name">${esc(p.name)}</div><div class="client">${esc(p.client.name)}</div></div>
    <div class="progress-cell"><div class="progress" aria-hidden="true">${ms.map((m) => `<span class="${m.status === 'paid' ? 'paid' : m.status !== 'in_progress' ? 'active' : ''}"></span>`).join('')}</div>
      <div class="progress-label">${paid.length} of ${ms.length} milestones paid</div></div>
    <div class="next-cell"><div class="next ${tone}">${esc(text)}</div></div>
    <div class="amount-col">${money(p.terms.total, p.currency)}<small>${money(sum(p.invoices.filter(isPaid)), p.currency)} received</small></div>
  </a>`;
}

const projectLedger = (projects) => `
  <div class="ledger-head" aria-hidden="true"><span>Project</span><span>Progress</span><span>Next step</span><span style="text-align:right">Contract value</span></div>
  ${projects.map(projectRow).join('') || '<div class="empty">No projects yet. Start one from a signed agreement.</div>'}`;

function activityList(items, limit) {
  if (!items.length) return '<div class="empty">No activity yet.</div>';
  return `<ul class="activity">${items.slice(0, limit).map((a) => {
    const d = new Date(a.at);
    return `<li><div class="when"><b>${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
      <div class="what">${esc(a.text)}${a.project ? `<small>${esc(a.project)}</small>` : ''}</div></li>`;
  }).join('')}</ul>`;
}
const allActivity = () => app.projects.flatMap((p) => p.activity.map((a) => ({ ...a, project: p.name }))).sort((a, b) => b.at.localeCompare(a.at));

// --- pages -----------------------------------------------------------------------------

function overview(view) {
  const invoices = allInvoices();
  const collected = invoices.filter(isPaid);
  const outstanding = invoices.filter(isOutstanding);
  const drafts = invoices.filter((i) => i.status === 'DRAFT');
  const awaiting = app.projects.flatMap((p) => p.terms.milestones.filter((m) => m.status === 'submitted').map((m) => ({ ...m, currency: p.currency })));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const { freelancer } = app.session;
  const band = pageBand(`${greeting}, ${freelancer.name.split(' ')[0]}`, { sub: esc(freelancer.businessName), actions: `<a class="btn primary" href="#/new">${icon('plus')} New project</a>` });
  if (!app.projects.length) {
    view.innerHTML = `${band}<div class="content"><section class="card welcome">
      <h2>Start with a signed agreement</h2>
      <p class="sub">Upload the agreement for a project you are working on. ScopePay extracts its milestones and acceptance conditions, and you confirm them before anything else happens.</p>
      <div class="actions" style="margin-top:20px"><a class="btn primary" href="#/new">${icon('plus')} New project from an agreement</a><button class="btn" data-action="add-sample">Add the sample project</button></div>
      <p class="sub" style="margin-top:16px">The sample is a website redesign with one milestone paid and one ready to review, so you can try every step.</p>
    </section></div>`;
    return;
  }
  view.innerHTML = `
    ${band}
    <div class="content">
      <section class="card summary" aria-label="Account summary">
        <div><div class="label">Collected to date</div>
          <div class="balance">${balance(sum(collected))}</div>
          <div class="note">${plural(collected.length, 'paid invoice')} across ${plural(app.projects.length, 'project')}</div>
          <div class="actions"><a class="btn small" href="#/invoices">View invoices</a><a class="btn small" href="#/activity">Statement of activity</a></div></div>
        <div><div class="label">Outstanding</div><div class="figure">${money(sum(outstanding))}</div><div class="note">${plural(outstanding.length, 'invoice')} sent, not yet paid</div></div>
        <div><div class="label">Awaiting acceptance</div><div class="figure">${money(sum(awaiting))}</div><div class="note">${plural(awaiting.length, 'milestone')} with your clients</div></div>
        <div><div class="label">Ready to invoice</div><div class="figure">${money(sum(drafts))}</div><div class="note">${plural(drafts.length, 'approved invoice')} to send</div></div>
      </section>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Your projects</h2><a class="btn small" href="#/projects">All projects</a></div>${projectLedger(app.projects)}</section>
        <div class="stack">
          <section class="card"><div class="card-head"><h2>Recent activity</h2><a href="#/activity" style="font-size:13px">See all</a></div>${activityList(allActivity(), 6)}</section>
          <section class="card"><div class="card-head"><h2>How payments are released</h2></div>
            <ol class="steps-list">
              <li>AI turns the agreement into milestones and acceptance conditions, each citing its clause.</li>
              <li>AI checks delivered screenshots and files against every condition.</li>
              <li>Your client reviews the evidence and accepts. People make the decision.</li>
              <li>Acceptance issues a PayPal invoice. Payment closes the milestone.</li>
            </ol></section>
        </div>
      </div>
    </div>`;
}

function projectsPage(view) {
  view.innerHTML = `${pageBand('Projects', { sub: 'Agreed work, milestone by milestone, with the evidence behind each payment.', actions: `<a class="btn primary" href="#/new">${icon('plus')} New project</a>` })}
    <div class="content stack">
      <section class="card">${projectLedger(app.projects)}</section>
      ${app.projects.length ? pipelineSection() : ''}
    </div>`;
  if (app.projects.length) mountPipeline(view);
}

// --- payment pipeline (AG Grid): every milestone across projects -------------------------

const STAGES = ['in_progress', 'changes_requested', 'submitted', 'approved', 'invoiced', 'paid'];
const STAGE_LABEL = { in_progress: 'In progress', changes_requested: 'Changes requested', submitted: 'Awaiting client', approved: 'Accepted', invoiced: 'Invoiced', paid: 'Paid' };

function pipelineRows() {
  return app.projects.flatMap((p) => p.terms.milestones.map((m) => {
    const review = p.reviews[m.id];
    const invoice = p.invoices.find((i) => i.kind === 'milestone' && i.targetId === m.id);
    return {
      projectId: p.id, milestoneId: m.id, project: p.name, client: p.client.name, milestone: `${m.index}. ${m.name}`,
      due: m.dueDate, status: m.status, stage: STAGES.indexOf(m.status), currency: p.currency, amount: m.amount,
      criteria: m.deliverables.length, met: review ? review.counts.met : null, partial: review?.counts.partial || 0, missing: review?.counts.missing || 0,
      acceptedBy: invoice?.approvedBy || '', invoice: invoice ? `${invoice.number || 'pending'}` : '', invoiceStatus: invoice?.status || '',
    };
  }));
}

function pipelineSection() {
  return `<section class="card"><div class="card-head"><div><h2>Payment pipeline</h2><p class="sub" style="margin-top:2px">Every milestone across your projects, from evidence to payment. Click a row to open it.</p></div>
    <div class="grid-tools"><label class="sr-only" for="pipeline-search">Search milestones</label><input type="text" id="pipeline-search" placeholder="Search milestones" autocomplete="off">
    <button class="btn small" data-export="pipeline">Export CSV</button></div></div>
    <div id="pipeline-grid" class="grid-host"></div></section>`;
}

function mountPipeline(view) {
  const evidenceCell = (r) => {
    if (r.met == null) return `<span class="grid-muted">Not reviewed</span>`;
    const seg = (n, cls) => (n ? `<span class="${cls}" style="flex:${n}"></span>` : '');
    return `<div class="cell-2" title="${r.met} met, ${r.partial} partial, ${r.missing} missing"><div class="evidence-bar">${seg(r.met, 'met')}${seg(r.partial, 'partial')}${seg(r.missing, 'missing')}</div><small class="grid-muted">${r.met} of ${r.criteria} met${r.missing ? `, ${r.missing} missing` : ''}</small></div>`;
  };
  const grid = ledgerGrid(view.querySelector('#pipeline-grid'), {
    rowData: pipelineRows(),
    columnDefs: [
      { headerName: 'Milestone', field: 'milestone', flex: 1.6, minWidth: 220, cellRenderer: (p) => twoLine(`<a href="#/projects/${p.data.projectId}/${p.data.milestoneId}">${esc(p.value)}</a>`, esc(`${p.data.project} for ${p.data.client}`)), getQuickFilterText: (p) => `${p.value} ${p.data.project} ${p.data.client}` },
      { headerName: 'Due', field: 'due', width: 130, sort: 'asc', valueFormatter: (p) => date(p.value), filter: 'agDateColumnFilter', filterParams: { comparator: (d, v) => (v ? Date.parse(v) - d.getTime() : 0) } },
      { headerName: 'Stage', field: 'stage', width: 170, valueFormatter: (p) => STAGE_LABEL[p.data.status], cellRenderer: (p) => milestoneChipHtml(p.data.status), filterValueGetter: (p) => STAGE_LABEL[p.data.status], filter: 'agTextColumnFilter' },
      { headerName: 'Evidence check', field: 'met', width: 170, cellRenderer: (p) => evidenceCell(p.data), comparator: (a, b) => (a ?? -1) - (b ?? -1), filter: false },
      { headerName: 'Accepted by', field: 'acceptedBy', width: 150, cellRenderer: (p) => (p.value ? esc(p.value) : '<span class="grid-muted">Not yet</span>') },
      { headerName: 'PayPal invoice', field: 'invoiceStatus', width: 160, cellRenderer: (p) => (p.value ? twoLine(invoiceChip(p.value), `No. ${esc(p.data.invoice)}`) : '<span class="grid-muted">Not issued</span>') },
      { headerName: 'Amount', field: 'amount', width: 140, type: 'rightAligned', valueFormatter: (p) => money(p.value, p.data?.currency || 'USD'), filter: 'agNumberColumnFilter', cellClass: 'grid-amount' },
    ],
    onRowClicked: (e) => { if (!e.event.target.closest('a')) location.hash = `#/projects/${e.data.projectId}/${e.data.milestoneId}`; },
    rowClass: 'grid-clickable',
  });
  view.querySelector('#pipeline-search').addEventListener('input', (e) => grid.setGridOption('quickFilterText', e.target.value));
  view.querySelector('[data-export="pipeline"]').addEventListener('click', () => grid.exportDataAsCsv({
    fileName: 'scopepay-payment-pipeline.csv',
    processCellCallback: (p) => (p.column.getColId() === 'stage' ? STAGE_LABEL[p.node.data.status] : p.column.getColId() === 'due' ? p.value || '' : p.value),
  }));
}

const milestoneChipHtml = (status) => {
  const tone = { in_progress: 'grey', changes_requested: 'amber', submitted: 'blue', approved: 'green', invoiced: 'blue', paid: 'green' }[status] || 'grey';
  return `<span class="chip ${tone}">${esc(STAGE_LABEL[status] || status)}</span>`;
};

// --- invoice ledger (AG Grid) -------------------------------------------------------------

const INVOICE_FILTERS = [
  ['all', 'All', () => true],
  ['draft', 'Ready to send', (i) => i.status === 'DRAFT'],
  ['open', 'Awaiting payment', (i) => isOutstanding(i)],
  ['paid', 'Paid', (i) => isPaid(i)],
];

function invoicesPage(view) {
  const invoices = allInvoices();
  const rows = invoices.map((i) => ({
    id: i.id, projectId: i.project.id, title: i.title, number: i.number || 'pending', client: i.project.client.name, project: i.project.name,
    approvedAt: i.approvedAt, approvedBy: i.approvedBy, sentAt: i.sentAt || null, paidAt: i.paidAt || null, mode: i.mode, status: i.status,
    amount: i.amount, currency: i.project.currency, kind: i.kind, raw: i,
  }));
  view.innerHTML = `${pageBand('Invoices', { sub: 'Every invoice is issued from a recorded client acceptance and sent through PayPal.' })}
    <div class="content">
      <section class="card">
        <div class="card-head">
          <div class="segmented" role="group" aria-label="Filter invoices">${INVOICE_FILTERS.map(([k, label, test], idx) => `<button data-filter="${k}" aria-pressed="${idx === 0}">${label}<span>${invoices.filter(test).length}</span></button>`).join('')}</div>
          <div class="grid-tools"><label class="sr-only" for="invoice-search">Search invoices</label><input type="text" id="invoice-search" placeholder="Search by client, project or number" autocomplete="off">
            <button class="btn small" data-export="invoices">Export CSV</button></div>
        </div>
        <div id="invoice-grid" class="grid-host"></div>
      </section>
    </div>`;

  let active = INVOICE_FILTERS[0];
  const totals = () => {
    let shown = 0, paid = 0, count = 0;
    grid.forEachNodeAfterFilter((n) => { if (n.data) { count++; shown += n.data.amount; if (isPaid(n.data)) paid += n.data.amount; } });
    grid.setGridOption('pinnedBottomRowData', count ? [{ title: `${count} invoice${count === 1 ? '' : 's'}`, totalRow: true, amount: shown, paidTotal: paid, currency: 'USD' }] : []);
  };
  const grid = ledgerGrid(view.querySelector('#invoice-grid'), {
    rowData: rows,
    columnDefs: [
      { headerName: 'Invoice', field: 'title', flex: 1.5, minWidth: 220, sort: null,
        cellRenderer: (p) => (p.data.totalRow ? `<b>${esc(p.value)}</b>` : twoLine(`<a href="#/projects/${p.data.projectId}">${esc(p.value)}</a>`, `No. ${esc(p.data.number)}`)),
        getQuickFilterText: (p) => `${p.value} ${p.data.number}` },
      { headerName: 'Billed to', field: 'client', flex: 1, minWidth: 170, cellRenderer: (p) => (p.data.totalRow ? '' : twoLine(esc(p.value), esc(p.data.project))), getQuickFilterText: (p) => `${p.value} ${p.data.project}` },
      { headerName: 'Accepted', field: 'approvedAt', width: 170, sort: 'desc', filter: 'agDateColumnFilter', filterParams: { comparator: (d, v) => (v ? Date.parse(v.slice(0, 10)) - d.getTime() : 0) },
        cellRenderer: (p) => (p.data.totalRow ? '' : twoLine(date(p.value), `by ${esc(p.data.approvedBy)}`)) },
      { headerName: 'Paid', field: 'paidAt', width: 120, valueFormatter: (p) => (p.data.totalRow ? '' : p.value ? date(p.value) : '—'), filter: false },
      { headerName: 'Channel', field: 'mode', width: 150, cellRenderer: (p) => (p.data.totalRow ? '' : modeChip(p.value)), filterValueGetter: (p) => ({ sandbox: 'PayPal sandbox', simulated: 'Simulated', sample: 'Sample history' })[p.data.mode] },
      { headerName: 'Status', field: 'status', width: 160, cellRenderer: (p) => (p.data.totalRow ? (p.data.paidTotal ? `<span class="grid-muted">${money(p.data.paidTotal)} paid</span>` : '') : invoiceChip(p.value)) },
      { headerName: 'Amount', field: 'amount', width: 150, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: (p) => money(p.value, p.data?.currency || 'USD'), cellClass: 'grid-amount' },
    ],
    isExternalFilterPresent: () => active[0] !== 'all',
    doesExternalFilterPass: (node) => active[2](node.data),
    getRowClass: (p) => (p.data.totalRow ? 'grid-total' : 'grid-clickable'),
    onRowClicked: (e) => { if (!e.data.totalRow && !e.event.target.closest('a')) location.hash = `#/projects/${e.data.projectId}`; },
    onFilterChanged: totals,
    onRowDataUpdated: totals,
    overlayNoRowsTemplate: '<span class="grid-empty">No invoices yet. One is issued when a client accepts a milestone.</span>',
  });
  totals();

  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    active = INVOICE_FILTERS.find(([k]) => k === b.dataset.filter);
    view.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    grid.onFilterChanged();
  }));
  view.querySelector('#invoice-search').addEventListener('input', (e) => grid.setGridOption('quickFilterText', e.target.value));
  view.querySelector('[data-export="invoices"]').addEventListener('click', () => grid.exportDataAsCsv({
    fileName: 'scopepay-invoices.csv',
    columnKeys: ['title', 'client', 'approvedAt', 'paidAt', 'mode', 'status', 'amount'],
    shouldRowBeSkipped: (p) => Boolean(p.node.data?.totalRow),
  }));
}

function settingsPage(view) {
  const { user } = app.session;
  if (!user) {
    view.innerHTML = `${pageBand('Settings')}<div class="content"><section class="card card-body"><p>The demo has no account settings. <a href="/signup">Create a free account</a> to keep your own projects and send invoices under your business name.</p></section></div>`;
    return;
  }
  view.innerHTML = `${pageBand('Settings', { sub: `Signed in as ${esc(user.email)}` })}
    <div class="content"><div class="settings">
      <section class="card"><div class="card-head"><h2>Profile</h2></div>
        <form class="card-body form-grid" data-form="profile">
          <label class="field">Your name<input type="text" name="name" value="${esc(user.name)}" autocomplete="name" required></label>
          <label class="field">Business name<input type="text" name="businessName" value="${esc(user.businessName)}" autocomplete="organization"></label>
          <p class="sub" style="grid-column:1/-1;margin:0">Your business name appears on client review pages and on PayPal invoices.</p>
          <div class="actions"><button class="btn primary" type="submit">Save profile</button></div>
        </form></section>
      <section class="card"><div class="card-head"><h2>Password</h2></div>
        <form class="card-body form-grid" data-form="password">
          <label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label>
          <label class="field">New password<input type="password" name="newPassword" autocomplete="new-password" minlength="10" required></label>
          <div class="actions"><button class="btn primary" type="submit">Change password</button></div>
        </form></section>
      <section class="card"><div class="card-head"><h2>Delete account</h2></div>
        <form class="card-body form-grid" data-form="delete">
          <p class="sub" style="grid-column:1/-1;margin:0">Deletes your account, all projects and evidence files. Invoices already created in PayPal stay in your PayPal account. This cannot be undone.</p>
          <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
          <div class="actions"><button class="btn danger" type="submit">Delete my account</button></div>
        </form></section>
    </div></div>`;
}

function activityPage(view) {
  view.innerHTML = `${pageBand('Activity', { sub: 'Every extraction, review, acceptance and payment, most recent first.' })}
    <div class="content"><section class="card">${activityList(allActivity(), 300)}</section></div>`;
}

// --- router --------------------------------------------------------------------------

export async function refreshProjects() {
  app.projects = await api.get('/api/projects');
}

export async function route() {
  clearInterval(app.timer);
  const hash = location.hash || '#/';
  const root = document.getElementById('app');
  try {
    await refreshProjects();
    const projectMatch = /^#\/projects\/([\w]+)(?:\/([\w]+))?/.exec(hash);
    if (projectMatch) {
      root.innerHTML = shell('Projects');
      return renderProject(document.getElementById('view'), projectMatch[1], projectMatch[2]);
    }
    const pages = { '#/': ['Overview', overview], '#/projects': ['Projects', projectsPage], '#/invoices': ['Invoices', invoicesPage], '#/activity': ['Activity', activityPage], '#/new': ['Projects', renderNewProject], '#/settings': ['', settingsPage] };
    const [label, render] = pages[hash] || pages['#/'];
    root.innerHTML = shell(label);
    await render(document.getElementById('view'));
    window.scrollTo(0, 0);
  } catch (error) {
    root.innerHTML = `<div class="empty" style="padding:80px">ScopePay could not load: ${esc(error.message)}. Refresh the page to try again.</div>`;
  }
}

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => (m.hidden = true));
  document.querySelectorAll('[data-action="menu"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action !== 'menu' && !e.target.closest('.menu')) closeMenus();
  if (action === 'menu') {
    const menu = e.target.closest('.menu-wrap').querySelector('.menu');
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    e.target.closest('[data-action]').setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('a, button')?.focus();
  }
  if (action === 'reset') {
    closeMenus();
    if (!confirm('Reset the demo to the sample project? Your demo changes will be removed.')) return;
    await api.post('/api/workspace/reset');
    toast('Demo reset to the sample project.');
    location.hash = '#/';
    route();
  }
  if (action === 'signout') {
    await api.post('/api/auth/signout');
    location.assign('/');
  }
  if (action === 'add-sample') {
    const button = e.target.closest('button');
    button.disabled = true;
    try {
      const project = await api.post('/api/workspace/sample');
      location.hash = `#/projects/${project.id}`;
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    if (form.dataset.form === 'profile') {
      const { user } = await api.post('/api/account', body);
      app.session = await api.get('/api/session');
      toast(`Profile saved. Clients now see ${user.businessName}.`);
      route();
    } else if (form.dataset.form === 'password') {
      await api.post('/api/account/password', body);
      form.reset();
      toast('Password changed.');
    } else if (form.dataset.form === 'delete') {
      if (!confirm('Delete your account and all of its projects? This cannot be undone.')) return;
      await api.post('/api/account/delete', body);
      location.assign('/');
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

window.addEventListener('hashchange', route);
app.session = await api.get('/api/session');
if (!app.session.user && !app.session.demo) location.replace('/signin?next=/app');
else route();
