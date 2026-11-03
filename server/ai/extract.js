// Agreement → structured, editable terms. Every term carries the exact clause it
// came from, and every quote is checked against the source text so the UI can
// flag anything the model could not ground in the agreement.

import { config } from '../config.js';
import { structuredCall, UNTRUSTED_NOTE } from './provider.js';
import { newId } from '../store.js';

const clause = {
  type: 'object',
  properties: {
    clauseRef: { type: 'string', description: 'Clause number as written, e.g. "3.4". Empty if none.' },
    quote: { type: 'string', description: 'Exact, verbatim sentence or fragment from the agreement supporting this term.' },
  },
  required: ['clauseRef', 'quote'],
};

const schema = {
  type: 'object',
  properties: {
    projectName: { type: 'string' },
    clientName: { type: 'string' },
    currency: { type: 'string', description: 'ISO currency code, e.g. USD' },
    total: { type: ['number', 'null'] },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: ['number', 'null'] },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
          source: clause,
          deliverables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short name, e.g. "Portfolio page"' },
                criterion: { type: 'string', description: 'What must be visibly true for this deliverable to be accepted.' },
                source: clause,
              },
              required: ['title', 'criterion', 'source'],
            },
          },
        },
        required: ['name', 'amount', 'dueDate', 'source', 'deliverables'],
      },
    },
    exclusions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, source: clause },
        required: ['item', 'source'],
      },
    },
    changePolicy: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        hourlyRate: { type: ['number', 'null'] },
        source: clause,
      },
      required: ['summary', 'hourlyRate', 'source'],
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Missing, ambiguous or inconsistent terms the freelancer should fix before relying on the agreement.',
    },
  },
  required: ['projectName', 'clientName', 'currency', 'total', 'milestones', 'exclusions', 'changePolicy', 'warnings'],
};

const SYSTEM = `You extract payment milestones and acceptance conditions from freelance service agreements.
${UNTRUSTED_NOTE}
Rules:
- Use only what the agreement states. Never invent amounts, dates, deliverables or rates; use null and add a warning instead.
- Each deliverable must be independently checkable from delivered work (a page, a file, a screenshot). Split compound clauses into separate deliverables only when the agreement lists them separately.
- "criterion" restates the acceptance condition precisely, keeping every count and required element (e.g. "at least six case-study cards").
- Every "quote" must be copied character-for-character from the agreement.
- Add warnings for missing acceptance terms, totals that do not match milestone amounts, or vague deliverables.`;

export async function extractAgreement(text) {
  if (config.ai.provider === 'demo') {
    return finalizeExtraction(ruleBasedExtract(text), text, { by: 'rules', model: 'rules' });
  }
  const raw = await structuredCall({
    system: SYSTEM,
    prompt: `<agreement>\n${text}\n</agreement>\nExtract the terms.`,
    toolName: 'submit_terms',
    schema,
  });
  return finalizeExtraction(raw, text, { by: 'ai', model: config.ai.model });
}

// --- grounding --------------------------------------------------------------

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[“”"]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function isGrounded(quote, text) {
  const q = normalize(quote);
  return q.length >= 8 && normalize(text).includes(q);
}

function sourceOf(source, text) {
  return {
    clauseRef: source?.clauseRef || '',
    quote: source?.quote || '',
    verified: isGrounded(source?.quote, text),
  };
}

