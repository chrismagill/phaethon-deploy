'use strict';
const fs = require('fs');
const path = require('path');
const { start, terminal, sleep } = require('./lib');
const { freshTotp } = require('./totp');

const { WORK, OUT } = require('./paths');
const HOME = path.join(WORK, 'home-ord');
const STATE = JSON.parse(fs.readFileSync(path.join(OUT, 'ord-state.json'), 'utf8'));
const BASE = 'http://localhost:8088';
const VERSION = '4.0.0';

async function evaluate(body) {
  const r = await fetch(BASE + '/v1/evaluate', { method: 'POST', headers: { 'X-Api-Key': STATE.apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

const curl = (json) => `curl -s -X POST http://localhost:8088/v1/evaluate \\\n  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \\\n  -d '${json}'; echo`;
const ESCALATED = '{"action":"account.create_privileged","subject":{"id":"bob@acme.example"},"context":{}';

(async () => {
  // Each command runs in its own shell, so $KEY is supplied to all of them here; the
  // on-screen `KEY=$(grep …)` line is what a customer types once in their own terminal.
  const term = await terminal({ port: 4702, home: HOME, extraEnv: { KEY: STATE.apiKey }, title: 'Terminal — bash', prompt: '~/Downloads/ordinance-trial $ ' });
  await fetch(term.url.split('?')[0] + 'run', { method: 'POST', body: JSON.stringify({ cmd: 'cd ~/Downloads/ordinance-trial' }) }).then((r) => r.text());
  const r = await start('ord-overview');
  const { page } = r;
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.T[f](...args), [fn, a]);
  const lastOutput = () => page.evaluate(() => window.__lastOutput || '');

  // Some history first (off-screen), so the escalation raised on screen is the newest one.
  // Skipped when a previous take already seeded this instance (the ledger is append-only).
  const seeded = (await (await fetch(BASE + '/v1/approvals', { headers: { 'X-Api-Key': STATE.apiKey } })).json()).approvals.length > 0;
  for (const b of seeded ? [] : [
    { action: 'account.create_privileged', subject: { id: 'dana@acme.example' }, context: { mfa_verified: true, change_ticket_approved: true, target_role: 'domain_admin' } },
    { action: 'data.export_cui', subject: { id: 'lee@acme.example' }, context: { destination_approved: true, dlp_scan_passed: true, destination_classification: 'restricted' } },
    { action: 'ai.model_invoke', subject: { id: 'priya@acme.example' }, context: { prompt_classified: true, pii_redacted: true, model_family: 'reviewed' } },
    { action: 'data.export_cui', subject: { id: 'sam@acme.example' }, context: { destination_approved: false, dlp_scan_passed: false } },
    { action: 'ai.model_invoke', subject: { id: 'lee@acme.example' }, context: { prompt_classified: true, pii_redacted: true, model_family: 'reviewed' } },
  ]) await evaluate(b);

  await page.goto(term.url);
  await r.card('Ordinance', 'Using Ordinance', 'Your systems and AI agents ask Ordinance <i>before</i> they act. It answers <b>ALLOW</b>, <b>DENY</b> or <b>ESCALATE</b>, and records who asked and which policy decided.',
    `Ordinance ${VERSION} · evaluation mode · captions only, no audio`, 5500);
  await r.uncard();

  // ── Part 1: decisions ──────────────────────────────────────────────────────
  let step = 'Part 1 · Ask for a decision';
  await r.cap('Callers send the action they\'re about to take, <b>who is asking</b>, and the facts, to <code>POST /v1/evaluate</code>. They authenticate with their API key.', { step, wait: false });
  await sleep(3000);
  await T('run', "KEY=$(grep '^ORDINANCE_API_KEY=' .env | cut -d= -f2)", { hold: 200 });

  await r.cap('An AI model call whose prompt is classified and PII-redacted…', { step, wait: false });
  await T('run', curl('{"action":"ai.model_invoke","subject":{"id":"jane@acme.example"},"context":{"prompt_classified":true,"pii_redacted":true,"model_family":"reviewed"}}'), { speed: 12 });
  await r.cap('…is <b>allowed</b>. The response names the rule that decided, the exact policy file by its hash, and the controls that applied.', { step, hold: 5200 });

  await T('clear');
  await r.cap('Exporting CUI to a destination that isn\'t approved…', { step, wait: false });
  await T('run', curl('{"action":"data.export_cui","subject":{"id":"jane@acme.example"},"context":{"destination_approved":false,"dlp_scan_passed":true}}'), { speed: 12 });
  await r.cap('…is <b>denied</b>, with the reason. Your code enforces the answer before anything happens.', { step, hold: 4500 });

  await T('clear');
  await r.cap('A request that doesn\'t say who is asking…', { step, wait: false });
  await T('run', curl('{"action":"data.export_cui","context":{"destination_approved":true,"dlp_scan_passed":true}}'), { speed: 12 });
  await r.cap('…is <b>refused</b> and nothing is recorded. Every decision has to be traceable to a requester.', { step, hold: 4500 });

  await T('clear');
  await r.cap('Creating a privileged account without the required facts…', { step, wait: false });
  await T('run', curl(ESCALATED + '}'), { speed: 12 });
  const approvalId = ((await lastOutput()).match(/"approval_id":"([0-9a-f-]{36})"/) || [])[1];
  if (!approvalId) throw new Error('no approval_id in the escalation response');
  await r.cap('…is <b>escalated</b>. The response includes an <code>approval_id</code> and the request waits for a person to decide.', { step, hold: 5000 });

  // ── Part 2: console, approvals ─────────────────────────────────────────────
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

  await r.click(page.getByRole('button', { name: /^Approvals/ }), { pause: 1200 });
  await r.cap('<b>Approvals</b> is the human gate. Each escalation shows who requested it, which system raised it, the controls involved, and why it was escalated.', { step: 'Approvals' });
  await r.cap('Give a reason, then approve or reject. The decision is recorded under <b>your signed-in account</b>. The approver can\'t be typed in, and the system that raised a request can never approve it.', { step: 'Approvals', wait: false });
  await sleep(1500);
  await r.type(page.getByPlaceholder('e.g. confirmed via ticket #4821').first(), 'Confirmed via ticket #4821', 35);
  await r.click(page.getByRole('button', { name: 'Approve' }).first(), { pause: 2600 });
  await r.type(page.getByPlaceholder('e.g. confirmed via ticket #4821').first(), 'Insufficient justification', 35);
  await r.click(page.getByRole('button', { name: 'Reject' }).first(), { pause: 2200 });
  await r.click(page.getByRole('button', { name: 'All', exact: true }), { pause: 1500 });
  await r.cap('Every decision keeps its approver and rationale on record.', { step: 'Approvals' });

  // ── Part 3: resume on the approval ─────────────────────────────────────────
  step = 'Part 3 · Proceed on the approval';
  await page.goto(term.url);
  await T('setPrompt', '~/Downloads/ordinance-trial $ ');
  await T('clear');
  await r.cap('Back in the calling system: the request was approved, so it sends the <b>same request again</b> with its <code>approval_id</code>.', { step, wait: false });
  await sleep(2200);
  await T('run', "KEY=$(grep '^ORDINANCE_API_KEY=' .env | cut -d= -f2)", { hold: 200 });
  await T('run', curl(`${ESCALATED},"approval_id":"${approvalId}"}`), { speed: 10 });
  await r.cap('Now it is <b>allowed</b>, and the record names the person who approved it.', { step, hold: 4800 });
  await T('clear');
  await r.cap('An approval covers that one request, once. Send it again…', { step, wait: false });
  await T('run', curl(`${ESCALATED},"approval_id":"${approvalId}"}`), { speed: 6 });
  await r.cap('…and it is refused. An approval is never a standing permission, and it never overrides a denial.', { step, hold: 4800 });

  // ── Part 4: evidence ───────────────────────────────────────────────────────
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Audit Log' }).waitFor();
  await r.click(page.getByRole('button', { name: 'Audit Log' }), { pause: 1500 });
  await r.cap('The <b>Audit Log</b> records every decision: who requested it, the rule that decided, the controls, and the reason. Sign-ins and exports are recorded too.', { step: 'Audit Log' });
  await r.click(page.getByRole('button', { name: 'deny', exact: true }), { pause: 1500 });
  await r.cap('Filter by decision, for example just the denials…', { step: 'Audit Log', hold: 2800 });
  await r.click(page.getByRole('button', { name: 'All', exact: true }), { pause: 1000 });
  await r.cap('…and export audit evidence in one click: the decision-log CSV, a control-coverage matrix, or everything as a zip.', { step: 'Audit Log', wait: false });
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await r.click(page.getByRole('button', { name: 'Matrix' }), { pause: 300 });
  await dl; await sleep(3500);

  await r.click(page.getByRole('button', { name: 'Policies' }), { pause: 1500 });
  await r.cap('<b>Policies</b> lists the loaded policy bundles. The trial ships with a reference bundle, and you can mount your own YAML.', { step: 'Policies' });
  await r.cap('Ask what an action would require before you build against it.', { step: 'Policies', wait: false });
  await r.type(page.getByPlaceholder('e.g. account.create_privileged'), 'account.create_privileged', 45);
  await r.click(page.getByRole('button', { name: 'Look up' }), { pause: 1200 });
  await r.cap('The matching rule shows its control, the facts it requires, and what triggers an escalation.', { step: 'Policies', hold: 4500 });

  // ── Part 5: prove it ───────────────────────────────────────────────────────
  step = 'Part 5 · Check the claims yourself';
  await page.goto(term.url);
  await T('setPrompt', '~/Downloads/ordinance-trial $ ');
  await T('clear');
  await r.cap('Don\'t take our word for it. One command checks these claims against the instance you are running.', { step, wait: false });
  await sleep(2200);
  // The recorder's shell has no TTY, so the real command adds -T; the customer's doesn't need it.
  await T('run', 'docker compose exec -T ordinance python client/proof.py',
    { display: 'docker compose exec ordinance python client/proof.py', speed: 22 });
  await r.cap('It also confirms the decision log has <b>not been altered</b>: every record is chained to the one before it.', { step, hold: 5200 });
  await r.hideCap();

  await r.card('Ordinance', 'Decide before you act', 'Allow, deny, or escalate. Every decision traceable to who asked and the policy in force, with a human approval gate.',
    'Phaethon Security · info@phaethonsecurity.com', 4500);
  term.stop();
  console.log('wrote', await r.finish('Ordinance-2-Overview'));
})().catch((e) => { console.error(e); process.exit(1); });
