'use strict';

const express = require('express');
const { waitUntil } = require('@vercel/functions');
const config = require('./config');
const { verifyShopifyWebhook } = require('./webhooks/verifySignature');
const { handleProduct, extractProductData } = require('./webhooks/product');
const { verifyWhatsAppWebhook, handleWhatsAppWebhook } = require('./webhooks/whatsapp');
const { privacyPolicy, termsOfService, dataDeletionInstructions } = require('./pages/legal');
const { router: appRouter } = require('./pages/app');
const { getInstallationStore } = require('./shopify/installations');
const { normalizeShopDomain } = require('./shopify/security');
const { resolveWebhookContext } = require('./shopify/webhookContext');

const app = express();

app.use((_req, res, next) => {
  res.set('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;');
  next();
});

function isShopifyWebhook(pathname) {
  return pathname.startsWith('/webhooks/products/') || pathname.startsWith('/webhooks/shopify/');
}

app.use(express.json({
  limit: '2mb',
  verify: (req, res, buffer) => {
    if (isShopifyWebhook(req.path)) {
      req.rawBody = Buffer.from(buffer);
      verifyShopifyWebhook(req, res, buffer);
    } else if (req.path === '/webhooks/whatsapp') {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', mode: 'installable' }));
app.get('/privacy', (_req, res) => res.type('html').send(privacyPolicy()));
app.get('/terms', (_req, res) => res.type('html').send(termsOfService()));
app.get('/data-deletion', (_req, res) => res.type('html').send(dataDeletionInstructions()));

app.get('/webhooks/whatsapp', verifyWhatsAppWebhook);
app.post('/webhooks/whatsapp', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
  waitUntil(handleWhatsAppWebhook(req).catch(err =>
    console.error('[whatsapp] async error:', err.message)
  ));
});

async function acceptProductWebhook(req, res, next) {
  try {
    const topic = req.headers['x-shopify-topic'];
    if (topic && !['products/create', 'products/update'].includes(topic)) {
      return res.status(400).json({ error: `Unexpected Shopify topic: ${topic}` });
    }
    const product = extractProductData(req.body);
    const context = await resolveWebhookContext(req);
    console.log(`[webhook] ${topic || req.path} — shop=${context.shopDomain} id=${product.id}`);
    res.status(200).json({ ok: true });
    waitUntil(handleProduct(product, context).catch(err =>
      console.error(`[product] async error for ${context.shopDomain}:`, err.message)
    ));
  } catch (err) {
    next(err);
  }
}

app.post('/webhooks/shopify/products', acceptProductWebhook);
app.post('/webhooks/products/create', acceptProductWebhook);
app.post('/webhooks/products/update', acceptProductWebhook);

app.post('/webhooks/shopify/app-uninstalled', (req, res) => {
  const shopDomain = normalizeShopDomain(req.headers['x-shopify-shop-domain']);
  res.status(200).json({ ok: true });
  if (shopDomain) {
    waitUntil(getInstallationStore().delete(shopDomain).then(() =>
      console.log(`[install] removed ${shopDomain}`)
    ).catch(err => console.error(`[install] uninstall cleanup failed for ${shopDomain}:`, err.message)));
  }
});

app.post('/webhooks/shopify/customers-data-request', (_req, res) => {
  res.status(200).json({ ok: true, storedCustomerData: false });
});

app.post('/webhooks/shopify/customers-redact', (_req, res) => {
  res.status(200).json({ ok: true, storedCustomerData: false });
});

app.post('/webhooks/shopify/shop-redact', (req, res) => {
  const shopDomain = normalizeShopDomain(req.body?.shop_domain || req.headers['x-shopify-shop-domain']);
  res.status(200).json({ ok: true });
  if (shopDomain) {
    waitUntil(getInstallationStore().delete(shopDomain).catch(err =>
      console.error(`[privacy] shop redact cleanup failed for ${shopDomain}:`, err.message)
    ));
  }
});

app.use(appRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' || err.name === 'MulterError' ? 400 : 500);
  console.error('[request] rejected:', err.message);
  res.status(status).json({ error: err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Shopify image app listening on port ${config.port}`);
  });
}

module.exports = app;
