'use strict';
const fs = require('fs');
const path = require('path');
const { start, sleep } = require('./lib');
const { freshTotp } = require('./totp');

const STATE = JSON.parse(fs.readFileSync(path.join(require('./paths').OUT, 'att-state.json'), 'utf8'));
const BASE = 'http://localhost:8080';

// A week of realistic sample logs from a few sources, sent with the ingestion key minted on screen.
function sampleEvents() {
  const now = Date.now(), H = 3600e3, ev = [];
  const ip = (i) => `203.0.113.${10 + (i % 40)}`;
  const users = ['jsmith', 'mlopez', 'akim', 'tnguyen', 'rpatel'];
  for (let d = 6; d >= 0; d--) {
    const n = 4 + ((d * 7) % 5);
    for (let i = 0; i < n; i++) {
      const t = new Date(now - d * 24 * H - (i * 2.3 + 1) * H).toISOString();
      const u = users[(d + i) % users.length];
      const k = (d + i) % 6;
      if (k === 0) ev.push({ source: 'sshd', severity: 'warning', hostname: 'bastion-01', source_ip: ip(i + d), timestamp: t, description: `Failed password for invalid user admin from ${ip(i + d)}` });
      else if (k === 1) ev.push({ source: 'okta', severity: 'info', source_ip: ip(i), timestamp: t, description: `User ${u}@demo.example logged in successfully (MFA push accepted)` });
      else if (k === 2) ev.push({ source: 'sshd', severity: 'notice', hostname: 'build-02', timestamp: t, description: `${u} ran sudo: /usr/bin/systemctl restart nginx` });
      else if (k === 3) ev.push({ source: 'entra', severity: 'warning', source_ip: ip(i + 3), timestamp: t, description: `Sign-in denied for ${u}@demo.example: incorrect password` });
      else if (k === 4) ev.push({ source: 'azuread', severity: 'notice', timestamp: t, description: `New user created: contractor-${d}${i}@demo.example (by ${u})` });
      else ev.push({ source: 'vpn', severity: 'info', source_ip: ip(i + 7), timestamp: t, description: `VPN session opened for ${u}` });
    }
  }
  return ev;
}