export function finalizeExtraction(raw, text, meta = { by: 'rules', model: 'rules' }) {
  const warnings = [...(raw.warnings || [])];
  const milestones = (raw.milestones || []).map((m, index) => ({
    id: newId('ms'),
    index: index + 1,
    name: m.name || `Milestone ${index + 1}`,
    amount: Number.isFinite(m.amount) ? m.amount : null,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(m.dueDate || '') ? m.dueDate : null,
    source: sourceOf(m.source, text),
    deliverables: (m.deliverables || []).map((d) => ({
      id: newId('dl'),
      title: d.title,
      criterion: d.criterion,
      source: sourceOf(d.source, text),
    })),
  }));

  const sum = milestones.reduce((n, m) => n + (m.amount || 0), 0);
  if (raw.total && Math.abs(sum - raw.total) > 0.5) {
    warnings.push(`Milestone amounts add up to ${sum}, but the agreement total is ${raw.total}.`);
  }
  for (const m of milestones) {
    if (m.amount == null) warnings.push(`No amount found for "${m.name}".`);
    if (!m.deliverables.length) warnings.push(`No checkable deliverables found for "${m.name}".`);
  }
  const unverified = milestones.flatMap((m) => m.deliverables).filter((d) => !d.source.verified).length;
  if (unverified) warnings.push(`${unverified} deliverable quote(s) could not be matched to the agreement text. Check them before confirming.`);

  return {
    terms: {
      projectName: raw.projectName || 'Untitled project',
      clientName: raw.clientName || '',
      currency: (raw.currency || 'USD').toUpperCase(),
      total: raw.total ?? sum,
      milestones,
      exclusions: (raw.exclusions || []).map((e) => ({ id: newId('ex'), item: e.item, source: sourceOf(e.source, text) })),
      changePolicy: {
        summary: raw.changePolicy?.summary || '',
        hourlyRate: raw.changePolicy?.hourlyRate ?? null,
        source: sourceOf(raw.changePolicy?.source, text),
      },
    },
    extraction: { ...meta, at: new Date().toISOString(), warnings },
  };
}

// --- demo mode ---------------------------------------------------------------
// Deterministic parser for numbered agreements like samples/agreement-website-redesign.md.
// Used only when no AI key is configured, and labelled as such in the UI.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const money = (s) => Number(String(s).replace(/[^0-9.]/g, ''));

function isoDate(s) {
  const m = /([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(s || '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

function shortTitle(sentence) {
  const page = /^([A-Z][a-z]+) page/.exec(sentence);
  if (page) return `${page[1]} page`;
  return sentence.split(/ with | covering | showing | listing | of the | in | to the |,/)[0].replace(/^(One|A|An) /, '').replace(/\.$/, '').slice(0, 48);
}

export function ruleBasedExtract(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const milestones = [];
  const exclusions = [];
  let changePolicy = { summary: '', hourlyRate: null, source: { clauseRef: '', quote: '' } };
  let current = null;
  let total = null;
  const client = /\*\*And:\*\*\s*([^("]+)/.exec(text)?.[1]?.trim() || '';

  for (const line of lines) {
    const heading = /^#+\s*\d+\.\s*Milestone\s*\d+:\s*([^(]+)\((\$?[\d,.]+)(?:,\s*due\s*([^)]+))?\)/i.exec(line);
    if (heading) {
      current = {
        name: heading[1].trim(),
        amount: money(heading[2]),
        dueDate: isoDate(heading[3]),
        source: { clauseRef: '', quote: line.replace(/^#+\s*/, '') },
        deliverables: [],
      };
      milestones.push(current);
      continue;
    }
    if (/^#+/.test(line)) current = null;
    const numbered = /^(\d+\.\d+)\s+(.*)$/.exec(line);
    if (!numbered) continue;
    const [, ref, sentence] = numbered;
    if (!total && /total fee/i.test(sentence)) total = money(/\$[\d,]+/.exec(sentence)?.[0]);
    if (current) {
      current.deliverables.push({ title: shortTitle(sentence), criterion: sentence.replace(/\.$/, ''), source: { clauseRef: ref, quote: sentence } });
    } else if (/per hour/i.test(sentence)) {
      changePolicy = {
        summary: sentence,
        hourlyRate: money(/\$[\d.,]+\s*per hour/i.exec(sentence)?.[0]),
        source: { clauseRef: ref, quote: sentence },
      };
    } else if (/outside the scope of this agreement:/i.test(sentence)) {
      const list = sentence.split(':')[1] || '';
      for (const item of list.replace(/\.$/, '').split(/,\s*(?:and\s+)?/)) {
        if (item.trim()) exclusions.push({ item: item.trim(), source: { clauseRef: ref, quote: sentence } });
      }
    }
  }
  const title = /^#\s*(.+)$/m.exec(text)?.[1] || 'New project';
  return {
    projectName: title.replace(/services agreement/i, '').trim() || title,
    clientName: client,
    currency: 'USD',
    total,
    milestones,
    exclusions,
    changePolicy,
    warnings: milestones.length ? [] : ['Demo rules could not find milestones. Configure an AI key to extract free-form agreements.'],
  };
}
