'use strict';

const crypto = require('crypto');
const config = require('../config');
const { createInstallationClient } = require('./client');
const { getInstallationStore } = require('./installations');
const { refreshOfflineToken } = require('./embeddedAuth');
const {
  normalizeShopDomain,
  normalizeShopifyCdnUrl,
  signValue,
  verifySignedValue,
} = require('./security');

const PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const PRODUCT_PREVIEW_QUERY = `
  query SocialPreviewProduct(
    $query: String!
    $namespace: String!
    $imageKey: String!
    $versionKey: String!
  ) {
    products(first: 1, query: $query) {
      nodes {
        handle
        title
        description
        ogImage: metafield(namespace: $namespace, key: $imageKey) { value }
        shareVersion: metafield(namespace: $namespace, key: $versionKey) { value }
      }
    }
  }
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(String.fromCharCode(34), '&quot;')
    .replaceAll(String.fromCharCode(39), '&#039;');
}

function normalizeProductHandle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  let handle = raw;
  if (raw.includes('://')) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return null;
      const match = url.pathname.match(/^\/products\/([^/]+)\/?$/);
      if (!match) return null;
      handle = decodeURIComponent(match[1]);
    } catch (_error) {
      return null;
    }
  }
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

function createSharePreviewToken(shopDomain, productHandle, secret = config.shopifyApiSecret, now = Date.now()) {
  const shop = normalizeShopDomain(shopDomain);
  const handle = normalizeProductHandle(productHandle);
  if (!shop || !handle) throw new Error('A valid shop and product handle are required');
  return signValue({
    shopDomain: shop,
    handle,
    issuedAt: now,
    nonce: crypto.randomBytes(6).toString('hex'),
  }, secret);
}

function verifySharePreviewToken(token, secret = config.shopifyApiSecret, now = Date.now()) {
  const value = verifySignedValue(token, secret);
  if (!value) return null;
  const shopDomain = normalizeShopDomain(value.shopDomain);
  const handle = normalizeProductHandle(value.handle);
  const issuedAt = Number(value.issuedAt);
  if (!shopDomain || !handle || !Number.isFinite(issuedAt)) return null;
  if (issuedAt > now + FUTURE_TOLERANCE_MS || now - issuedAt > PREVIEW_MAX_AGE_MS) return null;
  return { shopDomain, handle, issuedAt };
}

function graphData(response) {
  if (response.data?.errors?.length) {
    throw new Error(response.data.errors.map(error => error.message).join(', '));
  }
  return response.data?.data;
}

async function fetchPreviewProduct(handle, client) {
  const response = await client.post('/graphql.json', {
    query: PRODUCT_PREVIEW_QUERY,
    variables: {
      query: `handle:${handle}`,
      namespace: 'custom',
      imageKey: 'og_image',
      versionKey: 'share_version',
    },
  });
  const product = graphData(response)?.products?.nodes?.[0];
  if (!product || product.handle !== handle) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }
  const imageUrl = normalizeShopifyCdnUrl(product.ogImage?.value);
  if (!imageUrl) {
    const error = new Error('Generate a social image for this product first');
    error.status = 409;
    throw error;
  }
  return {
    handle,
    title: String(product.title || '').trim() || 'Product preview',
    description: String(product.description || '').trim().slice(0, 300),
    imageUrl,
    shareVersion: String(product.shareVersion?.value || '').trim(),
  };
}

function buildStorefrontUrl(installation, product) {
  const hostname = String(installation.publicDomain || installation.shopDomain || '').toLowerCase();
  const shopFallback = normalizeShopDomain(installation.shopDomain);
  let safeHost = shopFallback;
  try {
    const parsed = new URL(`https://${hostname}`);
    if (parsed.protocol === 'https:' && parsed.hostname === hostname && parsed.pathname === '/') {
      safeHost = parsed.hostname;
    }
  } catch (_error) {
    // Fall back to the validated myshopify.com hostname.
  }
  const url = new URL(`https://${safeHost}/products/${encodeURIComponent(product.handle)}`);
  if (product.shareVersion) url.searchParams.set('pv', product.shareVersion);
  return url.toString();
}

function sharePreviewPage({ previewUrl, storefrontUrl, product }) {
  const title = escapeHtml(product.title);
  const description = escapeHtml(product.description || product.title);
  const imageUrl = escapeHtml(product.imageUrl);
  const shareUrl = escapeHtml(previewUrl);
  const targetUrl = escapeHtml(storefrontUrl);
  const redirectUrl = JSON.stringify(storefrontUrl).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width,initial-scale=1'>
  <title>${title}</title>
  <meta name='robots' content='noindex,nofollow,noarchive'>
  <meta name='description' content='${description}'>
  <meta property='og:type' content='product'>
  <meta property='og:url' content='${shareUrl}'>
  <meta property='og:title' content='${title}'>
  <meta property='og:description' content='${description}'>
  <meta property='og:image' content='${imageUrl}'>
  <meta property='og:image:secure_url' content='${imageUrl}'>
  <meta property='og:image:width' content='1200'>
  <meta property='og:image:height' content='628'>
  <meta name='twitter:card' content='summary_large_image'>
  <meta name='twitter:title' content='${title}'>
  <meta name='twitter:description' content='${description}'>
  <meta name='twitter:image' content='${imageUrl}'>
  <style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f5f7;color:#202223;font-family:Inter,system-ui,sans-serif}.card{max-width:560px;margin:24px;padding:24px;background:#fff;border:1px solid #dfe3e8;border-radius:14px;text-align:center}.card img{display:block;width:100%;border-radius:10px;margin-bottom:18px}.card h1{font-size:22px}.card p{color:#61666c}.card a{display:inline-block;padding:11px 16px;border-radius:8px;background:#006e52;color:#fff;font-weight:700;text-decoration:none}</style>
</head>
<body>
  <main class='card'><img src='${imageUrl}' alt=''><h1>${title}</h1><p>Opening the password-protected storefront...</p><a href='${targetUrl}'>Continue to storefront</a></main>
  <script>setTimeout(function(){window.location.href=${redirectUrl}},1500)</script>
</body>
</html>`;
}

function createSharePreviewUrl(token, appUrl = config.appUrl) {
  const url = new URL('/share-preview', appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

async function renderSharePreview(req, res) {
  const payload = verifySharePreviewToken(req.query.token);
  if (!payload) return res.status(403).type('text').send('Preview link is invalid or expired.');
  try {
    const stored = await getInstallationStore().get(payload.shopDomain);
    if (!stored || stored.status !== 'active') {
      return res.status(404).type('text').send('Store installation not found.');
    }
    const installation = await refreshOfflineToken(stored);
    const product = await fetchPreviewProduct(payload.handle, createInstallationClient(installation));
    const previewUrl = createSharePreviewUrl(req.query.token);
    const storefrontUrl = buildStorefrontUrl(installation, product);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.type('html').send(sharePreviewPage({ previewUrl, storefrontUrl, product }));
  } catch (error) {
    const status = error.status && error.status < 500 ? error.status : 502;
    return res.status(status).type('text').send(
      status === 409 ? error.message : 'Unable to build the product preview.'
    );
  }
}

module.exports = {
  PREVIEW_MAX_AGE_MS,
  buildStorefrontUrl,
  createSharePreviewToken,
  createSharePreviewUrl,
  fetchPreviewProduct,
  normalizeProductHandle,
  renderSharePreview,
  sharePreviewPage,
  verifySharePreviewToken,
};
