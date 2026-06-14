/* kit-layout.js — declarative screen layout API.
 *
 * Games declare layout intent; the platform translates it into CSS custom
 * properties on #gameScreen. The shared shell (GameShell.renderTable) reads
 * those properties via main.css rules. Concrete shape:
 *
 *   Kit.Layout.apply({
 *     minis:   { maxHeight: '24dvh', minColWidth: 132 },  // opponent strip
 *     main:    { fit: 'contain', maxWidth: 1040 },        // focus board
 *     center:  { maxHeight: '30dvh' },                    // dice/piles zone
 *     status:  { sticky: true },                          // status bar
 *     mobile:  { breakpoint: 560, stack: 'vertical' },    // small-screen rules
 *   });
 *
 * Each known field becomes a CSS custom property on #gameScreen:
 *   --gs-minis-max-h: 24dvh
 *   --gs-minis-mincol: 132px
 *   --gs-main-max-w: 1040px
 *   --gs-center-max-h: 30dvh
 *   ...
 *
 * Rules in main.css already use these custom properties (with sensible
 * defaults), so a game opting in is purely additive. Games can call apply()
 * any time (typically once on first render, then never).
 *
 * Why custom-property-based and not direct style mutation: it lets the same
 * declarative intent drive media queries (which can override the property
 * with a different value at breakpoints, in CSS, declaratively) AND keeps
 * the shell's grid logic in CSS rather than JS.
 */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Layout] Kit not loaded'); return; }

  const TARGET_ID = 'gameScreen';
  // Whitelist of fields → CSS custom property name. Anything else is silently
  // ignored so a game can pass forward-compatible fields without breaking.
  const FIELD_MAP = {
    'minis.maxHeight':  '--gs-minis-max-h',
    'minis.minColWidth':'--gs-minis-mincol',
    'minis.gap':        '--gs-minis-gap',
    'main.maxWidth':    '--gs-main-max-w',
    'main.minHeight':   '--gs-main-min-h',
    'main.padding':     '--gs-main-pad',
    'center.maxHeight': '--gs-center-max-h',
    'center.padding':   '--gs-center-pad',
    'status.sticky':    '--gs-status-sticky',   // 1 / 0
    'mobile.breakpoint':'--gs-mobile-bp',
  };

  function setVar(name, value) {
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    if (value == null || value === false) { target.style.removeProperty(name); return; }
    if (value === true) value = '1';
    if (typeof value === 'number') value = value + 'px'; // numeric → px
    target.style.setProperty(name, String(value));
  }

  function flatten(obj, prefix) {
    const out = {};
    for (const k of Object.keys(obj || {})) {
      const path = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, path));
      else out[path] = v;
    }
    return out;
  }

  /** Apply a layout spec. Pass the entire intent object every time you want
   *  the layout to change (we don't merge with previous calls). */
  function apply(spec) {
    if (!spec || typeof spec !== 'object') return;
    // Clear previously-set vars so removed fields actually disappear.
    const target = document.getElementById(TARGET_ID);
    if (target) {
      for (const cssVar of Object.values(FIELD_MAP)) target.style.removeProperty(cssVar);
    }
    const flat = flatten(spec, '');
    for (const [path, val] of Object.entries(flat)) {
      const cssVar = FIELD_MAP[path];
      if (!cssVar) continue; // unknown field — silently ignore
      setVar(cssVar, val);
    }
  }

  /** Read back the currently-applied spec (resolved values, as strings). */
  function current() {
    const target = document.getElementById(TARGET_ID);
    if (!target) return {};
    const out = {};
    for (const [path, cssVar] of Object.entries(FIELD_MAP)) {
      const v = target.style.getPropertyValue(cssVar);
      if (v) out[path] = v;
    }
    return out;
  }

  /** Reset the layout to defaults (called by GameShell.unmount). */
  function reset() {
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    for (const cssVar of Object.values(FIELD_MAP)) target.style.removeProperty(cssVar);
  }

  /* The Kit.Layout.fit JS solver was removed after three rounds of
   * iteration showed it was the wrong tool: it competed with CSS
   * Flexbox (which already does this job natively) and produced
   * unpredictable layouts when its allocations diverged from
   * content-based sizing. The platform layout is now pure CSS
   * Flexbox on #gameScreen.active (see main.css). Game files no
   * longer call any solver. The legacy `apply()` API (declarative
   * caps via CSS custom properties) is preserved — it's a thin
   * declarative layer over CSS vars, not an algorithm. */
  Kit.Layout = { apply, current, reset, FIELD_MAP };
})();
