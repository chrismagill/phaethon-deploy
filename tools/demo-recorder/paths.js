'use strict';
// Where the recorder reads bundles from and writes its scratch state + videos.
const os = require('os');
const path = require('path');

const WORK = process.env.DEMO_WORK || path.join(os.tmpdir(), 'phaethon-demo');   // fake ~ dirs, demo license
const OUT = process.env.DEMO_OUT || path.join(__dirname, 'out');                 // finished MP4s + run state
const BUNDLES = path.join(__dirname, '..', '..', 'bundles');                     // the customer bundles in this repo

module.exports = {
  WORK, OUT, BUNDLES,
  LICENSE_ENV: path.join(WORK, 'lic.env'),
  ATTESTOR_OVERRIDE: path.join(WORK, 'attestor-demo-override.yml').replace(/\\/g, '/'),
};
