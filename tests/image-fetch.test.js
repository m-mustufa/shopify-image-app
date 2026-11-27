'use strict';

const assert = require('assert');
const http = require('http');
const { downloadImage, generateProductImage } = require('../src/image/generator');

// Local server: answers 429 a set number of times, then the image bytes.
function server(failures, status = 429) {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    calls += 1;
    if (calls <= failures) {
      res.writeHead(status);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(Buffer.from('fake-image'));
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${srv.address().port}/img.png`, calls: () => calls, close: () => srv.close() });
  }));
}

const noSleep = () => Promise.resolve();

function quiet(fn) {
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  return Promise.resolve().then(fn).finally(() => { console.warn = warn; console.log = log; });
}

(async () => {
  // A 429 followed by success is retried.
  const flaky = await server(2);
  await quiet(async () => {
    const buf = await downloadImage(flaky.url, { sleep: noSleep });
    assert.strictEqual(buf.toString(), 'fake-image');
  });
  assert.strictEqual(flaky.calls(), 3);
  flaky.close();

  // Gives up after the attempt limit.
  const down = await server(99);
  await quiet(async () => {
    await assert.rejects(() => downloadImage(down.url, { attempts: 3, sleep: noSleep }), /429/);
  });
  assert.strictEqual(down.calls(), 3);
  down.close();

  // A 404 is not retried.
  const missing = await server(99, 404);
  await quiet(async () => {
    await assert.rejects(() => downloadImage(missing.url, { sleep: noSleep }), /404/);
  });
  assert.strictEqual(missing.calls(), 1);
  missing.close();

  // No blank preview: a product whose image cannot be fetched fails instead.
  const gone = await server(99, 404);
  await quiet(async () => {
    await assert.rejects(
      () => generateProductImage({ id: 1, title: 'Test', price: '10', compare_at_price: '20', image_url: gone.url }),
      /product image fetch failed/
    );
  });
  gone.close();

  console.log('image fetch tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
