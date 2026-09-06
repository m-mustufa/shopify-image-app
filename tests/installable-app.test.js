'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { createShopifyClient } = require('../src/shopify/client');
const { MemoryInstallationStore } = require('../src/shopify/installations');
const {
  decryptSecret,
  encryptSecret,
  normalizeShopDomain,
  normalizeShopifyCdnUrl,
  signValue,
  verifyOAuthHmac,
  verifySignedValue,
} = require('../src/shopify/security');
const { dashboardPage, embeddedAppPage, installPage, normalizePublicDomain } = require('../src/pages/app');
const { validateIdToken } = require('../src/shopify/embeddedAuth');
const { ensureProductMetafieldDefinitions } = require('../src/shopify/metafields');

async function testAuthenticationSecurity() {
  const secret = 'test-client-secret';
  const query = {
    shop: 'alpha-store.myshopify.com',
    code: 'temporary-code',
    state: 'nonce',
    timestamp: '1788560000',
  };
  const message = Object.entries(query).sort().map(([key, value]) => `${key}=${value}`).join('&');
  query.hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
  assert.strictEqual(verifyOAuthHmac(query, secret), true);
  assert.strictEqual(verifyOAuthHmac({ ...query, shop: 'attacker.myshopify.com' }, secret), false);

  const signed = signValue({ shopDomain: query.shop, issuedAt: Date.now() }, secret);
  assert.strictEqual(verifySignedValue(signed, secret, 1000).shopDomain, query.shop);
  assert.strictEqual(verifySignedValue(`${signed}x`, secret, 1000), null);

  const encrypted = encryptSecret('shpat_private', secret);
  assert.notStrictEqual(encrypted, 'shpat_private');
  assert.strictEqual(decryptSecret(encrypted, secret), 'shpat_private');

  config.shopifyApiKey = 'oauth-test-key';
  config.shopifyApiSecret = secret;
  const now = Math.floor(Date.now() / 1000);
  const idToken = jwt.sign({
    aud: config.shopifyApiKey,
    dest: 'https://alpha.myshopify.com',
    exp: now + 60,
    iss: 'https://alpha.myshopify.com/admin',
    nbf: now - 1,
    sub: '12345',
  }, secret, { algorithm: 'HS256', noTimestamp: true });
  assert.strictEqual(validateIdToken(idToken).shopDomain, 'alpha.myshopify.com');
  assert.throws(() => validateIdToken(jwt.sign({
    aud: 'wrong-key',
    dest: 'https://alpha.myshopify.com',
    exp: now + 60,
    iss: 'https://alpha.myshopify.com/admin',
    nbf: now - 1,
  }, secret, { algorithm: 'HS256', noTimestamp: true })), /audience/);
}

