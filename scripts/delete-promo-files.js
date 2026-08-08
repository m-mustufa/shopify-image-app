'use strict';

/**
 * Deletes all promo-* files from Shopify Files.
 * Usage: node scripts/delete-promo-files.js
 */

require('dotenv').config();
const client = require('../src/shopify/client');

const LIST_QUERY = `
  query listFiles($cursor: String) {
    files(first: 250, after: $cursor, query: "filename:promo-") {
      edges {
        cursor
        node {
          id
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

const DELETE_MUTATION = `
  mutation fileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message }
    }
  }
`;

async function fetchAllIds() {
  const ids = [];
  let cursor = null;

  while (true) {
    const res = await client.post('/graphql.json', {
      query: LIST_QUERY,
      variables: { cursor },
    });

    const files = res.data?.data?.files;
    if (!files) {
      console.error('Unexpected response:', JSON.stringify(res.data, null, 2));
      break;
    }

    for (const edge of files.edges) {
      ids.push(edge.node.id);
      cursor = edge.cursor;
    }

    console.log(`  fetched ${ids.length} so far...`);

    if (!files.pageInfo.hasNextPage) break;
  }

  return ids;
}

async function deleteInBatches(ids, batchSize = 50) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const res = await client.post('/graphql.json', {
      query: DELETE_MUTATION,
      variables: { fileIds: batch },
    });

    const data = res.data?.data?.fileDelete;
    if (data?.userErrors?.length) {
      console.warn('  errors:', data.userErrors.map(e => e.message).join(', '));
    }

    deleted += data?.deletedFileIds?.length ?? 0;
    console.log(`  deleted ${deleted}/${ids.length}`);
  }
  return deleted;
}

async function run() {
  console.log('Fetching all promo-* files...');
  const ids = await fetchAllIds();
  console.log(`Found ${ids.length} files.`);

  if (ids.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  console.log('Deleting...');
  const total = await deleteInBatches(ids);
  console.log(`Done — ${total} files deleted.`);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
