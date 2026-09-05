'use strict';

const axios = require('axios');
const config = require('../config');
const { normalizeShopDomain } = require('./security');

function createShopifyClient({ shopDomain, accessToken, apiVersion = config.shopifyApiVersion }) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) throw new Error('Invalid Shopify shop domain');
  if (!accessToken) throw new Error(`Missing offline access token for ${shop}`);

  return axios.create({
    baseURL: `https://${shop}/admin/api/${apiVersion}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    timeout: 30_000,
  });
}

function createInstallationClient(installation) {
  if (!installation || installation.status === 'uninstalled') {
    throw new Error('Shopify installation is unavailable');
  }
  return createShopifyClient({
    shopDomain: installation.shopDomain,
    accessToken: installation.accessToken,
  });
}

let legacyToken = null;
let legacyExpiresAt = 0;

async function getLegacyToken() {
  if (legacyToken && Date.now() < legacyExpiresAt - 60_000) return legacyToken;
  if (!config.shopifyShopDomain || !config.shopifyClientId || !config.shopifyClientSecret) {
    throw new Error('No installed shop context or legacy Shopify credentials were provided');
  }

  console.log('[shopify] fetching legacy access token via client_credentials');
  const response = await axios.post(
    `https://${config.shopifyShopDomain}/admin/oauth/access_token`,
    {
      grant_type: 'client_credentials',
      client_id: config.shopifyClientId,
      client_secret: config.shopifyClientSecret,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
  );

  legacyToken = response.data.access_token;
  const ttl = response.data.expires_in ?? 86_400;
  legacyExpiresAt = Date.now() + ttl * 1_000;
  return legacyToken;
}

const legacyClient = axios.create({
  baseURL: config.shopifyShopDomain
    ? `https://${config.shopifyShopDomain}/admin/api/${config.shopifyApiVersion}`
    : undefined,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

legacyClient.interceptors.request.use(async request => {
  request.headers['X-Shopify-Access-Token'] = await getLegacyToken();
  return request;
});

legacyClient.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && !error.config._retried) {
      legacyToken = null;
      legacyExpiresAt = 0;
      error.config._retried = true;
      error.config.headers['X-Shopify-Access-Token'] = await getLegacyToken();
      return axios(error.config);
    }
    throw error;
  }
);

legacyClient.createShopifyClient = createShopifyClient;
legacyClient.createInstallationClient = createInstallationClient;

module.exports = legacyClient;
