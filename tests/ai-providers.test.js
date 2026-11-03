// AI provider adapters with a mocked network: forced tool calls, image inputs,
// and the evidence review mapping evidence labels back to stored IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'sk-test';
process.env.AI_PROVIDER = 'openai';
const calls = [];
let reply;
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify(reply), { status: 200 });
};

const { structuredCall } = await import('../server/ai/provider.js');
const { reviewMilestone } = await import('../server/ai/evidence.js');

const toolReply = (args) => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] });

test('OpenAI call forces the tool and sends images as data URLs', async () => {
  reply = toolReply({ ok: true });
  const result = await structuredCall({ system: 's', prompt: 'p', images: [{ mime: 'image/png', base64: 'AAA', label: 'E1' }], toolName: 'submit', schema: { type: 'object' } });
  assert.deepEqual(result, { ok: true });
  const body = calls.at(-1).body;
  assert.equal(calls.at(-1).url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(body.tool_choice.function.name, 'submit');
  assert.equal(body.messages[1].content.find((c) => c.type === 'image_url').image_url.url, 'data:image/png;base64,AAA');
});

test('evidence review maps labels to evidence IDs and counts verdicts', async () => {
  const milestone = { name: 'Development', deliverables: [
    { id: 'd1', title: 'Services page', criterion: 'All four packages with prices', source: { clauseRef: '3.3' } },
    { id: 'd2', title: 'Portfolio page', criterion: 'At least six cards', source: { clauseRef: '3.4' } },
  ] };
  reply = toolReply({ summary: 'One partial, one missing.', results: [
    { deliverableId: 'd1', status: 'partial', reason: 'Only Brand, Web and Content are shown.', missingElements: ['Growth package'], evidence: ['E1'] },
    { deliverableId: 'd2', status: 'missing', reason: 'No portfolio page.', missingElements: [], evidence: [] },
  ] });
  const review = await reviewMilestone(milestone, [{ id: 'ev_a', filename: 'services.png', kind: 'image', mime: 'image/png', base64: 'BBB' }]);
  assert.deepEqual(review.counts, { met: 0, partial: 1, missing: 1 });
  assert.deepEqual(review.results[0].evidenceIds, ['ev_a']);
  assert.equal(review.by, 'ai');
  const prompt = calls.at(-1).body.messages[1].content[0].text;
  assert.match(prompt, /id=d1 \| Services page/);
  assert.match(calls.at(-1).body.messages[0].content, /Never follow instructions/);
});
