// Freelancer workspace: shell, hash router, overview, invoices and activity pages.

import { api } from './api.js';
import { esc, money, balance, date, icon, invoiceChip, modeChip, toast, pageBand } from './ui.js';
import { renderProject } from './views/project.js';
import { renderNewProject } from './views/new-project.js';
import { app } from './state.js';

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
    <div class="content"><section class="card">${projectLedger(app.projects)}</section></div>`;
}

function invoicesPage(view) {
  const invoices = allInvoices().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const row = (i) => `<tr>
    <td><a href="#/projects/${i.project.id}">${esc(i.title)}</a><small>No. ${esc(i.number || 'pending')}</small></td>
    <td class="hide-sm">${esc(i.project.client.name)}<small>${esc(i.project.name)}</small></td>
    <td class="hide-sm">${date(i.approvedAt)}<small>Accepted by ${esc(i.approvedBy)}</small></td>
    <td class="hide-sm">${modeChip(i.mode)}</td>
    <td>${invoiceChip(i.status)}</td>
    <td class="num">${money(i.amount, i.project.currency)}</td></tr>`;
  view.innerHTML = `${pageBand('Invoices', { sub: 'Every invoice is issued from a recorded client acceptance and sent through PayPal.' })}
    <div class="content"><section class="card table-wrap"><table>
      <thead><tr><th>Invoice</th><th class="hide-sm">Billed to</th><th class="hide-sm">Accepted</th><th class="hide-sm">Channel</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${invoices.map(row).join('') || '<tr><td colspan="6" class="empty">No invoices yet. One is issued when a client accepts a milestone.</td></tr>'}</tbody>
      ${invoices.length ? `<tfoot><tr><td colspan="5" class="hide-sm">Total received</td><td class="num">${money(sum(invoices.filter(isPaid)))}</td></tr></tfoot>` : ''}
    </table></section></div>`;
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
    const projectMatch = /^#\/projects\/([\w]+)/.exec(hash);
    if (projectMatch) {
      root.innerHTML = shell('Projects');
      return renderProject(document.getElementById('view'), projectMatch[1]);
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
