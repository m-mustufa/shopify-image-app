require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: process.env.APP_URL || process.env.SHOPIFY_APP_URL || 'http://localhost:3000',
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
  shopifyScopes: (process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_files,write_files')
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean),
  shopifyWebhookSecret:  process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET,
  shopifyApiSecret:      process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET,
  shopifyApiKey:         process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID,
  shopifyShopDomain:     process.env.SHOPIFY_SHOP_DOMAIN,
  shopifyClientId:       process.env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret:   process.env.SHOPIFY_CLIENT_SECRET,
  databaseUrl:           process.env.DATABASE_URL || null,
  shopifyTokenEncryptionKey: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || null,
  fbAppId:               process.env.FB_APP_ID      || null,
  fbAppSecret:           process.env.FB_APP_SECRET  || null,
  whatsappVerifyToken:  process.env.WHATSAPP_VERIFY_TOKEN || null,
  whatsappAccessToken:  process.env.WHATSAPP_ACCESS_TOKEN || null,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  whatsappAllowedNumber: process.env.WHATSAPP_ALLOWED_NUMBER || null,
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v26.0',
  githubTaskToken: process.env.GITHUB_TASK_TOKEN || null,
  githubTaskRepository: process.env.GITHUB_TASK_REPOSITORY || null,
  storePublicDomain:     process.env.STORE_PUBLIC_DOMAIN || null,
testProductId: process.env.TEST_PRODUCT_ID || null,
  outputDir: process.env.VERCEL ? '/tmp' : (process.env.OUTPUT_DIR || './output'),
  logoPath:  process.env.LOGO_PATH  || './assets/logo.png',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey:    process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
};
