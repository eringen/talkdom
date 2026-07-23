const fs = require('node:fs/promises');
const path = require('node:path');
const { minify } = require('terser');

async function build(root = path.join(__dirname, '..')) {
  const dist = path.join(root, 'dist');
  await fs.mkdir(dist, {recursive:true});
  // Only remove obsolete, known generated artifacts; unrelated files are untouched.
  for (const name of ['talkdom.esm.js', 'talkdom-ws.esm.js']) {
    await fs.rm(path.join(dist, name), {force:true});
    await fs.rm(path.join(dist, name + '.map'), {force:true});
  }
  for (const [input, output] of [['index.js', 'talkdom.min.js'], ['websocket.js', 'talkdom-ws.min.js']]) {
    const result = await minify({[input]: await fs.readFile(path.join(root, input), 'utf8')}, {
      compress:true, mangle:true,
      sourceMap:{filename:output, url:output + '.map', includeSources:true},
    });
    await fs.writeFile(path.join(dist, output), result.code + '\n');
    await fs.writeFile(path.join(dist, output + '.map'), result.map + '\n');
  }
}

if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { build };
