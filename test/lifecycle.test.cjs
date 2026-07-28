const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, response } = require('./helpers.cjs');

for (const content of ['<p>new</p>', '<p>first</p><b>second</b>', 'text only', '']) {
  test(`outer lifecycle targets inserted markup or parent: ${content}`, async t => {
    const { w } = setup(t, '<main><div receiver="a">old</div><aside>unrelated</aside></main>');
    const original = w.talkDOM.receivers('a')[0];
    w.fetch = () => Promise.resolve(response(content));
    const events = [];
    w.document.addEventListener('talkdom:done', e => events.push(e));
    await w.talkDOM.send('a get: /new apply: outer');
    assert.equal(events.length, 1);
    assert.equal(events[0].target.tagName, content.startsWith('<p>') ? 'P' : 'MAIN');
    assert.equal(events[0].detail.originalReceiver, original);
    assert.equal(w.document.querySelector('aside').textContent, 'unrelated');
  });
}

test('shared delivery preserves synchronous updates and rejects thrown methods', async t => {
  const { w } = setup(t);
  const el = w.talkDOM.receivers('a')[0];
  const pending = w.talkDOM.deliver(el, 'text:', ['now']);
  assert.equal(el.textContent, 'now');
  await pending;
  let errors = 0;
  el.addEventListener('talkdom:error', () => errors++);
  w.talkDOM.methods['fail:'] = () => { throw new Error('failure'); };
  await assert.rejects(w.talkDOM.deliver(el, 'fail:', []), /failure/);
  assert.equal(errors, 1);
});

test('piped lifecycle details retain the declared arguments', async t => {
  const { w } = setup(t);
  const events = [];
  w.document.addEventListener('talkdom:done', e => events.push(e));
  w.talkDOM.methods['literal:'] = () => 'content';
  await w.talkDOM.send('a literal: | a apply: text');
  assert.deepEqual(Array.from(events[1].detail.args), ['text']);
});

test('throwing then accessors do not interrupt other receiver deliveries', async t => {
  const { w } = setup(t, '<div receiver="a"></div><div receiver="a"></div>');
  let calls = 0, errors = 0;
  w.document.addEventListener('talkdom:error', () => errors++);
  w.talkDOM.methods['bad:'] = () => {
    calls++;
    return {get then() { throw new Error('bad then'); }};
  };
  await assert.rejects(w.talkDOM.send('a bad:'), /bad then/);
  assert.equal(calls, 2); assert.equal(errors, 2);
});
