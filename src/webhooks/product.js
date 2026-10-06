'use strict';

const crypto = require('crypto');
const { resolvePromoText } = require('../image/promoText');

const { generateProductImage }                          = require('../image/generator');
const { uploadBufferToShopify }                         = require('../shopify/files');
const {
  updateProductMetafields,
  updateProductProcessingState,
  updateProductShareVersion,
  fetchProductOverrides,
} = require('../shopify/metafields');

function roundupInputSnapshot(roundup) {
  if (!roundup) return null;
  return {
    title: roundup.title ?? '',
    deals: (roundup.deals || []).map(deal => ({
      id: String(deal.id ?? ''),
      title: deal.title ?? '',
      vendor: deal.vendor ?? '',
      image_url: deal.imageUrl ?? '',
      price: deal.price ?? '',
      compare_at_price: deal.compareAtPrice ?? '',
      expired: deal.expired === true,
      active: deal.active !== false,
    })),
  };
}

function roundupDiscountPercent(deal) {
  const price = Number.parseFloat(deal?.price);
  const compareAtPrice = Number.parseFloat(deal?.compareAtPrice);
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice) || compareAtPrice <= price || compareAtPrice <= 0) {
    return null;
  }
  return Math.round(((compareAtPrice - price) * 100) / compareAtPrice);
}

function buildRoundupProductData(product, overrides, roundup) {
  const nonExpiredDeals = (roundup?.deals || []).filter(deal => deal.expired !== true);
  const activeDeals = nonExpiredDeals.filter(deal => deal.active !== false);
  const highestDiscount = activeDeals.reduce((highest, deal) => {
    const discount = roundupDiscountPercent(deal);
    return discount === null ? highest : Math.max(highest, discount);
  }, 0);
  const imageUrl = product.image_url || nonExpiredDeals.find(deal => deal.imageUrl)?.imageUrl || null;
  const base = {
    ...product,
    ...overrides,
    image_url: imageUrl,
    compare_at_price: null,
    deal_reg_price: null,
  };

  if (highestDiscount > 0) {
    return {
      ...base,
      deal_badge_text: 'UP TO',
      deal_sale_price: null,
      deal_sale_text: `${highestDiscount}% OFF`,
      deal_title: null,
    };
  }

  return {
    ...base,
    deal_badge_text: 'hide',
    deal_sale_price: 'hide',
    deal_sale_text: null,
    deal_title: roundup?.title || product.title,
  };
}

// Bump when generator output changes for the same inputs, so saved products regenerate.
const GENERATOR_VERSION = '3';

function computeInputHash(product, overrides, brand = {}) {
  const parts = [
    GENERATOR_VERSION,
    product.title            ?? '',
    product.template_suffix  ?? '',
    product.price            ?? '',
    product.compare_at_price ?? '',
    product.image_url        ?? '',
    overrides.deal_enabled   ?? '',
    overrides.deal_badge_text  ?? '',
    overrides.deal_sale_price  ?? '',
    overrides.deal_reg_price   ?? '',
    overrides.deal_title       ?? '',
    brand.logoUrl              ?? '',
  ];
  if (brand.roundup) parts.push(JSON.stringify(roundupInputSnapshot(brand.roundup)));
  const renderInput = { ...product, ...overrides };
  // Invalidate only automatic no-price images; priced-product hashes stay unchanged.
  if (resolvePromoText(renderInput) !== renderInput) parts.push('automatic-title-v3');
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

function computeOgVersion(imageBuffer) {
  return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 12);
}

