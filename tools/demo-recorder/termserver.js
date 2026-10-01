// Live terminal harness for screen recordings.
// GET /            -> terminal page
// POST /run        -> {cmd} runs for real in Git Bash, streams stdout+stderr; cwd persists across calls
// GET /env         -> current .env (in cwd) with secret values masked, for the editor view
// POST /setenv     -> {key, value} sets KEY=value in .env (uncommenting if needed)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.TERM_PORT || 4700);
const DEMO_HOME = process.env.DEMO_HOME;               // becomes ~ for the shell
const EXTRA_ENV = JSON.parse(process.env.EXTRA_ENV || '{}');
const BASH = process.env.DEMO_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash');
const SECRET = /PASSWORD|SECRET|_KEY$|^LICENSE_KEY$/;
let cwd = DEMO_HOME;

function body(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b ? JSON.parse(b) : {})); });
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'term.html'), 'utf8'));
  }
  if (req.method === 'POST' && url === '/run') {
    const { cmd } = await body(req);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
    // Run, then report the resulting directory after a \u0001 sentinel so `cd` sticks.
    const wrapped = `${cmd}\n__c=$?; printf '\\001%s' "$(pwd -W)"; exit $__c`;
    const p = spawn(BASH, ['-c', wrapped], {
      cwd,
      env: { ...process.env, ...EXTRA_ENV, HOME: DEMO_HOME, TERM: 'dumb', NO_COLOR: '1', MSYS_NO_PATHCONV: '1' },
    });
    let tail = '';
    const emit = (d) => {
      const s = tail + d.toString('utf8');
      const i = s.indexOf('\u0001');
      if (i >= 0) { res.write(s.slice(0, i)); tail = s.slice(i); } else { res.write(s); tail = ''; }
    };
    p.stdout.on('data', emit);
    p.stderr.on('data', (d) => res.write(d));
    p.on('close', (code) => {
      if (tail.startsWith('\u0001')) cwd = tail.slice(1).trim() || cwd;
      res.end(`\u0000${code}`);
    });
    return;
  }
  if (req.method === 'GET' && url === '/env') {
    const f = path.join(cwd, '.env');
    const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/) : [];
    const masked = lines.map((l) => {
      const m = l.match(/^([A-Z_]+)=(\S.*)$/);
      if (m && SECRET.test(m[1]) && !m[2].startsWith('#')) return `${m[1]}=${'•'.repeat(24)}`;
      return l;
    });
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(masked));
  }
  if (req.method === 'POST' && url === '/setenv') {
    const { key, value } = await body(req);
    const f = path.join(cwd, '.env');
    let t = fs.readFileSync(f, 'utf8');
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    t = re.test(t) ? t.replace(re, `${key}=${value}`) : `${t}\n${key}=${value}\n`;
    fs.writeFileSync(f, t);
    res.writeHead(200); return res.end('ok');
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`term on ${PORT} home=${DEMO_HOME}`));
