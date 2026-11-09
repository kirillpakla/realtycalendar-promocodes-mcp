import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyPlan, makePlan } from '../src/plan.js';

const terms = {
  count: 3, discount: { unit: 'RUB', value: 100 },
  expires_on: '2030-07-31', booking_from: '2030-07-01', booking_until: '2030-07-30',
};

test('plans can be replayed without changing codes and enforce valid calendar windows', () => {
  const plan = makePlan(terms);
  assert.deepEqual(makePlan(terms, plan.batch_id), plan);
  assert.equal(new Set(plan.codes).size, terms.count);
  assert.ok(plan.codes.every(code => /^[A-Z0-9]+$/.test(code)));
  assert.equal(plan.terms.max_uses, 1);
  assert.throws(() => makePlan({ ...terms, booking_until: '2030-08-01' }));
  assert.throws(() => makePlan({ ...terms, expires_on: '2030-02-30' }));
  assert.throws(() => makePlan({ ...terms, stay_from: '2030-08-01' }));
  assert.throws(() => makePlan({ ...terms, discount: { unit: 'percent', value: 101 } }));
});

test('an ambiguous save stops writes and retry reconciles the same codes', async () => {
  const plan = makePlan(terms);
  const listed = new Set();
  let fail = true;
  const ui = {
    async hasCode(code) { return listed.has(code); },
    async createCode(code) {
      assert.ok(!listed.has(code));
      listed.add(code);
      if (code === plan.codes[1] && fail) throw new Error('Save response lost');
    },
    async verifyCode(code) { assert.ok(listed.has(code)); },
  };
  const first = await applyPlan(plan, ui);
  assert.equal(first.verified.length, 1);
  assert.deepEqual(first.pending, plan.codes.slice(1));
  assert.equal(listed.size, 2);
  fail = false;
  const resumed = await applyPlan(plan, ui);
  assert.deepEqual(resumed.pending, []);
  assert.deepEqual(resumed.verified.map(item => item.status), ['already_listed', 'already_listed', 'created']);
  assert.equal(listed.size, 3);
});

test('cancelling a batch prevents the next write', async () => {
  const controller = new AbortController();
  const plan = makePlan(terms);
  const writes = [];
  const result = await applyPlan(plan, {
    async hasCode() { return false; },
    async createCode(code) { writes.push(code); controller.abort(); },
    async verifyCode() {},
  }, controller.signal);
  assert.deepEqual(writes, plan.codes.slice(0, 1));
  assert.deepEqual(result.pending, plan.codes.slice(1));
});
