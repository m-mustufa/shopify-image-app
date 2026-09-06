'use strict';

const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { createInstallationClient } = require('./client');
const { getInstallationStore } = require('./installations');
const { ensureProductMetafieldDefinitions } = require('./metafields');
const { normalizeShopDomain } = require('./security');

const OFFLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function assertAppConfig() {
  if (!config.shopifyApiKey || !config.shopifyApiSecret) {
    const error = new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required');
    error.status = 503;
    throw error;
  }
}

function validateIdToken(idToken) {
  assertAppConfig();
  if (!idToken) throw new Error('Missing Shopify ID token');
  const payload = jwt.verify(idToken, config.shopifyApiSecret, {
    algorithms: ['HS256'],
    audience: config.shopifyApiKey,
  });
  const issuerHost = normalizeShopDomain(new URL(payload.iss).hostname);
  const destinationHost = normalizeShopDomain(new URL(payload.dest).hostname);
  if (!issuerHost || issuerHost !== destinationHost) {
    throw new Error('Shopify token issuer and destination do not match');
  }
  return { ...payload, shopDomain: destinationHost };
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function expiryFrom(expiresIn) {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;
}

async function requestToken(shopDomain, body) {
  const response = await axios.post(
    `https://${shopDomain}/admin/oauth/access_token`,
    new URLSearchParams(body),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 15_000 }
  );
  if (!response.data?.access_token) throw new Error('Shopify did not return an offline access token');
  return response.data;
}

async function exchangeIdToken(shopDomain, idToken) {
  assertAppConfig();
  return requestToken(shopDomain, {
    client_id: config.shopifyApiKey,
    client_secret: config.shopifyApiSecret,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: idToken,
    subject_token_type: ID_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: '1',
  });
}

async function refreshOfflineToken(installation) {
  if (!installation?.refreshToken) return installation;
  const expiresAt = installation.expiresAt ? new Date(installation.expiresAt).getTime() : Infinity;
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) return installation;
  const token = await requestToken(installation.shopDomain, {
    client_id: config.shopifyApiKey,
    client_secret: config.shopifyApiSecret,
    grant_type: 'refresh_token',
    refresh_token: installation.refreshToken,
  });
  return getInstallationStore().save({
    ...installation,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || installation.refreshToken,
    expiresAt: expiryFrom(token.expires_in) || installation.expiresAt || null,
    scopes: token.scope || installation.scopes,
  });
}

async function establishEmbeddedInstallation(idToken) {
  const payload = validateIdToken(idToken);
  const token = await exchangeIdToken(payload.shopDomain, idToken);
  if (!token.refresh_token || !token.expires_in) {
    throw new Error('Shopify did not return an expiring offline access token');
  }
  const store = getInstallationStore();
  const existing = await store.get(payload.shopDomain);
  const draft = {
    ...existing,
    shopDomain: payload.shopDomain,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || existing?.refreshToken || null,
    expiresAt: expiryFrom(token.expires_in),
    scopes: token.scope || existing?.scopes || config.shopifyScopes.join(','),
    status: 'active',
  };
  const client = createInstallationClient(draft);
  let publicDomain = existing?.publicDomain || null;
  if (!existing) {
    const response = await client.post('/graphql.json', {
      query: 'query InstalledShop { shop { primaryDomain { host } } }',
    });
    publicDomain = response.data?.data?.shop?.primaryDomain?.host || null;
  }
  const installation = await store.save({ ...draft, publicDomain });
  if (!existing) {
    try {
      await ensureProductMetafieldDefinitions(client);
    } catch (error) {
      console.warn(`[install] metafield setup warning for ${payload.shopDomain}: ${error.message}`);
    }
    console.log(`[install] embedded installation completed for ${payload.shopDomain}`);
  }
  return { shopDomain: payload.shopDomain, installation, client };
}

async function requireEmbeddedSession(req, res, next) {
  try {
    const payload = validateIdToken(bearerToken(req));
    const stored = await getInstallationStore().get(payload.shopDomain);
    if (!stored || stored.status !== 'active') {
      req.shopify = await establishEmbeddedInstallation(bearerToken(req));
    } else {
      const installation = await refreshOfflineToken(stored);
      req.shopify = {
        shopDomain: payload.shopDomain,
        installation,
        client: createInstallationClient(installation),
      };
    }
    return next();
  } catch (error) {
    res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    error.status = 401;
    return next(error);
  }
}

async function requireEmbeddedInstallation(req, res, next) {
  try {
    req.shopify = await establishEmbeddedInstallation(bearerToken(req));
    return next();
  } catch (error) {
    res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    error.status = 401;
    return next(error);
  }
}

module.exports = {
  bearerToken,
  establishEmbeddedInstallation,
  exchangeIdToken,
  refreshOfflineToken,
  requireEmbeddedInstallation,
  requireEmbeddedSession,
  validateIdToken,
};
