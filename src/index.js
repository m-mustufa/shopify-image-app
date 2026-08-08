const express = require('express');
const { waitUntil } = require('@vercel/functions');
const config = require('./config');
const { verifyShopifyWebhook } = require('./webhooks/verifySignature');
const { handleProduct, extractProductData } = require('./webhooks/product');

const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.path.startsWith('/webhooks/')) verifyShopifyWebhook(req, res, buf);
    },
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/webhooks/products/create', (req, res) => {
  const product = extractProductData(req.body);
  console.log(`[webhook] products/create — id=${product.id} title="${product.title}"`);
  console.log('[webhook] processing started for product:', product.id);
  waitUntil(handleProduct(product).catch(err =>
    console.error('[product] async error:', err.message)
  ));
  res.status(200).json({ ok: true });
});

app.post('/webhooks/products/update', (req, res) => {
  const product = extractProductData(req.body);
  console.log(`[webhook] products/update — id=${product.id} title="${product.title}"`);
  console.log('[webhook] processing started for product:', product.id);
  waitUntil(handleProduct(product).catch(err =>
    console.error('[product] async error:', err.message)
  ));
  res.status(200).json({ ok: true });
});

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  console.error('[request] rejected:', err.message);
  res.status(status).json({ error: err.message });
});

// Export for Vercel serverless; only bind a port when run directly
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Shopify image app listening on port ${config.port}`);
  });
}

module.exports = app;
