'use strict';

require('dotenv').config({ path: '.env.bridge' });
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const token = process.env.GITHUB_TASK_TOKEN;
const repository = process.env.GITHUB_TASK_REPOSITORY;
const repoPath = path.resolve(process.env.BRIDGE_REPOSITORY_PATH || process.cwd());
const pollMs = Math.max(10, Number(process.env.BRIDGE_POLL_SECONDS) || 15) * 1000;
const taskLabel = 'whatsapp-codex-task';
const runningLabel = 'codex-running';
const completeLabel = 'codex-complete';
const failedLabel = 'codex-failed';

if (!token || !repository) {
  console.error('Missing GITHUB_TASK_TOKEN or GITHUB_TASK_REPOSITORY in .env.bridge');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'local-whatsapp-codex-worker',
};

async function github(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function ensureLabel(name, color, description) {
  try {
    await github('/labels', {
      method: 'POST',
      body: JSON.stringify({ name, color, description }),
    });
  } catch (error) {
    if (!error.message.startsWith('GitHub 422:')) throw error;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoPath,
      stdio: 'pipe',
      shell: options.shell === true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1000)}`)));
    if (options.input) child.stdin.end(options.input);
  });
}

function runGit(args) {
  return run('git', [`-c`, `safe.directory=${repoPath.replace(/\\/g, '/')}`, ...args]);
}

async function setLabels(issue, labels) {
  await github(`/issues/${issue}/labels`, { method: 'POST', body: JSON.stringify({ labels }) });
}

async function comment(issue, body) {
  await github(`/issues/${issue}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

async function nextTask() {
  const endpoint = `/issues?state=open&labels=${encodeURIComponent(taskLabel)}&sort=created&direction=asc&per_page=10`;
  const issues = await github(endpoint);
  return issues.find(issue => !issue.pull_request && !issue.labels.some(label => label.name === runningLabel));
}

function extractInstruction(body) {
  const match = String(body || '').match(/## Requested change\s+([\s\S]*?)\s+## Trusted source metadata/);
  return match ? match[1].trim() : '';
}

async function processTask(issue) {
  const instruction = extractInstruction(issue.body);
  if (!instruction) throw new Error('Task has no requested change');

  await setLabels(issue.number, [runningLabel]);
  await comment(issue.number, 'Local Codex worker claimed this task. No push, merge, or deployment is authorized.');

  const status = await runGit(['status', '--porcelain']);
  if (status.stdout.trim()) throw new Error('Local repository has uncommitted changes; refusing to overwrite them');

  await runGit(['switch', 'main']);
  const branch = `whatsapp/task-${issue.number}`;
  await runGit(['switch', '-c', branch]);

  const resultFile = path.join(os.tmpdir(), `codex-task-${issue.number}.txt`);
  const prompt = [
    'You are processing a trusted task received through the project WhatsApp bridge.',
    `Task: ${instruction}`, '',
    'Work only inside this repository. Preserve unrelated changes and existing behavior.',
    'Implement the requested change and run relevant tests.',
    'Do not push, merge, deploy, alter secrets, or send external messages.',
    'Finish with a concise summary and tests run.',
  ].join('\n');

  await run('codex', [
    'exec', '-C', repoPath, '--sandbox', 'workspace-write', '--approve-for-me',
    '--output-last-message', resultFile, '-'
  ], { input: prompt, shell: process.platform === 'win32' });

  const summary = fs.existsSync(resultFile)
    ? fs.readFileSync(resultFile, 'utf8').trim()
    : 'Codex completed the task.';
  await runGit(['add', '-A']);
  const staged = await runGit(['diff', '--cached', '--name-only']);
  if (!staged.stdout.trim()) throw new Error('Codex completed without making file changes');
  await runGit(['commit', '-m', `WhatsApp task #${issue.number}`]);

  await setLabels(issue.number, [completeLabel]);
  await comment(issue.number, `Completed locally on branch \`${branch}\`. Nothing was pushed or deployed.\n\n${summary.slice(0, 5000)}`);
  console.log(`Task #${issue.number} completed on ${branch}`);
}

async function poll() {
  try {
    const issue = await nextTask();
    if (issue) {
      try {
        await processTask(issue);
      } catch (error) {
        console.error(`Task #${issue.number} failed:`, error.message);
        await setLabels(issue.number, [failedLabel]);
        await comment(issue.number, `Local worker failed safely: ${error.message.slice(0, 1500)}`);
      }
    }
  } catch (error) {
    console.error('Worker poll failed:', error.message);
  } finally {
    setTimeout(poll, pollMs);
  }
}

async function start() {
  await ensureLabel(taskLabel, '1d76db', 'Trusted task received through WhatsApp');
  await ensureLabel(runningLabel, 'fbca04', 'Task is running on the local Codex worker');
  await ensureLabel(completeLabel, '0e8a16', 'Task completed locally');
  await ensureLabel(failedLabel, 'd73a4a', 'Task failed safely');
  console.log(`WhatsApp Codex worker watching ${repository} every ${pollMs / 1000}s`);
  poll();
}

start().catch(error => {
  console.error('Worker startup failed:', error.message);
  process.exit(1);
});