(async () => {
  const r = await start('att-overview');
  const { page } = r;
  await page.goto(BASE + '/');
  await r.card('Attestor', 'Using Attestor', 'Collect security logs, map every event to <b>NIST SP 800-171</b> and <b>CMMC Level 2</b> controls automatically, and produce signed, auditor-ready evidence.',
    'Attestor 1.2.1 · captions only, no audio', 5500);

  await r.uncard();
  const email = page.locator('input[autocomplete="username"]');
  await email.waitFor();
  await r.cap('Sign in with your password and authenticator code.', { step: 'Sign in', wait: false });
  await r.type(email, STATE.email, 35);
  await r.type(page.locator('input[autocomplete="current-password"]'), STATE.pass, 30);
  await r.click(page.getByRole('button', { name: 'Continue' }), { pause: 800 });
  await page.getByPlaceholder('000000').waitFor();
  await r.type(page.getByPlaceholder('000000'), await freshTotp(STATE.secret), 120);
  await r.click(page.getByRole('button', { name: 'Verify' }), { pause: 300 });
  await page.getByRole('button', { name: 'Evidence Bundles' }).waitFor();
  await sleep(1000);
  await r.cap('A fresh install starts empty. First, connect a log source.', { step: 'Overview' });

  // Log sources
  await r.click(page.getByRole('button', { name: 'Log Sources' }), { pause: 1200 });
  await r.cap('Under <b>Log Sources</b>, mint an <b>ingestion key</b> for each collector or forwarder.', { step: 'Log Sources', wait: false });
  await r.type(page.getByPlaceholder('edge-collector'), 'edge-collector', 60);
  await r.click(page.getByRole('button', { name: 'Mint key' }), { pause: 1200 });
  const key = (await page.locator('code').first().textContent()).trim();
  await r.cap('The key is shown <b>once</b>. Copy it into your collector, which then posts logs to the ingest endpoint shown on this page.', { step: 'Log Sources' });

  const res = await fetch(BASE + '/api/v1/ingest', { method: 'POST', headers: { "X-Api-Key": key, 'content-type': 'application/json' }, body: JSON.stringify(sampleEvents()) });
  const ing = await res.json();
  if (!ing.accepted) throw new Error('ingest failed ' + JSON.stringify(ing));
  await r.cap(`(For this demo, a collector using that key forwarded a week of sample logs: <b>${ing.count} events</b> from SSH, Okta, Entra ID and VPN.)`, { step: 'Log Sources', hold: 4200 });
  await r.click(page.getByRole('button', { name: 'Overview' }), { pause: 300 });
  await r.click(page.getByRole('button', { name: 'Log Sources' }), { pause: 1500 });
  await r.cap('Each source appears with its health, volume, and when it was last seen.', { step: 'Log Sources' });

  // Overview
  await r.click(page.getByRole('button', { name: 'Overview' }), { pause: 1500 });
  await r.cap('<b>Overview</b> now shows evidence readiness, controls evidenced, event volume, and coverage by control family.', { step: 'Overview' });

  // Events
  await r.click(page.getByRole('button', { name: 'Events', exact: true }), { pause: 1500 });
  await r.cap('Every ingested event is <b>tagged to its controls automatically</b>. A failed logon maps to NIST <code>3.1.8</code> and CMMC <code>AC.L2-3.1.8</code>.', { step: 'Events' });
  await r.cap('Search by text, source, IP address, or control ID. Here, every event that evidences AC.L2-3.1.8.', { step: 'Events', wait: false });
  await r.type(page.getByPlaceholder(/^Search description/), 'AC.L2-3.1.8', 70);
  await page.keyboard.press('Enter'); await sleep(2800);

  // Compliance
  await r.click(page.getByRole('button', { name: 'Compliance', exact: true }), { pause: 1500 });
  await r.cap('<b>Compliance</b> shows readiness per framework, and which controls have evidence and which don\'t.', { step: 'Compliance' });
  await r.click(page.getByRole('button', { name: 'CMMC Level 2' }).first(), { pause: 1800 });
  await r.cap('Open any control to see its requirement, contributing sources, and sample evidencing events.', { step: 'Compliance', wait: false });
  await r.click(page.getByRole('button', { name: 'View', exact: true }).first(), { pause: 4500 });
  await page.keyboard.press('Escape'); await sleep(800);

  // Evidence hub
  await r.click(page.getByRole('button', { name: 'Control Evidence' }), { pause: 1500 });
  await r.cap('The <b>Control Evidence Hub</b> tracks evidence for every control, including documents and artifacts that aren\'t logs.', { step: 'Control Evidence' });
  await r.cap('Add a policy document, for example, with a review cadence so it is flagged when it goes stale.', { step: 'Control Evidence', wait: false });
  await r.type(page.getByPlaceholder('e.g. Access Control Policy'), 'Access Control Policy v3', 45);
  await r.type(page.getByPlaceholder(/^s3:/), 'file:///policies/access-control-v3.pdf', 30);
  await r.click(page.getByRole('button', { name: 'Add', exact: true }), { pause: 2500 });

  // Evidence bundles
  await r.click(page.getByRole('button', { name: 'Evidence Bundles' }), { pause: 1500 });
  await r.cap('<b>Evidence Bundles</b>: pick a framework and period, then generate a <b>cryptographically signed</b> bundle for your assessor.', { step: 'Evidence Bundles', wait: false });
  await sleep(2500);
  await r.click(page.getByRole('button', { name: /Generate & sign/ }), { pause: 3000 });
  await r.cap('<b>Verify</b> re-checks the signature at any time, so tampering is detectable. <b>Download</b> saves the bundle as JSON.', { step: 'Evidence Bundles', wait: false });
  await sleep(1500);
  await r.click(page.getByRole('button', { name: 'Verify' }).first(), { pause: 2500 });
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await r.click(page.getByRole('button', { name: 'Download' }).first(), { pause: 300 });
  await dl; await sleep(2500);

  // Auditor portal
  await r.click(page.getByRole('button', { name: 'Auditor Portal' }), { pause: 1500 });
  await r.cap('The <b>Auditor Portal</b> grants your assessor time-limited, <b>read-only</b> access.', { step: 'Auditor Portal', wait: false });
  await r.type(page.getByPlaceholder('assessor@c3pao.example'), 'assessor@c3pao.example', 40);
  await r.click(page.getByRole('button', { name: 'Grant access' }), { pause: 3500 });
  await r.cap('Share the one-time credentials securely. The auditor sees the evidence, but can\'t change anything.', { step: 'Auditor Portal' });
  await r.hideCap();

  await r.card('Attestor', 'Audit-ready, every day', 'Self-hosted log collection, automatic control mapping, and signed evidence for NIST 800-171 and CMMC Level 2.',
    'Phaethon Security · info@phaethonsecurity.com', 4500);
  console.log('wrote', await r.finish('Attestor-2-Overview'));
})().catch((e) => { console.error(e); process.exit(1); });
