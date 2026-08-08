'use strict';

const axios  = require('axios');
const config = require('../config');

let _token     = null;
let _expiresAt = 0;

async function getShopifyToken() {
  if (_token && Date.now() < _expiresAt - 60_000) return _token;

  console.log('[shopify] fetching new access token via client_credentials');
  console.log('[shopify] client_id set:', !!config.shopifyClientId, '| client_secret set:', !!config.shopifyClientSecret);

  let res;
  try {
    res = await axios.post(
      `https://${config.shopifyShopDomain}/admin/oauth/access_token`,
      {
        grant_type:    'client_credentials',
        client_id:     config.shopifyClientId,
        client_secret: config.shopifyClientSecret,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
    );
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data ?? {});
    console.error(`[shopify] token fetch failed — HTTP ${status} — body: ${body}`);
    throw err;
  }

  _token     = res.data.access_token;
  const ttl  = res.data.expires_in ?? 86_400;
  _expiresAt = Date.now() + ttl * 1_000;
  console.log(`[shopify] token acquired, expires in ${ttl}s`);
  return _token;
}

const shopifyClient = axios.create({
  baseURL: `https://${config.shopifyShopDomain}/admin/api/2024-04`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Inject a fresh token before every request — auto-refreshes when expired
shopifyClient.interceptors.request.use(async (reqConfig) => {
  const token = await getShopifyToken();
  reqConfig.headers['X-Shopify-Access-Token'] = token;
  return reqConfig;
});

// On 401, clear cached token and retry once — covers mid-session revocation
shopifyClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401 && !err.config._retried) {
      console.warn('[shopify] 401 received — clearing token cache and retrying');
      _token = null;
      _expiresAt = 0;
      err.config._retried = true;
      const token = await getShopifyToken();
      err.config.headers['X-Shopify-Access-Token'] = token;
      return axios(err.config);
    }
    throw err;
  }
);

module.exports = shopifyClient;
