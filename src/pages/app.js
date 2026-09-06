'use strict';

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');
const { uploadLogoBufferToShopify } = require('../shopify/files');
const { getInstallationStore } = require('../shopify/installations');
const { normalizeShopifyCdnUrl } = require('../shopify/security');
const { requireEmbeddedInstallation, requireEmbeddedSession } = require('../shopify/embeddedAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Logo must be a PNG, JPG, or WebP image.'));
    }
    return callback(null, true);
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizePublicDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null;
    return url.hostname;
  } catch (_err) {
    return null;
  }
}

function layout(title, body, embedded = false) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${embedded ? `<meta name="shopify-api-key" content="${escapeHtml(config.shopifyApiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>` : ''}
<style>
  :root{color-scheme:light;font-family:Inter,system-ui,sans-serif;color:#202223;background:#f6f6f7}
  *{box-sizing:border-box}body{margin:0}.shell{max-width:920px;margin:0 auto;padding:48px 24px}
  .card{background:white;border:1px solid #e1e3e5;border-radius:14px;padding:24px;margin:18px 0;box-shadow:0 1px 2px #0000000d}
  h1{font-size:30px;margin:0 0 8px}h2{font-size:19px;margin:0 0 12px}p{line-height:1.55;color:#5c5f62}
  label{display:block;font-weight:650;margin:18px 0 7px}input{width:100%;padding:12px;border:1px solid #aeb4b9;border-radius:8px;font:inherit}
  button,.button{display:inline-block;border:0;border-radius:8px;padding:12px 18px;background:#006e52;color:#fff;font-weight:700;text-decoration:none;cursor:pointer}
  .button.secondary{background:#fff;color:#202223;border:1px solid #8c9196}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
  .status{display:inline-flex;align-items:center;gap:7px;background:#e3f1df;color:#1f5a29;border-radius:999px;padding:6px 10px;font-weight:700;font-size:13px}
  .logo{max-width:180px;max-height:90px;display:block;margin:10px 0}.notice{background:#f2f7fe;border-left:4px solid #2c6ecb;padding:12px 14px;color:#202223}
  code{background:#f1f2f3;padding:2px 5px;border-radius:4px}.muted{font-size:14px;color:#6d7175}
</style></head><body><main class="shell">${body}</main></body></html>`;
}

function embeddedAppPage() {
  return layout('Social Image Automation', `
    <div id="app-root"><h1>Social Image Automation</h1><p>Connecting securely to Shopify...</p></div>
    <script>
      async function shopifyRequest(url, options = {}) {
        const token = await shopify.idToken();
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', 'Bearer ' + token);
        return fetch(url, { ...options, headers });
      }

      async function loadDashboard(message = '') {
        const suffix = message ? '?message=' + encodeURIComponent(message) : '';
        const response = await shopifyRequest('/app/content' + suffix);
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || 'Unable to load the app');
        }
        document.getElementById('app-root').innerHTML = await response.text();
      }

      document.addEventListener('submit', async event => {
        if (event.target.id !== 'settings-form') return;
        event.preventDefault();
        const button = event.target.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const response = await shopifyRequest('/app/settings', {
            method: 'POST',
            body: new FormData(event.target),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to save settings');
          await loadDashboard('Settings saved.');
        } catch (error) {
          shopify.toast.show(error.message, { isError: true });
          button.disabled = false;
        }
      });

      loadDashboard().catch(error => {
        document.getElementById('app-root').textContent = 'Unable to connect: ' + error.message;
      });
    </script>`, true);
}

function installPage(query = {}) {
  const shop = escapeHtml(query.shop || '');
  const notice = query.session === 'expired'
    ? '<p class="notice">Your app session expired. Reconnect the store to continue.</p>'
    : '';
  return layout('Install Social Image Automation', `
    <h1>Social Image Automation</h1>
    <p>Connect a Shopify store to automate promotional social preview images.</p>
    ${notice}
    <section class="card">
      <h2>Install on a store</h2>
      <form method="get" action="/auth">
        <label for="shop">Shopify store domain</label>
        <input id="shop" name="shop" value="${shop}" placeholder="your-store.myshopify.com" required>
        <div class="actions"><button type="submit">Connect Shopify store</button></div>
      </form>
    </section>`);
}

function dashboardContent(installation, message = '') {
  const shop = escapeHtml(installation.shopDomain);
  const domain = escapeHtml(installation.publicDomain || '');
  const logo = normalizeShopifyCdnUrl(installation.logoUrl);
  const activation = `https://${installation.shopDomain}/admin/themes/current/editor?context=apps&template=product&activateAppId=${encodeURIComponent(config.shopifyApiKey)}/social-preview`;
  return `
    <h1>Social Image Automation</h1>
    <p><span class="status">Connected</span> &nbsp; ${shop}</p>
    ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}
    <section class="card">
      <h2>1. Brand settings</h2>
      <p>Upload the logo used in generated product images. It is stored safely in this shop's Shopify Files.</p>
      ${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="Current store logo">` : '<p class="muted">No custom logo uploaded yet.</p>'}
      <form id="settings-form" method="post" action="/app/settings" enctype="multipart/form-data">
        <label for="logo">Store logo (PNG, JPG, or WebP; maximum 5 MB)</label>
        <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp">
        <label for="publicDomain">Public storefront domain</label>
        <input id="publicDomain" name="publicDomain" value="${domain}" placeholder="www.example.com">
        <div class="actions"><button type="submit">Save settings</button></div>
      </form>
    </section>
    <section class="card">
      <h2>2. Activate storefront previews</h2>
      <p>Open the theme editor, confirm the <strong>Social preview metadata</strong> app embed is enabled, then click Save.</p>
      <div class="actions"><a class="button" href="${escapeHtml(activation)}" target="_blank" rel="noopener">Open theme editor</a></div>
      <p class="muted">Shopify requires this one theme confirmation after installation. Product webhooks and metafield definitions are automatic.</p>
    </section>
    <section class="card">
      <h2>3. Generate a preview</h2>
      <p>Open a product, set <code>Enable promo image</code> to true, and save it. The signed product webhook will generate the image and update its social metadata.</p>
    </section>`;
}

function dashboardPage(installation, message = '') {
  return layout('Social Image Automation', dashboardContent(installation, message));
}

const router = express.Router();

router.get('/', (_req, res) => res.type('html').send(embeddedAppPage()));

router.get('/app', (_req, res) => res.type('html').send(embeddedAppPage()));

router.get('/app/content', requireEmbeddedInstallation, (req, res) => {
  res.type('html').send(dashboardContent(req.shopify.installation, req.query.message || ''));
});

router.post('/app/settings', requireEmbeddedSession, upload.single('logo'), async (req, res, next) => {
  try {
    const publicDomain = normalizePublicDomain(req.body.publicDomain);
    if (req.body.publicDomain && !publicDomain) {
      return res.status(400).json({ error: 'Enter a valid HTTPS storefront hostname without a path.' });
    }

    let logoUrl = req.shopify.installation.logoUrl;
    if (req.file) {
      const normalizedLogo = await sharp(req.file.buffer)
        .rotate()
        .resize(800, 400, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      logoUrl = await uploadLogoBufferToShopify(
        normalizedLogo,
        req.shopify.client,
        req.shopify.shopDomain
      );
      if (!normalizeShopifyCdnUrl(logoUrl)) throw new Error('Shopify returned an unexpected logo URL');
    }

    await getInstallationStore().save({
      ...req.shopify.installation,
      logoUrl,
      publicDomain,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = { dashboardContent, dashboardPage, embeddedAppPage, installPage, normalizePublicDomain, router };
