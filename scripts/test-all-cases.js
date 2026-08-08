'use strict';

/**
 * Generates one image per documented case so you can visually verify every layout.
 * Usage:  node scripts/test-all-cases.js
 * Output: output/case-*.jpg
 */

require('dotenv').config();

const { generateProductImage } = require('../src/image/generator');
const path = require('path');
const fs   = require('fs');

// Load local test product images if they exist
function localImage(filename) {
  const p = path.resolve('assets', filename);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

const img1 = localImage('test-product1.jpg');
const img2 = localImage('test-product2.jpg');

const BASE = {
  price:            '14.44',
  compare_at_price: '21.89',
  image_buffer:     img1,
};

const CASES = [
  {
    id:   'case1-no-compare-at',
    desc: 'All empty, no compare-at price → DEAL badge',
    product: { ...BASE, compare_at_price: null },
  },
  {
    id:   'case2-auto-percent',
    desc: 'All empty + compare-at set → auto 34% OFF + Reg. $22',
    product: { ...BASE },
  },
  {
    id:   'case3-badge-only',
    desc: 'deal_sale_price=hide + deal_reg_price=hide → large 34% OFF, no prices',
    product: { ...BASE, deal_sale_price: 'hide', deal_reg_price: 'hide' },
  },
  {
    id:   'case3b-badge-only-no-compare',
    desc: 'deal_sale_price=hide + deal_reg_price=hide + no compare-at → large DEAL, no prices',
    product: { ...BASE, compare_at_price: null, deal_sale_price: 'hide', deal_reg_price: 'hide' },
  },
  {
    id:   'case4-custom-badge',
    desc: 'deal_badge_text=HOT DEAL → custom badge text',
    product: { ...BASE, deal_badge_text: 'HOT DEAL' },
  },
  {
    id:   'case5-badge-hidden',
    desc: 'deal_badge_text=hide → no badge, just prices',
    product: { ...BASE, deal_badge_text: 'hide' },
  },
  {
    id:   'case6-title-with-badge',
    desc: 'deal_title set + badge visible → badge + title below',
    product: { ...BASE, deal_title: 'Free Shipping on Orders Over $50' },
  },
  {
    id:   'case7-title-only',
    desc: 'deal_title set + deal_badge_text=hide → large title only, no badge',
    product: { ...BASE, deal_badge_text: 'hide', deal_title: 'Buy 2 Get 1 Free' },
  },
  {
    id:   'case8-custom-sale-price',
    desc: 'deal_sale_price=$9.99 → overrides Shopify price in display',
    product: { ...BASE, deal_sale_price: '$9.99' },
  },
  {
    id:   'case9-custom-reg-price',
    desc: 'deal_reg_price=$50.00 → overrides compare-at in Reg. line',
    product: { ...BASE, deal_reg_price: '$50.00' },
  },
  {
    id:   'case10-all-custom',
    desc: 'All overrides set manually',
    product: {
      ...BASE,
      deal_badge_text: '60% OFF',
      deal_sale_price: '$29.99',
      deal_reg_price:  '$74.99',
    },
  },
  // ── Repeat key cases with second product image ──
  {
    id:   'case2b-auto-percent-img2',
    desc: 'Auto 34% OFF with second product image',
    product: { ...BASE, image_buffer: img2 },
  },
  {
    id:   'case3b-badge-only-img2',
    desc: 'Badge-only mode with second product image',
    product: { ...BASE, image_buffer: img2, deal_sale_price: 'hide', deal_reg_price: 'hide' },
  },
];

async function run() {
  fs.mkdirSync('output', { recursive: true });

  console.log('─'.repeat(60));
  console.log('  Simplex Deals — All Cases Test');
  console.log('─'.repeat(60));

  for (const { id, desc, product } of CASES) {
    console.log(`\n→ [${id}]\n  ${desc}`);
    try {
      const buffer = await generateProductImage({ id, title: 'Test Product', ...product });
      const outPath = `output/${id}.jpg`;
      fs.writeFileSync(outPath, buffer);
      console.log(`  ✓ saved: ${path.resolve(outPath)}`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  Done — ${CASES.length} images in ${path.resolve('output')}`);
  console.log('─'.repeat(60));
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
