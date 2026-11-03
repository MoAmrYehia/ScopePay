// Delivered work → per-deliverable verdicts. The model looks at the actual
// screenshots and document text, checks each acceptance criterion, and must say
// which evidence item supports each verdict. A human makes the final decision.

import { config } from '../config.js';
import { structuredCall, UNTRUSTED_NOTE } from './provider.js';

const schema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          deliverableId: { type: 'string' },
          status: { type: 'string', enum: ['met', 'partial', 'missing'] },
          reason: { type: 'string', description: 'One or two sentences naming what is visible and what is absent.' },
          missingElements: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence labels such as "E2" that support this verdict.' },
        },
        required: ['deliverableId', 'status', 'reason', 'missingElements', 'evidence'],
      },
    },
    summary: { type: 'string', description: 'One sentence a client can read.' },
  },
  required: ['results', 'summary'],
};

const SYSTEM = `You verify freelance deliverables against the acceptance criteria of a signed agreement.
${UNTRUSTED_NOTE}
For every deliverable, decide:
- "met": the evidence clearly shows every element the criterion requires, including counts.
- "partial": relevant evidence exists but at least one required element is absent or the count is short. List what is missing.
- "missing": no evidence item shows this deliverable.
Count items carefully when the criterion has a number. Base verdicts only on what is visible in the evidence, not on file names or claims in notes.
Be specific and neutral; the client and the freelancer will both read this.`;

export async function reviewMilestone(milestone, evidenceItems) {
  const labelled = evidenceItems.map((item, i) => ({ ...item, label: `E${i + 1}` }));
  const raw =
    config.ai.provider === 'demo'
      ? ruleBasedReview(milestone, labelled)
      : await structuredCall({
          system: SYSTEM,
          prompt: buildPrompt(milestone, labelled),
          images: labelled.filter((e) => e.base64).map((e) => ({ mime: e.mime, base64: e.base64, label: `${e.label} (${e.filename})` })),
          toolName: 'submit_review',
          schema,
        });
  return normalizeReview(raw, milestone, labelled);
}

function buildPrompt(milestone, labelled) {
  const criteria = milestone.deliverables
    .map((d) => `- id=${d.id} | ${d.title} | criterion: ${d.criterion} | clause ${d.source.clauseRef}`)
    .join('\n');
  const evidence = labelled
    .map((e) => {
      const note = e.note ? ` | freelancer note: ${e.note}` : '';
      const body = e.text ? `\n<document label="${e.label}">\n${e.text.slice(0, 12000)}\n</document>` : ' (image attached)';
      return `${e.label}: ${e.filename}${note}${body}`;
    })
    .join('\n');
  return `Milestone: ${milestone.name}\n\nAcceptance criteria:\n${criteria}\n\nEvidence submitted:\n${evidence || '(none)'}\n\nReturn one result per deliverable id.`;
}

function normalizeReview(raw, milestone, labelled) {
  const byLabel = Object.fromEntries(labelled.map((e) => [e.label, e.id]));
  const results = milestone.deliverables.map((d) => {
    const r = (raw.results || []).find((x) => x.deliverableId === d.id);
    if (!r) return { deliverableId: d.id, status: 'missing', reason: 'The review did not return a verdict for this deliverable.', missingElements: [], evidenceIds: [] };
    return {
      deliverableId: d.id,
      status: ['met', 'partial', 'missing'].includes(r.status) ? r.status : 'missing',
      reason: r.reason || '',
      missingElements: r.missingElements || [],
      evidenceIds: (r.evidence || []).map((label) => byLabel[label]).filter(Boolean),
    };
  });
  return {
    by: config.ai.provider === 'demo' ? 'rules' : 'ai',
    model: config.ai.model,
    at: new Date().toISOString(),
    summary: raw.summary || '',
    results,
    counts: {
      met: results.filter((r) => r.status === 'met').length,
      partial: results.filter((r) => r.status === 'partial').length,
      missing: results.filter((r) => r.status === 'missing').length,
    },
  };
}

// Demo mode: match on file names and notes only. Clearly labelled in the UI.
function ruleBasedReview(milestone, labelled) {
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && w !== 'page');
  const results = milestone.deliverables.map((d) => {
    const key = words(d.title);
    const hits = labelled.filter((e) => key.some((k) => `${e.filename} ${e.note || ''}`.toLowerCase().includes(k)));
    return hits.length
      ? { deliverableId: d.id, status: 'met', reason: `Matched by file name: ${hits.map((h) => h.filename).join(', ')}. Demo rules cannot inspect content.`, missingElements: [], evidence: hits.map((h) => h.label) }
      : { deliverableId: d.id, status: 'missing', reason: 'No evidence file name refers to this deliverable.', missingElements: [d.title], evidence: [] };
  });
  const missing = results.filter((r) => r.status !== 'met').length;
  return { results, summary: missing ? `${missing} deliverable(s) still need evidence.` : 'Every deliverable has matching evidence.' };
}
