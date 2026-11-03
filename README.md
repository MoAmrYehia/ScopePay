# ScopePay

**Connect the agreement, the delivered work, and the payment.**

A responsive, single-user MVP for freelancers and small agencies. Includes a project dashboard, structured agreement import, three equal milestones, five-page acceptance checklist with agreement references, evidence attachment, human approval, invoices, reminders, and activity history.

## Run

Requires Node.js 22+ (tested on 24). No runtime packages are required.

```sh
cd /workspace/ScopePay
npm ci
npm start
```

The server listens on port 3000; override with `PORT`. `npm run dev` restarts the server when its files change. The cloud command sandbox may require permission to bind a listening port.

## Try the demo

1. Open Website redesign → Review evidence.
2. See four pages matched and Portfolio missing, with the agreement reference. Approval is disabled.
3. Add a screenshot or document as Portfolio evidence.
4. Use “Client: approve milestone”, then create a demo invoice.
5. Simulate payment and see the dashboard update. Reload to verify persistence.

New project accepts a `.txt` agreement, a total USD value, three equally sized milestones, and Home, About, Services, Portfolio, and Contact pages. Use the prefilled example as the supported format. All five missing pages can receive evidence. Use Settings to reset the demo.

## Optional integrations

Credentials stay on the server; never put them into browser source. Export the following through secure environment settings before restarting the server:

- `OPENAI_API_KEY`: enables the “Extract with AI” agreement action. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Review extracted terms before accepting them.
- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: sandbox REST app credentials.
- `PAYPAL_INVOICER_EMAIL`: sandbox merchant account email.
- `PAYPAL_RECIPIENT_EMAIL`: sandbox buyer account email.

When configured, invoice dialogs expose separate actions to create, send, retrieve status, and remind through PayPal Invoicing v2. Client acceptance is recorded on the server before sandbox invoice creation. Repeated creation reuses the same invoice and request ID. Only a PayPal `PAID` response from Refresh status marks a sandbox invoice paid. Complete payment using the sandbox buyer account in PayPal; the separate simulation action moves no funds. Sandbox IDs and approval records persist in ignored `data/invoices.json`.

Required HTTPS destinations: `api-m.sandbox.paypal.com` and, for AI, `api.openai.com`. Keep TLS verification enabled. In managed proxy environments use a Node version supporting environment proxy routing and start with `NODE_USE_ENV_PROXY=1 npm start`. The adapters have mock-based tests; live provider behavior has not been verified without credentials.

## Validation

```sh
node --test tests/integrations.test.js
# Start the app in another terminal first:
npm test
```

Browser checks use Playwright with `/usr/bin/chromium`; set `CHROMIUM_PATH` for another installed Chromium. Tests run in an isolated browser context and cover the missing-evidence approval guard, uploads, approval, invoice, simulated payment, persistence, agreement import, mobile overflow, and browser errors. Screenshots are written to `/tmp/scopepay-desktop.png` and `/tmp/scopepay-mobile.png`.

## MVP boundaries

This is a local demonstration, not a public multi-user payment service. The client approval button represents the client role in the same browser; there is no authentication, shareable client portal, authorization model, or immutable audit log. Do not expose it publicly or use production payment credentials. Approval endpoints are for this single-user sandbox workflow.

Default extraction uses template rules. Evidence matching uses page labels and file names, not visual understanding or document content analysis. Uploaded file contents are not retained or analyzed; the file name becomes the reference, and a human must inspect the actual delivered work separately. Agreement quotes in the seeded scenario are illustrative. Browser project state uses localStorage, independently of server sandbox invoice records. Demo payments and reminder drafts never contact PayPal or send email. Google Fonts is optional; system fonts provide the fallback.

## GitHub Pages demo

Pushing to `main` runs `.github/workflows/deploy-pages.yml` and deploys only `public/` to GitHub Pages. The workflow attempts to enable Pages automatically. If repository policy prevents that, select **GitHub Actions** under repository **Settings → Pages → Build and deployment**, then rerun the workflow.

The Pages version is the static demo: template extraction, evidence labels, simulated client approval, and simulated invoices/payments in browser storage. Node API routes and AI/PayPal adapters do not run on Pages. Use a Node-capable host for those optional integrations. No secrets, server files, or invoice records are uploaded by the Pages workflow.
