'use strict';

/**
 * Register Shopify webhooks for products/create and products/update.
 * Safe to re-run — lists existing webhooks first and skips duplicates.
 *
 * Usage:
 *   node scripts/register-webhooks.js
 *   node scripts/register-webhooks.js --url https://your-vercel-url.vercel.app
 */

require('dotenv').config();

const client = require('../src/shopify/client');

const CALLBACK_URL = (() => {
  const idx = process.argv.indexOf('--url');
  return idx !== -1
    ? process.argv[idx + 1]
    : 'https://shopify-image-app-seven.vercel.app';
})();

const TOPICS = [
  { topic: 'products/create', path: '/webhooks/products/create' },
  { topic: 'products/update', path: '/webhooks/products/update' },
];

function separator(label) {
  console.log('\n' + '─'.repeat(60));
  if (label) console.log(`  ${label}`);
  console.log('─'.repeat(60));
}

async function listWebhooks() {
  const res = await client.get('/webhooks.json?limit=250');
  return res.data.webhooks ?? [];
}

async function createWebhook(topic, address) {
  const res = await client.post('/webhooks.json', {
    webhook: {
      topic,
      address,
      format: 'json',
    },
  });
  return res.data.webhook;
}

async function deleteWebhook(id) {
  await client.delete(`/webhooks/${id}.json`);
}

async function run() {
  separator('Shopify Webhook Registration');
  console.log(`  Store   : ${process.env.SHOPIFY_SHOP_DOMAIN}`);
  console.log(`  Base URL: ${CALLBACK_URL}`);

  // 1. Fetch existing webhooks
  console.log('\n→ Fetching existing webhooks...');
  let existing;
  try {
    existing = await listWebhooks();
  } catch (err) {
    console.error(`  ✗ Could not list webhooks: ${err.message}`);
    if (err.response) {
      console.error('  Response:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }

  console.log(`  Found ${existing.length} existing webhook(s):`);
  existing.forEach(w => console.log(`    [${w.id}] ${w.topic} → ${w.address}`));

  // 2. Register each required topic
  separator('Registering webhooks');
  for (const { topic, path } of TOPICS) {
    const address  = `${CALLBACK_URL}${path}`;
    const existing_match = existing.find(w => w.topic === topic);

    if (existing_match) {
      if (existing_match.address === address) {
        console.log(`  ✓ Already registered: ${topic} → ${address}`);
        continue;
      }
      // Wrong URL — delete stale entry and re-create
      console.log(`  ~ Updating stale webhook [${existing_match.id}] for ${topic}`);
      try {
        await deleteWebhook(existing_match.id);
      } catch (err) {
        console.warn(`  ⚠  Could not delete old webhook: ${err.message}`);
      }
    }

    try {
      const wh = await createWebhook(topic, address);
      console.log(`  ✓ Registered: ${topic}`);
      console.log(`      id      : ${wh.id}`);
      console.log(`      address : ${wh.address}`);
    } catch (err) {
      console.error(`  ✗ Failed to register ${topic}: ${err.message}`);
      if (err.response) {
        console.error('    Response:', JSON.stringify(err.response.data, null, 2));
      }
    }
  }

  separator('Done');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
