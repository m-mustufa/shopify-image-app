'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function testRoundupDataExtraction() {
  const { extractRoundupData } = require('../src/shopify/metafields');
  const metafieldsSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'shopify', 'metafields.js'),
    'utf8'
  );
  assert.match(metafieldsSource, /references\(first:\s*100\)/);
  const roundup = extractRoundupData({
    roundupTitle: { value: ' Weekend deals ' },
    roundupDeals: { references: { nodes: [{
      id: 'gid://shopify/Product/1',
      handle: 'first-deal',
      title: 'First deal',
      vendor: 'Amazon',
      status: 'ACTIVE',
      featuredImage: { url: 'https://cdn.shopify.com/files/first.jpg', altText: 'First' },
      dealExpired: { value: 'true' },
      variants: { nodes: [{ price: '9.99', compareAtPrice: '19.99' }] },
    }] } },
  });
  assert.strictEqual(roundup.title, 'Weekend deals');
  assert.deepStrictEqual(roundup.deals[0], {
    id: 'gid://shopify/Product/1',
    handle: 'first-deal',
    title: 'First deal',
    vendor: 'Amazon',
    imageUrl: 'https://cdn.shopify.com/files/first.jpg',
    imageAlt: 'First',
    price: '9.99',
    compareAtPrice: '19.99',
    expired: true,
    active: true,
  });
  assert.deepStrictEqual(
    extractRoundupData({ roundupTitle: { value: 'Empty roundup' }, roundupDeals: { references: { nodes: [] } } }),
    { title: 'Empty roundup', deals: [] }
  );
}

async function testNormalRendererIsPixelIdentical() {
  const { generateProductImage } = require('../src/image/generator');
  const imageBuffer = fs.readFileSync(path.join(__dirname, '..', 'assets', 'test-product1.jpg'));
  const buffer = await generateProductImage({
    id: 'normal-baseline',
    title: 'Normal deal',
    price: '5.14',
    compare_at_price: '8.43',
    image_buffer: imageBuffer,
    badge_text: null,
  });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  assert.strictEqual(hash, '34799059c2e94f0780695d5e2a62b488f43dd2525fc88a8da3898029264e64ad');
}

async function testOptionBRenderer() {
  const { generateProductImage } = require('../src/image/generator');
  const { buildRoundupProductData, roundupDiscountPercent } = require('../src/webhooks/product');
  assert.strictEqual(roundupDiscountPercent({ price: '31.39', compareAtPrice: '69.00' }), 55);

  const productData = buildRoundupProductData({ id: 2, title: 'Carrier', image_url: null }, {}, {
    title: 'Weekend deals',
    deals: [{
      id: 'one',
      price: '31.39',
      compareAtPrice: '69.00',
      imageUrl: null,
      expired: false,
      active: true,
    }],
  });
  assert.strictEqual(productData.deal_badge_text, 'UP TO');
  assert.strictEqual(productData.deal_sale_text, '55% OFF');
  assert.strictEqual(productData.deal_reg_price, null);

  const titleOnly = buildRoundupProductData({ id: 3, title: 'Carrier title', image_url: null }, {}, {
    title: 'No active discounts',
    deals: [
      { id: 'inactive', price: '1', compareAtPrice: '100', active: false, expired: false },
      { id: 'full-price', price: '100', compareAtPrice: '100', active: true, expired: false },
    ],
  });
  assert.strictEqual(titleOnly.deal_badge_text, 'hide');
  assert.strictEqual(titleOnly.deal_sale_price, 'hide');
  assert.strictEqual(titleOnly.deal_title, 'No active discounts');

  const buffer = await generateProductImage(productData);
  const metadata = await sharp(buffer).metadata();
  assert.strictEqual(metadata.width, 1200);
  assert.strictEqual(metadata.height, 628);
  assert.strictEqual(metadata.format, 'jpeg');
}

async function testRoundupInputHash() {
  const { computeInputHash, extractProductData } = require('../src/webhooks/product');
  const extracted = extractProductData({
    id: 123,
    handle: 'carrier',
    title: 'Carrier',
    template_suffix: 'deal-roundup',
    variants: [],
  });
  assert.strictEqual(extracted.template_suffix, 'deal-roundup');

  const product = { id: 123, title: 'Carrier', template_suffix: 'deal-roundup' };
  const roundup = {
    title: 'Weekend deals',
    deals: [{
      id: 'gid://shopify/Product/1',
      title: 'First',
      price: '9.99',
      compareAtPrice: '19.99',
      imageUrl: 'https://cdn.example/first.jpg',
      expired: false,
      active: true,
    }],
  };
  const original = computeInputHash(product, {}, { roundup });
  assert.notStrictEqual(original, computeInputHash({ ...product, template_suffix: '' }, {}, { roundup }));
  for (const change of [
    { id: 'gid://shopify/Product/2' },
    { price: '8.99' },
    { compareAtPrice: '21.99' },
    { imageUrl: 'https://cdn.example/second.jpg' },
    { expired: true },
    { active: false },
  ]) {
    assert.notStrictEqual(original, computeInputHash(product, {}, {
      roundup: { ...roundup, deals: [{ ...roundup.deals[0], ...change }] },
    }));
  }
}

