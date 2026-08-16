const crypto = require('crypto');
const config = require('../config');
const { createGitHubTask, taskInstruction } = require('../tasks/github');

function verifyWhatsAppWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!config.whatsappVerifyToken) {
    return res.status(500).send('WHATSAPP_VERIFY_TOKEN is not configured');
  }
  if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

function hasValidMetaSignature(req) {
  if (!config.fbAppSecret || !req.rawBody) return false;
  const received = req.headers['x-hub-signature-256'];
  if (!received || !received.startsWith('sha256=')) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', config.fbAppSecret)
    .update(req.rawBody)
    .digest('hex')}`;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function getIncomingMessages(body) {
  return (body.entry || []).flatMap(entry =>
    (entry.changes || []).flatMap(change => change.value?.messages || [])
  );
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function commandReply(text) {
  const command = text.trim().toLowerCase();
  if (command === 'help') {
    return 'Available commands:\n- help\n- status\n- task <change you want>';
  }
  if (command === 'status') {
    return 'Shopify Image Bot is online and ready.';
  }
  return 'Unknown command. Send "help" to see available commands.';
}

async function handleCommand(message, from) {
  const text = message.text?.body || '';
  const instruction = taskInstruction(text);
  if (!instruction) return commandReply(text);
  if (instruction.length < 10) return 'Please describe the task in at least 10 characters.';
  if (instruction.length > 3000) return 'Task is too long. Keep it under 3,000 characters.';

  const task = await createGitHubTask({
    instruction,
    whatsappMessageId: message.id || 'unknown',
    from,
  });
  return `Task #${task.number} queued securely. Your local Codex worker will process it when your PC is online.`;
}

async function sendWhatsAppText(to, body) {
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
    throw new Error('WhatsApp sending credentials are not configured');
  }
  const response = await fetch(
    `https://graph.facebook.com/${config.whatsappGraphVersion}/${config.whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`WhatsApp send failed (${response.status}): ${await response.text()}`);
  }
}

async function handleWhatsAppWebhook(req) {
  if (!hasValidMetaSignature(req)) {
    console.warn('[whatsapp] rejected invalid Meta signature');
    return;
  }

  const allowed = normalizePhone(config.whatsappAllowedNumber);
  if (!allowed) {
    console.warn('[whatsapp] ignored message because WHATSAPP_ALLOWED_NUMBER is not configured');
    return;
  }

  for (const message of getIncomingMessages(req.body)) {
    const from = normalizePhone(message.from);
    if (from !== allowed || message.type !== 'text') {
      console.warn(`[whatsapp] ignored message from unauthorized number: ${from || 'unknown'}`);
      continue;
    }
    await sendWhatsAppText(from, await handleCommand(message, from));
  }
}

module.exports = {
  commandReply,
  getIncomingMessages,
  hasValidMetaSignature,
  handleCommand,
  handleWhatsAppWebhook,
  normalizePhone,
  sendWhatsAppText,
  verifyWhatsAppWebhook,
};
