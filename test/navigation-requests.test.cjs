const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, response, flush } = require('./helpers.cjs');

test('superseded response bodies and triggers cannot overwrite newer content', async t => {
  const { w } = setup(t);
  const body = deferred(), pending = [];
  let triggers = 0;
  w.talkDOM.methods['trigger:'] = () => triggers++;
  w.fetch = (url, options) => { pending.push(options); return Promise.resolve(pending.length === 1 ? {...response('', 'a trigger:'), text: () => body.promise} : response('new')); };
  const old = w.talkDOM.send('a get: /slow apply: inner');
  const rejected = assert.rejects(old, {name:'AbortError'});
  await flush();
  await w.talkDOM.send('a get: /fast apply: inner');
  assert(pending[0].signal.aborted);
  body.resolve('stale'); await rejected;
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'new');
  assert.equal(triggers, 0);
});

test('receivers sharing a name do not cancel each other', async t => {
  const { w } = setup(t, '<div receiver="a"></div><div receiver="a"></div>');
  const calls = [];
  w.fetch = (url, options) => { calls.push(options); return Promise.resolve(response('both')); };
  await w.talkDOM.send('a get: /group apply: inner');
  assert.equal(calls.length, 2);
  assert(calls.every(call => !call.signal.aborted));
  assert(w.talkDOM.receivers('a').every(el => el.textContent === 'both'));
});

test('new navigation cancels outstanding reads, preserves writes, and commits only the winner', async t => {
  const { w } = setup(t, '<div receiver="a">home</div><button sender="a get: /first apply: inner" push-url="/first">First</button><button sender="a get: /second apply: inner" push-url="/second">Second</button>');
  const pending = [];
  w.fetch = (url, options) => { const p = deferred(); pending.push({...p, options}); return p.promise; };
  const write = w.talkDOM.send('a post: /save');
  const buttons = w.document.querySelectorAll('button');
  buttons[0].click(); buttons[1].click();
  assert.equal(pending[0].options.signal, undefined);
  assert(pending[1].options.signal.aborted);
  pending[2].resolve(response('second')); await flush();
  pending[1].resolve(response('first')); pending[0].resolve(response('saved')); await write; await flush();
  assert.equal(w.location.pathname, '/second');
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'second');
  assert.equal(w.history.length, 2);
  buttons[0].click();
  const back = new Promise(resolve => w.addEventListener('popstate', resolve, {once:true}));
  w.history.back(); await back;
  assert(pending[3].options.signal.aborted);
  pending[3].resolve(response('late')); await flush();
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'home');
  assert.equal(w.location.pathname, '/page');
});

for (const options of [{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {button:1}, {button:2}]) {
  test('modified clicks are not intercepted: ' + JSON.stringify(options), async t => {
    const { w } = setup(t, '<button sender="a text: changed"></button><div receiver="a">original</div>');
    const event = new w.MouseEvent('click', {bubbles:true, cancelable:true, ...options});
    w.document.querySelector('button').dispatchEvent(event); await flush();
    assert.equal(event.defaultPrevented, false);
    assert.equal(w.talkDOM.receivers('a')[0].textContent, 'original');
  });
}
for (const attribute of ['download', 'target="_blank"']) {
  test('explicit browser behavior is preserved: ' + attribute, async t => {
    const { w } = setup(t, '<a ' + attribute + ' sender="a text: changed">Read</a><div receiver="a">original</div>');
    const event = new w.MouseEvent('click', {bubbles:true, cancelable:true});
    w.document.querySelector('a').dispatchEvent(event); await flush();
    assert.equal(event.defaultPrevented, false);
    assert.equal(w.talkDOM.receivers('a')[0].textContent, 'original');
  });
}

test('application-prevented clicks do not dispatch', async t => {
  const { w } = setup(t, '<button sender="a text: changed"></button><div receiver="a">original</div>');
  const button = w.document.querySelector('button');
  button.addEventListener('click', e => e.preventDefault());
  button.click(); await flush();
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'original');
});
