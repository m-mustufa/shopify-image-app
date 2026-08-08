# Shopify Social Image Automation

![Shopify Social Image Automation](docs/github-banner.png)

A Node.js webhook service that automatically generates promotional Open Graph images for Shopify products, uploads them to Shopify Files, and publishes cache-busted sharing metadata.

The application is designed for stores that frequently update product images, prices, offers, or custom deal content and need social previews—especially WhatsApp previews—to reflect the latest product state.

## Highlights

- Handles Shopify `products/create` and `products/update` webhooks.
- Verifies Shopify HMAC signatures against the raw request body.
- Generates 1200 × 628 promotional images with Sharp.
- Supports deal badges, sale prices, regular prices, and custom deal titles.
- Safely trims transparent or near-white product-image padding.
- Preserves images with photographic or designed backgrounds.
- Reserves a top-right area for the brand logo.
- Uploads each generated image to Shopify Files with a versioned filename.
- Stores image and sharing versions in Shopify product metafields.
- Prevents redundant processing and webhook loops.
- Supports cache-busted storefront and social-sharing URLs.
- Runs locally with Express and deploys as a Vercel function.

## How it works

```text
Shopify product change
        │
        ▼
Signed product webhook
        │
        ▼
Validate raw-body HMAC
        │
        ▼
Read product metafields and deal overrides
        │
        ├── Product content unchanged → stop
        │
        ▼
Generate and hash the final OG image
        │
        ├── Final image unchanged → skip upload
        │
        ▼
Upload versioned file to Shopify CDN
        │
        ▼
Update Shopify metafields in one GraphQL mutation
```

## Shopify metafields

The service reads deal configuration from the `custom` namespace:

| Metafield | Purpose |
| --- | --- |
| `custom.deal_enabled` | Enables or disables promotional generation. |
| `custom.deal_badge_text` | Overrides the badge text; `hide` removes it. |
| `custom.deal_sale_price` | Overrides the displayed sale price. |
| `custom.deal_reg_price` | Overrides the displayed regular price. |
| `custom.deal_title` | Adds custom promotional copy. |

It manages these output metafields:

| Metafield | Type | Purpose |
| --- | --- | --- |
| `custom.og_image` | Single line text | Shopify CDN URL of the generated image. |
| `custom.og_version` | Single line text | First 12 characters of the final image SHA-256 hash. |
| `custom.share_version` | Single line text | Stable hash of customer-visible product content and custom metafields. |
| `custom.og_image_input_hash` | Single line text | Internal idempotency guard for image inputs. |

Create definitions for `custom.og_version` and `custom.share_version` under **Shopify Admin → Settings → Custom data → Products**.

## Cache busting

WhatsApp and other platforms may cache previews by exact URL. The app gives every changed product state a stable sharing version:

```text
https://example.com/products/example?pv=63f70872bede
```

The canonical URL remains unchanged:

```liquid
<link rel="canonical" href="{{ canonical_url }}">
```

The Shopify theme must read `custom.share_version` when constructing `og:url` and shared URLs. It can also update the visible product URL with `history.replaceState()` so a copied browser URL contains the current `pv` value.

## Product-image handling

Uploaded product images are normalized conservatively:

- Transparent or overwhelmingly white outer padding is trimmed.
- Visual and photographic backgrounds are preserved.
- The product is resized to 90% of the available safe region.
- The product is shifted 10% left from the original right-panel center.
- The upper 80% of the logo zone is reserved; at most the lower 20% can intersect the image region.

This keeps products visually consistent without blindly removing designed backgrounds.

## Requirements

- Node.js 18 or newer
- A Shopify app with product, metafield, and file access
- A Shopify webhook secret
- Vercel for the included serverless deployment configuration

Required Shopify scopes:

```text
read_products
write_products
read_metafields
write_metafields
write_files
```

## Local setup

Install dependencies:

```bash
npm install
```

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

Configure `.env`:

```dotenv
PORT=3000
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your_client_id
SHOPIFY_CLIENT_SECRET=your_client_secret
STORE_PUBLIC_DOMAIN=www.example.com
```

Never commit `.env` or Shopify credentials.

Start the local server:

```bash
npm run dev
```

Health check:

```text
GET http://localhost:3000/health
```

## Webhook endpoints

```text
POST /webhooks/products/create
POST /webhooks/products/update
```

Webhook requests must include a valid `X-Shopify-Hmac-Sha256` header.

## Testing

Run the automated cache-busting and image-normalization tests:

```bash
npm test
```

Generate local sample images:

```bash
npm run test:generate
```

Generated previews are written to `output/`, which is intentionally excluded from Git.

## Deployment

The repository includes a Vercel function entry point and routing configuration.

Deploy a production build:

```bash
vercel --prod
```

After deployment, confirm:

```text
GET https://your-project.vercel.app/health
```

Then change an image-affecting product field and verify that Shopify receives new values for `custom.og_image` and `custom.og_version`.

## Project structure

```text
api/                    Vercel function entry point
assets/                 Brand and local test assets
scripts/                Webhook registration and image test utilities
src/
  image/generator.js    Sharp image-generation pipeline
  shopify/              Shopify API, file, and metafield clients
  webhooks/             HMAC verification and product processing
  index.js              Express application and webhook routes
tests/                  Focused automated tests
vercel.json             Vercel function and routing configuration
```

## Operational notes

- Previously shared URLs may continue showing their original cached previews.
- A new versioned URL allows social platforms to fetch the latest metadata.
- Existing products regenerate after an image-affecting product change triggers the webhook.
- `X-Shopify-Webhook-Id` deduplication requires persistent storage such as Redis or Vercel KV; in-memory deduplication is unreliable in serverless environments.

## License

This repository is currently private and does not include an open-source license.
