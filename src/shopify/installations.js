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
  return { ...record, accessToken: encryptSecret(record.accessToken, encryptionSecret()) };
}

function deserializeInstallation(record) {
  if (!record) return null;
  return { ...record, accessToken: decryptSecret(record.accessToken, encryptionSecret()) };
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
  constructor(databaseUrl) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: databaseUrl });
    this.ready = null;
  }

  async initialize() {
    if (!this.ready) {
      this.ready = this.pool.query(`
        CREATE TABLE IF NOT EXISTS shop_installations (
          shop_domain TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '',
          logo_url TEXT,
          public_domain TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    }
    await this.ready;
  }

  async save(input) {
    await this.initialize();
    const record = serializeInstallation(input);
    const result = await this.pool.query(`
      INSERT INTO shop_installations
        (shop_domain, access_token, scopes, logo_url, public_domain, status, installed_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (shop_domain) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        scopes = EXCLUDED.scopes,
        logo_url = COALESCE(EXCLUDED.logo_url, shop_installations.logo_url),
        public_domain = COALESCE(EXCLUDED.public_domain, shop_installations.public_domain),
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *
    `, [record.shopDomain, record.accessToken, record.scopes, record.logoUrl,
      record.publicDomain, record.status, record.installedAt]);
    return deserializeInstallation(this.fromRow(result.rows[0]));
  }

  fromRow(row) {
    if (!row) return null;
    return {
      shopDomain: row.shop_domain,
      accessToken: row.access_token,
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

function getInstallationStore() {
  if (!singleton) {
    singleton = config.databaseUrl
      ? new PostgresInstallationStore(config.databaseUrl)
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
  FileInstallationStore,
  MemoryInstallationStore,
  PostgresInstallationStore,
  UnconfiguredInstallationStore,
  getInstallationStore,
  setInstallationStoreForTests,
};
