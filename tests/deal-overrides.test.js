'use strict';

const assert = require('assert');
const { normalizeDealOverrides } = require('../src/image/generator');

// "Hide" in any casing hides the field instead of rendering as "$0.00".
const hidden = normalizeDealOverrides({
  title: 'Board Games', price: '20.00', compare_at_price: '40.00',
  deal_badge_text: ' HIDE ', deal_sale_price: 'Hide', deal_reg_price: 'hIdE',
});
assert.strictEqual(hidden.deal_badge_text, 'hide');
assert.strictEqual(hidden.deal_sale_price, 'hide');
assert.strictEqual(hidden.deal_reg_price, null);
assert.strictEqual(hidden.compare_at_price, null);

// A $0 product falls back to its title instead of printing "$0.00".
const free = normalizeDealOverrides({ title: 'Save Big On Board Games', price: '0.00', deal_badge_text: 'Great Prices' });
assert.strictEqual(free.deal_title, 'Save Big On Board Games');
assert.strictEqual(free.deal_badge_text, 'Great Prices');

const freeHidden = normalizeDealOverrides({ title: 'Save Big', price: '0.00', deal_sale_price: 'Hide', deal_reg_price: 'Hide' });
assert.strictEqual(freeHidden.deal_title, 'Save Big');

// A manual sale price, custom title or roundup sale text is left alone.
assert.strictEqual(normalizeDealOverrides({ title: 'X', price: '0.00', deal_sale_price: '$9.99' }).deal_title, undefined);
assert.strictEqual(normalizeDealOverrides({ title: 'X', price: '0.00', deal_title: 'Custom' }).deal_title, 'Custom');
assert.strictEqual(normalizeDealOverrides({ title: 'X', price: '0', deal_sale_text: '70% OFF' }).deal_title, undefined);

// Normal priced deals are unchanged.
const normal = normalizeDealOverrides({ title: 'Acer', price: '79.99', compare_at_price: '149.99' });
assert.strictEqual(normal.deal_title, undefined);
assert.strictEqual(normal.compare_at_price, '149.99');

console.log('deal override tests passed');
