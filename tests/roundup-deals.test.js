'use strict';

const assert = require('assert');
const { syncRoundupDeals, hasRoundupOnlyTag } = require('../src/shopify/roundupDeals');

function fakeClient(failIds = []) {
  const calls = [];
  return {
    calls,
    post: async (_path, { query, variables }) => {
      const id = variables.id || variables.product?.id;
      const op = query.includes('tagsAdd') ? 'tagsAdd' : 'productUpdate';
      calls.push({ op, id, variables });
      const userErrors = failIds.includes(id) ? [{ field: ['id'], message: 'boom' }] : [];
      return { data: { data: { [op]: { userErrors } } } };
    },
  };
}

(async () => {
  assert.strictEqual(hasRoundupOnlyTag(['Sale', ' Roundup-Only ']), true);
  assert.strictEqual(hasRoundupOnlyTag(['roundup-only-not']), false);

  // Untagged draft: tag added and activated. Tagged active: untouched.
  // Untagged active: tag only. Archived: tag only, never activated.
  const deals = [
    { id: 'gid://shopify/Product/1', status: 'DRAFT', active: false, tags: ['Toys'] },
    { id: 'gid://shopify/Product/2', status: 'ACTIVE', active: true, tags: ['roundup-only'] },
    { id: 'gid://shopify/Product/3', status: 'ACTIVE', active: true, tags: [] },
    { id: 'gid://shopify/Product/4', status: 'ARCHIVED', active: false, tags: [] },
  ];
  const client = fakeClient();
  const result = await syncRoundupDeals(deals, client);
  assert.deepStrictEqual(result.tagged, ['gid://shopify/Product/1', 'gid://shopify/Product/3', 'gid://shopify/Product/4']);
  assert.deepStrictEqual(result.activated, ['gid://shopify/Product/1']);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(client.calls.find(c => c.op === 'productUpdate').variables, { product: { id: 'gid://shopify/Product/1', status: 'ACTIVE' } });
  assert.strictEqual(deals[0].active, true, 'activated deals count toward the roundup discount');
  assert.strictEqual(deals[3].status, 'ARCHIVED');

  // Second save is a no-op.
  const again = fakeClient();
  await syncRoundupDeals(deals, again);
  assert.strictEqual(again.calls.length, 0, 'already synced deals must not be written again');

  // One failing deal does not stop the others.
  const partial = fakeClient(['gid://shopify/Product/5']);
  const mixed = await syncRoundupDeals([
    { id: 'gid://shopify/Product/5', status: 'DRAFT', tags: [] },
    { id: 'gid://shopify/Product/6', status: 'DRAFT', tags: [] },
  ], partial);
  assert.strictEqual(mixed.failed.length, 1);
  assert.deepStrictEqual(mixed.activated, ['gid://shopify/Product/6']);

  console.log('roundup deal sync tests passed');
})().catch(err => { console.error(err); process.exit(1); });
