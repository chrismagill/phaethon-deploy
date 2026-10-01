#!/usr/bin/env node
'use strict';
// Mint a throwaway 30-day Attestor EVALUATION license for a recording, using the
// attestor repo's own scripts/dev-license.js, and write the compose override that
// trusts its public key (ATTESTOR_LICENSE_EXTRA_PUBKEYS). Neither file is part of
// the customer bundle; att-install.js feeds the override in through COMPOSE_FILE.
//
//   ATTESTOR_REPO=/path/to/attestor node prep-attestor-license.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { WORK, LICENSE_ENV, ATTESTOR_OVERRIDE } = require('./paths');

const repo = process.env.ATTESTOR_REPO;
if (!repo) { console.error('Set ATTESTOR_REPO to a checkout of chrismagill/attestor.'); process.exit(1); }
fs.mkdirSync(WORK, { recursive: true });
execFileSync(process.execPath, [path.join(repo, 'docker/api/scripts/dev-license.js'),
  '--days', '30', '--customer', 'Demo Co (evaluation)', '--write', LICENSE_ENV], { stdio: 'inherit' });

const pub = fs.readFileSync(LICENSE_ENV, 'utf8').match(/^ATTESTOR_LICENSE_EXTRA_PUBKEYS=(.*)$/m)[1].trim();
fs.writeFileSync(ATTESTOR_OVERRIDE, `services:\n  api:\n    environment:\n      ATTESTOR_LICENSE_EXTRA_PUBKEYS: "${pub}"\n`);
console.log('wrote', LICENSE_ENV, 'and', ATTESTOR_OVERRIDE);