function computeShareVersion(payload) {
  const byPositionAndId = (a, b) =>
    (Number(a.position ?? 0) - Number(b.position ?? 0)) ||
    String(a.id ?? '').localeCompare(String(b.id ?? ''));

  const snapshot = {
    title: payload.title ?? '',
    body_html: payload.body_html ?? '',
    handle: payload.handle ?? '',
    vendor: payload.vendor ?? '',
    product_type: payload.product_type ?? '',
    status: payload.status ?? '',
    published_at: payload.published_at ?? '',
    template_suffix: payload.template_suffix ?? '',
    tags: String(payload.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean).sort(),
    options: [...(payload.options ?? [])].sort(byPositionAndId).map(option => ({
      id: option.id ?? null,
      name: option.name ?? '',
      position: option.position ?? null,
      values: option.values ?? [],
    })),
    variants: [...(payload.variants ?? [])].sort(byPositionAndId).map(variant => ({
      id: variant.id ?? null,
      title: variant.title ?? '',
      sku: variant.sku ?? '',
      barcode: variant.barcode ?? '',
      price: variant.price ?? '',
      compare_at_price: variant.compare_at_price ?? '',
      position: variant.position ?? null,
      option1: variant.option1 ?? '',
      option2: variant.option2 ?? '',
      option3: variant.option3 ?? '',
      image_id: variant.image_id ?? null,
      requires_shipping: variant.requires_shipping ?? null,
      taxable: variant.taxable ?? null,
      weight: variant.weight ?? null,
      weight_unit: variant.weight_unit ?? '',
    })),
    images: [...(payload.images ?? [])].sort(byPositionAndId).map(image => ({
      id: image.id ?? null,
      src: image.src ?? '',
      alt: image.alt ?? '',
      position: image.position ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
    })),
  };

  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 12);
}

function computeShareVersionWithMetafields(baseVersion, metafields = [], brand = {}) {
  const snapshot = {
    baseVersion,
    metafields,
    logoUrl: brand.logoUrl || null,
  };
  if (brand.roundup) snapshot.roundup = brand.roundup;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex')
    .slice(0, 12);
}

function extractProductData(payload) {
  return {
    id:               payload.id,
    handle:           payload.handle ?? null,
    title:            payload.title,
    template_suffix:  payload.template_suffix ?? null,
    price:            payload.variants?.[0]?.price ?? null,
    compare_at_price: payload.variants?.[0]?.compare_at_price ?? null,
    image_url:        payload.image?.src || payload.images?.[0]?.src || null,
    badge_text:       null,
    share_version:    computeShareVersion(payload),
  };
}

