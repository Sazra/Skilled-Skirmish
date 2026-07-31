/**
 * The natural (unmodified) d20 result from a roll built as "1d20[ + ...]" -
 * every D20 roll in this system puts its d20 term first. Used to detect
 * critical successes/failures, which key off the raw die, never the roll's
 * modified total.
 * @param {Roll} roll
 * @return {number|null}
 */
export function getNaturalD20(roll) {
  const die = roll.dice?.[0];
  return die?.faces === 20 ? die.total : null;
}

const GENERIC_THRESHOLDS = Object.freeze({ success: 20, failure: 1 });

/**
 * An Angriffswurf's (attack roll's) own critical thresholds - configurable
 * per actor (system.criticalHitThreshold/criticalFailureThreshold, GM tab,
 * directly editable and equally targetable by Active Effects). Clamped to
 * their schema's own [10,20]/[1,10] range in case an Active Effect pushes a
 * value outside it. Falls back to the fixed 20/1 used by every other D20
 * roll when there's no actor at all (e.g. an unowned spell item's attack
 * roll).
 * @param {Actor|null} actor
 * @return {{success: number, failure: number}}
 */
export function getAttackCriticalThresholds(actor) {
  if (!actor) return GENERIC_THRESHOLDS;
  const success = Math.min(20, Math.max(10, actor.system.criticalHitThreshold ?? 20));
  const failure = Math.min(10, Math.max(1, actor.system.criticalFailureThreshold ?? 1));
  return { success, failure };
}

/**
 * Whether a natural D20 result is a critical success/failure/neither,
 * against a given pair of thresholds - success is "at or above", failure is
 * "at or below" (a tie between the two, possible only if thresholds were
 * pushed to overlap, resolves as a success).
 * @param {number|null} natural
 * @param {{success: number, failure: number}} thresholds
 * @return {"success"|"failure"|null}
 */
export function getCriticalType(natural, thresholds) {
  if (natural === null) return null;
  if (natural >= thresholds.success) return 'success';
  if (natural <= thresholds.failure) return 'failure';
  return null;
}

/**
 * Critical type for an Angriffswurf (attack roll) - see
 * getAttackCriticalThresholds for where its variable thresholds come from.
 * @param {Roll} roll
 * @param {Actor|null} actor   The attacker (whose thresholds apply).
 * @return {"success"|"failure"|null}
 */
export function getAttackCriticalType(roll, actor) {
  return getCriticalType(getNaturalD20(roll), getAttackCriticalThresholds(actor));
}

/**
 * Critical type for any non-attack D20 roll (attribute checks, saving
 * throws, Restrained/Poison/Concentration checks, ...) - always a fixed
 * natural 20/1, never actor-configurable (only Angriffswürfe use variable
 * thresholds).
 * @param {Roll} roll
 * @return {"success"|"failure"|null}
 */
export function getGenericCriticalType(roll) {
  return getCriticalType(getNaturalD20(roll), GENERIC_THRESHOLDS);
}

/**
 * Whether a check against a DC/AC/MR succeeds, accounting for critical
 * overrides: a critical success always succeeds and a critical failure
 * always fails, regardless of whether the rolled total would otherwise
 * have cleared (or missed) the target value.
 * @param {number} total
 * @param {number} target
 * @param {"success"|"failure"|null} criticalType
 * @return {boolean}
 */
export function resolveCheckSuccess(total, target, criticalType) {
  if (criticalType === 'success') return true;
  if (criticalType === 'failure') return false;
  return total >= target;
}

/**
 * Wrap a block of rendered roll HTML in a green/red critical-success or
 * critical-failure div (see css/sksk.css's .sksk-critical-success/-failure,
 * which color the die's own .dice-total) - a no-op when there's nothing to
 * highlight.
 * @param {string} html
 * @param {"success"|"failure"|null} criticalType
 * @return {string}
 */
export function wrapCriticalBlock(html, criticalType) {
  if (!criticalType) return html;
  return `<div class="sksk-critical-${criticalType}">${html}</div>`;
}

/**
 * Wrap a short piece of inline text (e.g. an outcome label) the same way,
 * but as a span rather than a block.
 * @param {string} text
 * @param {"success"|"failure"|null} criticalType
 * @return {string}
 */
export function wrapCriticalInline(text, criticalType) {
  if (!criticalType) return text;
  return `<span class="sksk-critical-${criticalType}">${text}</span>`;
}
