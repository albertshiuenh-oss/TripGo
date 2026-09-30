/* In-memory stand-in for the Firebase compat SDK (app + database).
   Seeded from window.__TG_SEED; every write is logged in window.__fbStub.writes
   so tests can assert which paths were touched. */
(function () {
  var clone = function (v) { return v == null ? null : JSON.parse(JSON.stringify(v)); };
  var root = clone(window.__TG_SEED) || {};
  var listeners = [];
  var pushN = 0;
  var stub = window.__fbStub = { writes: [], dump: function () { return clone(root); } };

  function parts(p) { return String(p || '').split('/').filter(Boolean); }
  function norm(p) { return parts(p).join('/'); }
  function getAt(p) {
    var n = root;
    for (var k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
    return n === undefined ? null : n;
  }
  function setAt(p, v) {
    var ks = parts(p);
    if (!ks.length) { root = clone(v) || {}; return; }
    var n = root;
    for (var i = 0; i < ks.length - 1; i++) {
      if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
      n = n[ks[i]];
    }
    if (v == null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
  }
  function snap(key, val) {
    return {
      key: key,
      val: function () { return clone(val); },
      exists: function () { return val != null; },
      numChildren: function () { return val && typeof val === 'object' ? Object.keys(val).length : 0; },
      child: function (c) { var v = val && val[c]; return snap(c, v === undefined ? null : v); },
      forEach: function (fn) {
        if (!val || typeof val !== 'object') return false;
        for (var k of Object.keys(val)) if (fn(snap(k, val[k])) === true) return true;
        return false;
      }
    };
  }
  function lastKey(p) { var ks = parts(p); return ks.length ? ks[ks.length - 1] : null; }
  function childMap(p) {
    var v = getAt(p), m = {};
    if (v && typeof v === 'object') for (var k of Object.keys(v)) m[k] = JSON.stringify(v[k]);
    return m;
  }
  function fire(l) {
    var p = l.path;
    if (l.ev === 'value') { l.cb(snap(lastKey(p), getAt(p))); return; }
    var now = childMap(p), prev = l.prev || {}, v = getAt(p) || {};
    l.prev = now;
    if (l.ev === 'child_added') for (var k in now) if (!(k in prev)) l.cb(snap(k, v[k]));
    if (l.ev === 'child_changed') for (var k2 in now) if (k2 in prev && prev[k2] !== now[k2]) l.cb(snap(k2, v[k2]));
    if (l.ev === 'child_removed') for (var k3 in prev) if (!(k3 in now)) l.cb(snap(k3, JSON.parse(prev[k3])));
  }
  function notify(changed) {
    var cp = norm(changed);
    listeners.slice().forEach(function (l) {
      var lp = l.path;
      if (cp === lp || cp.indexOf(lp + '/') === 0 || lp.indexOf(cp + '/') === 0 || cp === '')
        setTimeout(function () { if (listeners.indexOf(l) >= 0) fire(l); }, 0);
    });
  }
  function write(op, p, v) {
    stub.writes.push({ op: op, path: norm(p) });
    setAt(p, v); notify(p);
    return Promise.resolve();
  }
  function ref(path) {
    var p = norm(path);
    var r = {
      key: lastKey(p),
      on: function (ev, cb) {
        var l = { path: p, ev: ev, cb: cb, prev: ev === 'value' ? null : {} };
        listeners.push(l);
        setTimeout(function () { if (listeners.indexOf(l) >= 0) fire(l); }, 0);
        return cb;
      },
      off: function (ev, cb) {
        listeners = listeners.filter(function (l) { return !(l.path === p && (!ev || l.ev === ev) && (!cb || l.cb === cb)); });
      },
      once: function () { return Promise.resolve(snap(lastKey(p), getAt(p))); },
      set: function (v) { return write('set', p, v); },
      update: function (obj) {
        Object.keys(obj).forEach(function (k) { setAt(p + '/' + k, obj[k]); });
        stub.writes.push({ op: 'update', path: p }); notify(p); return Promise.resolve();
      },
      remove: function () { return write('remove', p, null); },
      push: function (v) {
        var k = '-T' + String(Date.now()).slice(-6) + String(++pushN).padStart(5, '0');
        var child = ref(p + '/' + k);
        if (v === undefined) return child;
        var pr = child.set(v);
        child.then = pr.then.bind(pr);
        return child;
      },
      child: function (c) { return ref(p + '/' + c); }
    };
    return r;
  }
  window.firebase = {
    initializeApp: function (cfg, name) { return { name: name || '[DEFAULT]', options: cfg }; },
    database: function () { return { ref: ref }; }
  };
})();