async function handleProduct(product, context = {}) {
  console.log('[product] handleProduct called with:', product.id);
  try {
    // 1. Fetch per-product metafield overrides (includes _storedHash)
    const overrides = await fetchProductOverrides(product.id, context.client);
    const {
      _storedHash,
      _storedOgVersion,
      _storedOgImage,
      _storedShareVersion,
      _shareMetafields,
      _roundup,
      _notFound,
      ...cleanOverrides
    } = overrides;

    if (_notFound) {
      console.log(`[product] skipping — product ${product.id} not found in store`);
      return;
    }

    console.log('[product] overrides:', cleanOverrides);

    const isRoundup = product.template_suffix === 'deal-roundup';
    const roundup = isRoundup ? (_roundup || { title: null, deals: [] }) : null;
    if (isRoundup && !roundup.deals.length) {
      console.log('[product] roundup template has no selected deals — using title-only fallback');
    }
    const shareVersion = computeShareVersionWithMetafields(
      product.share_version,
      _shareMetafields ?? [],
      { logoUrl: context.logoUrl, roundup }
    );
    const shareVersionChanged = Boolean(shareVersion && _storedShareVersion !== shareVersion);

    // fetchProductOverrides defaults an unset flag to true, so only an explicit
    // "false" opts a product out. A failed read leaves it undefined; installed
    // shops then skip rather than render an image without the overrides.
    const generationDisabled = context.installation
      ? cleanOverrides.deal_enabled === undefined || (!isRoundup && cleanOverrides.deal_enabled !== true)
      : !isRoundup && cleanOverrides.deal_enabled === false;
    if (generationDisabled) {
      if (shareVersionChanged) await updateProductShareVersion(product.id, shareVersion, context.client);
      console.log(`[product] skipping - deal_enabled is ${cleanOverrides.deal_enabled}`);
      return;
    }

    // 2. Skip if nothing that affects the image actually changed.
    //    This breaks the infinite loop caused by our own metafield updates
    //    triggering a new products/update webhook.
    const inputHash = computeInputHash(product, cleanOverrides, {
      logoUrl: context.logoUrl,
      roundup,
    });
    // A missing og_image (stale admin save, or a duplicated product that copied
    // processing state without an image) must not be masked by a matching hash.
    // The stored URL must also be the image we last generated: uploads are named
    // promo-<id>-<ogVersion>.jpg, and a stale admin save can write an older URL
    // back into og_image while og_version and the input hash still match.
    const hasStoredImage = Boolean(
      _storedOgImage && _storedOgVersion && _storedOgImage.includes(`-${_storedOgVersion}`)
    );
    if (_storedHash === inputHash && hasStoredImage) {
      if (shareVersionChanged) {
        await updateProductShareVersion(product.id, shareVersion, context.client);
        console.log(`[product] share version updated — ${shareVersion}`);
      }
      console.log(`[product] skipping — input unchanged (hash ${inputHash})`);
      return;
    }
    if (_storedHash === inputHash) {
      console.log(`[product] input unchanged but og_image is missing or stale (hash ${inputHash}), regenerating`);
    } else {
      console.log(`[product] input changed (${_storedHash ?? 'none'} → ${inputHash}), generating`);
    }

    const productData = roundup
      ? buildRoundupProductData(product, cleanOverrides, roundup)
      : { ...product, ...cleanOverrides };

    // 3. Generate the promo image as a buffer
    const buffer = await generateProductImage(productData, { logoUrl: context.logoUrl });
    console.log('[product] image buffer ready, size:', buffer.length);

    const ogVersion = computeOgVersion(buffer);
    if (_storedOgVersion === ogVersion && hasStoredImage) {
      await updateProductProcessingState(product.id, shareVersion, inputHash, context.client);
      console.log(`[product] processing state updated — share ${shareVersion}, input ${inputHash}`);
      console.log(`[product] skipping — generated image unchanged (OG version ${ogVersion})`);
      return { imageUrl: null, ogVersion, unchanged: true };
    }
    console.log(`[product] OG version changed (${_storedOgVersion ?? 'none'} → ${ogVersion})`);

    // 4. Upload to Shopify Files — failure is non-fatal
    let imageUrl = null;
    try {
      imageUrl = await uploadBufferToShopify(buffer, product.id, ogVersion, context.client, context.shopDomain);
      console.log('[product] uploaded to Shopify:', imageUrl);
    } catch (err) {
      console.error(`[product] Shopify upload failed (non-fatal): ${err.message}`);
    }

    // 5. Write image, image version, share version, and input hash in one batched call
    let shareVersionWritten = false;
    if (imageUrl) {
      let metafieldOk = false;
      try {
        await updateProductMetafields(
          product.id,
          imageUrl,
          ogVersion,
          shareVersion,
          inputHash,
          context.client
        );
        console.log(`[product] metafields updated — product ${product.id}`);
        metafieldOk = true;
        shareVersionWritten = true;
      } catch (err) {
        console.error(`[product] metafield update failed (non-fatal): ${err.message}`);
      }
    }

    if (shareVersionChanged && !shareVersionWritten) {
      try {
        await updateProductShareVersion(product.id, shareVersion, context.client);
        console.log(`[product] share version updated — ${shareVersion}`);
      } catch (err) {
        console.error(`[product] share version update failed (non-fatal): ${err.message}`);
      }
    }

    return { imageUrl, ogVersion };
  } catch (err) {
    console.error('[product] error:', err.message, err.stack);
    throw err;
  }
}

async function handleProductCreate(req, res) {
  const product = extractProductData(req.body);
  console.log(`[webhook] products/create — id=${product.id} title="${product.title}"`);
  console.log('[product] step 1: starting handleProduct');
  try {
    await handleProduct(product);
    console.log('[product] step final: all done');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] failed:', err.message);
    res.status(200).json({ ok: true });
  }
}

async function handleProductUpdate(req, res) {
  const product = extractProductData(req.body);
  console.log(`[webhook] products/update — id=${product.id} title="${product.title}"`);
  console.log('[product] step 1: starting handleProduct');
  try {
    await handleProduct(product);
    console.log('[product] step final: all done');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] failed:', err.message);
    res.status(200).json({ ok: true });
  }
}

module.exports = {
  handleProductCreate,
  handleProductUpdate,
  handleProduct,
  extractProductData,
  computeInputHash,
  computeOgVersion,
  computeShareVersion,
  computeShareVersionWithMetafields,
  buildRoundupProductData,
  roundupDiscountPercent,
};
