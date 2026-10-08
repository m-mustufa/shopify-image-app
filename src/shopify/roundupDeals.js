'use strict';

// Deals picked into a Deal Roundup are grid-only: the theme hides products
// tagged "roundup-only" from the home, category and related-product lists.
// Deals are published to the Online Store and Draft deals activated so the
// roundup grid can render them (an Active product on no sales channel is still
// invisible on the storefront). The tag is never removed, so a deal taken out
// of a roundup stays hidden.
const ROUNDUP_ONLY_TAG = 'roundup-only';

const TAGS_ADD_MUTATION = `
  mutation RoundupTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const ONLINE_STORE_PUBLICATION_QUERY = `
  query RoundupPublications {
    publications(first: 25) {
      nodes { id name catalog { title } }
    }
  }
`;

const PUBLISHED_QUERY = `
  query RoundupPublished($ids: [ID!]!, $publicationId: ID!) {
    nodes(ids: $ids) {
      ... on Product { id publishedOnPublication(publicationId: $publicationId) }
    }
  }
`;

const PUBLISH_MUTATION = `
  mutation RoundupPublishDeal($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
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

async function runQuery(client, query, variables) {
  const response = await client.post('/graphql.json', { query, variables });
  if (response.data?.errors?.length) {
    throw new Error(response.data.errors.map(error => error.message).join(', '));
  }
  return response.data?.data;
}

async function runMutation(client, query, variables, field) {
  const data = await runQuery(client, query, variables);
  const userErrors = data?.[field]?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map(error => error.message).join(', '));
  return data?.[field];
}

async function findOnlineStorePublication(client) {
  const data = await runQuery(client, ONLINE_STORE_PUBLICATION_QUERY);
  const nodes = data?.publications?.nodes || [];
  const match = nodes.find(node => /^online store$/i.test(node.catalog?.title || node.name || ''));
  return match?.id || null;
}

// Returns the set of deal ids not yet on the Online Store, or null when the
// publication can't be read (e.g. the read/write_publications scopes are not
// granted yet) so the caller can still tag and activate.
async function unpublishedDealIds(deals, client, publicationId) {
  const data = await runQuery(client, PUBLISHED_QUERY, { ids: deals.map(deal => deal.id), publicationId });
  const published = new Set((data?.nodes || []).filter(node => node?.publishedOnPublication).map(node => node.id));
  return new Set(deals.map(deal => deal.id).filter(id => !published.has(id)));
}

async function syncRoundupDeals(deals = [], client) {
  const result = { tagged: [], published: [], activated: [], failed: [], publishError: null };
  let publicationId = null;
  let unpublished = new Set();
  if (deals.length) {
    try {
      publicationId = await findOnlineStorePublication(client);
      if (!publicationId) throw new Error('Online Store publication not found');
      unpublished = await unpublishedDealIds(deals, client, publicationId);
    } catch (err) {
      publicationId = null;
      result.publishError = err.message;
    }
  }
  for (const deal of deals) {
    try {
      if (!hasRoundupOnlyTag(deal.tags)) {
        await runMutation(client, TAGS_ADD_MUTATION, { id: deal.id, tags: [ROUNDUP_ONLY_TAG] }, 'tagsAdd');
        deal.tags = [...(deal.tags || []), ROUNDUP_ONLY_TAG];
        result.tagged.push(deal.id);
      }
      if (publicationId && unpublished.has(deal.id)) {
        await runMutation(client, PUBLISH_MUTATION, { id: deal.id, input: [{ publicationId }] }, 'publishablePublish');
        result.published.push(deal.id);
      }
      if (deal.status === 'DRAFT') {
        const updated = await runMutation(client, PRODUCT_ACTIVATE_MUTATION, { product: { id: deal.id, status: 'ACTIVE' } }, 'productUpdate');
        // Trust Shopify's answer, not the absence of errors.
        if (updated?.product?.status && updated.product.status !== 'ACTIVE') {
          throw new Error(`status is still ${updated.product.status} after activation`);
        }
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
