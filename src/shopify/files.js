'use strict';

const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const client   = require('./client');

const STAGE_UPLOAD_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE_MUTATION = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        fileStatus
        ... on MediaImage {
          id
          image {
            url
          }
          preview {
            image {
              url
            }
          }
        }
        ... on GenericFile {
          id
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_FILE_QUERY = `
  query getFile($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image {
          url
        }
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function uploadImageToShopify(filePath) {
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size.toString();
  const mimeType = 'image/jpeg';

  // ── Step 1: request a staged upload target ────────────────────────────────
  console.log('[files] step 1 — stagedUploadsCreate');
  const stageRes = await client.post('/graphql.json', {
    query: STAGE_UPLOAD_MUTATION,
    variables: {
      input: [{
        filename:   fileName,
        mimeType,
        fileSize,
        resource:   'IMAGE',
        httpMethod: 'POST',
      }],
    },
  });

  console.log('[files] stagedUploadsCreate response:', JSON.stringify(stageRes.data, null, 2));

  const stageData = stageRes.data?.data?.stagedUploadsCreate;
  if (stageData?.userErrors?.length) {
    throw new Error(`stagedUploadsCreate error: ${stageData.userErrors.map(e => e.message).join(', ')}`);
  }
  if (!stageData?.stagedTargets?.length) {
    throw new Error('stagedUploadsCreate returned no targets');
  }

  const target      = stageData.stagedTargets[0];
  const uploadUrl   = target.url;
  const params      = target.parameters;
  const resourceUrl = target.resourceUrl;

  // ── Step 2: POST file to staged URL (multipart) ───────────────────────────
  console.log(`[files] step 2 — uploading to staged URL: ${uploadUrl}`);
  const form = new FormData();
  params.forEach(p => form.append(p.name, p.value));
  form.append('file', fs.createReadStream(filePath), { filename: fileName, contentType: mimeType });

  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    timeout: 60_000,
  });
  console.log(`[files] staged upload HTTP status: ${uploadRes.status}`);

  // ── Step 3: register with fileCreate ─────────────────────────────────────
  console.log(`[files] step 3 — fileCreate (resourceUrl: ${resourceUrl})`);
  const fileRes = await client.post('/graphql.json', {
    query: FILE_CREATE_MUTATION,
    variables: {
      files: [{ originalSource: resourceUrl, contentType: 'IMAGE' }],
    },
  });

  console.log('[files] fileCreate response:', JSON.stringify(fileRes.data, null, 2));

  const fileData = fileRes.data?.data?.fileCreate;
  if (fileData?.userErrors?.length) {
    throw new Error(`fileCreate error: ${fileData.userErrors.map(e => e.message).join(', ')}`);
  }
  if (!fileData?.files?.length) {
    throw new Error('fileCreate returned no files');
  }

  const created   = fileData.files[0];
  const fileGid   = created?.id;
  const extractUrl = node =>
    node?.image?.url ?? node?.preview?.image?.url ?? node?.url ?? null;

  let url = extractUrl(created);
  if (url) return url;

  // ── Step 4: poll until Shopify finishes processing ────────────────────────
  console.log(`[files] step 4 — URL not yet available (status: ${created?.fileStatus}), polling...`);
  const MAX_POLLS = 10;
  for (let i = 1; i <= MAX_POLLS; i++) {
    await sleep(2000);
    const pollRes = await client.post('/graphql.json', {
      query: GET_FILE_QUERY,
      variables: { id: fileGid },
    });
    const node = pollRes.data?.data?.node;
    console.log(`[files] poll ${i}/${MAX_POLLS} — status: ${node?.fileStatus}`);
    url = extractUrl(node);
    if (url) {
      console.log(`[files] URL ready after ${i} poll(s): ${url}`);
      return url;
    }
  }

  // ── Fallback: construct CDN URL from shop domain + filename ───────────────
  const config  = require('../config');
  const cdnUrl  = `https://${config.shopifyShopDomain}/cdn/shop/files/${encodeURIComponent(fileName)}`;
  console.warn(`[files] URL still null after ${MAX_POLLS} polls — returning CDN fallback: ${cdnUrl}`);
  return cdnUrl;
}

