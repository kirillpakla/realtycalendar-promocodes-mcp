import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const date = z.string().date();
export const batch = z.object({
  count: z.number().int().min(1).max(50),
  discount: z.object({
    unit: z.enum(['RUB', 'percent']),
    value: z.number().int().positive(),
  }).strict(),
  expires_on: date,
  booking_from: date,
  booking_until: date,
  stay_from: date.optional(),
  stay_until: date.optional(),
  min_total_rub: z.number().int().nonnegative().optional(),
  min_nights: z.number().int().min(1).max(365).default(1),
  max_uses: z.number().int().min(1).max(1000).default(1),
  prefix: z.string().regex(/^[A-Z0-9]{1,6}$/).default('RC'),
}).strict();

export function makePlan(input, batchId = randomUUID()) {
  const terms = batch.parse(input);
  const id = z.string().uuid().parse(batchId);
  if (terms.discount.unit === 'percent' && terms.discount.value > 100) {
    throw new Error('Percentage cannot exceed 100.');
  }
  if (terms.booking_from > terms.booking_until || terms.booking_until > terms.expires_on) {
    throw new Error('Require booking_from <= booking_until <= expires_on.');
  }
  if (Boolean(terms.stay_from) !== Boolean(terms.stay_until) ||
      (terms.stay_from && terms.stay_from > terms.stay_until)) {
    throw new Error('Supply both stay dates in chronological order, or omit both.');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([id, terms])).digest('hex');
  const codes = Array.from({ length: terms.count }, (_, index) =>
    terms.prefix + createHash('sha256').update(fingerprint + ':' + index).digest('hex').slice(0, 12).toUpperCase()
  );
  return { batch_id: id, fingerprint, terms, codes };
}

export async function applyPlan(plan, ui, signal) {
  const result = { batch_id: plan.batch_id, verified: [], pending: [...plan.codes] };
  for (const code of plan.codes) {
    try {
      signal?.throwIfAborted();
      const existed = await ui.hasCode(code);
      if (!existed) await ui.createCode(code, plan.terms, signal);
      await ui.verifyCode(code);
      result.verified.push({ code, status: existed ? 'already_listed' : 'created' });
      result.pending.shift();
    } catch (error) {
      result.error = { code, reason: error.message };
      break;
    }
  }
  return result;
}
