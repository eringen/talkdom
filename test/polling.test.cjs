const test = require('node:test');
const assert = require('node:assert/strict');
const { sockets } = require('./sockets.cjs');
const { deferred, flush } = require('./helpers.cjs');

test('pollers follow insertion, configuration, group changes and removal', async t => {
  const { w, advance, timers } = sockets(t);
  const calls = [];
  w.talkDOM.methods['record:'] = (el, value) => calls.push([el.id, value]);
  w.document.body.innerHTML = '<div id="a" receiver="feed record: one poll: 10ms"></div>';
  await flush(); advance(10); await flush();
  assert.deepEqual(calls, [['a', 'one']]);
  w.document.body.insertAdjacentHTML('beforeend', '<div id="b" receiver="feed record: one poll: 10ms"></div>');
  await flush(); advance(10); await flush();
  assert.deepEqual(calls.slice(1), [['a', 'one'], ['b', 'one']]);
  assert.equal(timers.size, 1, 'identical group declarations share a timer');
  w.document.getElementById('a').remove();
  w.document.getElementById('b').setAttribute('receiver', 'feed record: two poll: 20ms');
  await flush(); advance(19); assert.equal(calls.length, 3);
  advance(1); await flush();
  assert.deepEqual(calls[3], ['b', 'two']);
  w.document.body.innerHTML = '';
  advance(20); await flush();
  assert.equal(calls.length, 4);
  assert.equal(timers.size, 0);
});

test('polling emits events, waits for every pending receiver, and recovers', async t => {
  const { w, advance } = sockets(t, '<div receiver="a work: poll: 10ms"></div><div receiver="a"></div>');
  const slow = deferred(); let calls = 0, done = 0, errors = 0;
  w.talkDOM.methods['work:'] = () => {
    calls++;
    if (calls === 1) throw new Error('failed');
    if (calls === 2) return slow.promise;
  };
  w.document.addEventListener('talkdom:done', () => done++);
  w.document.addEventListener('talkdom:error', () => errors++);
  advance(10); await flush(); advance(100); await flush();
  assert.equal(calls, 2); assert.equal(errors, 1); assert.equal(done, 0);
  slow.resolve(); await flush(); advance(10); await flush();
  assert.equal(calls, 4); assert.equal(done, 3);
});

test('outer replacements continue polling and added ordinary group members receive ticks', async t => {
  const { w, advance } = sockets(t, '<div receiver="a replace: poll: 10ms"></div>');
  let calls = 0;
  w.talkDOM.methods['replace:'] = el => {
    calls++;
    return w.talkDOM.methods['apply:'](el, '<p receiver="a replace: poll: 10ms">new</p>', 'outer');
  };
  advance(10); await flush(); advance(10); await flush();
  assert.equal(calls, 2);
  w.document.body.insertAdjacentHTML('beforeend', '<div receiver="a"></div>');
  advance(10); await flush(); assert.equal(calls, 4);
});

test('poller limit is enforced and waiting declarations start when a slot frees', async t => {
  const { w, advance, timers, warnings } = sockets(t);
  w.talkDOM.maxPollers = 1;
  const calls = [];
  w.talkDOM.methods['record:'] = el => calls.push(el.id);
  w.document.body.innerHTML = '<div id="a" receiver="a record: poll: 10ms"></div><div id="b" receiver="b record: poll: 10ms"></div>';
  await flush(); advance(10); await flush();
  assert.equal(timers.size, 1); assert.deepEqual(calls, ['a']);
  assert.ok(warnings.some(args => String(args[0]).includes('max pollers')));
  w.document.getElementById('a').remove();
  await flush(); advance(10); await flush(); assert.deepEqual(calls, ['a', 'b']);
});

test('head-loaded core restores and polls content parsed before DOM ready', async t => {
  const { w, advance } = sockets(t);
  w.localStorage.setItem('talkDOM:a', JSON.stringify({op:'text', content:'saved'}));
  w.document.body.innerHTML = '<div receiver="a record: poll: 10ms" persist></div>';
  let calls = 0;
  w.talkDOM.methods['record:'] = () => calls++;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.querySelector('[receiver]').textContent, 'saved');
  advance(10); await flush(); assert.equal(calls, 1);
});
