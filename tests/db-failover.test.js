'use strict';

const assert = require('assert');
const {
  CachedInstallationStore,
  FailoverInstallationStore,
  MemoryInstallationStore,
} = require('../src/shopify/installations');

const SHOP = 'example-store.myshopify.com';

// A memory store that can be switched "down" to act like a suspended database.
class FlakyStore extends MemoryInstallationStore {
  constructor() {
    super();
    this.down = false;
    this.calls = { get: 0, save: 0, delete: 0 };
  }

  check() {
    if (this.down) throw new Error('compute quota exceeded');
  }

  async get(shop) { this.calls.get += 1; this.check(); return super.get(shop); }
  async save(input) { this.calls.save += 1; this.check(); return super.save(input); }
  async delete(shop) { this.calls.delete += 1; this.check(); return super.delete(shop); }
}

function clock(start = 1_000_000) {
  let time = start;
  const now = () => time;
  now.advance = ms => { time += ms; };
  return now;
}

function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  return Promise.resolve().then(fn).finally(() => { console.warn = warn; });
}

async function testWritesGoToBoth() {
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  const store = new FailoverInstallationStore(primary, backup);
  await store.save({ shopDomain: SHOP, accessToken: 'token-1' });
  assert.strictEqual((await primary.get(SHOP)).accessToken, 'token-1');
  assert.strictEqual((await backup.get(SHOP)).accessToken, 'token-1');
}

async function testReadFallsBackWhenPrimaryDown() {
  const now = clock();
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  const store = new FailoverInstallationStore(primary, backup, { cooldownMs: 60_000, now });
  await store.save({ shopDomain: SHOP, accessToken: 'token-1' });

  primary.down = true;
  await quiet(async () => {
    assert.strictEqual((await store.get(SHOP)).accessToken, 'token-1');
  });

  // During cooldown the primary is not tried again, so webhooks don't wait on it.
  const primaryReads = primary.calls.get;
  assert.strictEqual((await store.get(SHOP)).accessToken, 'token-1');
  assert.strictEqual(primary.calls.get, primaryReads);

  // After cooldown the primary is used again.
  primary.down = false;
  now.advance(60_000);
  assert.strictEqual((await store.get(SHOP)).accessToken, 'token-1');
  assert.strictEqual(primary.calls.get, primaryReads + 1);
}

async function testSaveDuringOutageIsCopiedBack() {
  const now = clock();
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  const store = new FailoverInstallationStore(primary, backup, { cooldownMs: 60_000, now });

  primary.down = true;
  await quiet(async () => {
    const saved = await store.save({ shopDomain: SHOP, accessToken: 'saved-during-outage' });
    assert.strictEqual(saved.accessToken, 'saved-during-outage');
  });

  primary.down = false;
  now.advance(60_000);
  assert.strictEqual((await store.get(SHOP)).accessToken, 'saved-during-outage');
  assert.strictEqual((await primary.get(SHOP)).accessToken, 'saved-during-outage');
}

async function testBackupFailureDoesNotBlockPrimary() {
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  backup.down = true;
  const store = new FailoverInstallationStore(primary, backup);
  await quiet(async () => {
    const saved = await store.save({ shopDomain: SHOP, accessToken: 'token-1' });
    assert.strictEqual(saved.accessToken, 'token-1');
    // Unknown shop: primary says none, backup is down -> null, no crash.
    assert.strictEqual(await store.get('other-store.myshopify.com'), null);
  });
}

async function testBothDownThrows() {
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  primary.down = true;
  backup.down = true;
  const store = new FailoverInstallationStore(primary, backup);
  await quiet(async () => {
    await assert.rejects(() => store.save({ shopDomain: SHOP, accessToken: 'x' }), /quota/);
    await assert.rejects(() => store.get(SHOP), /quota/);
    await assert.rejects(() => store.delete(SHOP), /quota/);
  });
}

async function testDeleteRemovesFromBoth() {
  const primary = new FlakyStore();
  const backup = new FlakyStore();
  const store = new FailoverInstallationStore(primary, backup);
  await store.save({ shopDomain: SHOP, accessToken: 'token-1' });
  assert.strictEqual(await store.delete(SHOP), true);
  assert.strictEqual(await primary.get(SHOP), null);
  assert.strictEqual(await backup.get(SHOP), null);
}

async function testCacheSkipsDatabaseForBursts() {
  const now = clock();
  const inner = new FlakyStore();
  const store = new CachedInstallationStore(inner, { ttlMs: 30 * 60_000, minTokenLifeMs: 10 * 60_000, now });
  const expiresAt = new Date(now() + 60 * 60_000).toISOString();
  await inner.save({ shopDomain: SHOP, accessToken: 'token-1', expiresAt });

  for (let i = 0; i < 20; i += 1) await store.get(SHOP);
  assert.strictEqual(inner.calls.get, 1);

  // Past the TTL the database is read again.
  now.advance(30 * 60_000);
  await store.get(SHOP);
  assert.strictEqual(inner.calls.get, 2);
}

async function testCacheRereadsNearTokenExpiry() {
  const now = clock();
  const inner = new FlakyStore();
  const store = new CachedInstallationStore(inner, { ttlMs: 30 * 60_000, minTokenLifeMs: 10 * 60_000, now });
  await inner.save({ shopDomain: SHOP, accessToken: 'old', expiresAt: new Date(now() + 15 * 60_000).toISOString() });
  await store.get(SHOP);

  // Another instance refreshed the token; ours must not keep using the old one
  // once it is close to expiry.
  await inner.save({ shopDomain: SHOP, accessToken: 'new', expiresAt: new Date(now() + 75 * 60_000).toISOString() });
  now.advance(6 * 60_000);
  assert.strictEqual((await store.get(SHOP)).accessToken, 'new');
}

async function testCacheUpdatesOnSaveAndDelete() {
  const inner = new FlakyStore();
  const store = new CachedInstallationStore(inner);
  await store.save({ shopDomain: SHOP, accessToken: 'token-1' });
  await store.save({ shopDomain: SHOP, accessToken: 'token-2' });
  assert.strictEqual((await store.get(SHOP)).accessToken, 'token-2');
  await store.delete(SHOP);
  assert.strictEqual(await store.get(SHOP), null);
}

async function testCacheDoesNotRememberMissingShop() {
  const inner = new FlakyStore();
  const store = new CachedInstallationStore(inner);
  assert.strictEqual(await store.get(SHOP), null);
  await inner.save({ shopDomain: SHOP, accessToken: 'installed-later' });
  assert.strictEqual((await store.get(SHOP)).accessToken, 'installed-later');
}

(async () => {
  await testWritesGoToBoth();
  await testReadFallsBackWhenPrimaryDown();
  await testSaveDuringOutageIsCopiedBack();
  await testBackupFailureDoesNotBlockPrimary();
  await testBothDownThrows();
  await testDeleteRemovesFromBoth();
  await testCacheSkipsDatabaseForBursts();
  await testCacheRereadsNearTokenExpiry();
  await testCacheUpdatesOnSaveAndDelete();
  await testCacheDoesNotRememberMissingShop();
  console.log('db failover tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
