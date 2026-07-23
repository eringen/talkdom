const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { build } = require('../scripts/build.cjs');

test('builds are deterministic and the packed bundles run with linked source maps', async t => {
  const root = path.join(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'talkdom-release-'));
  t.after(() => fs.rm(temp, {recursive:true, force:true}));
  for (const name of ['index.js', 'websocket.js', 'package.json', 'README.md', 'LICENSE']) {
    await fs.copyFile(path.join(root, name), path.join(temp, name));
  }
  await fs.mkdir(path.join(temp, 'scripts'));
  await fs.copyFile(path.join(root, 'scripts/build.cjs'), path.join(temp, 'scripts/build.cjs'));
  await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  await build(temp);
  const names = ['talkdom.min.js', 'talkdom-ws.min.js'];
  const first = await Promise.all(names.map(name => fs.readFile(path.join(temp, 'dist', name), 'utf8')));
  await fs.writeFile(path.join(temp, 'dist/talkdom.esm.js'), 'obsolete');
  await fs.writeFile(path.join(temp, 'dist/unrelated.txt'), 'preserve but do not ship');
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--cache', path.join(temp, 'cache')], {
    cwd:temp, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'],
  }));
  const files = packed[0].files.map(file => file.path).sort();
  assert.deepEqual(files, ['LICENSE', 'README.md', 'dist/talkdom-ws.min.js', 'dist/talkdom-ws.min.js.map', 'dist/talkdom.min.js', 'dist/talkdom.min.js.map', 'index.js', 'package.json', 'websocket.js']);
  assert.equal(await fs.readFile(path.join(temp, 'dist/unrelated.txt'), 'utf8'), 'preserve but do not ship');
  execFileSync('tar', ['-xzf', path.join(temp, packed[0].filename), '-C', temp]);
  const dom = new JSDOM('<div receiver="a"></div>', {url:'https://example.test', runScripts:'outside-only'});
  t.after(async () => {
    dom.window.document.replaceChildren();
    await new Promise(resolve => setImmediate(resolve));
    dom.window.close();
  });
  for (const [i, name] of names.entries()) {
    const code = await fs.readFile(path.join(temp, 'package/dist', name), 'utf8');
    assert.equal(code, first[i]);
    assert.ok(code.includes('sourceMappingURL=' + name + '.map'));
    const map = JSON.parse(await fs.readFile(path.join(temp, 'package/dist', name + '.map'), 'utf8'));
    assert.equal(map.file, name);
    assert.ok(map.sourcesContent[0].includes('(function ()'));
    dom.window.eval(code);
  }
  await dom.window.talkDOM.send('a text: packed');
  assert.equal(dom.window.document.querySelector('[receiver]').textContent, 'packed');
  assert.equal(typeof dom.window.talkDOM.ws.connect, 'function');
});
