// Freelancer workspace: shell, hash router, overview, invoices and activity pages.

import { api } from './api.js';
import { esc, money, date, ago, icon, milestoneChip, invoiceChip, modeChip, toast } from './ui.js';
import { renderProject } from './views/project.js';
import { renderNewProject } from './views/new-project.js';
import { app } from './state.js';

const NAV = [
  ['#/', 'Overview', 'grid'],
  ['#/projects', 'Projects', 'folder'],
  ['#/invoices', 'Invoices', 'wallet'],
  ['#/activity', 'Activity', 'pulse'],
];

function shell(active, crumbs) {
  const caps = app.session.capabilities;
  const ai = caps.ai.live ? `${caps.ai.provider === 'anthropic' ? 'Claude' : 'OpenAI'} · ${caps.ai.model}` : 'Demo rules (no AI key)';
  const pay = caps.payments.live ? `Invoicing v2 sandbox${caps.payments.webhooks ? ' + webhooks' : ''}` : 'Simulated (no sandbox keys)';
  return `<div class="shell">
    <aside class="sidebar">
      <a class="logo" href="#/"><span class="logo-mark">s</span><span>scopepay<span class="dot">.</span></span></a>
      <nav class="main-nav" aria-label="Main">${NAV.map(([href, label, ico]) => `<a href="${href}" class="${active === label ? 'active' : ''}">${icon(ico)}<span>${label}</span>${label === 'Projects' ? `<span class="nav-count">${app.projects.length}</span>` : ''}</a>`).join('')}</nav>
      <div class="sidebar-foot">
        <div class="integrations"><b>Integrations</b>
          <div class="integration"><span class="led ${caps.ai.live ? 'live' : ''}"></span><div>AI review<small>${esc(ai)}</small></div></div>
          <div class="integration"><span class="led ${caps.payments.live ? 'live' : ''}"></span><div>PayPal<small>${esc(pay)}</small></div></div>
        </div>
        <button class="reset" data-action="reset">↺ Reset demo workspace</button>
      </div>
    </aside>
    <main>
      <div class="topbar"><div class="crumbs">${crumbs}</div>
        <span class="pill ${caps.payments.live ? 'live' : 'demo'}">${icon('shield')}${caps.payments.live ? 'PayPal sandbox connected' : 'Demo mode: simulated payments'}</span></div>
      <div class="content" id="view"></div>
    </main></div>`;
}

const crumb = (...parts) => parts.map((p, i) => (i === parts.length - 1 ? `<span class="here">${esc(p)}</span>` : `<a href="#/">${esc(p)}</a>`)).join('<span class="sep">/</span>');

// --- derived numbers --------------------------------------------------------------

