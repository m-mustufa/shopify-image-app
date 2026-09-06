'use strict';

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');
const { uploadLogoBufferToShopify } = require('../shopify/files');
const { getInstallationStore } = require('../shopify/installations');
const { normalizeShopifyCdnUrl } = require('../shopify/security');
const { requireEmbeddedInstallation, requireEmbeddedSession } = require('../shopify/embeddedAuth');
const {
  createSharePreviewToken,
  createSharePreviewUrl,
  normalizeProductHandle,
  renderSharePreview,
} = require('../shopify/sharePreview');

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
<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>${escapeHtml(title)}</title>
${embedded ? `<meta name='shopify-api-key' content='${escapeHtml(config.shopifyApiKey)}'>
<script src='https://cdn.shopify.com/shopifycloud/app-bridge.js'></script>` : ''}
<style>
  :root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2124;background:#f3f4f6;--ink:#1f2124;--muted:#61666c;--border:#dfe3e8;--surface:#fff;--brand:#006e52;--brand-hover:#005b45;--success:#15803d;--success-bg:#edf9f0;--info:#175cd3;--info-bg:#eff6ff;--danger:#b42318;--danger-bg:#fff1f0;--shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08)}
  *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f8f9fa 0,#f3f4f6 280px);min-height:100vh}.shell{max-width:1120px;margin:0 auto;padding:40px 28px 64px}
  h1,h2,h3,p{margin-top:0}h1{font-size:30px;letter-spacing:-.7px;margin-bottom:8px}h2{font-size:19px;letter-spacing:-.2px;margin-bottom:8px}h3{font-size:15px;margin-bottom:6px}p{line-height:1.55;color:var(--muted)}
  .app-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:24px}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:#697077;margin-bottom:8px}.subtitle{margin:0;max-width:630px}.connection{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid #ccebd5;background:var(--success-bg);border-radius:10px;font-size:13px;color:#166534;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px #d7f5df}.store{font-weight:700}
  .setup-strip{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 20px;background:#162a25;color:#fff;border-radius:14px;margin-bottom:20px;box-shadow:var(--shadow)}.setup-copy{display:flex;align-items:center;gap:14px}.setup-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.12);font-weight:800}.setup-strip p{margin:2px 0 0;color:#cddbd7;font-size:13px}.progress{min-width:210px}.progress-label{display:flex;justify-content:space-between;font-size:12px;margin-bottom:7px;color:#d9e4e1}.progress-track{height:7px;border-radius:99px;background:rgba(255,255,255,.16);overflow:hidden}.progress-fill{height:100%;width:50%;background:#5ee3b5;border-radius:inherit;transition:width .3s ease}
  .grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(290px,.85fr);gap:20px;align-items:start}.side-stack{display:grid;gap:20px}.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 24px 18px;border-bottom:1px solid #edf0f2}.card-head p{font-size:14px;margin:0}.card-body{padding:24px}.step{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#e8f5f0;color:var(--brand);font-size:13px;font-weight:800;margin-right:9px}.title-row{display:flex;align-items:center}.badge{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:750}.badge.pending{background:#fff7df;color:#854d0e}.badge.active{background:var(--success-bg);color:#166534}.badge.neutral{background:#f1f3f5;color:#50565c}
  .logo-panel{display:flex;gap:18px;align-items:center;padding:16px;border:1px solid #e7eaed;border-radius:12px;background:#fafbfb;margin-bottom:22px}.logo-frame{display:grid;place-items:center;width:132px;height:82px;flex:0 0 132px;border:1px solid #e1e5e8;border-radius:10px;background:#fff;overflow:hidden}.logo{max-width:112px;max-height:64px;display:block}.logo-placeholder{font-size:12px;color:#8a9096;text-align:center}.logo-copy p{font-size:13px;margin:0}.logo-copy strong{display:block;margin-bottom:4px}
  label{display:block;font-size:13px;font-weight:700;margin-bottom:7px}.field{margin-bottom:20px}.field-help{font-size:12px;color:#757b82;margin:7px 0 0}.text-input{width:100%;padding:11px 12px;border:1px solid #aeb5bd;border-radius:9px;background:#fff;color:var(--ink);font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}.text-input:focus{border-color:#2c6ecb;box-shadow:0 0 0 3px rgba(44,110,203,.14)}
  .file-picker{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px;border:1px dashed #98a2ad;border-radius:10px;background:#fafbfb}.file-picker:focus-within{border-color:#2c6ecb;box-shadow:0 0 0 3px rgba(44,110,203,.12)}.file-input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.file-trigger{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #c7ccd1;border-radius:7px;background:#fff;font-size:13px;font-weight:700;cursor:pointer}.file-name{font-size:13px;color:#687078;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .card-footer{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:16px 24px;background:#fafbfb;border-top:1px solid #edf0f2}.button,button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;border:1px solid transparent;border-radius:8px;padding:9px 15px;background:var(--brand);color:#fff;font:inherit;font-size:13px;font-weight:750;text-decoration:none;cursor:pointer;transition:background .15s,transform .05s,box-shadow .15s}.button:hover,button:hover{background:var(--brand-hover)}.button:active,button:active{transform:translateY(1px)}button:disabled{cursor:not-allowed;opacity:.68}.button.secondary{background:#fff;color:var(--ink);border-color:#c7ccd1}.button.secondary:hover{background:#f6f7f8}.button.full{width:100%}
  .notice{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;margin:0 0 20px;font-size:13px;font-weight:600}.notice.success{background:var(--success-bg);color:#166534;border:1px solid #ccebd5}.notice.error{background:var(--danger-bg);color:var(--danger);border:1px solid #ffd0cc}.notice.info{background:var(--info-bg);color:#1849a9;border:1px solid #cfe0ff}.notice[hidden]{display:none}
  .embed-summary{padding:15px;border:1px solid #e7eaed;border-radius:11px;background:#fafbfb;margin-bottom:18px}.embed-summary p{font-size:13px;margin:8px 0 0}.check-list{display:grid;gap:13px;margin:18px 0 22px}.check-item{display:flex;gap:10px;font-size:13px;color:#4f565d}.check{display:grid;place-items:center;width:20px;height:20px;flex:0 0 20px;border-radius:50%;background:#e8f5f0;color:var(--brand);font-size:11px;font-weight:900}.mini-steps{display:grid;gap:4px}.mini-step{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid #edf0f2}.mini-step:last-child{border-bottom:0}.mini-num{display:grid;place-items:center;width:25px;height:25px;flex:0 0 25px;border-radius:7px;background:#f0f2f4;color:#4b5157;font-size:12px;font-weight:800}.mini-step p{font-size:13px;margin:1px 0 0}.preview-form{display:grid;gap:12px}.preview-result{padding:12px;background:var(--success-bg);border:1px solid #ccebd5;border-radius:9px}.preview-result[hidden]{display:none}.preview-result .text-input{font-size:12px;margin-bottom:9px}.preview-actions{display:flex;gap:8px}.preview-actions button,.preview-actions a{flex:1}
  code{background:#f0f2f4;padding:2px 5px;border-radius:5px;font-size:12px;color:#343a40}.spinner{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite}.loading-state{padding-top:6px}.skeleton{position:relative;overflow:hidden;background:#e7eaed;border-radius:8px}.skeleton:after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent);animation:shimmer 1.25s infinite}.sk-title{width:310px;height:32px;margin-bottom:12px}.sk-sub{width:470px;max-width:80%;height:16px;margin-bottom:28px}.sk-strip{height:82px;margin-bottom:20px;border-radius:14px}.sk-grid{display:grid;grid-template-columns:1.55fr .85fr;gap:20px}.sk-card{height:430px;border-radius:14px}.sk-card.small{height:270px}.error-state{max-width:560px;margin:80px auto;padding:34px;text-align:center;background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow)}.error-mark{display:grid;place-items:center;width:48px;height:48px;margin:0 auto 17px;border-radius:13px;background:var(--danger-bg);color:var(--danger);font-size:24px;font-weight:800}.error-state p{margin-bottom:22px}
  @keyframes spin{to{transform:rotate(360deg)}}@keyframes shimmer{100%{transform:translateX(100%)}}@media(max-width:780px){.shell{padding:24px 16px 48px}.app-header{display:block}.connection{margin-top:16px;width:max-content}.setup-strip{align-items:flex-start;flex-direction:column}.progress{width:100%;min-width:0}.grid,.sk-grid{grid-template-columns:1fr}.logo-panel{align-items:flex-start}.card-head,.card-body{padding-left:18px;padding-right:18px}.card-footer{padding:14px 18px}}@media(max-width:480px){.logo-panel{display:block}.logo-frame{margin-bottom:12px;width:100%}.card-footer{display:block}.card-footer button{width:100%}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition:none!important}}
</style></head><body><main class='shell'>${body}</main></body></html>`;
}

function loadingMarkup() {
  return `<div class='loading-state' aria-label='Loading application'>
    <div class='skeleton sk-title'></div><div class='skeleton sk-sub'></div>
    <div class='skeleton sk-strip'></div><div class='sk-grid'><div class='skeleton sk-card'></div><div class='skeleton sk-card small'></div></div>
  </div>`;
}

function embeddedAppPage() {
  return layout('Social Image Automation', `
    <div id='app-root' aria-live='polite'>${loadingMarkup()}</div>
    <script>
      const appRoot = document.getElementById('app-root');

      async function shopifyRequest(url, options = {}) {
        const token = await shopify.idToken();
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', 'Bearer ' + token);
        return fetch(url, { ...options, headers });
      }

      async function responseError(response) {
        try {
          const result = await response.json();
          return result.error || 'The request could not be completed.';
        } catch (_error) {
          return 'The request could not be completed.';
        }
      }

      function showError(error) {
        appRoot.innerHTML = \`<section class='error-state' role='alert'>
          <div class='error-mark'>!</div><h1>We could not load the app</h1>
          <p id='load-error'></p><button id='retry-load' type='button'>Try again</button>
        </section>\`;
        document.getElementById('load-error').textContent = error.message || 'Please try again.';
      }

      function showNotice(type, message) {
        const notice = document.getElementById('form-notice');
        if (!notice) return;
        notice.className = 'notice ' + type;
        notice.textContent = message;
        notice.hidden = false;
        notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      async function updateEmbedStatus() {
        const badge = document.getElementById('embed-status');
        const progress = document.getElementById('setup-progress');
        const progressCopy = document.getElementById('setup-progress-copy');
        if (!badge || !shopify.app || !shopify.app.extensions) return;
        try {
          const extensions = await shopify.app.extensions();
          const active = extensions.some(extension => extension.type === 'theme_app_extension' &&
            extension.activations.some(block => block.handle === 'social-preview' && block.status === 'active'));
          badge.className = 'badge ' + (active ? 'active' : 'pending');
          badge.textContent = active ? 'Active' : 'Action required';
          progress.style.width = active ? '100%' : '50%';
          progressCopy.textContent = active ? 'Setup complete' : '1 of 2 complete';
        } catch (_error) {
          badge.className = 'badge neutral';
          badge.textContent = 'Check in theme editor';
        }
      }

      async function loadDashboard(message = '') {
        appRoot.innerHTML = ${JSON.stringify(loadingMarkup())};
        try {
          const suffix = message ? '?message=' + encodeURIComponent(message) : '';
          const response = await shopifyRequest('/app/content' + suffix);
          if (!response.ok) throw new Error(await responseError(response));
          appRoot.innerHTML = await response.text();
          await updateEmbedStatus();
        } catch (error) {
          showError(error);
        }
      }

      document.addEventListener('click', event => {
        if (event.target.closest('#retry-load')) loadDashboard();
        const copyButton = event.target.closest('#copy-preview-link');
        if (copyButton) {
          const input = document.getElementById('preview-url');
          navigator.clipboard.writeText(input.value).then(() => {
            copyButton.textContent = 'Copied';
          }).catch(() => {
            input.select();
            showNotice('info', 'Copy the selected link.');
          });
        }
      });

      document.addEventListener('change', event => {
        if (event.target.id !== 'logo') return;
        const file = event.target.files[0];
        const fileName = document.getElementById('file-name');
        if (!file) {
          fileName.textContent = 'No file selected';
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          event.target.value = '';
          fileName.textContent = 'No file selected';
          showNotice('error', 'The logo must be smaller than 5 MB.');
          return;
        }
        fileName.textContent = file.name;
      });

      document.addEventListener('submit', async event => {
        if (event.target.id === 'preview-link-form') {
          event.preventDefault();
          const button = event.target.querySelector('button[type=submit]');
          const original = button.innerHTML;
          button.disabled = true;
          button.innerHTML = \`<span class='spinner' aria-hidden='true'></span>Generating...\`;
          try {
            const response = await shopifyRequest('/app/share-preview-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ product: document.getElementById('preview-product').value }),
            });
            if (!response.ok) throw new Error(await responseError(response));
            const result = await response.json();
            document.getElementById('preview-url').value = result.url;
            document.getElementById('open-preview-link').href = result.url;
            document.getElementById('preview-result').hidden = false;
          } catch (error) {
            showNotice('error', error.message || 'The test link could not be generated.');
          } finally {
            button.disabled = false;
            button.innerHTML = original;
          }
          return;
        }
        if (event.target.id !== 'settings-form') return;
        event.preventDefault();
        const button = event.target.querySelector('button[type=submit]');
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = \`<span class='spinner' aria-hidden='true'></span>Saving...\`;
        const notice = document.getElementById('form-notice');
        if (notice) notice.hidden = true;
        try {
          const response = await shopifyRequest('/app/settings', { method: 'POST', body: new FormData(event.target) });
          if (!response.ok) throw new Error(await responseError(response));
          await loadDashboard('Settings saved successfully.');
          if (shopify.toast && shopify.toast.show) shopify.toast.show('Settings saved');
        } catch (error) {
          button.disabled = false;
          button.innerHTML = original;
          showNotice('error', error.message || 'Settings could not be saved. Please try again.');
          if (shopify.toast && shopify.toast.show) shopify.toast.show('Settings could not be saved', { isError: true });
        }
      });

      loadDashboard();
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
    <header class='app-header'>
      <div><div class='eyebrow'>Storefront automation</div><h1>Social Image Automation</h1><p class='subtitle'>Create branded product previews and keep social sharing metadata up to date automatically.</p></div>
      <div class='connection'><span class='dot' aria-hidden='true'></span><span>Connected to</span><span class='store'>${shop}</span></div>
    </header>

    ${message ? `<div class='notice success' role='status'>✓ ${escapeHtml(message)}</div>` : ''}
    <div id='form-notice' class='notice info' role='status' hidden></div>

    <section class='setup-strip'>
      <div class='setup-copy'><div class='setup-icon'>2</div><div><strong>Complete your storefront setup</strong><p>Add your brand details, then activate the theme embed once.</p></div></div>
      <div class='progress'><div class='progress-label'><span>Setup progress</span><strong id='setup-progress-copy'>Checking status...</strong></div><div class='progress-track'><div id='setup-progress' class='progress-fill'></div></div></div>
    </section>

    <div class='grid'>
      <section class='card'>
        <div class='card-head'><div><div class='title-row'><span class='step'>1</span><h2>Brand settings</h2></div><p>Used when generating promotional images for this store.</p></div><span class='badge active'>Connected</span></div>
        <form id='settings-form' method='post' action='/app/settings' enctype='multipart/form-data'>
          <div class='card-body'>
            <div class='logo-panel'>
              <div class='logo-frame'>${logo ? `<img class='logo' src='${escapeHtml(logo)}' alt='Current store logo'>` : `<div class='logo-placeholder'>No logo<br>uploaded</div>`}</div>
              <div class='logo-copy'><strong>${logo ? 'Current store logo' : 'Add your store logo'}</strong><p>PNG, JPG, or WebP. Maximum file size 5 MB.</p></div>
            </div>

            <div class='field'>
              <label for='logo'>Store logo</label>
              <div class='file-picker'><input class='file-input' id='logo' name='logo' type='file' accept='image/png,image/jpeg,image/webp'><label class='file-trigger' for='logo'>Choose image</label><span id='file-name' class='file-name'>No file selected</span></div>
              <p class='field-help'>Leave this empty to keep the existing logo.</p>
            </div>

            <div class='field'>
              <label for='publicDomain'>Public storefront domain</label>
              <input class='text-input' id='publicDomain' name='publicDomain' value='${domain}' placeholder='www.example.com' autocomplete='url'>
              <p class='field-help'>Use the hostname customers visit, without a page path.</p>
            </div>
          </div>
          <div class='card-footer'><button type='submit'>Save brand settings</button></div>
        </form>
      </section>

      <aside class='side-stack'>
        <section class='card'>
          <div class='card-head'><div><div class='title-row'><span class='step'>2</span><h2>Storefront preview</h2></div><p>Required once for each published theme.</p></div><span id='embed-status' class='badge neutral'>Checking...</span></div>
          <div class='card-body'>
            <div class='embed-summary'><h3>Social preview metadata</h3><p>Adds the generated image to Open Graph and X/Twitter preview tags.</p></div>
            <div class='check-list'><div class='check-item'><span class='check'>✓</span><span>The theme editor opens with the app embed selected.</span></div><div class='check-item'><span class='check'>✓</span><span>Review the preview and click <strong>Save</strong> in Shopify.</span></div></div>
            <a class='button full' href='${escapeHtml(activation)}' target='_blank' rel='noopener'>Open theme editor <span aria-hidden='true'>↗</span></a>
          </div>
        </section>

        <section class='card'>
          <div class='card-head'><div><h2>Generate your first preview</h2><p>After the theme embed is active.</p></div></div>
          <div class='card-body mini-steps'>
            <div class='mini-step'><span class='mini-num'>1</span><div><h3>Open a product</h3><p>Choose any product you want to promote.</p></div></div>
            <div class='mini-step'><span class='mini-num'>2</span><div><h3>Enable the promo image</h3><p>Set <code>Enable promo image</code> to true.</p></div></div>
            <div class='mini-step'><span class='mini-num'>3</span><div><h3>Save the product</h3><p>Your branded social image is generated automatically.</p></div></div>
          </div>
        </section>

        <section class='card'>
          <div class='card-head'><div><h2>Test on WhatsApp</h2><p>Works while the Shopify storefront is password-protected.</p></div></div>
          <div class='card-body'>
            <form id='preview-link-form' class='preview-form'>
              <div><label for='preview-product'>Product URL or handle</label><input class='text-input' id='preview-product' name='product' placeholder='the-multi-location-snowboard' required></div>
              <button type='submit'>Generate test link</button>
              <div id='preview-result' class='preview-result' hidden>
                <label for='preview-url'>WhatsApp test link</label>
                <input id='preview-url' class='text-input' readonly>
                <div class='preview-actions'><button id='copy-preview-link' class='secondary' type='button'>Copy link</button><a id='open-preview-link' class='button secondary' target='_blank' rel='noopener'>Open</a></div>
              </div>
            </form>
          </div>
        </section>
      </aside>
    </div>`;
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

router.get('/share-preview', renderSharePreview);

router.post('/app/share-preview-link', requireEmbeddedSession, express.json(), (req, res) => {
  const handle = normalizeProductHandle(req.body.product);
  if (!handle) return res.status(400).json({ error: 'Enter a valid product URL or product handle.' });
  const token = createSharePreviewToken(req.shopify.shopDomain, handle);
  return res.json({ url: createSharePreviewUrl(token), expiresInHours: 24 });
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
