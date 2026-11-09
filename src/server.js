import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { applyPlan, batch, makePlan } from './plan.js';

const server = new McpServer({ name: 'realtycalendar-promocodes-mcp', version: '0.1.0' });
let applying = false;
const response = (data, isError = false) => ({
  isError,
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const errorResponse = error => response({ error: error.message }, true);

server.registerTool('plan_promocodes', {
  description: 'Generate a preview without browser access or writes. Dates use YYYY-MM-DD. Booking dates and optional stay dates are separate.',
  inputSchema: { terms: batch },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ terms }) => {
  try { return response(makePlan(terms)); } catch (error) { return errorResponse(error); }
});

server.registerTool('create_promocodes', {
  description: 'Create a previously planned batch in the signed-in RealtyCalendar account. Use the unchanged plan and explicit authorization. Retry with the same batch ID and fingerprint to reconcile partial results.',
  inputSchema: { terms: batch, batch_id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ terms, batch_id, fingerprint }, { signal }) => {
  if (applying) return errorResponse(new Error('A batch is already in progress in this server.'));
  applying = true;
  try {
    const plan = makePlan(terms, batch_id);
    if (plan.fingerprint !== fingerprint) throw new Error('Plan fingerprint does not match the requested terms.');
    const { withPromoBrowser } = await import('./browser.js');
    const result = await withPromoBrowser(ui => applyPlan(plan, ui, signal));
    return response(result, Boolean(result.error));
  } catch (error) {
    return errorResponse(error);
  } finally {
    applying = false;
  }
});

await server.connect(new StdioServerTransport());
