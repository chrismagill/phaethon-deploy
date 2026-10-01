'use strict';
const fs = require('fs');
const path = require('path');
const { start, terminal, sleep } = require('./lib');
const { freshTotp } = require('./totp');

const { WORK, OUT } = require('./paths');
const HOME = path.join(WORK, 'home-ord');
const STATE = JSON.parse(fs.readFileSync(path.join(OUT, 'ord-state.json'), 'utf8'));
const BASE = 'http://localhost:8088';

async function evaluate(body) {
  const r = await fetch(BASE + '/v1/evaluate', { method: 'POST', headers: { 'X-Api-Key': 'ordinance-trial-key', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

const curl = (json) => `curl -s -X POST http://localhost:8088/v1/evaluate \\\n  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \\\n  -d '${json}'; echo`;

(async () => {
  const term = await terminal({ port: 4702, home: HOME, extraEnv: { KEY: 'ordinance-trial-key' }, title: 'Terminal — bash', prompt: '~/Downloads/ordinance-trial $ ' });
  await fetch(term.url.split('?')[0] + 'run', { method: 'POST', body: JSON.stringify({ cmd: 'cd ~/Downloads/ordinance-trial' }) }).then((r) => r.text());
  const r = await start('ord-overview');
  const { page } = r;
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.T[f](...args), [fn, a]);

  await page.goto(term.url);
  await r.card('Ordinance', 'Using Ordinance', 'Your systems and AI agents ask Ordinance <i>before</i> they act. It answers <b>ALLOW</b>, <b>DENY</b> or <b>ESCALATE</b>, with the governing control attached.',
    'Ordinance 3.3.0 · evaluation mode · captions only, no audio', 5500);
  await r.uncard();

  const step = 'Part 1 · Ask for a decision';
  await r.cap('Callers send the action they\'re about to take, plus its context, to <code>POST /v1/evaluate</code>. They authenticate with the API key.', { step, wait: false });
  await sleep(2500);
  await T('run', 'KEY=ordinance-trial-key', { hold: 200 });

  await r.cap('An AI model call whose prompt is classified and PII-redacted…', { step, wait: false });
  await T('run', curl('{"action":"ai.model_invoke","subject":{"id":"svc-1"},"context":{"prompt_classified":true,"pii_redacted":true,"model_family":"reviewed"}}'), { speed: 12 });
  await r.cap('…is <b>allowed</b>, and the response cites the controls that applied.', { step, hold: 4200 });

  await T('clear');
  await r.cap('Exporting CUI to a destination that isn\'t approved…', { step, wait: false });
  await T('run', curl('{"action":"data.export_cui","subject":{"id":"u-9"},"context":{"destination_approved":false,"dlp_scan_passed":true}}'), { speed: 12 });
  await r.cap('…is <b>denied</b>, with the reason. Your code enforces the answer before anything happens.', { step, hold: 4500 });

  await T('clear');
  await r.cap('Creating a privileged account without the required facts…', { step, wait: false });
  await T('run', curl('{"action":"account.create_privileged","subject":{"id":"u-9"},"context":{}}'), { speed: 12 });
  await r.cap('…is <b>escalated</b>. The response includes an <code>approval_id</code> and the request waits for a person to decide.', { step, hold: 5000 });

  // A few more decisions from the same API so the console has something to show.
  for (const b of [
    { action: 'account.create_privileged', subject: { id: 'u-12' }, context: { target_role: 'domain_admin' } },
    { action: 'data.export_cui', subject: { id: 'u-31' }, context: { destination_classification: 'restricted' } },
    { action: 'ai.model_invoke', subject: { id: 'agent-7' }, context: { prompt_classified: true, pii_redacted: true, model_family: 'reviewed' } },
    { action: 'data.export_cui', subject: { id: 'u-4' }, context: { destination_approved: false, dlp_scan_passed: false } },
    { action: 'ai.model_invoke', subject: { id: 'agent-2' }, context: { prompt_classified: true, pii_redacted: true, model_family: 'reviewed' } },
  ]) await evaluate(b);
  await r.cap('(Five more requests were sent the same way off-screen, so the console has some history to show.)', { step, hold: 3800 });

  // Console
  await page.goto(BASE + '/');
  const inputs = page.locator('form input');
  await inputs.first().waitFor();
  await r.cap('Operators work in the console. Sign in with your password and authenticator code.', { step: 'Part 2 · The console', wait: false });
  await r.type(inputs.nth(0), STATE.user);
  await r.type(inputs.nth(1), STATE.pass, 35);
  await r.click(page.getByRole('button', { name: 'Continue' }), { pause: 800 });
  await page.getByPlaceholder('000000').waitFor();
  await r.type(page.getByPlaceholder('000000'), await freshTotp(STATE.secret), 120);
  await r.click(page.getByRole('button', { name: 'Verify' }), { pause: 300 });
  await page.getByRole('button', { name: 'Approvals' }).waitFor();
  await sleep(1200);
  await r.cap('<b>Overview</b> tallies every decision recorded so far, and how many escalations are waiting.', { step: 'Overview' });

  // Approvals
  await r.click(page.getByRole('button', { name: /^Approvals/ }), { pause: 1200 });
  await r.cap('<b>Approvals</b> is the human gate. Each escalation shows the action, its context, the controls involved, and why it was escalated.', { step: 'Approvals' });
  const approver = page.getByPlaceholder('you@org.example');
  await r.cap('Record who decided and why, then approve or reject.', { step: 'Approvals', wait: false });
  await r.type(approver.first(), 'security-lead@demo.example', 35);
  await r.type(page.getByPlaceholder('e.g. confirmed via ticket #4821').first(), 'Confirmed via ticket #4821', 35);
  await r.click(page.getByRole('button', { name: 'Approve' }).first(), { pause: 2200 });
  await r.type(approver.first(), 'security-lead@demo.example', 30);
  await r.type(page.getByPlaceholder('e.g. confirmed via ticket #4821').first(), 'Insufficient justification', 35);
  await r.click(page.getByRole('button', { name: 'Reject' }).first(), { pause: 2000 });
  await r.click(page.getByRole('button', { name: 'All', exact: true }), { pause: 1500 });
  await r.cap('Every decision keeps its approver and rationale on record.', { step: 'Approvals' });

  // Audit log
  await r.click(page.getByRole('button', { name: 'Audit Log' }), { pause: 1500 });
  await r.cap('The <b>Audit Log</b> records every evaluation and approval, with its decision, controls, and reason.', { step: 'Audit Log' });
  await r.click(page.getByRole('button', { name: 'deny', exact: true }), { pause: 1500 });
  await r.cap('Filter by decision, for example just the denials…', { step: 'Audit Log', hold: 2800 });
  await r.click(page.getByRole('button', { name: 'All', exact: true }), { pause: 1000 });
  await r.cap('…and export audit evidence in one click: the decision-log CSV, a control-coverage matrix, or everything as a zip.', { step: 'Audit Log', wait: false });
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await r.click(page.getByRole('button', { name: 'Matrix' }), { pause: 300 });
  await dl; await sleep(3500);

  // Policies
  await r.click(page.getByRole('button', { name: 'Policies' }), { pause: 1500 });
  await r.cap('<b>Policies</b> lists the loaded policy bundles. The trial ships with a reference bundle, and you can mount your own YAML.', { step: 'Policies' });
  await r.cap('Ask what an action would require before you build against it.', { step: 'Policies', wait: false });
  await r.type(page.getByPlaceholder('e.g. account.create_privileged'), 'account.create_privileged', 45);
  await r.click(page.getByRole('button', { name: 'Look up' }), { pause: 1200 });
  await r.cap('The matching rule shows its control, the facts it requires, and what triggers an escalation.', { step: 'Policies', hold: 4500 });
  await r.hideCap();

  await r.card('Ordinance', 'Decide before you act', 'Allow, deny, or escalate, with a human approval gate and audit evidence for every decision.',
    'Phaethon Security · info@phaethonsecurity.com', 4500);
  term.stop();
  console.log('wrote', await r.finish('Ordinance-2-Overview'));
})().catch((e) => { console.error(e); process.exit(1); });
