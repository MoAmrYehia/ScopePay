// Agreement extraction: rule-based parsing of the sample, and grounding checks
// that flag quotes the model could not take verbatim from the agreement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ruleBasedExtract, finalizeExtraction, isGrounded } from '../server/ai/extract.js';

const text = await readFile(new URL('../samples/agreement-website-redesign.md', import.meta.url), 'utf8');

test('sample agreement parses into three cited milestones', () => {
  const { terms, extraction } = finalizeExtraction(ruleBasedExtract(text), text);
  assert.deepEqual(terms.milestones.map((m) => m.amount), [1350, 2250, 900]);
  assert.equal(terms.total, 4500);
  assert.equal(terms.milestones[1].deliverables.length, 5);
  assert.equal(terms.milestones[1].deliverables[3].source.clauseRef, '3.4');
  assert.ok(terms.milestones.flatMap((m) => m.deliverables).every((d) => d.source.verified));
  assert.equal(terms.changePolicy.hourlyRate, 95);
  assert.ok(terms.exclusions.some((e) => /blog/.test(e.item)));
  assert.deepEqual(extraction.warnings, []);
});

test('grounding tolerates whitespace and quote styles but not invention', () => {
  assert.ok(isGrounded('Portfolio page showing at least  six case-study cards', text));
  assert.ok(isGrounded('a “Book a call” call-to-action button', text));
  assert.equal(isGrounded('Portfolio page showing at least ten case-study cards', text), false);
});

test('model output with invented quotes and wrong totals produces warnings', () => {
  const raw = {
    projectName: 'X', clientName: 'Y', currency: 'usd', total: 5000,
    milestones: [{ name: 'Build', amount: 4500, dueDate: 'next week', source: { clauseRef: '3', quote: '' },
      deliverables: [{ title: 'Blog', criterion: 'A blog', source: { clauseRef: '3.9', quote: 'Build a blog with ten posts.' } }] }],
    exclusions: [], changePolicy: { summary: '', hourlyRate: null, source: { clauseRef: '', quote: '' } }, warnings: [],
  };
  const { terms, extraction } = finalizeExtraction(raw, text, { by: 'ai', model: 'test' });
  assert.equal(terms.currency, 'USD');
  assert.equal(terms.milestones[0].dueDate, null, 'non-ISO dates are dropped');
  assert.equal(terms.milestones[0].deliverables[0].source.verified, false);
  assert.ok(extraction.warnings.some((w) => /add up to 4500/.test(w)));
  assert.ok(extraction.warnings.some((w) => /could not be matched/.test(w)));
});
