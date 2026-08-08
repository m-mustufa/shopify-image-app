'use strict';

const client = require('./client');

const METAFIELD_SET_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function updateProductMetafields(productId, imageUrl, ogVersion, shareVersion, inputHash) {
  let res;
  try {
    res = await client.post('/graphql.json', {
      query: METAFIELD_SET_MUTATION,
      variables: {
        metafields: [
          {
            ownerId:   `gid://shopify/Product/${productId}`,
            namespace: 'custom',
            key:       'og_version',
            value:     ogVersion,
            type:      'single_line_text_field',
          },
          {
            ownerId:   `gid://shopify/Product/${productId}`,
            namespace: 'custom',
            key:       'og_image',
            value:     imageUrl,
            type:      'single_line_text_field',
          },
          {
            ownerId:   `gid://shopify/Product/${productId}`,
            namespace: 'custom',
            key:       'share_version',
            value:     shareVersion,
            type:      'single_line_text_field',
          },
          {
            ownerId:   `gid://shopify/Product/${productId}`,
            namespace: 'custom',
            key:       'og_image_input_hash',
            value:     inputHash,
            type:      'single_line_text_field',
          },
        ],
      },
    });
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data ?? {});
    console.error(`[metafields] HTTP ${status} — body: ${body}`);
    throw err;
  }

  const data = res.data?.data?.metafieldsSet;
  if (data?.userErrors?.length) {
    throw new Error(`metafieldsSet error: ${data.userErrors.map(e => e.message).join(', ')}`);
  }

  return data.metafields;
}

async function updateProductShareVersion(productId, shareVersion) {
  const res = await client.post('/graphql.json', {
    query: METAFIELD_SET_MUTATION,
    variables: {
      metafields: [{
        ownerId:   `gid://shopify/Product/${productId}`,
        namespace: 'custom',
        key:       'share_version',
        value:     shareVersion,
        type:      'single_line_text_field',
      }],
    },
  });

  const data = res.data?.data?.metafieldsSet;
  if (data?.userErrors?.length) {
    throw new Error(`metafieldsSet error: ${data.userErrors.map(e => e.message).join(', ')}`);
  }
  return data.metafields;
}

const OVERRIDE_KEYS = ['deal_enabled', 'deal_badge_text', 'deal_sale_price', 'deal_reg_price', 'deal_title'];
const APP_MANAGED_KEYS = new Set(['og_image', 'og_version', 'share_version', 'og_image_input_hash']);

async function fetchProductOverrides(productId) {
  try {
    const res = await client.get(
      `/products/${productId}/metafields.json?namespace=custom`
    );
    const mfs = res.data?.metafields ?? [];
    const result = {};
    for (const key of OVERRIDE_KEYS) {
      const mf = mfs.find(m => m.key === key);
      if (key === 'deal_enabled') {
        result[key] = mf ? mf.value : null;
      } else {
        result[key] = mf?.value?.trim() || null;
      }
    }
    result._storedHash = mfs.find(m => m.key === 'og_image_input_hash')?.value ?? null;
    result._storedOgVersion = mfs.find(m => m.key === 'og_version')?.value ?? null;
    result._storedShareVersion = mfs.find(m => m.key === 'share_version')?.value ?? null;
    result._shareMetafields = mfs
      .filter(m => !APP_MANAGED_KEYS.has(m.key))
      .map(m => ({
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: m.value,
      }))
      .sort((a, b) => `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
    return result;
  } catch (err) {
    if (err.response?.status === 404) {
      console.warn('[metafields] product not found (404) — skipping');
      return { _notFound: true };
    }
    console.warn('[metafields] fetchProductOverrides failed (non-fatal):', err.message);
    return {};
  }
}

module.exports = { updateProductMetafields, updateProductShareVersion, fetchProductOverrides };
