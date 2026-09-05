'use strict';

const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const { createInstallationClient } = require('./client');
const { getInstallationStore } = require('./installations');
const { ensureProductMetafieldDefinitions } = require('./metafields');
const {
  normalizeShopDomain,
  parseCookies,
  signValue,
  verifyOAuthHmac,
  verifySignedValue,
} = require('./security');

const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function assertAppConfig() {
  if (!config.shopifyApiKey || !config.shopifyApiSecret) {
    const error = new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required');
    error.status = 503;
    throw error;
  }
}

function cookieOptions(maxAgeSeconds) {
  const secure = new URL(config.appUrl).protocol === 'https:';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function setSignedCookie(res, name, value, maxAgeMs) {
  const token = signValue(value, config.shopifyApiSecret);
  res.append('Set-Cookie', `${name}=${encodeURIComponent(token)}; ${cookieOptions(Math.floor(maxAgeMs / 1000))}`);
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; ${cookieOptions(0)}`);
}

function sessionShop(req) {
  const token = parseCookies(req.headers.cookie).shopify_app_session;
  const session = verifySignedValue(token, config.shopifyApiSecret, SESSION_MAX_AGE_MS);
  return normalizeShopDomain(session?.shopDomain);
}

function csrfToken(shopDomain, purpose = 'settings') {
  return signValue({ shopDomain, purpose, issuedAt: Date.now() }, config.shopifyApiSecret);
}

function verifyCsrfToken(token, shopDomain, purpose = 'settings') {
  const payload = verifySignedValue(token, config.shopifyApiSecret, 60 * 60 * 1000);
  return payload?.shopDomain === shopDomain && payload?.purpose === purpose;
}

async function beginOAuth(req, res) {
  assertAppConfig();
  const shopDomain = normalizeShopDomain(req.query.shop);
  if (!shopDomain) return res.status(400).send('Enter a valid .myshopify.com store domain.');

  const nonce = crypto.randomBytes(24).toString('base64url');
  setSignedCookie(res, 'shopify_oauth_state', { nonce, shopDomain, issuedAt: Date.now() }, OAUTH_MAX_AGE_MS);
  const redirectUri = new URL('/auth/callback', config.appUrl).toString();
  const query = new URLSearchParams({
    client_id: config.shopifyApiKey,
    scope: config.shopifyScopes.join(','),
    redirect_uri: redirectUri,
    state: nonce,
  });
  return res.redirect(`https://${shopDomain}/admin/oauth/authorize?${query}`);
}

async function exchangeCode(shopDomain, code) {
  const response = await axios.post(
    `https://${shopDomain}/admin/oauth/access_token`,
    new URLSearchParams({
      client_id: config.shopifyApiKey,
      client_secret: config.shopifyApiSecret,
      code,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      timeout: 15_000,
    }
  );
  if (!response.data?.access_token) throw new Error('Shopify did not return an offline access token');
  return response.data;
}

async function fetchShopDetails(client) {
  const response = await client.post('/graphql.json', {
    query: `query InstalledShop { shop { myshopifyDomain primaryDomain { host } } }`,
  });
  if (response.data?.errors?.length) {
    throw new Error(response.data.errors.map(error => error.message).join(', '));
  }
  return response.data?.data?.shop || {};
}

async function oauthCallback(req, res) {
  assertAppConfig();
  const shopDomain = normalizeShopDomain(req.query.shop);
  const stateCookie = verifySignedValue(
    parseCookies(req.headers.cookie).shopify_oauth_state,
    config.shopifyApiSecret,
    OAUTH_MAX_AGE_MS
  );

  if (!shopDomain || !req.query.code || !req.query.state) return res.status(400).send('Incomplete OAuth callback.');
  if (!stateCookie || stateCookie.shopDomain !== shopDomain || stateCookie.nonce !== req.query.state) {
    return res.status(403).send('Invalid or expired OAuth state. Start installation again.');
  }
  if (!verifyOAuthHmac(req.query, config.shopifyApiSecret)) {
    return res.status(403).send('Invalid Shopify OAuth signature.');
  }

  clearCookie(res, 'shopify_oauth_state');
  const token = await exchangeCode(shopDomain, req.query.code);
  const draftInstallation = {
    shopDomain,
    accessToken: token.access_token,
    scopes: token.scope || config.shopifyScopes.join(','),
    status: 'active',
  };
  const client = createInstallationClient(draftInstallation);
  const details = await fetchShopDetails(client);
  const store = getInstallationStore();
  const existing = await store.get(shopDomain);
  const installation = await store.save({
    ...existing,
    ...draftInstallation,
    publicDomain: details.primaryDomain?.host || existing?.publicDomain || null,
  });

  try {
    await ensureProductMetafieldDefinitions(client);
  } catch (err) {
    console.warn(`[install] metafield setup warning for ${shopDomain}: ${err.message}`);
  }

  setSignedCookie(res, 'shopify_app_session', { shopDomain, issuedAt: Date.now() }, SESSION_MAX_AGE_MS);
  console.log(`[install] completed for ${installation.shopDomain}`);
  return res.redirect('/app');
}

async function requireShopSession(req, res, next) {
  try {
    assertAppConfig();
    const shopDomain = sessionShop(req);
    if (!shopDomain) return res.redirect('/?session=expired');
    const installation = await getInstallationStore().get(shopDomain);
    if (!installation || installation.status !== 'active') return res.redirect(`/?shop=${shopDomain}`);
    req.shopify = {
      shopDomain,
      installation,
      client: createInstallationClient(installation),
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  beginOAuth,
  csrfToken,
  oauthCallback,
  requireShopSession,
  sessionShop,
  verifyCsrfToken,
};
