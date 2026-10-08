'use strict';

// Deals picked into a Deal Roundup are grid-only: the theme hides products
// tagged "roundup-only" from the home, category and related-product lists,
// and Draft deals are activated so the roundup grid can render them.
// The tag is never removed, so a deal taken out of a roundup stays hidden.
const ROUNDUP_ONLY_TAG = 'roundup-only';

const TAGS_ADD_MUTATION = `
  mutation RoundupTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const PRODUCT_ACTIVATE_MUTATION = `
  mutation RoundupActivateDeal($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

function hasRoundupOnlyTag(tags = []) {
  return tags.some(tag => String(tag).trim().toLowerCase() === ROUNDUP_ONLY_TAG);
}

async function runMutation(client, query, variables, field) {
  const response = await client.post('/graphql.json', { query, variables });
  if (response.data?.errors?.length) {
    throw new Error(response.data.errors.map(error => error.message).join(', '));
  }
  const userErrors = response.data?.data?.[field]?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map(error => error.message).join(', '));
}

async function syncRoundupDeals(deals = [], client) {
  const result = { tagged: [], activated: [], failed: [] };
  for (const deal of deals) {
    try {
      if (!hasRoundupOnlyTag(deal.tags)) {
        await runMutation(client, TAGS_ADD_MUTATION, { id: deal.id, tags: [ROUNDUP_ONLY_TAG] }, 'tagsAdd');
        deal.tags = [...(deal.tags || []), ROUNDUP_ONLY_TAG];
        result.tagged.push(deal.id);
      }
      if (deal.status === 'DRAFT') {
        await runMutation(client, PRODUCT_ACTIVATE_MUTATION, { product: { id: deal.id, status: 'ACTIVE' } }, 'productUpdate');
        deal.status = 'ACTIVE';
        deal.active = true;
        result.activated.push(deal.id);
      }
    } catch (err) {
      result.failed.push({ id: deal.id, error: err.message });
    }
  }
  return result;
}

module.exports = { ROUNDUP_ONLY_TAG, hasRoundupOnlyTag, syncRoundupDeals };
