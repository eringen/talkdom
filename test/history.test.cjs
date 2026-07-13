const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, response, flush } = require('./helpers.cjs');
const html = '<button sender="a get: /about apply: inner" push-url="/about">About</button><main><div receiver="a">home</div></main><aside>untouched</aside>';

function traverse(w, method) {
  return new Promise(resolve => { w.addEventListener('popstate', resolve, {once:true}); w.history[method](); });
}

test('history waits for success and restores initial Back and Forward without requests', async t => {
  const { w } = setup(t, html);
  const pending = deferred(); let requests = 0;
  w.fetch = () => { requests++; return pending.promise; };
  const aside = w.document.querySelector('aside');
  w.document.querySelector('button').click();
  assert.equal(w.location.pathname, '/page');
  pending.resolve(response('about')); await flush();
  assert.equal(w.location.pathname, '/about');
  await traverse(w, 'back'); assert.equal(w.talkDOM.receivers('a')[0].textContent, 'home');
  await traverse(w, 'forward'); assert.equal(w.talkDOM.receivers('a')[0].textContent, 'about');
  assert.equal(requests, 1); assert.equal(w.document.querySelector('aside'), aside);
});

for (const failure of ['cancel', 'http']) {
  test(`history stays put on ${failure}`, async t => {
    const { w } = setup(t, html);
    w.fetch = () => Promise.resolve({ok:false, status:500});
    if (failure === 'cancel') {
      w.confirm = () => false;
      w.document.querySelector('button').setAttribute('sender', 'a confirm: sure | a get: /about apply: inner');
    }
    w.document.querySelector('button').click(); await flush();
    assert.equal(w.location.pathname, '/page'); assert.equal(w.history.length, 1);
  });
}

test('history snapshots outer removal and never repeats mutation commands', async t => {
  const { w } = setup(t, html);
  let requests = 0;
  w.fetch = () => { requests++; return Promise.resolve(response('')); };
  w.document.querySelector('button').setAttribute('sender', 'a post: /delete apply: outer');
  w.document.querySelector('button').click(); await flush();
  assert.equal(w.talkDOM.receivers('a').length, 0);
  await traverse(w, 'back'); assert.equal(w.talkDOM.receivers('a')[0].textContent, 'home');
  await traverse(w, 'forward'); assert.equal(w.talkDOM.receivers('a').length, 0);
  assert.equal(requests, 1);
});

test('equivalent absolute URLs do not add duplicate entries', async t => {
  const { w } = setup(t, html);
  w.fetch = () => Promise.resolve(response('new'));
  w.document.querySelector('button').setAttribute('push-url', w.location.href);
  w.document.querySelector('button').click(); await flush();
  assert.equal(w.history.length, 1);
});

test('reload restores saved content without replaying commands', async t => {
  const { w } = setup(t, html, w => {
    w.history.replaceState({talkDOM:{version:1, regions:['<p receiver="a">saved</p>']}}, '', '/about');
    w.fetch = () => { throw new Error('must not fetch'); };
  });
  await flush(); assert.equal(w.talkDOM.receivers('a')[0].textContent, 'saved');
});

test('legacy sender states never replay side effects', t => {
  const { w } = setup(t, html, w => {
    w.history.replaceState({sender:'a delete: /danger'}, '');
    w.fetch = () => { throw new Error('must not fetch'); };
  });
  assert.equal(w.talkDOM.receivers('a')[0].textContent, 'home');
});
