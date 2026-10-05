'use strict';

function resolvePromoText(product) {
  const overrides = ['deal_title', 'deal_badge_text', 'deal_sale_price', 'deal_reg_price'];
  if (overrides.some(key => product[key] != null && String(product[key]).trim() !== '')) return product;
  const price = Number(product.price);
  const title = String(product.title || '').trim();
  if (title && (!Number.isFinite(price) || price === 0)) {
    return { ...product, deal_title: title, deal_badge_text: 'hide' };
  }
  return product;
}

module.exports = { resolvePromoText };
