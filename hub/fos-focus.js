/* ══════════════════════════════════════════════════════════════
   FAMILY OS — TV FOCUS MANAGER
   First reusable interaction primitive. Home, Academy, Elsie's
   World, Memories and Watch will all use this grammar.

   Model: focusable items registered with a semantic id and a
   spatial position. Directional movement finds the nearest item
   in the pressed direction. ENTER activates. BACK unwinds panels
   then bubbles to the host.

   Keep it small. Not a UI framework.
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function FocusManager() {
    this.items = [];          // { id, el, onEnter, group }
    this.currentId = null;
    this.backStack = [];      // panel close handlers, LIFO
    this.onBack = null;       // host handler when stack empty
    this.focusClass = 'fos-focused';
  }

  FocusManager.prototype.reset = function () {
    this.items = [];
    this.currentId = null;
    this.backStack = [];
  };

  // Register a focusable. rect() returns {x,y,w,h} in viewport px.
  FocusManager.prototype.register = function (id, el, onEnter, group) {
    if (!el) return;
    this.items.push({ id: id, el: el, onEnter: onEnter || null, group: group || 'default' });
  };

  FocusManager.prototype._center = function (item) {
    var r = item.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
  };

  FocusManager.prototype.focus = function (id) {
    var found = this.items.find(function (i) { return i.id === id; });
    if (!found) return false;
    this.items.forEach(function (i) { i.el.classList.remove(this.focusClass); }, this);
    found.el.classList.add(this.focusClass);
    this.currentId = id;
    // Ensure visible (for lists that scroll)
    if (found.el.scrollIntoView) {
      try { found.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    }
    return true;
  };

  FocusManager.prototype.focusFirst = function (group) {
    var pool = group ? this.items.filter(function (i) { return i.group === group; }) : this.items;
    if (!pool.length) return;
    // top-most, then left-most
    pool.sort(function (a, b) {
      var ca = a.el.getBoundingClientRect(), cb = b.el.getBoundingClientRect();
      if (Math.abs(ca.top - cb.top) > 20) return ca.top - cb.top;
      return ca.left - cb.left;
    });
    this.focus(pool[0].id);
  };

  // Directional move: dir in 'left'|'right'|'up'|'down'
  FocusManager.prototype.move = function (dir) {
    var cur = this.items.find(function (i) { return i.id === this.currentId; }, this);
    if (!cur) { this.focusFirst(); return; }
    var cc = this._center(cur);

    var best = null, bestScore = Infinity;
    this.items.forEach(function (cand) {
      if (cand.id === cur.id) return;
      var c = this._center(cand);
      var dx = c.x - cc.x, dy = c.y - cc.y;

      var inDir =
        (dir === 'left'  && dx < -4) ||
        (dir === 'right' && dx >  4) ||
        (dir === 'up'    && dy < -4) ||
        (dir === 'down'  && dy >  4);
      if (!inDir) return;

      // Primary axis distance + heavy penalty for cross-axis drift
      var primary, cross;
      if (dir === 'left' || dir === 'right') { primary = Math.abs(dx); cross = Math.abs(dy); }
      else { primary = Math.abs(dy); cross = Math.abs(dx); }
      var score = primary + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = cand; }
    }, this);

    if (best) this.focus(best.id);
  };

  FocusManager.prototype.activate = function () {
    var cur = this.items.find(function (i) { return i.id === this.currentId; }, this);
    if (cur && cur.onEnter) cur.onEnter(cur);
  };

  // Panels: push a close handler; BACK pops it before bubbling to host
  FocusManager.prototype.pushPanel = function (closeFn) { this.backStack.push(closeFn); };
  FocusManager.prototype.back = function () {
    if (this.backStack.length) {
      var fn = this.backStack.pop();
      if (fn) fn();
      return true; // handled
    }
    if (this.onBack) { this.onBack(); return true; }
    return false;
  };

  // Handle a key event. Returns true if handled.
  FocusManager.prototype.handleKey = function (key, code) {
    var isLeft  = key === 'ArrowLeft'  || code === 37;
    var isRight = key === 'ArrowRight' || code === 39;
    var isUp    = key === 'ArrowUp'    || code === 38;
    var isDown  = key === 'ArrowDown'  || code === 40;
    var isOK    = key === 'Enter' || code === 13 || code === 23;
    var isBack  = code === 4 || code === 27 || key === 'Escape' || key === 'GoBack';

    if (isBack)  return this.back();
    if (isOK)    { this.activate(); return true; }
    if (isLeft)  { this.move('left');  return true; }
    if (isRight) { this.move('right'); return true; }
    if (isUp)    { this.move('up');    return true; }
    if (isDown)  { this.move('down');  return true; }
    return false;
  };

  global.FOSFocus = FocusManager;
})(window);
