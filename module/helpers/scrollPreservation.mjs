/**
 * Every scrollable PART's own current scrollTop, keyed by partId - call
 * right before a render that's about to replace the DOM (see an
 * ApplicationV2's own _preRender). Exists because this system's Actor/Item
 * sheets each re-activate several nested custom tab groups by hand in their
 * own _onRender (Fertigkeiten's per-category sub-tabs, Zauber's per-type/
 * -school sub-tabs, etc.), since Foundry doesn't apply an initial state to
 * a nested tab group on its own. That reactivation happens AFTER Foundry's
 * own built-in scroll restoration (_preSyncPartState/_syncPartState) runs -
 * which tries to restore a PART's scrollTop while the correct nested tab
 * inside it is still hidden, so the assignment gets silently clamped back
 * to 0 by the browser (a hidden container's scrollHeight is ~0 at that
 * point). Capturing/reapplying scroll ourselves, AFTER our own tab
 * reactivation, fixes that ordering - see restoreScrollPositions below.
 * @param {foundry.applications.api.ApplicationV2} app
 * @return {Map<string, number>}
 */
export function captureScrollPositions(app) {
  const positions = new Map();
  if (!app.element) return positions;
  for (const [partId, part] of Object.entries(app.constructor.PARTS ?? {})) {
    if (!part.scrollable?.length) continue;
    const root = app.element.querySelector(`[data-application-part="${partId}"]`);
    if (root) positions.set(partId, root.scrollTop);
  }
  return positions;
}

/**
 * Re-apply scrollTop values captured by captureScrollPositions - call at
 * the END of _onRender, after every nested tab group has already been
 * reactivated (changeTab), so the target container is actually tall enough
 * again for the assignment to stick.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {Map<string, number>} positions
 */
export function restoreScrollPositions(app, positions) {
  for (const [partId, scrollTop] of positions) {
    const root = app.element.querySelector(`[data-application-part="${partId}"]`);
    if (root) root.scrollTop = scrollTop;
  }
}
