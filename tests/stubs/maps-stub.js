/* Minimal Google Maps JS API stand-in. Unknown instance methods are no-ops
   (via Proxy) so the app never crashes on an API we didn't model. Places and
   Directions return ZERO_RESULTS. Calls window.initMap like the real loader. */
(function () {
  var noop = function () {};
  function lenient(obj) {
    return new Proxy(obj, {
      get: function (t, k) {
        if (k in t) return t[k];
        if (k === 'then' || typeof k === 'symbol') return undefined;
        return function () { return undefined; };
      }
    });
  }
  function LatLng(a, b) {
    if (a && typeof a === 'object') { this._a = +(typeof a.lat === 'function' ? a.lat() : a.lat); this._b = +(typeof a.lng === 'function' ? a.lng() : a.lng); }
    else { this._a = +a; this._b = +b; }
  }
  LatLng.prototype.lat = function () { return this._a; };
  LatLng.prototype.lng = function () { return this._b; };
  LatLng.prototype.toJSON = function () { return { lat: this._a, lng: this._b }; };
  function LatLngBounds() { this.pts = []; }
  LatLngBounds.prototype.extend = function (p) { this.pts.push(new LatLng(p)); return this; };
  LatLngBounds.prototype.isEmpty = function () { return !this.pts.length; };
  LatLngBounds.prototype.contains = function () { return true; };
  LatLngBounds.prototype.getCenter = function () { return this.pts[0] || new LatLng(25, 121.5); };

  function makeClass(extra) {
    function C(opts) {
      this.opts = opts || {}; this.map = this.opts.map || null;
      if (this.opts.position) this.pos = new LatLng(this.opts.position);
      return lenient(this);
    }
    C.prototype.setMap = function (m) { this.map = m; };
    C.prototype.getMap = function () { return this.map; };
    C.prototype.addListener = function () { return { remove: noop }; };
    C.prototype.setOptions = function (o) { Object.assign(this.opts, o || {}); };
    C.prototype.setPosition = function (p) { this.pos = p ? new LatLng(p) : null; };
    C.prototype.getPosition = function () { return this.pos || null; };
    Object.assign(C.prototype, extra || {});
    return C;
  }
  var MapBase = makeClass({
    getCenter: function () { return new LatLng(25, 121.5); },
    getZoom: function () { return this._z || 10; },
    setZoom: function (z) { this._z = z; },
    getBounds: function () { var b = new LatLngBounds(); b.extend({ lat: 25, lng: 121.5 }); return b; },
    getDiv: function () { return this._div; }
  });
  function Map(div, opts) { this._div = div; this.opts = opts || {}; return lenient(this); }
  Map.prototype = Object.create(MapBase.prototype);
  function OverlayView() {}
  var pane = function () { var d = document.createElement('div'); d.className = 'stub-pane'; return d; };
  OverlayView.prototype.setMap = function (m) {
    this.__map = m;
    if (m && this.onAdd) { this.onAdd(); if (this.draw) this.draw(); }
    if (!m && this.onRemove) this.onRemove();
  };
  OverlayView.prototype.getMap = function () { return this.__map; };
  OverlayView.prototype.getPanes = function () {
    if (!this.__panes) this.__panes = { floatPane: pane(), overlayLayer: pane(), overlayMouseTarget: pane(), markerLayer: pane() };
    return this.__panes;
  };
  OverlayView.prototype.getProjection = function () {
    return { fromLatLngToDivPixel: function () { return { x: 0, y: 0 }; }, fromLatLngToContainerPixel: function () { return { x: 0, y: 0 }; } };
  };
  var ZERO = 'ZERO_RESULTS';
  function Svc() { return lenient(this); }
  var places = {
    PlacesServiceStatus: { OK: 'OK', ZERO_RESULTS: ZERO },
    AutocompleteService: function () { return lenient({ getPlacePredictions: function (req, cb) { cb && cb([], ZERO); } }); },
    PlacesService: function () {
      var f = function (req, cb) { cb && cb([], ZERO); };
      return lenient({ getDetails: function (r, cb) { cb && cb(null, ZERO); }, textSearch: f, nearbySearch: f, findPlaceFromQuery: f });
    }
  };
  window.google = {
    maps: {
      Map: Map, Marker: makeClass(), Circle: makeClass({ setCenter: noop, setRadius: noop }),
      InfoWindow: makeClass({ open: noop, close: noop, setContent: noop }), Polyline: makeClass(),
      DirectionsRenderer: makeClass({ setDirections: noop }),
      DirectionsService: function () { return lenient({ route: function (req, cb) { var p = Promise.resolve({ routes: [] }); cb && cb({ routes: [] }, ZERO); return p; } }); },
      DirectionsStatus: { OK: 'OK', ZERO_RESULTS: ZERO },
      TravelMode: { DRIVING: 'DRIVING', WALKING: 'WALKING', TRANSIT: 'TRANSIT', BICYCLING: 'BICYCLING' },
      Animation: { DROP: 1, BOUNCE: 2 }, SymbolPath: { CIRCLE: 0 },
      LatLng: LatLng, LatLngBounds: LatLngBounds,
      Point: function (x, y) { this.x = x; this.y = y; }, Size: function (w, h) { this.width = w; this.height = h; },
      OverlayView: OverlayView, places: places,
      ControlPosition: {}, MapTypeId: { ROADMAP: 'roadmap' },
      event: { trigger: noop, addListener: function () { return { remove: noop }; }, addListenerOnce: function () { return { remove: noop }; }, clearListeners: noop, removeListener: noop }
    }
  };
  setTimeout(function () { if (typeof window.initMap === 'function') window.initMap(); }, 0);
})();
