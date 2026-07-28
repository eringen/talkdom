// Dependency-free Chromium integration check using its DevTools pipe.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function main() {
  const root = path.join(__dirname, '..');
  const core = await fs.readFile(path.join(root, 'index.js'));
  const plugin = await fs.readFile(path.join(root, 'websocket.js'));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'talkdom-chrome-'));
  const sockets = new Set();
  let requests = 0, mutations = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/index.js' || req.url === '/websocket.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(req.url === '/index.js' ? core : plugin);
    }
    if (req.url === '/fragment') { requests++; return res.end('about'); }
    if (req.url === '/mutation') { mutations++; return res.end('changed'); }
    if (req.url === '/fail') { res.statusCode = 500; return res.end('failed'); }
    if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><head><script src="/index.js"></script><script src="/websocket.js"></script></head>
      <body><button id="go" sender="content get: /fragment apply: inner" push-url="/about">About</button>
      <button id="change" sender="content post: /mutation apply: inner" push-url="/changed">Change</button>
      <button id="fail" sender="content get: /fail apply: inner" push-url="/failed">Fail</button>
      <main receiver="content">home</main><div receiver="feed ws: ws://${req.headers.host}/socket"></div></body>`);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const data = Buffer.from(JSON.stringify({receiver:'feed', content:'socket live', op:'text'}));
    socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data]));
  });
  let chrome;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const binary = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
    chrome = spawn(binary, ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir=' + profile], {
      stdio:['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    });
    chrome.stderr.resume();
    let next = 0, buffer = '';
    const pending = new Map();
    chrome.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
    chrome.on('exit', code => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Chromium exited: ' + code)); } pending.clear(); });
    chrome.stdio[4].on('data', chunk => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf('\0'); if (end < 0) break;
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        const item = pending.get(message.id);
        if (item) {
          pending.delete(message.id); clearTimeout(item.timer);
          if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
        }
      }
    });
    function command(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 15000);
        pending.set(id, {resolve, reject, timer});
        chrome.stdio[3].write(JSON.stringify({id, method, params, sessionId}) + '\0');
      });
    }
    const { targetId } = await command('Target.createTarget', {url:'about:blank'});
    const { sessionId } = await command('Target.attachToTarget', {targetId, flatten:true});
    const call = (method, params) => command(method, params, sessionId);
    async function evaluate(expression) {
      const result = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result.value;
    }
    async function waitFor(expression) {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Condition timed out: ' + expression);
    }
    await call('Page.enable');
    await call('Page.navigate', {url:base + '/'});
    await waitFor('window.talkDOM && talkDOM.receivers("feed")[0]?.textContent === "socket live"');
    await evaluate(`talkDOM.deliver(talkDOM.receivers("feed")[0], "apply:", ['<div receiver="feed">safe<script>window.outerScriptRan = true</script></div>', "outer"])`);
    assert.equal(await evaluate('Boolean(window.outerScriptRan)'), false, 'outer swaps preserve inert script behavior');
    const point = await evaluate('(() => { const r = document.getElementById("go").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    await call('Input.dispatchMouseEvent', {...point, type:'mousePressed', button:'left', clickCount:1});
    await call('Input.dispatchMouseEvent', {...point, type:'mouseReleased', button:'left', clickCount:1});
    await waitFor('location.pathname === "/about" && talkDOM.receivers("content")[0].textContent === "about"');
    assert.equal(requests, 1);
    await evaluate('history.back()');
    await waitFor('location.pathname === "/" && talkDOM.receivers("content")[0].textContent === "home"');
    await evaluate('history.forward()');
    await waitFor('location.pathname === "/about" && talkDOM.receivers("content")[0].textContent === "about"');
    await evaluate('window.beforeReload = true');
    await call('Page.reload');
    await waitFor('!window.beforeReload && window.talkDOM && talkDOM.receivers("content")[0]?.textContent === "about"');
    assert.equal(requests, 1, 'reload and traversal do not refetch');
    await evaluate('document.getElementById("change").click()');
    await waitFor('location.pathname === "/changed" && talkDOM.receivers("content")[0].textContent === "changed"');
    await evaluate('history.back()'); await waitFor('location.pathname === "/about"');
    await evaluate('history.forward()'); await waitFor('location.pathname === "/changed"');
    assert.equal(mutations, 1, 'traversal does not repeat POST');
    await evaluate('window.failed = false; document.addEventListener("talkdom:error", () => window.failed = true, {once:true}); document.getElementById("fail").click()');
    await waitFor('window.failed');
    assert.equal(await evaluate('location.pathname'), '/changed');
    console.log('Chromium passed: native click, HTTP, WebSocket, Back/Forward, reload, mutation safety, failed navigation.');
  } finally {
    if (chrome && chrome.exitCode === null) {
      const closed = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill(); await closed;
    }
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, {recursive:true, force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
