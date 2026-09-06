'use strict';

const config = require('../config');
const defaultClient = require('./client');
const { createInstallationClient } = require('./client');
const { getInstallationStore } = require('./installations');
const { normalizeShopDomain } = require('./security');
const { refreshOfflineToken } = require('./embeddedAuth');

async function resolveWebhookContext(req) {
  const shopDomain = normalizeShopDomain(req.headers['x-shopify-shop-domain']);
  if (!shopDomain) {
    const error = new Error('Missing or invalid X-Shopify-Shop-Domain header');
    error.status = 400;
    throw error;
  }

  if (!config.databaseUrl && normalizeShopDomain(config.shopifyShopDomain) === shopDomain) {
    return { shopDomain, installation: null, client: defaultClient, logoUrl: undefined, legacy: true };
  }

  const installation = await getInstallationStore().get(shopDomain);
  if (installation?.status === 'active') {
    const currentInstallation = await refreshOfflineToken(installation);
    return {
      shopDomain,
      installation: currentInstallation,
      client: createInstallationClient(currentInstallation),
      logoUrl: currentInstallation.logoUrl || null,
    };
  }

  if (normalizeShopDomain(config.shopifyShopDomain) === shopDomain) {
    return { shopDomain, installation: null, client: defaultClient, logoUrl: undefined, legacy: true };
  }

  const error = new Error(`No active installation found for ${shopDomain}`);
  error.status = 401;
  throw error;
}

module.exports = { resolveWebhookContext };
