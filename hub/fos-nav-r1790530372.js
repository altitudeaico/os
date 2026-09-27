/* ══════════════════════════════════════════════════════════════
   FAMILY OS — NAVIGATION STACK
   Second reusable interaction primitive (with FOSFocus).

   Responsibilities kept separate:
     FOSFocus  — directional movement + activation within a view
     FOSNav    — view hierarchy (push/pop) + focus restoration

   A "view" is a named layer inside a destination (e.g. emma-main,
   emma-today, emma-playlist). Pushing a view records which focus id
   was active so BACK can restore it exactly.

   Core invariant: BACK reverses the most recent navigation step.
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function NavStack() {
    this.stack = [];            // [{ view, focusId, onEnter, onLeave }]
    this.onEmpty = null;        // called when BACK pops the last view
  }

  NavStack.prototype.reset = function () {
    this.stack = [];
  };

  NavStack.prototype.current = function () {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  };

  NavStack.prototype.currentView = function () {
    var c = this.current();
    return c ? c.view : null;
  };

  // Push a new view. rememberFocusId = the focus id in the CURRENT view
  // to restore when we come back to it.
  // onEnter() builds/shows the new view. onLeave() (optional) hides it.
  NavStack.prototype.push = function (view, rememberFocusId, onEnter, onLeave) {
    // Record restore point on the view we're leaving
    var top = this.current();
    if (top) top.focusId = rememberFocusId != null ? rememberFocusId : top.focusId;
    this.stack.push({ view: view, focusId: null, onEnter: onEnter || null, onLeave: onLeave || null });
    if (onEnter) onEnter();
  };

  // Record the focus id currently active in the top view (call as focus moves)
  NavStack.prototype.markFocus = function (focusId) {
    var top = this.current();
    if (top) top.focusId = focusId;
  };

  // BACK: pop current view, run its onLeave, return the restored view + focusId
  NavStack.prototype.back = function () {
    if (this.stack.length <= 1) {
      // At root of this destination — bubble out
      if (this.stack.length === 1) {
        var only = this.stack.pop();
        if (only && only.onLeave) only.onLeave();
      }
      if (this.onEmpty) this.onEmpty();
      return null;
    }
    var leaving = this.stack.pop();
    if (leaving && leaving.onLeave) leaving.onLeave();
    var restored = this.current();
    return restored; // { view, focusId, ... }
  };

  NavStack.prototype.depth = function () { return this.stack.length; };

  global.FOSNav = NavStack;
})(window);
