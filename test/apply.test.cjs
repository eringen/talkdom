const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers.cjs');

test('accepts uses whitespace tokens and preserves empty allow-all behavior', async t => {
  const { w } = setup(t, '<div receiver="a" accepts="text\ninner\tappend"></div>');
  await w.talkDOM.send('a text: yes');
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'yes');
  w.talkDOM.receivers('a')[0].setAttribute('accepts', '');
  await w.talkDOM.send('a text: allowed');
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'allowed');
});

for (const strict of [false, true]) {
  for (const op of ['inner', 'invalid', undefined]) {
    test(`invalid/denied apply ${op}, strict=${strict}`, async t => {
      const { w } = setup(t, '<div receiver="a" accepts="text" persist>old</div>');
      w.talkDOM.config.strictApply = strict;
      let done = 0, errors = 0;
      w.document.addEventListener('talkdom:done', () => done++);
      w.document.addEventListener('talkdom:error', () => errors++);
      const pending = w.talkDOM.deliver(w.talkDOM.receivers('a')[0], 'apply:', ['new', op]);
      if (strict) await assert.rejects(pending); else await pending;
      assert.equal(done, 0); assert.equal(errors, 1);
      assert.equal(w.talkDOM.receivers('a')[0].textContent, 'old');
      assert.equal(w.localStorage.getItem('talkDOM:a'), null);
    });
  }
}

test('strict applies stop pipes while legacy mode keeps resolving', async t => {
  const { w } = setup(t, '<div receiver="a" accepts="text"></div>');
  let calls = 0;
  w.talkDOM.methods['literal:'] = () => 'content';
  w.talkDOM.methods['next:'] = () => calls++;
  const command = 'a literal: | a apply: inner | a next:';
  await w.talkDOM.send(command); assert.equal(calls, 1);
  w.talkDOM.config.strictApply = true;
  await assert.rejects(w.talkDOM.send(command)); assert.equal(calls, 1);
});
