'use strict';

const assert = require('assert');
const crypto = require('crypto');
const sharp = require('sharp');

async function testHmacVerification() {
  const config = require('../src/config');
  config.shopifyWebhookSecret = 'test-secret';
  const { verifyShopifyWebhook } = require('../src/webhooks/verifySignature');
  const body = Buffer.from('{"id":123}');
  const validHmac = crypto.createHmac('sha256', config.shopifyWebhookSecret).update(body).digest('base64');

  assert.doesNotThrow(() => verifyShopifyWebhook({ headers: { 'x-shopify-hmac-sha256': validHmac } }, null, body));
  assert.throws(
    () => verifyShopifyWebhook({ headers: { 'x-shopify-hmac-sha256': validHmac } }, null, Buffer.from('{"id":124}')),
    /Invalid Shopify webhook HMAC/
  );
}

async function testProductIdempotency() {
  const imageBuffer = Buffer.from('final generated image');
  const expectedVersion = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 12);
  let storedHash = null;
  let storedVersion = null;
  let storedShareVersion = null;
  let generationCalls = 0;
  let uploadCalls = 0;
  let metafieldCalls = 0;
  let lastMetafieldArgs = null;
  let lastProcessingArgs = null;
  let lastUploadArgs = null;
  let dealEnabled = null;

  const generatorPath = require.resolve('../src/image/generator');
  const filesPath = require.resolve('../src/shopify/files');
  const metafieldsPath = require.resolve('../src/shopify/metafields');
  const productPath = require.resolve('../src/webhooks/product');

  require.cache[generatorPath] = { exports: { generateProductImage: async () => {
    generationCalls += 1;
    return imageBuffer;
  } } };
  require.cache[filesPath] = { exports: { uploadBufferToShopify: async (...args) => {
    uploadCalls += 1;
    lastUploadArgs = args;
    return 'https://cdn.example/og.jpg';
  } } };
  require.cache[metafieldsPath] = { exports: {
    fetchProductOverrides: async () => ({
      deal_enabled: dealEnabled,
      _storedHash: storedHash,
      _storedOgVersion: storedVersion,
      _storedShareVersion: storedShareVersion,
      _shareMetafields: [{ namespace: 'custom', key: 'deal_title', type: 'single_line_text_field', value: 'Deal' }],
    }),
    updateProductMetafields: async (...args) => { metafieldCalls += 1; lastMetafieldArgs = args; },
    updateProductProcessingState: async (...args) => {
      metafieldCalls += 1;
      lastProcessingArgs = args;
      storedHash = args[2];
    },
    updateProductShareVersion: async () => { metafieldCalls += 1; },
  } };
  delete require.cache[productPath];
  const {
    handleProduct,
    computeOgVersion,
    computeInputHash,
    computeShareVersion,
    computeShareVersionWithMetafields,
  } = require(productPath);
  const product = { id: 123, handle: 'example', title: 'Example', price: '10', compare_at_price: '15', image_url: 'https://cdn.example/source.jpg', share_version: 'share1234567' };
  const shareMetafields = [{ namespace: 'custom', key: 'deal_title', type: 'single_line_text_field', value: 'Deal' }];
  const expectedShareVersion = computeShareVersionWithMetafields(product.share_version, shareMetafields);
  const expectedInputHash = computeInputHash(product, { deal_enabled: null });
  storedShareVersion = expectedShareVersion;

  assert.strictEqual(computeOgVersion(imageBuffer), expectedVersion);
  assert.notStrictEqual(
    computeInputHash(product, {}),
    computeInputHash({ ...product, image_url: 'https://cdn.example/changed.jpg' }, {})
  );
  assert.notStrictEqual(
    computeInputHash(product, {}, { logoUrl: 'https://cdn.shopify.com/first.png' }),
    computeInputHash(product, {}, { logoUrl: 'https://cdn.shopify.com/second.png' })
  );
  assert.notStrictEqual(
    computeShareVersion({ title: 'Example', body_html: 'First' }),
    computeShareVersion({ title: 'Example', body_html: 'Changed' })
  );
  assert.strictEqual(
    computeShareVersion({ title: 'Example', updated_at: '2026-01-01' }),
    computeShareVersion({ title: 'Example', updated_at: '2026-01-02' })
  );
  assert.notStrictEqual(
    expectedShareVersion,
    computeShareVersionWithMetafields(product.share_version, [{ ...shareMetafields[0], value: 'Changed deal' }])
  );
  assert.notStrictEqual(
    computeShareVersionWithMetafields(product.share_version, shareMetafields, { logoUrl: 'https://cdn.shopify.com/first.png' }),
    computeShareVersionWithMetafields(product.share_version, shareMetafields, { logoUrl: 'https://cdn.shopify.com/second.png' })
  );

  const changed = await handleProduct(product);
  assert.strictEqual(changed.ogVersion, expectedVersion);
  assert.strictEqual(generationCalls, 1);
  assert.strictEqual(uploadCalls, 1);
  assert.strictEqual(lastUploadArgs[2], expectedVersion);
  assert.strictEqual(metafieldCalls, 1);
  assert.strictEqual(lastMetafieldArgs[1], 'https://cdn.example/og.jpg');
  assert.strictEqual(lastMetafieldArgs[2], expectedVersion);
  assert.strictEqual(lastMetafieldArgs[3], expectedShareVersion);
  assert.strictEqual(lastMetafieldArgs[4], expectedInputHash);

  storedVersion = expectedVersion;
  const unchanged = await handleProduct(product);
  assert.strictEqual(unchanged.unchanged, true);
  assert.strictEqual(generationCalls, 2);
  assert.strictEqual(uploadCalls, 1, 'unchanged image must not be uploaded');
  assert.strictEqual(metafieldCalls, 2, 'unchanged image must persist its processed input state');
  assert.deepStrictEqual(lastProcessingArgs.slice(0, 3), [product.id, expectedShareVersion, expectedInputHash]);

  const stable = await handleProduct(product);
  assert.strictEqual(stable, undefined);
  assert.strictEqual(generationCalls, 2, 'persisted input state must prevent repeat generation');
  assert.strictEqual(uploadCalls, 1);
  assert.strictEqual(metafieldCalls, 2);

  dealEnabled = null;
  storedVersion = null;
  storedShareVersion = expectedShareVersion;
  const disabledForInstalledShop = await handleProduct(product, { installation: { shopDomain: 'installed.myshopify.com' } });
  assert.strictEqual(disabledForInstalledShop, undefined);
  assert.strictEqual(uploadCalls, 1, 'new installations require deal_enabled=true');
}

