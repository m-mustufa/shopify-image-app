const crypto = require('crypto');
const config = require('../config');

function verifyShopifyWebhook(req, res, buf) {
  const receivedHmac = req.headers['x-shopify-hmac-sha256'];
  if (!config.shopifyWebhookSecret) {
    const err = new Error('SHOPIFY_WEBHOOK_SECRET is not configured');
    err.status = 500;
    throw err;
  }
  if (!receivedHmac) {
    const err = new Error('Missing Shopify webhook HMAC');
    err.status = 401;
    throw err;
  }

  const expectedHmac = crypto
    .createHmac('sha256', config.shopifyWebhookSecret)
    .update(buf)
    .digest('base64');
  const received = Buffer.from(receivedHmac, 'base64');
  const expected = Buffer.from(expectedHmac, 'base64');

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    const err = new Error('Invalid Shopify webhook HMAC');
    err.status = 401;
    throw err;
  }
}

module.exports = { verifyShopifyWebhook };
