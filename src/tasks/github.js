'use strict';

const config = require('../config');

const TASK_LABEL = 'whatsapp-codex-task';

async function ensureTaskLabel(headers) {
  const response = await fetch(`https://api.github.com/repos/${config.githubTaskRepository}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: TASK_LABEL, color: '1d76db', description: 'Trusted task received through WhatsApp' }),
  });
  if (!response.ok && response.status !== 422) {
    throw new Error(`GitHub label setup failed (${response.status}): ${await response.text()}`);
  }
}

function taskInstruction(text) {
  const match = String(text || '').trim().match(/^task\s+([\s\S]+)$/i);
  return match ? match[1].trim() : null;
}

async function createGitHubTask({ instruction, whatsappMessageId, from }) {
  if (!config.githubTaskToken || !config.githubTaskRepository) {
    throw new Error('GitHub task queue is not configured');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.githubTaskToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'shopify-image-whatsapp-bridge',
  };
  await ensureTaskLabel(headers);

  const response = await fetch(`https://api.github.com/repos/${config.githubTaskRepository}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `[WhatsApp task] ${instruction.slice(0, 72)}`,
      body: [
        '## Requested change', '', instruction, '',
        '## Trusted source metadata', '',
        `- WhatsApp sender: ${from}`,
        `- WhatsApp message ID: ${whatsappMessageId}`, '',
        '> Created automatically after Meta signature verification and sender allowlist validation.',
      ].join('\n'),
      labels: [TASK_LABEL],
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub task creation failed (${response.status}): ${await response.text()}`);
  }
  const issue = await response.json();
  return { number: issue.number, url: issue.html_url };
}

module.exports = { TASK_LABEL, createGitHubTask, taskInstruction };