async function testBatchedMetafields() {
  let requestBody;
  const clientPath = require.resolve('../src/shopify/client');
  const metafieldsPath = require.resolve('../src/shopify/metafields');
  require.cache[clientPath] = { exports: { post: async (_url, body) => {
    requestBody = body;
    return { data: { data: { metafieldsSet: { metafields: [], userErrors: [] } } } };
  } } };
  delete require.cache[metafieldsPath];
  const { updateProductMetafields, updateProductProcessingState } = require(metafieldsPath);
  await updateProductMetafields(123, 'https://cdn.example/og.jpg', 'abc123def456', 'share1234567', 'input-hash');

  const values = Object.fromEntries(requestBody.variables.metafields.map(field => [field.key, field.value]));
  assert.deepStrictEqual(values, {
    og_version: 'abc123def456',
    og_image: 'https://cdn.example/og.jpg',
    share_version: 'share1234567',
    og_image_input_hash: 'input-hash',
  });

  await updateProductProcessingState(123, 'share-next', 'input-next');
  const processingValues = Object.fromEntries(requestBody.variables.metafields.map(field => [field.key, field.value]));
  assert.deepStrictEqual(processingValues, {
    share_version: 'share-next',
    og_image_input_hash: 'input-next',
  });
}

async function testSafeProductImageTrimming() {
  const generatorPath = require.resolve('../src/image/generator');
  delete require.cache[generatorPath];
  const { detectTrimmableBackground, trimPlainProductBackground } = require(generatorPath);

  const productBlock = await sharp({
    create: { width: 80, height: 100, channels: 4, background: '#cc0000' },
  }).png().toBuffer();
  const whitePadded = await sharp({
    create: { width: 200, height: 200, channels: 4, background: '#ffffff' },
  }).composite([{ input: productBlock, left: 60, top: 50 }]).png().toBuffer();
  const visualBackground = await sharp({
    create: { width: 200, height: 200, channels: 4, background: '#4477aa' },
  }).png().toBuffer();

  assert.strictEqual(await detectTrimmableBackground(whitePadded), 'white');
  assert.strictEqual(await detectTrimmableBackground(visualBackground), null);

  const trimmed = await trimPlainProductBackground(whitePadded);
  const trimmedMetadata = await sharp(trimmed.buffer).metadata();
  assert.strictEqual(trimmed.trimmed, true);
  assert(trimmedMetadata.width < 200 && trimmedMetadata.height < 200);

  const preserved = await trimPlainProductBackground(visualBackground);
  assert.strictEqual(preserved.trimmed, false);
  assert.strictEqual(preserved.buffer, visualBackground);
}

(async () => {
  await testHmacVerification();
  await testProductIdempotency();
  await testBatchedMetafields();
  await testSafeProductImageTrimming();
  console.log('cache-busting tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
