'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { decryptSecret, encryptSecret, normalizeShopDomain } = require('./security');

function encryptionSecret() {
  if (config.shopifyTokenEncryptionKey) return config.shopifyTokenEncryptionKey;
  if (process.env.VERCEL) {
    throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY is required on Vercel');
  }
  if (!config.shopifyApiSecret) {
    throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY or SHOPIFY_API_SECRET is required');
  }
  return config.shopifyApiSecret;
}

function normalizeInstallation(input) {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  if (!shopDomain) throw new Error('Invalid Shopify shop domain');
  return {
    shopDomain,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken || null,
    expiresAt: input.expiresAt || null,
    scopes: input.scopes || '',
    logoUrl: input.logoUrl || null,
    publicDomain: input.publicDomain || null,
    status: input.status || 'active',
    installedAt: input.installedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function serializeInstallation(input) {
  const record = normalizeInstallation(input);
  if (!record.accessToken) throw new Error('Shopify offline access token is required');
  return {
    ...record,
    accessToken: encryptSecret(record.accessToken, encryptionSecret()),
    refreshToken: record.refreshToken ? encryptSecret(record.refreshToken, encryptionSecret()) : null,
  };
}

function deserializeInstallation(record) {
  if (!record) return null;
  return {
    ...record,
    accessToken: decryptSecret(record.accessToken, encryptionSecret()),
    refreshToken: record.refreshToken ? decryptSecret(record.refreshToken, encryptionSecret()) : null,
  };
}

class MemoryInstallationStore {
  constructor() {
    this.records = new Map();
  }

  async save(input) {
    const record = normalizeInstallation(input);
    this.records.set(record.shopDomain, record);
    return record;
  }

  async get(shopDomain) {
    return this.records.get(normalizeShopDomain(shopDomain)) || null;
  }

  async delete(shopDomain) {
    return this.records.delete(normalizeShopDomain(shopDomain));
  }
}

class FileInstallationStore {
  constructor(filePath = path.join(process.cwd(), '.data', 'shop-installations.json')) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async readAll() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async writeAll(records) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }

  async save(input) {
    const encrypted = serializeInstallation(input);
    let saved;
    this.queue = this.queue.then(async () => {
      const records = await this.readAll();
      const existing = records[encrypted.shopDomain];
      saved = { ...existing, ...encrypted, installedAt: existing?.installedAt || encrypted.installedAt };
      records[encrypted.shopDomain] = saved;
      await this.writeAll(records);
    });
    await this.queue;
    return deserializeInstallation(saved);
  }

  async get(shopDomain) {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return null;
    const records = await this.readAll();
    return deserializeInstallation(records[shop]);
  }

  async delete(shopDomain) {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return false;
    let deleted = false;
    this.queue = this.queue.then(async () => {
      const records = await this.readAll();
      deleted = Boolean(records[shop]);
      delete records[shop];
      await this.writeAll(records);
    });
    await this.queue;
    return deleted;
  }
}

class PostgresInstallationStore {
  constructor(databaseUrl, { label = 'primary', connectionTimeoutMillis = 5000 } = {}) {
    const { Pool } = require('pg');
    this.label = label;
    // A suspended or over-quota database must fail fast so failover can kick in,
    // instead of hanging the webhook until the function times out.
    this.pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis });
    // Without a listener, an idle client dropped by the server (Neon suspends idle
    // computes) emits an unhandled 'error' that crashes the process.
    this.pool.on('error', err => console.warn(`[db:${this.label}] idle client error: ${err.message}`));
    this.ready = null;
  }

  async initialize() {
    if (!this.ready) {
      this.ready = this.pool.query(`
        CREATE TABLE IF NOT EXISTS shop_installations (
          shop_domain TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          expires_at TIMESTAMPTZ,
          scopes TEXT NOT NULL DEFAULT '',
          logo_url TEXT,
          public_domain TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE shop_installations ADD COLUMN IF NOT EXISTS refresh_token TEXT;
        ALTER TABLE shop_installations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
      `);
      // Do not keep a failed setup: the next call retries once the database is back.
      this.ready.catch(() => { this.ready = null; });
    }
    await this.ready;
  }

  async save(input) {
    await this.initialize();
    const record = serializeInstallation(input);
    const result = await this.pool.query(`
      INSERT INTO shop_installations
        (shop_domain, access_token, refresh_token, expires_at, scopes, logo_url, public_domain, status, installed_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (shop_domain) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, shop_installations.refresh_token),
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        logo_url = COALESCE(EXCLUDED.logo_url, shop_installations.logo_url),
        public_domain = COALESCE(EXCLUDED.public_domain, shop_installations.public_domain),
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *
    `, [record.shopDomain, record.accessToken, record.refreshToken, record.expiresAt,
      record.scopes, record.logoUrl, record.publicDomain, record.status, record.installedAt]);
    return deserializeInstallation(this.fromRow(result.rows[0]));
  }

  fromRow(row) {
    if (!row) return null;
    return {
      shopDomain: row.shop_domain,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
      scopes: row.scopes,
      logoUrl: row.logo_url,
      publicDomain: row.public_domain,
      status: row.status,
      installedAt: row.installed_at?.toISOString?.() || row.installed_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    };
  }

  async get(shopDomain) {
    await this.initialize();
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return null;
    const result = await this.pool.query(
      'SELECT * FROM shop_installations WHERE shop_domain = $1 LIMIT 1',
      [shop]
    );
    return deserializeInstallation(this.fromRow(result.rows[0]));
  }

  async delete(shopDomain) {
    await this.initialize();
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return false;
    const result = await this.pool.query('DELETE FROM shop_installations WHERE shop_domain = $1', [shop]);
    return result.rowCount > 0;
  }
}

