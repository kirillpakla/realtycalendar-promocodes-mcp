import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio advertises both tools and a modified plan fails before browser access', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.js'] });
  await client.connect(transport, { timeout: 120000 });
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['create_promocodes', 'plan_promocodes']);
    const { content } = await client.callTool({ name: 'plan_promocodes', arguments: { terms: {
      count: 2, discount: { unit: 'percent', value: 8 },
      expires_on: '2030-07-31', booking_from: '2030-07-01', booking_until: '2030-07-31',
    } } });
    const { batch_id, fingerprint, terms, codes } = JSON.parse(content[0].text);
    assert.equal(codes.length, 2);
    const result = await client.callTool({ name: 'create_promocodes', arguments: {
      batch_id, fingerprint, terms: { ...terms, count: 3 }, confirm: true,
    } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /fingerprint/);
  } finally {
    await client.close();
  }
});
