'use strict';

/**
 * Phase 3 smoke test — verifies Shopify API connection, file upload, and
 * metafield update without needing a live webhook.
 *
 * Usage:
 *   node scripts/test-shopify.js
 *   node scripts/test-shopify.js --product-id 12345678901
 *
 * Requires .env with:
 *   SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
 *   SHOPIFY_CLIENT_ID=your_client_id
 *   SHOPIFY_CLIENT_SECRET=your_client_secret
 */

require('dotenv').config();

const path  = require('path');
const fs    = require('fs');
const axios = require('axios');

const config = require('../src/config');
const { uploadImageToShopify }    = require('../src/shopify/files');
const { updateProductMetafield }  = require('../src/shopify/metafields');

const productIdArg = (() => {
  const idx = process.argv.indexOf('--product-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

function separator(label) {
  console.log('\n' + '─'.repeat(56));
  console.log(`  ${label}`);
  console.log('─'.repeat(56));
}

async function testConnection() {
  separator('1 — Shopify API connection');
  const client = require('../src/shopify/client');
  const res = await client.get('/shop.json');
  console.log(`  ✓ Connected to: ${res.data.shop.name} (${res.data.shop.domain})`);
}

async function testFileUpload() {
  separator('2 — File upload');

  // Use an existing output image if available, else fall back to logo
  const candidates = [
    path.resolve('./output/product-deal-standard.jpg'),
    path.resolve('./assets/logo.png'),
  ];
  const filePath = candidates.find(p => fs.existsSync(p));
  if (!filePath) throw new Error('No test image found — run test-generate.js first');

  console.log(`  Uploading: ${filePath}`);
  const url = await uploadImageToShopify(filePath);
  console.log(`  ✓ Uploaded → ${url}`);
  return url;
}

async function testMetafieldUpdate(productId, imageUrl) {
  separator('3 — Metafield update');

  if (!productId) {
    console.log('  ⚠  Skipped — pass --product-id <id> to test metafield update');
    return;
  }

  console.log(`  Product ID : ${productId}`);
  console.log(`  Image URL  : ${imageUrl}`);
  const mf = await updateProductMetafield(productId, imageUrl);
  console.log(`  ✓ Metafield set — id=${mf.id}  ${mf.namespace}.${mf.key}="${mf.value}"`);
}

async function run() {
  console.log('Shopify Phase 3 — Integration Test');

  if (!config.shopifyShopDomain || !config.shopifyClientId || !config.shopifyClientSecret) {
    console.error('\n  ✗ Missing env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and/or SHOPIFY_CLIENT_SECRET');
    console.error('  Add them to .env and retry.\n');
    process.exit(1);
  }

  try {
    await testConnection();
  } catch (err) {
    console.error(`  ✗ Connection failed: ${err.message}`);
    process.exit(1);
  }

  let uploadedUrl = null;
  try {
    uploadedUrl = await testFileUpload();
  } catch (err) {
    console.error(`  ✗ File upload failed: ${err.message}`);
  }

  if (uploadedUrl) {
    try {
      await testMetafieldUpdate(productIdArg, uploadedUrl);
    } catch (err) {
      console.error(`  ✗ Metafield update failed: ${err.message}`);
    }
  }

  separator('Done');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
