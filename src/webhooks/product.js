'use strict';

const crypto = require('crypto');

const { generateProductImage }                          = require('../image/generator');
const { uploadBufferToShopify }                         = require('../shopify/files');
const {
  updateProductMetafields,
  updateProductShareVersion,
  fetchProductOverrides,
} = require('../shopify/metafields');
const { fbAppId, fbAppSecret, storePublicDomain } = require('../config');

async function bustFacebookCache(handle) {
  if (!fbAppId || !fbAppSecret || !handle || !storePublicDomain) return;
  const productUrl = `https://${storePublicDomain}/products/${handle}`;
  const token      = `${fbAppId}|${fbAppSecret}`;
  // Wait 5s for Shopify to propagate the new metafield before Facebook scrapes
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res  = await fetch(`https://graph.facebook.com/?id=${encodeURIComponent(productUrl)}&scrape=true&access_token=${encodeURIComponent(token)}`, { method: 'POST' });
    const data = await res.json();
    if (data.url || data.updated_time) {
      const foundImage = data.image?.[0]?.url ?? 'none';
      console.log(`[facebook] cache busted: ${productUrl} — image: ${foundImage}`);
    } else {
      console.warn('[facebook] scrape response:', JSON.stringify(data));
    }
  } catch (err) {
    console.warn('[facebook] cache bust failed (non-fatal):', err.message);
  }
}

function computeInputHash(product, overrides) {
  const parts = [
    product.title            ?? '',
    product.price            ?? '',
    product.compare_at_price ?? '',
    product.image_url        ?? '',
    overrides.deal_enabled   ?? '',
    overrides.deal_badge_text  ?? '',
    overrides.deal_sale_price  ?? '',
    overrides.deal_reg_price   ?? '',
    overrides.deal_title       ?? '',
  ];
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

function computeShareVersionWithMetafields(baseVersion, metafields = []) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ baseVersion, metafields }))
    .digest('hex')
    .slice(0, 12);
}

function extractProductData(payload) {
  return {
    id:               payload.id,
    handle:           payload.handle ?? null,
    title:            payload.title,
    price:            payload.variants?.[0]?.price ?? null,
    compare_at_price: payload.variants?.[0]?.compare_at_price ?? null,
    image_url:        payload.image?.src || payload.images?.[0]?.src || null,
    badge_text:       null,
    share_version:    computeShareVersion(payload),
  };
}

async function handleProduct(product) {
  console.log('[product] handleProduct called with:', product.id);
  try {
    // 1. Fetch per-product metafield overrides (includes _storedHash)
    const overrides = await fetchProductOverrides(product.id);
    const {
      _storedHash,
      _storedOgVersion,
      _storedShareVersion,
      _shareMetafields,
      _notFound,
      ...cleanOverrides
    } = overrides;

    if (_notFound) {
      console.log(`[product] skipping — product ${product.id} not found in store`);
      return;
    }

    console.log('[product] overrides:', cleanOverrides);

    const shareVersion = computeShareVersionWithMetafields(
      product.share_version,
      _shareMetafields ?? []
    );
    const shareVersionChanged = Boolean(shareVersion && _storedShareVersion !== shareVersion);

    if (cleanOverrides.deal_enabled === false) {
      if (shareVersionChanged) await updateProductShareVersion(product.id, shareVersion);
      console.log('[product] skipping - deal_enabled is false');
      return;
    }

    // 2. Skip if nothing that affects the image actually changed.
    //    This breaks the infinite loop caused by our own metafield updates
    //    triggering a new products/update webhook.
    const inputHash = computeInputHash(product, cleanOverrides);
    if (_storedHash === inputHash) {
      if (shareVersionChanged) {
        await updateProductShareVersion(product.id, shareVersion);
        console.log(`[product] share version updated — ${shareVersion}`);
      }
      console.log(`[product] skipping — input unchanged (hash ${inputHash})`);
      return;
    }
    console.log(`[product] input changed (${_storedHash ?? 'none'} → ${inputHash}), generating`);

    const productData = { ...product, ...cleanOverrides };

    // 3. Generate the promo image as a buffer
    const buffer = await generateProductImage(productData);
    console.log('[product] image buffer ready, size:', buffer.length);

    const ogVersion = computeOgVersion(buffer);
    if (_storedOgVersion === ogVersion) {
      if (shareVersionChanged) {
        await updateProductShareVersion(product.id, shareVersion);
        console.log(`[product] share version updated — ${shareVersion}`);
      }
      console.log(`[product] skipping — generated image unchanged (OG version ${ogVersion})`);
      return { imageUrl: null, ogVersion, unchanged: true };
    }
    console.log(`[product] OG version changed (${_storedOgVersion ?? 'none'} → ${ogVersion})`);

    // 4. Upload to Shopify Files — failure is non-fatal
    let imageUrl = null;
    try {
      imageUrl = await uploadBufferToShopify(buffer, product.id, ogVersion);
      console.log('[product] uploaded to Shopify:', imageUrl);
    } catch (err) {
      console.error(`[product] Shopify upload failed (non-fatal): ${err.message}`);
    }

    // 5. Write image, image version, share version, and input hash in one batched call
    let shareVersionWritten = false;
    if (imageUrl) {
      let metafieldOk = false;
      try {
        await updateProductMetafields(product.id, imageUrl, ogVersion, shareVersion, inputHash);
        console.log(`[product] metafields updated — product ${product.id}`);
        metafieldOk = true;
        shareVersionWritten = true;
      } catch (err) {
        console.error(`[product] metafield update failed (non-fatal): ${err.message}`);
      }
      if (metafieldOk) await bustFacebookCache(product.handle);
    }

    if (shareVersionChanged && !shareVersionWritten) {
      try {
        await updateProductShareVersion(product.id, shareVersion);
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
};
