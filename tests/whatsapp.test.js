'use strict';

const assert = require('assert');
const crypto = require('crypto');
const config = require('../src/config');
const {
  commandReply,
  getIncomingMessages,
  hasValidMetaSignature,
  normalizePhone,
  verifyWhatsAppWebhook,
} = require('../src/webhooks/whatsapp');

assert.strictEqual(normalizePhone('+92 300-1234567'), '923001234567');
assert.match(commandReply(' HELP '), /status/);
assert.match(commandReply('help'), /task <change you want>/);
assert.match(commandReply('status'), /online/);
assert.match(commandReply('anything else'), /Unknown command/);

const { taskInstruction } = require('../src/tasks/github');
assert.strictEqual(taskInstruction('task replace native selects'), 'replace native selects');
assert.strictEqual(taskInstruction('status'), null);

const payload = Buffer.from(JSON.stringify({ entry: [] }));
config.fbAppSecret = 'test-meta-secret';
const signature = `sha256=${crypto.createHmac('sha256', config.fbAppSecret).update(payload).digest('hex')}`;
assert.strictEqual(hasValidMetaSignature({ rawBody: payload, headers: { 'x-hub-signature-256': signature } }), true);
assert.strictEqual(hasValidMetaSignature({ rawBody: payload, headers: { 'x-hub-signature-256': 'sha256=invalid' } }), false);

const messages = getIncomingMessages({
  entry: [{ changes: [{ value: { messages: [{ from: '923001234567', type: 'text' }] } }] }],
});
assert.strictEqual(messages.length, 1);

config.whatsappVerifyToken = 'verify-me';
const response = {
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  send(body) { this.body = body; return this; },
  sendStatus(code) { this.statusCode = code; return this; },
};
verifyWhatsAppWebhook({ query: {
  'hub.mode': 'subscribe',
  'hub.verify_token': 'verify-me',
  'hub.challenge': 'challenge-value',
} }, response);
assert.strictEqual(response.statusCode, 200);
assert.strictEqual(response.body, 'challenge-value');

console.log('whatsapp webhook tests passed');
