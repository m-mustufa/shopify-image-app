# Shopify Social Image Automation

A multi-store Shopify app that generates 1200 x 628 promotional Open Graph images when products change. Images are uploaded to each merchant's own Shopify Files and written back to product metafields.

This repository also contains a WhatsApp-to-Codex bridge. That bridge is independent from merchant Shopify installations.

## Merchant experience

After the app is distributed, a merchant only needs to:

1. Install the app and approve its Shopify scopes.
2. Upload their logo and confirm their public storefront domain.
3. Open the provided theme-editor link, enable the Social preview metadata app embed, and save the theme.
4. Set Enable promo image on a product and save it.

The app handles OAuth, offline-token storage, product webhooks, metafield definitions, image upload, and version metadata. Merchants don't create webhooks or metafield definitions manually.

## Processing flow

```text
Shopify app installation
        |
        +-- OAuth callback validates state and HMAC
        +-- Offline token is encrypted and stored per shop
        +-- Product metafield definitions are created
        +-- Merchant uploads a logo to their own Shopify Files

Signed products/create or products/update webhook
        |
        +-- Resolve the sending shop and its token
        +-- Read deal overrides and stored versions
        +-- Skip unchanged input
        +-- Generate the promotional image
        +-- Upload a versioned file to Shopify Files
        +-- Write OG image and sharing versions in one mutation
```

Facebook's scraper API is not called. Cache invalidation uses the stable `pv` sharing version in the storefront URL.

## Shopify configuration

The checked-in [shopify.app.toml](shopify.app.toml) declares:

- `read_products`
- `write_products`
- `read_files`
- `write_files`
- `products/create` and `products/update` webhooks
- `app/uninstalled` cleanup
- mandatory customer/shop privacy webhooks
- the theme app extension under `extensions/social-preview`

The OAuth callback is `/auth/callback`. Shopify's CLI applies app-specific webhook subscriptions consistently to installed shops when a version is deployed.

The app creates these merchant-owned product metafield definitions during installation:

| Metafield | Type | Purpose |
| --- | --- | --- |
| `custom.deal_enabled` | Boolean | Enables generation for the product. |
| `custom.deal_badge_text` | Single line text | Badge override; `hide` removes it. |
| `custom.deal_sale_price` | Single line text | Sale-price override; `hide` removes prices. |
| `custom.deal_reg_price` | Single line text | Regular-price override. |
| `custom.deal_title` | Single line text | Promotional headline. |
| `custom.og_image` | Single line text | Generated Shopify CDN URL. |
| `custom.og_version` | Single line text | Generated-image hash. |
| `custom.share_version` | Single line text | Customer-visible sharing-state hash. |
| `custom.og_image_input_hash` | Single line text | Image-input idempotency hash. |

The `custom` namespace is retained for compatibility with stores already using the prototype.

## Environment variables

Copy `.env.example` to `.env` for local development.

Required for installable mode:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public HTTPS base URL of the app. Use the current tunnel URL during local Shopify testing. |
| `SHOPIFY_API_KEY` | Shopify app client ID. |
| `SHOPIFY_API_SECRET` | Shopify app client secret and webhook HMAC secret. |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | Separate random secret used to encrypt offline tokens at rest. |
| `DATABASE_URL` | PostgreSQL connection string. Required on Vercel; local development can omit it. |
| `SHOPIFY_API_VERSION` | Defaults to `2026-07`. |
| `SHOPIFY_SCOPES` | Defaults to the four scopes declared above. |

Generate the encryption secret locally with Node:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Local development without `DATABASE_URL` stores encrypted installation records in `.data/shop-installations.json`. That folder is ignored by Git. Vercel refuses installable mode without PostgreSQL because its filesystem is ephemeral.

The previous `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_WEBHOOK_SECRET` variables remain as a temporary single-store compatibility path. New installations do not use them.

`FB_APP_SECRET` remains in use by the separate WhatsApp webhook signature check. It is no longer used for Shopify/OG cache scraping.

## Local validation

Install dependencies and run the full test suite:

```powershell
npm install
npm test
```

Generate local image fixtures:

```powershell
npm run test:generate
```

Validate the Shopify app configuration and theme extension without deploying:

```powershell
npx --yes @shopify/cli@latest app build
```

Start the app:

```powershell
npm start
```

Then check `http://localhost:3000/health` and the onboarding screen at `http://localhost:3000/`.

## Pre-live test sequence

Keep this work on a feature branch until all checks pass:

1. Run `npm test` and the Shopify CLI build.
2. Create a preview deployment with a preview PostgreSQL database.
3. Link a Shopify development app configuration to the preview URL.
4. Install it on a development store.
5. Upload a test logo from the app dashboard.
6. Activate the theme app embed and save the theme.
7. Enable a product, save it, and confirm the generated Shopify File and four output metafields.
8. Inspect the product page source for the generated `og:image` and versioned `og:url`.
9. Test the exact `?pv=` URL with an external crawler. A password-protected development storefront cannot complete this final crawler check.

Do not deploy the Shopify app version or merge the feature branch until this sequence is approved.

## Production notes

- Arbitrary unrelated merchants require public distribution and Shopify App Review. Custom distribution is limited to one store or stores in the same eligible organization.
- Theme app embeds are disabled by default after installation; the merchant must confirm activation and save once.
- Some themes already render their own OG tags. Duplicate-tag behavior must be tested on target themes before release.
- `X-Shopify-Webhook-Id` persistence is still recommended for strict duplicate-delivery tracking. The current content hashes make repeated product deliveries idempotent, but a dedicated webhook-delivery table is the stronger production design.
- Never commit `.env`, `.env.bridge`, PostgreSQL credentials, access tokens, or Shopify secrets.

## Project structure

```text
api/                         Vercel function entry point
assets/                      Legacy default logo and test assets
extensions/social-preview/   Theme app embed and pv URL script
scripts/                     Bridge, Shopify, and image test utilities
src/image/                   Sharp image generator
src/pages/                   Legal and merchant onboarding pages
src/shopify/                 OAuth, encrypted installations, API clients, files, metafields
src/webhooks/                Shopify product and WhatsApp webhook handlers
tests/                       Regression and installable-app security checks
```

## License

This repository is private and does not include an open-source license.