async function uploadBufferToShopify(buffer, productId, ogVersion) {
  const versionSuffix = /^[a-f0-9]{12}$/.test(ogVersion ?? '') ? `-${ogVersion}` : '';
  const fileName = `promo-${productId}${versionSuffix}.jpg`;
  const fileSize = buffer.length.toString();
  const mimeType = 'image/jpeg';

  // Step 1: staged upload target
  console.log('[files] step 1 — stagedUploadsCreate');
  const stageRes = await client.post('/graphql.json', {
    query: STAGE_UPLOAD_MUTATION,
    variables: {
      input: [{
        filename:   fileName,
        mimeType,
        fileSize,
        resource:   'IMAGE',
        httpMethod: 'POST',
      }],
    },
  });

  const stageData = stageRes.data?.data?.stagedUploadsCreate;
  if (stageData?.userErrors?.length) {
    throw new Error(`stagedUploadsCreate error: ${stageData.userErrors.map(e => e.message).join(', ')}`);
  }
  if (!stageData?.stagedTargets?.length) {
    throw new Error('stagedUploadsCreate returned no targets');
  }

  const target      = stageData.stagedTargets[0];
  const uploadUrl   = target.url;
  const params      = target.parameters;
  const resourceUrl = target.resourceUrl;

  // Step 2: multipart POST to staged URL
  console.log(`[files] step 2 — uploading buffer to staged URL`);
  const form = new FormData();
  params.forEach(p => form.append(p.name, p.value));
  form.append('file', buffer, { filename: fileName, contentType: mimeType });

  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    timeout: 60_000,
  });
  console.log(`[files] staged upload HTTP status: ${uploadRes.status}`);

  // Step 3: fileCreate
  console.log(`[files] step 3 — fileCreate`);
  const fileRes = await client.post('/graphql.json', {
    query: FILE_CREATE_MUTATION,
    variables: {
      files: [{ originalSource: resourceUrl, contentType: 'IMAGE' }],
    },
  });

  console.log('[files] fileCreate raw response:', JSON.stringify(fileRes.data, null, 2));
  const fileData = fileRes.data?.data?.fileCreate;
  if (fileData?.userErrors?.length) {
    throw new Error(`fileCreate error: ${fileData.userErrors.map(e => e.message).join(', ')}`);
  }
  if (!fileData?.files?.length) {
    throw new Error('fileCreate returned no files');
  }

  const created  = fileData.files[0];
  const fileGid  = created?.id;
  const extractUrl = node =>
    node?.image?.url ?? node?.preview?.image?.url ?? node?.url ?? null;

  let url = extractUrl(created);
  if (url) return url;

  // Step 4: poll until ready
  console.log(`[files] step 4 — polling for URL (status: ${created?.fileStatus})`);
  for (let i = 1; i <= 10; i++) {
    await sleep(2000);
    const pollRes = await client.post('/graphql.json', {
      query: GET_FILE_QUERY,
      variables: { id: fileGid },
    });
    const node = pollRes.data?.data?.node;
    console.log(`[files] poll ${i}/10 — status: ${node?.fileStatus}`);
    url = extractUrl(node);
    if (url) {
      console.log(`[files] URL ready after ${i} poll(s): ${url}`);
      return url;
    }
  }

  const config = require('../config');
  const cdnUrl = `https://${config.shopifyShopDomain}/cdn/shop/files/${encodeURIComponent(fileName)}`;
  console.warn(`[files] URL still null after polling — returning CDN fallback: ${cdnUrl}`);
  return cdnUrl;
}

module.exports = { uploadImageToShopify, uploadBufferToShopify };
