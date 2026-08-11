import { getActorSkillLevel } from './skills.mjs';

/**
 * Roughly-opposite tolerance for the base Flankieren rule: an ally's angle
 * (measured from the target, relative to the flanker's own angle) must be at
 * least this many degrees to count as "on the other side" of the target.
 * The single tunable constant if live-testing shows this too strict/loose.
 */
const FLANK_FULL_MIN_ANGLE = 135;

/**
 * Loosened tolerance once the flanker's own Tactic level is 5+ - "senkrecht"
 * (perpendicular) or better counts too, not just fully opposite.
 */
const FLANK_PERPENDICULAR_MIN_ANGLE = 45;

/**
 * Whether an actor counts as a melee-capable flanking partner - true if it
 * owns any weapon Item whose effectiveProperties (see helpers/attackRolls.mjs
 * for the same `.some(p => p.property === 'X')` pattern) do NOT include
 * "ranged", or if it owns no weapons at all (falls back to Martial Arts,
 * always melee). There's no "weapon currently in use" concept for an actor
 * who isn't the one rolling right now, so this is a best-guess heuristic -
 * only relevant for classifying potential flanking allies, not the flanker
 * itself (which may be ranged).
 * @param {Actor} actor
 * @return {boolean}
 */
export function isMeleeCapable(actor) {
  const weapons = actor?.items?.filter(i => i.type === 'weapon') ?? [];
  if (!weapons.length) return true;
  return weapons.some(w => !(w.system.effectiveProperties ?? []).some(p => p.property === 'ranged'));
}

/**
 * The angle (degrees, 0-360) from one point to another, in raw pixel space -
 * grid-agnostic (works identically for square/hex/gridless scenes).
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @return {number}
 */
function angleBetween(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/**
 * The shortest angular difference between two angles, normalized to [0,180] -
 * e.g. 10 and 350 differ by 20, not 340.
 * @param {number} a
 * @param {number} b
 * @return {number}
 */
function angleDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Whether flankerActor is currently flanking targetActor: a melee-capable
 * ally (same token disposition as the flanker, excluding the flanker and
 * target themselves) positioned - as seen from the target - roughly opposite
 * the flanker (or, once the flanker's own Tactic level is 5+, merely roughly
 * perpendicular). No distance/range check at all, for either the flanker or
 * the ally - only the angle and the ally's melee-capability matter (see
 * helpers/actions.mjs/attackRolls.mjs for where the resulting attack bonus,
 * Vorteil suggestion, and Tactic-10 AC bonus are applied). Resolves tokens
 * via canvas.tokens.placeables - silently returns { flanking: false } if
 * either actor has no token on the current scene, or if they're the same
 * actor.
 * @param {Actor} flankerActor
 * @param {Actor} targetActor
 * @return {{flanking: boolean}}
 */
export function checkFlanking(flankerActor, targetActor) {
  if (!flankerActor || !targetActor || flankerActor === targetActor) return { flanking: false };

  const placeables = canvas?.tokens?.placeables ?? [];
  const flankerToken = placeables.find(t => t.actor === flankerActor);
  const targetToken = placeables.find(t => t.actor === targetActor);
  if (!flankerToken || !targetToken) return { flanking: false };

  const candidates = placeables.filter(t =>
    t !== flankerToken && t !== targetToken
    && t.document.disposition === flankerToken.document.disposition
    && isMeleeCapable(t.actor)
  );
  if (!candidates.length) return { flanking: false };

  // Read positions straight off each TokenDocument (getCenterPoint(), the
  // documented v11+ replacement for the placeable-only .center getter)
  // rather than the rendered placeable, so this never depends on canvas
  // render/refresh timing having caught up with the latest position.
  const targetCenter = targetToken.document.getCenterPoint();
  const flankerAngle = angleBetween(targetCenter, flankerToken.document.getCenterPoint());
  const minAngle = getActorSkillLevel(flankerActor, 'tactic') >= 5
    ? FLANK_PERPENDICULAR_MIN_ANGLE : FLANK_FULL_MIN_ANGLE;

  const flanking = candidates.some(candidate => {
    const candidateAngle = angleBetween(targetCenter, candidate.document.getCenterPoint());
    return angleDifference(flankerAngle, candidateAngle) >= minAngle;
  });
  return { flanking };
}