async function testTenantIsolation() {
  const store = new MemoryInstallationStore();
  await store.save({ shopDomain: 'alpha.myshopify.com', accessToken: 'alpha-token', logoUrl: 'https://cdn.shopify.com/alpha.png' });
  await store.save({ shopDomain: 'beta.myshopify.com', accessToken: 'beta-token', refreshToken: 'beta-refresh', expiresAt: '2026-09-08T00:00:00.000Z', logoUrl: 'https://cdn.shopify.com/beta.png' });
  assert.strictEqual((await store.get('alpha.myshopify.com')).accessToken, 'alpha-token');
  assert.strictEqual((await store.get('beta.myshopify.com')).logoUrl, 'https://cdn.shopify.com/beta.png');
  assert.strictEqual((await store.get('beta.myshopify.com')).refreshToken, 'beta-refresh');

  const alpha = createShopifyClient({ shopDomain: 'alpha.myshopify.com', accessToken: 'alpha-token' });
  const beta = createShopifyClient({ shopDomain: 'beta.myshopify.com', accessToken: 'beta-token' });
  assert.match(alpha.defaults.baseURL, /^https:\/\/alpha\.myshopify\.com\//);
  assert.match(beta.defaults.baseURL, /^https:\/\/beta\.myshopify\.com\//);
  assert.strictEqual(alpha.defaults.headers['X-Shopify-Access-Token'], 'alpha-token');
  assert.strictEqual(beta.defaults.headers['X-Shopify-Access-Token'], 'beta-token');
}

async function testMerchantMetafieldsArePinned() {
  const createRequests = [];
  const pinRequests = [];
  const client = {
    async post(path, body) {
      assert.strictEqual(path, '/graphql.json');
      if (body.query.includes('metafieldDefinitionPin')) {
        pinRequests.push(body.variables.identifier);
        return {
          data: {
            data: {
              metafieldDefinitionPin: {
                pinnedDefinition: { id: `pin-${body.variables.identifier.key}` },
                userErrors: [],
              },
            },
          },
        };
      }

      createRequests.push(body.variables.definition);
      return {
        data: {
          data: {
            metafieldDefinitionCreate: {
              createdDefinition: null,
              userErrors: [{ code: 'TAKEN', message: 'Definition already exists' }],
            },
          },
        },
      };
    },
  };

  const results = await ensureProductMetafieldDefinitions(client);
  const merchantKeys = ['deal_enabled', 'deal_badge_text', 'deal_sale_price', 'deal_reg_price', 'deal_title'];
  const internalKeys = ['og_image', 'og_version', 'share_version', 'og_image_input_hash'];

  assert.deepStrictEqual(createRequests.filter(definition => definition.pin).map(definition => definition.key), merchantKeys);
  assert.deepStrictEqual(createRequests.filter(definition => !definition.pin).map(definition => definition.key), internalKeys);
  assert.deepStrictEqual(pinRequests.map(identifier => identifier.key), merchantKeys);
  assert.ok(pinRequests.every(identifier => identifier.namespace === 'custom' && identifier.ownerType === 'PRODUCT'));
  assert.ok(results.filter(result => merchantKeys.includes(result.key)).every(result => result.pinned));
  assert.ok(results.filter(result => internalKeys.includes(result.key)).every(result => !result.pinned));
}

async function testInputValidationAndPages() {
  assert.strictEqual(normalizeShopDomain('Example-Store.myshopify.com'), 'example-store.myshopify.com');
  assert.strictEqual(normalizeShopDomain('example.myshopify.com.attacker.test'), null);
  assert.match(normalizeShopifyCdnUrl('https://cdn.shopify.com/logo.png'), /^https:\/\/cdn\.shopify\.com/);
  assert.strictEqual(normalizeShopifyCdnUrl('http://127.0.0.1/private'), null);
  assert.strictEqual(normalizePublicDomain('https://www.example.com'), 'www.example.com');
  assert.strictEqual(normalizePublicDomain('https://example.com/path'), null);

  config.shopifyApiSecret = 'page-test-secret';
  config.shopifyApiKey = 'page-test-key';
  const dashboard = dashboardPage({
    shopDomain: 'alpha.myshopify.com',
    accessToken: 'must-not-render',
    logoUrl: 'https://cdn.shopify.com/logo.png',
    publicDomain: 'www.example.com',
    status: 'active',
  });
  assert.match(dashboard, /activateAppId=page-test-key\/social-preview/);
  assert.match(dashboard, /alpha\.myshopify\.com/);
  assert.ok(!dashboard.includes('must-not-render'));
  assert.ok(!installPage({ shop: '<script>' }).includes('<script>'));
  const embedded = embeddedAppPage();
  assert.match(embedded, /name="shopify-api-key"/);
  assert.match(embedded, /shopifycloud\/app-bridge\.js/);
  assert.match(embedded, /shopify\.idToken\(\)/);
  assert.match(embedded, /Authorization/);

  const appConfig = fs.readFileSync('shopify.app.toml', 'utf8');
  assert.match(appConfig, /embedded = true/);
  assert.ok(!appConfig.includes('use_legacy_install_flow'));
  const embeddedAuth = fs.readFileSync('src/shopify/embeddedAuth.js', 'utf8');
  assert.match(embeddedAuth, /expiring: '1'/);

  const liquid = fs.readFileSync('extensions/social-preview/blocks/social-preview.liquid', 'utf8');
  const browserScript = fs.readFileSync('extensions/social-preview/assets/social-preview.js', 'utf8');
  assert.match(liquid, /custom\.og_image/);
  assert.match(liquid, /custom\.share_version/);
  assert.match(liquid, /property="og:image"/);
  assert.match(browserScript, /searchParams\.set\('pv'/);
}

(async () => {
  await testAuthenticationSecurity();
  await testTenantIsolation();
  await testMerchantMetafieldsArePinned();
  await testInputValidationAndPages();
  console.log('installable app tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