async function testRoundupWebhookRouting() {
  const generated = [];
  const generatorPath = require.resolve('../src/image/generator');
  const filesPath = require.resolve('../src/shopify/files');
  const metafieldsPath = require.resolve('../src/shopify/metafields');
  const productPath = require.resolve('../src/webhooks/product');

  const roundups = {
    1: { title: 'Must be ignored', deals: [{ id: 'normal-ref', price: '1', compareAtPrice: '100', active: true }] },
    2: { title: 'Own image roundup', deals: [{ id: 'own', price: '45', compareAtPrice: '100', imageUrl: 'https://cdn.example/deal.jpg', active: true }] },
    3: { title: 'Fallback image roundup', deals: [
      { id: 'expired', price: '1', compareAtPrice: '100', imageUrl: 'https://cdn.example/expired.jpg', expired: true, active: true },
      { id: 'active', price: '50', compareAtPrice: '100', imageUrl: 'https://cdn.example/first-active.jpg', active: true },
      { id: 'inactive', price: '2', compareAtPrice: '100', imageUrl: 'https://cdn.example/inactive.jpg', active: false },
    ] },
    4: { title: 'Expired max roundup', deals: [
      { id: 'expired-max', price: '1', compareAtPrice: '100', expired: true, active: true },
      { id: 'valid', price: '70', compareAtPrice: '100', expired: false, active: true },
    ] },
    5: { title: 'Empty roundup title', deals: [] },
  };

  require.cache[generatorPath] = { exports: {
    generateProductImage: async product => {
      generated.push(product);
      return Buffer.from(`image-${product.id}`);
    },
  } };
  require.cache[filesPath] = { exports: { uploadBufferToShopify: async () => 'https://cdn.example/generated.jpg' } };
  require.cache[metafieldsPath] = { exports: {
    fetchProductOverrides: async productId => ({
      deal_enabled: productId === 1 ? true : null,
      _storedHash: null,
      _storedOgVersion: null,
      _storedShareVersion: null,
      _shareMetafields: [],
      _roundup: roundups[productId],
    }),
    updateProductMetafields: async () => {},
    updateProductProcessingState: async () => {},
    updateProductShareVersion: async () => {},
  } };
  delete require.cache[productPath];
  const { handleProduct } = require(productPath);
  const context = { installation: { shopDomain: 'example.myshopify.com' }, shopDomain: 'example.myshopify.com' };

  await handleProduct({ id: 1, title: 'Normal', template_suffix: '', price: '10', compare_at_price: '20', image_url: 'normal.jpg', share_version: 'v1' }, context);
  await handleProduct({ id: 2, title: 'Own', template_suffix: 'deal-roundup', image_url: 'own.jpg', share_version: 'v2' }, context);
  await handleProduct({ id: 3, title: 'Fallback', template_suffix: 'deal-roundup', image_url: null, share_version: 'v3' }, context);
  await handleProduct({ id: 4, title: 'Expired max', template_suffix: 'deal-roundup', image_url: null, share_version: 'v4' }, context);
  await handleProduct({ id: 5, title: 'Empty', template_suffix: 'deal-roundup', image_url: null, share_version: 'v5' }, context);

  assert.strictEqual(generated.length, 5);
  assert.strictEqual(generated[0].deal_sale_text, undefined);
  assert.strictEqual(generated[0].image_url, 'normal.jpg');
  assert.strictEqual(generated[0].price, '10');
  assert.strictEqual(generated[1].image_url, 'own.jpg');
  assert.strictEqual(generated[1].deal_badge_text, 'UP TO');
  assert.strictEqual(generated[1].deal_sale_text, '55% OFF');
  assert.strictEqual(generated[1].deal_reg_price, null);
  assert.strictEqual(generated[2].image_url, 'https://cdn.example/first-active.jpg');
  assert.strictEqual(generated[2].deal_sale_text, '50% OFF');
  assert.strictEqual(generated[3].deal_sale_text, '30% OFF');
  assert.strictEqual(generated[4].deal_badge_text, 'hide');
  assert.strictEqual(generated[4].deal_sale_price, 'hide');
  assert.strictEqual(generated[4].deal_title, 'Empty roundup title');
}

(async () => {
  await testRoundupDataExtraction();
  await testNormalRendererIsPixelIdentical();
  await testOptionBRenderer();
  await testRoundupInputHash();
  await testRoundupWebhookRouting();
  console.log('roundup preview tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
