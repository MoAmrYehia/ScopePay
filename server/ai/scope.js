// Client request → in scope / out of scope, grounded in the agreement, and a
// priced change-order draft when it is extra work. Also drafts payment reminders.

import { config } from '../config.js';
import { structuredCall, UNTRUSTED_NOTE } from './provider.js';
import { isGrounded } from './extract.js';

const scopeSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['in_scope', 'out_of_scope', 'unclear'] },
    reason: { type: 'string', description: 'Two sentences at most, naming the relevant clause.' },
    clauseRef: { type: 'string' },
    quote: { type: 'string', description: 'Verbatim text from the agreement that decides the verdict.' },
    changeOrder: {
      type: ['object', 'null'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'What would be delivered, written for the client.' },
        estimatedHours: { type: 'number' },
      },
      required: ['title', 'description', 'estimatedHours'],
    },
  },
  required: ['verdict', 'reason', 'clauseRef', 'quote', 'changeOrder'],
};

const SYSTEM = `You check whether a client's request is covered by a signed freelance agreement.
${UNTRUSTED_NOTE}
- "in_scope": the request is part of an agreed deliverable.
- "out_of_scope": it is excluded or goes beyond the agreed deliverables. Draft a change order with a realistic, modest hour estimate for a freelance web designer.
- "unclear": the agreement does not decide it; explain what to clarify.
Quote the clause verbatim. Set changeOrder to null unless the verdict is out_of_scope.`;

export async function checkScope(terms, agreementText, message) {
  const raw = config.ai.provider === 'demo' ? ruleBasedScope(terms, message) : await structuredCall({
    system: SYSTEM,
    prompt: `<agreement>\n${agreementText}\n</agreement>\n<client_request>\n${message}\n</client_request>`,
    toolName: 'submit_scope_check',
    schema: scopeSchema,
  });

  const rate = terms.changePolicy?.hourlyRate || null;
  let changeOrder = null;
  if (raw.verdict === 'out_of_scope' && raw.changeOrder) {
    const hours = Math.max(0.5, Math.round(Number(raw.changeOrder.estimatedHours || 1) * 2) / 2);
    changeOrder = {
      title: raw.changeOrder.title,
      description: raw.changeOrder.description,
      hours,
      rate,
      amount: rate ? Math.round(hours * rate * 100) / 100 : null,
      status: 'draft',
    };
  }
  return {
    by: config.ai.provider === 'demo' ? 'rules' : 'ai',
    verdict: raw.verdict,
    reason: raw.reason,
    source: { clauseRef: raw.clauseRef || '', quote: raw.quote || '', verified: isGrounded(raw.quote, agreementText) },
    changeOrder,
  };
}

function ruleBasedScope(terms, message) {
  const text = message.toLowerCase();
  const stem = (w) => w.toLowerCase().replace(/s$/, '');
  const exclusion = terms.exclusions.find((e) => e.item.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => text.includes(stem(w))));
  if (exclusion) {
    return {
      verdict: 'out_of_scope',
      reason: `"${exclusion.item}" is listed as outside the scope in clause ${exclusion.source.clauseRef}.`,
      clauseRef: exclusion.source.clauseRef,
      quote: exclusion.source.quote,
      changeOrder: { title: `Add ${exclusion.item}`, description: `Design and build: ${message.trim()}`, estimatedHours: 8 },
    };
  }
  const deliverable = terms.milestones.flatMap((m) => m.deliverables).find((d) => text.includes(d.title.toLowerCase().replace(' page', '')));
  if (deliverable) {
    return { verdict: 'in_scope', reason: `Covered by "${deliverable.title}" (clause ${deliverable.source.clauseRef}).`, clauseRef: deliverable.source.clauseRef, quote: deliverable.source.quote, changeOrder: null };
  }
  return { verdict: 'unclear', reason: 'Demo rules could not match this request to a clause. Configure an AI key for a real check.', clauseRef: '', quote: '', changeOrder: null };
}

const reminderSchema = {
  type: 'object',
  properties: { subject: { type: 'string' }, note: { type: 'string', description: 'Under 80 words, warm and professional.' } },
  required: ['subject', 'note'],
};

export async function draftReminder({ project, invoice, daysSinceSent }) {
  const facts = `Client: ${project.client.name}. Project: ${project.name}. Invoice ${invoice.number || ''} for ${invoice.title}, ${invoice.amount} ${project.currency}. Sent ${daysSinceSent} day(s) ago. The client approved this work in writing on ${invoice.approvedAt?.slice(0, 10) || 'record'}.`;
  if (config.ai.provider === 'demo') {
    return {
      subject: `Reminder: ${invoice.title}`,
      note: `Hi ${project.client.name}, a friendly reminder that the invoice for ${invoice.title} (approved on ${invoice.approvedAt?.slice(0, 10)}) is ready for payment. Thank you!`,
    };
  }
  return structuredCall({
    system: 'You write short, friendly payment reminders for freelancers. Mention that the work was approved. No threats, no legal language.',
    prompt: facts,
    toolName: 'submit_reminder',
    schema: reminderSchema,
  });
}
