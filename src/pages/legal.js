'use strict';

const CONTACT_EMAIL = 'mustufa50@gmail.com';
const LAST_UPDATED = 'August 15, 2026';

function page(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Shopify Image Bot</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #1d1e1e; background: #f5f7fb; }
    body { margin: 0; padding: 40px 20px; }
    main { max-width: 800px; margin: 0 auto; padding: 40px; background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(29,30,30,.08); }
    h1 { margin-top: 0; }
    h2 { margin-top: 30px; }
    p, li { line-height: 1.65; }
    a { color: #2457d6; }
    .updated { color: #62666d; }
    @media (max-width: 600px) { body { padding: 16px; } main { padding: 24px; } }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="updated">Last updated: ${LAST_UPDATED}</p>
    ${content}
  </main>
</body>
</html>`;
}

function privacyPolicy() {
  return page('Privacy Policy', `
    <p>Shopify Image Bot is a private automation service that receives authorized WhatsApp commands and processes Shopify product-image workflows.</p>
    <h2>Information we process</h2>
    <ul>
      <li>The WhatsApp phone number that sends a message to the bot.</li>
      <li>The message text and WhatsApp message metadata needed to process and reply to the command.</li>
      <li>Shopify product information required to generate and update product sharing images.</li>
      <li>Technical request and error logs maintained by our hosting and integration providers.</li>
    </ul>
    <h2>How we use information</h2>
    <p>We use this information only to authenticate authorized users, execute requested automation, send responses, maintain security, and diagnose errors. We do not sell personal information or use WhatsApp message content for advertising.</p>
    <h2>Sharing and service providers</h2>
    <p>Information may be processed by service providers required to operate the app, including Meta/WhatsApp, Shopify, Vercel, GitHub, and configured image-hosting services. Their handling of information is governed by their own policies and our service configuration.</p>
    <h2>Retention and security</h2>
    <p>The current bot does not intentionally maintain a separate permanent database of WhatsApp command content. Limited data may remain temporarily in provider logs, generated artifacts, or repository history where needed to complete an authorized task. Access is restricted through webhook signatures, private credentials, and an authorized-number allowlist.</p>
    <h2>Your choices</h2>
    <p>You may stop messaging the bot at any time or request deletion using our <a href="/data-deletion">Data Deletion Instructions</a>.</p>
    <h2>Contact</h2>
    <p>For privacy questions, email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  `);
}

function termsOfService() {
  return page('Terms of Service', `
    <p>By using Shopify Image Bot, you agree to these terms.</p>
    <h2>Authorized use</h2>
    <p>You may use the bot only for Shopify stores, repositories, accounts, and services that you own or are authorized to manage. You are responsible for reviewing requested changes before approving publication or deployment.</p>
    <h2>Service operation</h2>
    <p>The bot may rely on third-party services such as Meta/WhatsApp, Shopify, Vercel, GitHub, and image-hosting providers. Availability may be affected by those services, expired credentials, API limits, or account requirements.</p>
    <h2>Prohibited use</h2>
    <p>You must not use the service for unlawful activity, unauthorized access, harmful code, spam, credential theft, or infringement of another party's rights.</p>
    <h2>No warranty</h2>
    <p>The service is provided as available without guarantees of uninterrupted or error-free operation. Always verify generated images, code changes, and deployments before relying on them.</p>
    <h2>Changes and termination</h2>
    <p>We may update these terms or suspend access to protect the service, connected accounts, or users.</p>
    <h2>Contact</h2>
    <p>Questions may be sent to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  `);
}

function dataDeletionInstructions() {
  return page('Data Deletion Instructions', `
    <p>You can request deletion of information associated with your use of Shopify Image Bot.</p>
    <h2>How to request deletion</h2>
    <ol>
      <li>Email <a href="mailto:${CONTACT_EMAIL}?subject=Shopify%20Image%20Bot%20Data%20Deletion">${CONTACT_EMAIL}</a> with the subject <strong>Shopify Image Bot Data Deletion</strong>.</li>
      <li>Include the WhatsApp phone number used with the bot and enough information to identify the relevant activity.</li>
      <li>We may ask you to verify that you control the number or connected account.</li>
    </ol>
    <p>After verification, we will remove information under our control unless retention is required for security, legal compliance, fraud prevention, or records of completed repository changes. Data held independently by Meta, Shopify, Vercel, GitHub, or another provider must also be managed through that provider.</p>
    <p>We aim to respond to verified deletion requests within 30 days.</p>
  `);
}

module.exports = { privacyPolicy, termsOfService, dataDeletionInstructions };
