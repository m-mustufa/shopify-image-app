'use strict';

const assert = require('assert');
const {
  PREVIEW_MAX_AGE_MS,
  buildStorefrontUrl,
  createSharePreviewToken,
  createSharePreviewUrl,
  fetchPreviewProduct,
  normalizeProductHandle,
  sharePreviewPage,
  verifySharePreviewToken,
} = require('../src/shopify/sharePreview');

async function run() {
  const now = 1_788_650_000_000;
  const secret = 'preview-test-secret';

  assert.strictEqual(normalizeProductHandle('Example-Product'), 'example-product');
  assert.strictEqual(normalizeProductHandle('https://shop.example.com/products/example-product'), 'example-product');
  assert.strictEqual(normalizeProductHandle('https://shop.example.com/collections/all/products/example-product'), null);
  assert.strictEqual(normalizeProductHandle('javascript:alert(1)'), null);

  const token = createSharePreviewToken('alpha.myshopify.com', 'example-product', secret, now);
  assert.deepStrictEqual(
    verifySharePreviewToken(token, secret, now),
    { shopDomain: 'alpha.myshopify.com', handle: 'example-product', issuedAt: now }
  );
  assert.strictEqual(verifySharePreviewToken(`${token}x`, secret, now), null);
  assert.strictEqual(verifySharePreviewToken(token, secret, now + PREVIEW_MAX_AGE_MS + 1), null);
  assert.strictEqual(verifySharePreviewToken(token, secret, now - 5 * 60 * 1000 - 1), null);

  const calls = [];
  const product = await fetchPreviewProduct('example-product', {
    async post(path, body) {
      calls.push({ path, body });
      return { data: { data: { products: { nodes: [{
        handle: 'example-product',
        title: '<script>unsafe</script>',
        description: 'Example description',
        ogImage: { value: 'https://cdn.shopify.com/files/preview.jpg' },
        shareVersion: { value: 'abc123' },
      }] } } } };
    },
  });
  assert.strictEqual(calls[0].path, '/graphql.json');
  assert.strictEqual(calls[0].body.variables.query, 'handle:example-product');
  assert.strictEqual(product.shareVersion, 'abc123');

  const storefrontUrl = buildStorefrontUrl({
    shopDomain: 'alpha.myshopify.com',
    publicDomain: 'www.example.com',
  }, product);
  assert.strictEqual(storefrontUrl, 'https://www.example.com/products/example-product?pv=abc123');

  const previewUrl = createSharePreviewUrl(token, 'https://app.example.com');
  assert.match(previewUrl, /^https:\/\/app\.example\.com\/share-preview\?token=/);

  const html = sharePreviewPage({ previewUrl, storefrontUrl, product });
  assert.ok(!html.includes('<script>unsafe</script>'));
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /property='og:image'/);
  assert.match(html, /preview\.jpg/);
  assert.match(html, /noindex,nofollow,noarchive/);

  await assert.rejects(
    fetchPreviewProduct('missing', {
      async post() {
        return { data: { data: { products: { nodes: [] } } } };
      },
    }),
    /Product not found/
  );
  await assert.rejects(
    fetchPreviewProduct('no-image', {
      async post() {
        return { data: { data: { products: { nodes: [{ handle: 'no-image', title: 'No image' }] } } } };
      },
    }),
    /Generate a social image/
  );

  console.log('share preview tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
