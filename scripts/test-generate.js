'use strict';

/**
 * Local test — generates the full Canva-template image (1200×628) for several
 * mock products.  No Shopify access required.
 *
 * Usage:
 *   node scripts/test-generate.js               — all cases, downloads images
 *   node scripts/test-generate.js --no-image    — skip image download (text only)
 *   node scripts/test-generate.js --single <id> — run one case by id
 */

require('dotenv').config();

const { generateProductImage } = require('../src/image/generator');
const path = require('path');
const fs   = require('fs');

const flags = new Set(process.argv.slice(2));
const singleId = (() => {
  const idx = process.argv.indexOf('--single');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const noImage = flags.has('--no-image');

// Picsum seeds give consistent placeholder images without an API key.
const img = seed => noImage ? null : `https://picsum.photos/seed/${seed}/900/628`;

const MOCK_PRODUCTS = [
  {
    // Standard deal: auto % OFF badge  →  "🔥 47% OFF"
    id:               'deal-standard',
    title:            'Nike Air Max 270 React',
    price:            '79.99',
    compare_at_price: '149.50',   // ceil → $150
    image_url:        img('sneaker'),
    badge_text:       null,
  },
  {
    // Big saving: auto badge  →  "🔥 76% OFF"
    id:               'deal-big-save',
    title:            'Wireless Noise Cancelling Headphones Pro',
    price:            '49.00',
    compare_at_price: '199.99',   // ceil → $200
    image_url:        img('headphones'),
    badge_text:       null,
  },
  {
    // Custom metafield badge override (client-controlled copy)
    id:               'deal-custom-badge',
    title:            'Leather Bifold Wallet',
    price:            '34.95',
    compare_at_price: '59.00',    // ceil → $59
    image_url:        img('wallet'),
    badge_text:       '🎁 GIFT DEAL',   // metafield override
  },
  {
    // No compare-at price (single price, no reg. line, generic badge)
    id:               'deal-no-compare',
    title:            'Classic White Tee',
    price:            '24.00',
    compare_at_price: null,
    image_url:        img('fashion'),
    badge_text:       null,
  },
  {
    // Long price string — triggers smaller font-size
    id:               'deal-high-price',
    title:            'Premium Standing Desk',
    price:            '1,299.00',
    compare_at_price: '1,899.99',  // ceil → $1900
    image_url:        img('desk'),
    badge_text:       null,
  },
];

const products = singleId
  ? MOCK_PRODUCTS.filter(p => p.id === singleId)
  : MOCK_PRODUCTS;

async function run() {
  console.log('─'.repeat(56));
  console.log('  Simplex Deals — Image Generator (1200×628)');
  console.log('─'.repeat(56));

  for (const product of products) {
    console.log(`\n→ [${product.id}]  price: $${product.price}  ` +
                `compare: ${product.compare_at_price ?? '—'}  ` +
                `badge: "${product.badge_text ?? 'auto'}"`);
    try {
      const buffer = await generateProductImage(product);
      const outputPath = `output/product-${product.id}.jpg`;
      fs.mkdirSync('output', { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      console.log('[test] saved:', path.resolve(outputPath));
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }

  console.log('\n─'.repeat(56));
  console.log(`  Done — ${products.length} image(s) in ${path.resolve('output')}`);
  console.log('─'.repeat(56));
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