const allInvoices = () => app.projects.flatMap((p) => p.invoices.map((i) => ({ ...i, project: p })));
const isPaid = (i) => ['PAID', 'MARKED_AS_PAID'].includes(i.status);
const isOpen = (i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING', 'DRAFT'].includes(i.status);

function projectAttention(p) {
  const notes = [];
  for (const m of p.terms.milestones) {
    const review = p.reviews[m.id];
    if (m.status === 'changes_requested') notes.push(['amber', `${p.client.name} requested changes on ${m.name}.`]);
    else if (review && ['in_progress'].includes(m.status) && review.counts.missing + review.counts.partial) notes.push(['amber', `${m.name}: ${review.counts.missing} missing and ${review.counts.partial} partial deliverable(s).`]);
    else if (m.status === 'submitted') notes.push(['blue', `${m.name} is awaiting the client's acceptance.`]);
  }
  for (const i of p.invoices) if (i.status === 'DRAFT') notes.push(['green', `${i.title} was approved. Invoice ready to send.`]);
  return notes[0];
}

function projectRow(p) {
  const ms = p.terms.milestones;
  const paid = ms.filter((m) => m.status === 'paid').length;
  const attention = projectAttention(p);
  return `<a class="project-row" href="#/projects/${p.id}">
    <div class="row-top"><span class="badge-icon">${icon('globe')}</span>
      <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:10px"><h3>${esc(p.name)}</h3><span class="chip ${paid === ms.length ? 'green' : 'grey'}">${paid}/${ms.length} paid</span></div>
      <div class="sub" style="margin-top:2px">${esc(p.client.name)}</div></div></div>
    <div class="meta"><span>Value <b>${money(p.terms.total, p.currency)}</b></span><span>Milestones <b>${ms.length}</b></span><span>Next due <b>${date(ms.find((m) => m.status !== 'paid')?.dueDate)}</b></span></div>
    <div class="progress">${ms.map((m) => `<span class="${m.status === 'paid' ? 'paid' : m.status !== 'in_progress' ? 'active' : ''}"></span>`).join('')}</div>
    ${attention ? `<div class="callout ${attention[0]}">${icon(attention[0] === 'green' ? 'check' : 'alert')}${esc(attention[1])}</div>` : ''}
  </a>`;
}

function activityList(items, limit = 8) {
  const ico = { evidence: 'upload', review: 'spark', approval: 'check', invoice: 'wallet', paid: 'wallet', scope: 'scope', agreement: 'file', error: 'alert', changes: 'alert', submit: 'send' };
  if (!items.length) return '<div class="empty">Nothing yet.</div>';
  return `<ul class="activity">${items.slice(0, limit).map((a) => `<li><span class="ico">${icon(ico[a.kind] || 'pulse')}</span><div>${esc(a.text)}${a.project ? ` <span style="color:var(--muted)">· ${esc(a.project)}</span>` : ''}<time datetime="${esc(a.at)}">${ago(a.at)}</time></div></li>`).join('')}</ul>`;
}
const allActivity = () => app.projects.flatMap((p) => p.activity.map((a) => ({ ...a, project: p.name }))).sort((a, b) => b.at.localeCompare(a.at));

// --- pages -----------------------------------------------------------------------------

function overview(view) {
  const invoices = allInvoices();
  const outstanding = invoices.filter((i) => isOpen(i) && i.status !== 'DRAFT');
  const awaiting = app.projects.flatMap((p) => p.terms.milestones.filter((m) => m.status === 'submitted')).length;
  const paid = invoices.filter(isPaid).reduce((n, i) => n + i.amount, 0);
  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Agreed · Delivered · Approved · Paid</div><h1>Good to see you, Jamie</h1><p class="sub">Every milestone backed by evidence your client can check.</p></div>
      <a class="btn primary" href="#/new">${icon('plus')} New project</a></div>
    <div class="stats">
      ${stat('Active projects', app.projects.filter((p) => p.terms.milestones.some((m) => m.status !== 'paid')).length, 'folder', 'Across your workspace')}
      ${stat('Awaiting client', awaiting, 'send', 'Milestones shared for acceptance')}
      ${stat('Outstanding', money(outstanding.reduce((n, i) => n + i.amount, 0)), 'file', `${outstanding.length} invoice(s) sent via PayPal`)}
      ${stat('Collected', money(paid), 'wallet', 'Paid invoices, incl. sample history')}
    </div>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>Your projects</h2><a class="btn small" href="#/new">${icon('plus')} New</a></div>${app.projects.map(projectRow).join('') || '<div class="empty">No projects yet.</div>'}</section>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>Recent activity</h2></div>${activityList(allActivity(), 7)}</section>
        <section class="card card-body" style="background:#eef4ef;border-color:#dce9df">
          <div class="eyebrow" style="color:#4c7a5e">${icon('spark')} How ScopePay works</div>
          <ol style="padding-left:18px;margin:12px 0 0;font-size:13px;color:#3f5a4b;display:grid;gap:6px">
            <li>AI turns the agreement into milestones and acceptance criteria, each citing its clause.</li>
            <li>AI checks delivered screenshots and files against every criterion.</li>
            <li>The client reviews the evidence and accepts. Humans decide.</li>
            <li>Acceptance creates a PayPal invoice; payment updates the milestone.</li>
          </ol></section>
      </div>
    </div>`;
}

const stat = (label, value, ico, foot) => `<div class="card stat"><div class="stat-top">${label}${icon(ico)}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;

function projectsPage(view) {
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Workspace</div><h1>Projects</h1><p class="sub">Agreed work, clear milestones, and the evidence behind them.</p></div><a class="btn primary" href="#/new">${icon('plus')} New project</a></div>
    <section class="card">${app.projects.map(projectRow).join('') || '<div class="empty">No projects yet.</div>'}</section>`;
}

function invoicesPage(view) {
  const invoices = allInvoices().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">PayPal Invoicing</div><h1>Invoices</h1><p class="sub">Every invoice links back to the client approval that triggered it.</p></div></div>
    <section class="card" style="overflow-x:auto"><table>
      <thead><tr><th>Invoice</th><th>Project</th><th class="hide-sm">Approved by</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${invoices.map((i) => `<tr>
        <td><a href="#/projects/${i.project.id}">${esc(i.title)}</a><div class="sub" style="margin:2px 0 0">${esc(i.number || '—')} · ${modeChip(i.mode)}</div></td>
        <td>${esc(i.project.name)}<div class="sub" style="margin:2px 0 0">${esc(i.project.client.name)}</div></td>
        <td class="hide-sm">${esc(i.approvedBy)}<div class="sub" style="margin:2px 0 0">${date(i.approvedAt)}</div></td>
        <td>${invoiceChip(i.status)}</td><td class="num">${money(i.amount, i.project.currency)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No invoices yet. They appear when a client accepts a milestone.</td></tr>'}</tbody>
    </table></section>`;
}

function activityPage(view) {
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Audit trail</div><h1>Activity</h1><p class="sub">Every extraction, review, approval and payment, in order.</p></div></div>
    <section class="card">${activityList(allActivity(), 200)}</section>`;
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
    const projectMatch = /^#\/projects\/([\w]+)/.exec(hash);
    if (projectMatch) {
      const p = app.projects.find((x) => x.id === projectMatch[1]);
      root.innerHTML = shell('Projects', crumb('Workspace', 'Projects', p?.name || 'Project'));
      return renderProject(document.getElementById('view'), projectMatch[1]);
    }
    const pages = { '#/': ['Overview', overview], '#/projects': ['Projects', projectsPage], '#/invoices': ['Invoices', invoicesPage], '#/activity': ['Activity', activityPage], '#/new': ['Projects', renderNewProject] };
    const [label, render] = pages[hash] || pages['#/'];
    root.innerHTML = shell(label, crumb('Workspace', hash === '#/new' ? 'New project' : label));
    await render(document.getElementById('view'));
  } catch (error) {
    root.innerHTML = `<div class="empty" style="padding:80px">Could not load ScopePay: ${esc(error.message)}</div>`;
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-action="reset"]')) {
    if (!confirm('Reset this workspace to the sample project? Your demo data will be removed.')) return;
    await api.post('/api/workspace/reset');
    toast('Workspace reset to the sample project.');
    location.hash = '#/';
    route();
  }
});

window.addEventListener('hashchange', route);
app.session = await api.get('/api/session');
route();
