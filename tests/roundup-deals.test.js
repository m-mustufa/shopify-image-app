'use strict';

const assert = require('assert');
const { syncRoundupDeals, hasRoundupOnlyTag } = require('../src/shopify/roundupDeals');

const ONLINE_STORE = 'gid://shopify/Publication/1';

// Fake Admin API: tracks writes, knows which products are on the Online Store,
// and can deny the publications scope or fail specific product writes.
function fakeClient({ publishedIds = [], failIds = [], denyPublications = false, stickyDraftIds = [] } = {}) {
  const calls = [];
  const published = new Set(publishedIds);
  return {
    calls,
    post: async (_path, { query, variables = {} }) => {
      if (query.includes('RoundupPublications')) {
        if (denyPublications) return { data: { errors: [{ message: 'Access denied for publications field.' }] } };
        return { data: { data: { publications: { nodes: [
          { id: 'gid://shopify/Publication/9', name: 'Point of Sale', catalog: { title: 'Point of Sale' } },
          { id: ONLINE_STORE, name: 'Online Store', catalog: { title: 'Online Store' } },
        ] } } } };
      }
      if (query.includes('RoundupPublished')) {
        assert.strictEqual(variables.publicationId, ONLINE_STORE);
        return { data: { data: { nodes: variables.ids.map(id => ({ id, publishedOnPublication: published.has(id) })) } } };
      }
      const op = query.includes('tagsAdd') ? 'tagsAdd' : query.includes('publishablePublish') ? 'publishablePublish' : 'productUpdate';
      const id = variables.id || variables.product?.id;
      calls.push({ op, id, variables });
      const userErrors = failIds.includes(id) ? [{ field: ['id'], message: 'boom' }] : [];
      if (op === 'publishablePublish' && !userErrors.length) published.add(id);
      const payload = { userErrors };
      if (op === 'productUpdate') payload.product = { id, status: stickyDraftIds.includes(id) ? 'DRAFT' : 'ACTIVE' };
      return { data: { data: { [op]: payload } } };
    },
  };
}

(async () => {
  assert.strictEqual(hasRoundupOnlyTag(['Sale', ' Roundup-Only ']), true);
  assert.strictEqual(hasRoundupOnlyTag(['roundup-only-not']), false);

  // Untagged unpublished draft: tagged, published, activated (in that order).
  // Tagged + published active: untouched. Archived: tagged and published, never activated.
  const deals = [
    { id: 'gid://shopify/Product/1', status: 'DRAFT', active: false, tags: ['Toys'] },
    { id: 'gid://shopify/Product/2', status: 'ACTIVE', active: true, tags: ['roundup-only'] },
    { id: 'gid://shopify/Product/3', status: 'ACTIVE', active: true, tags: [] },
    { id: 'gid://shopify/Product/4', status: 'ARCHIVED', active: false, tags: [] },
  ];
  const client = fakeClient({ publishedIds: ['gid://shopify/Product/2', 'gid://shopify/Product/3'] });
  const result = await syncRoundupDeals(deals, client);
  assert.deepStrictEqual(result.tagged, ['gid://shopify/Product/1', 'gid://shopify/Product/3', 'gid://shopify/Product/4']);
  assert.deepStrictEqual(result.published, ['gid://shopify/Product/1', 'gid://shopify/Product/4']);
  assert.deepStrictEqual(result.activated, ['gid://shopify/Product/1']);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(result.publishError, null);
  assert.deepStrictEqual(
    client.calls.filter(c => c.id === 'gid://shopify/Product/1').map(c => c.op),
    ['tagsAdd', 'publishablePublish', 'productUpdate'],
    'a deal must be hidden from lists before it is published and activated'
  );
  assert.deepStrictEqual(client.calls.find(c => c.op === 'publishablePublish').variables.input, [{ publicationId: ONLINE_STORE }]);
  assert.strictEqual(deals[0].active, true, 'activated deals count toward the roundup discount');
  assert.strictEqual(deals[3].status, 'ARCHIVED');

  // Second save is a no-op once everything is tagged, published and active.
  const again = fakeClient({ publishedIds: deals.map(d => d.id) });
  await syncRoundupDeals(deals, again);
  assert.strictEqual(again.calls.length, 0, 'already synced deals must not be written again');

  // Without the publications scope, deals are still tagged and activated.
  const noScope = fakeClient({ denyPublications: true });
  const limited = await syncRoundupDeals([{ id: 'gid://shopify/Product/7', status: 'DRAFT', tags: [] }], noScope);
  assert.match(limited.publishError, /Access denied/);
  assert.deepStrictEqual(limited.published, []);
  assert.deepStrictEqual(limited.activated, ['gid://shopify/Product/7']);

  // Shopify reporting a status other than ACTIVE is a failure, not a success.
  const sticky = fakeClient({ stickyDraftIds: ['gid://shopify/Product/8'] });
  const stuck = await syncRoundupDeals([{ id: 'gid://shopify/Product/8', status: 'DRAFT', tags: ['roundup-only'] }], sticky);
  assert.deepStrictEqual(stuck.activated, []);
  assert.match(stuck.failed[0].error, /still DRAFT/);

  // One failing deal does not stop the others.
  const partial = fakeClient({ failIds: ['gid://shopify/Product/5'] });
  const mixed = await syncRoundupDeals([
    { id: 'gid://shopify/Product/5', status: 'DRAFT', tags: [] },
    { id: 'gid://shopify/Product/6', status: 'DRAFT', tags: [] },
  ], partial);
  assert.strictEqual(mixed.failed.length, 1);
  assert.deepStrictEqual(mixed.activated, ['gid://shopify/Product/6']);

  console.log('roundup deal sync tests passed');
})().catch(err => { console.error(err); process.exit(1); });
