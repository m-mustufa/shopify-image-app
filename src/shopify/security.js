'use strict';

const crypto = require('crypto');

const SHOP_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function normalizeShopDomain(value) {
  const shop = String(value || '').trim().toLowerCase();
  return SHOP_PATTERN.test(shop) ? shop : null;
}

function normalizeShopifyCdnUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === 'cdn.shopify.com' || hostname.endsWith('.shopifycdn.com');
    return url.protocol === 'https:' && allowedHost ? url.toString() : null;
  } catch (_err) {
    return null;
  }
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyOAuthHmac(query, secret) {
  if (!secret || !query?.hmac) return false;
  const message = Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join('&');
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return safeEqualText(expected, query.hmac);
}

function signValue(value, secret) {
  if (!secret) throw new Error('A signing secret is required');
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySignedValue(token, secret, maxAgeMs) {
  if (!token || !secret) return null;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqualText(expected, signature)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (maxAgeMs && (!value.issuedAt || Date.now() - value.issuedAt > maxAgeMs)) return null;
    return value;
  } catch (_err) {
    return null;
  }
}

function parseCookies(header) {
  return Object.fromEntries(String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      if (index < 0) return [part, ''];
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

function deriveEncryptionKey(secret) {
  if (!secret) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY is required');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(plainText, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptSecret(value, secret) {
  const [iv, tag, encrypted] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv?.length || !tag?.length || !encrypted?.length) throw new Error('Stored token is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = {
  decryptSecret,
  encryptSecret,
  normalizeShopifyCdnUrl,
  normalizeShopDomain,
  parseCookies,
  signValue,
  verifyOAuthHmac,
  verifySignedValue,
};
