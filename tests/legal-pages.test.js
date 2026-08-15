'use strict';

const assert = require('assert');
const http = require('http');
const app = require('../src/index');

const paths = [
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service'],
  ['/data-deletion', 'Data Deletion Instructions'],
];

const server = http.createServer(app);
server.listen(0, '127.0.0.1', async () => {
  try {
    const { port } = server.address();
    for (const [path, heading] of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await response.text();
      assert.strictEqual(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.ok(body.includes(`<h1>${heading}</h1>`));
    }
    console.log('legal page tests passed');
  } finally {
    server.close();
  }
});
