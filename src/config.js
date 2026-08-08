require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  shopifyWebhookSecret:  process.env.SHOPIFY_WEBHOOK_SECRET,
  shopifyShopDomain:     process.env.SHOPIFY_SHOP_DOMAIN,
  shopifyClientId:       process.env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret:   process.env.SHOPIFY_CLIENT_SECRET,
  fbAppId:               process.env.FB_APP_ID      || null,
  fbAppSecret:           process.env.FB_APP_SECRET  || null,
  storePublicDomain:     process.env.STORE_PUBLIC_DOMAIN || null,
testProductId: process.env.TEST_PRODUCT_ID || null,
  outputDir: process.env.VERCEL ? '/tmp' : (process.env.OUTPUT_DIR || './output'),
  logoPath:  process.env.LOGO_PATH  || './assets/logo.png',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey:    process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
};