// Two databases: reads use the primary and fall back to the backup when the primary
// is unreachable; writes go to both so either one can serve on its own.
class FailoverInstallationStore {
  constructor(primary, backup, { cooldownMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.primary = primary;
    this.backup = backup;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.primaryDownUntil = 0;
  }

  primaryAvailable() {
    return this.now() >= this.primaryDownUntil;
  }

  markPrimaryDown(err) {
    this.primaryDownUntil = this.now() + this.cooldownMs;
    console.warn(`[db] primary unavailable, using backup for ${Math.round(this.cooldownMs / 60000)} min: ${err.message}`);
  }

  async get(shopDomain) {
    if (!this.primaryAvailable()) return this.backup.get(shopDomain);

    let record;
    try {
      record = await this.primary.get(shopDomain);
    } catch (err) {
      this.markPrimaryDown(err);
      return this.backup.get(shopDomain);
    }
    if (record) return record;

    // Saved while the primary was down: copy it back so the primary catches up.
    let fromBackup;
    try {
      fromBackup = await this.backup.get(shopDomain);
    } catch (err) {
      console.warn(`[db] backup read failed: ${err.message}`);
      return null;
    }
    if (fromBackup) {
      try {
        await this.primary.save(fromBackup);
      } catch (err) {
        console.warn(`[db] could not copy installation back to primary: ${err.message}`);
      }
    }
    return fromBackup;
  }

  async save(input) {
    const usePrimary = this.primaryAvailable();
    const [primary, backup] = await Promise.allSettled([
      usePrimary ? this.primary.save(input) : Promise.resolve(null),
      this.backup.save(input),
    ]);
    if (usePrimary && primary.status === 'rejected') this.markPrimaryDown(primary.reason);
    if (backup.status === 'rejected') console.warn(`[db] backup write failed: ${backup.reason.message}`);

    if (usePrimary && primary.status === 'fulfilled') return primary.value;
    if (backup.status === 'fulfilled') return backup.value;
    throw usePrimary ? primary.reason : backup.reason;
  }

  async delete(shopDomain) {
    const [primary, backup] = await Promise.allSettled([
      this.primary.delete(shopDomain),
      this.backup.delete(shopDomain),
    ]);
    if (primary.status === 'rejected') console.warn(`[db] primary delete failed: ${primary.reason.message}`);
    if (backup.status === 'rejected') console.warn(`[db] backup delete failed: ${backup.reason.message}`);
    if (primary.status === 'rejected' && backup.status === 'rejected') throw primary.reason;
    return [primary, backup].some(result => result.status === 'fulfilled' && result.value);
  }
}

// Keeps recently read installations in memory so a burst of product webhooks does
// not wake the database for every request (each wake bills compute time).
// A record is served from cache only while its access token has plenty of life
// left, so a token refresh always starts from a fresh database read: Shopify
// rotates refresh tokens, and a stale cached one would be rejected.
class CachedInstallationStore {
  constructor(store, { ttlMs = 30 * 60 * 1000, minTokenLifeMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.store = store;
    this.ttlMs = ttlMs;
    this.minTokenLifeMs = minTokenLifeMs;
    this.now = now;
    this.entries = new Map();
  }

  remember(record) {
    if (record?.shopDomain) this.entries.set(record.shopDomain, { record, cachedAt: this.now() });
    return record;
  }

  fresh(entry) {
    if (!entry) return false;
    if (this.now() - entry.cachedAt >= this.ttlMs) return false;
    const expiresAt = entry.record.expiresAt ? new Date(entry.record.expiresAt).getTime() : Infinity;
    return expiresAt - this.now() > this.minTokenLifeMs;
  }

  async get(shopDomain) {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) return null;
    const entry = this.entries.get(shop);
    if (this.fresh(entry)) return entry.record;
    this.entries.delete(shop);
    return this.remember(await this.store.get(shop));
  }

  async save(input) {
    const shop = normalizeShopDomain(input?.shopDomain);
    if (shop) this.entries.delete(shop);
    return this.remember(await this.store.save(input));
  }

  async delete(shopDomain) {
    const shop = normalizeShopDomain(shopDomain);
    if (shop) this.entries.delete(shop);
    return this.store.delete(shopDomain);
  }
}

class UnconfiguredInstallationStore {
  unavailable() {
    const error = new Error('DATABASE_URL is required for installable mode on Vercel');
    error.status = 503;
    throw error;
  }

  async save() { return this.unavailable(); }
  async get() { return this.unavailable(); }
  async delete() { return this.unavailable(); }
}

let singleton;

function createDatabaseStore() {
  const primary = new PostgresInstallationStore(config.databaseUrl, { label: 'primary' });
  const store = config.databaseBackupUrl
    ? new FailoverInstallationStore(
      primary,
      new PostgresInstallationStore(config.databaseBackupUrl, { label: 'backup' })
    )
    : primary;
  return new CachedInstallationStore(store);
}

function getInstallationStore() {
  if (!singleton) {
    singleton = config.databaseUrl
      ? createDatabaseStore()
      : process.env.VERCEL
        ? new UnconfiguredInstallationStore()
        : new FileInstallationStore();
  }
  return singleton;
}

function setInstallationStoreForTests(store) {
  singleton = store;
}

module.exports = {
  CachedInstallationStore,
  FailoverInstallationStore,
  FileInstallationStore,
  MemoryInstallationStore,
  PostgresInstallationStore,
  UnconfiguredInstallationStore,
  getInstallationStore,
  setInstallationStoreForTests,
};
