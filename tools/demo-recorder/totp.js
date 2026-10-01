'use strict';
const crypto = require('crypto');

function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/[\s=-]/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

// RFC 6238 TOTP, SHA-1, 30 s step, 6 digits.
function totp(secret, t = Date.now()) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Wait until we're not in the last few seconds of a step, so the code stays valid while it's typed.
async function freshTotp(secret) {
  while ((Date.now() / 1000) % 30 > 22) await new Promise((r) => setTimeout(r, 500));
  return totp(secret);
}

module.exports = { totp, freshTotp };
if (require.main === module) console.log(totp(process.argv[2]));
