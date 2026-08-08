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

/**
 * How "good" a resolved d20 result is, for ranking one roll against another
 * under Vorteil/Nachteil (Angriffswürfe - see helpers/attackRolls.mjs#
 * chooseAttackMode/resolveHitEvaluationFromChat; generic D20 rolls - see
 * chooseGenericRollMode/evaluateD20WithMode below) - a critical success is
 * always the best possible outcome and a critical failure always the worst,
 * regardless of either roll's total (mirrors resolveCheckSuccess's own
 * critical-overrides-total rule); otherwise the raw total itself is the
 * score.
 * @param {number} total
 * @param {"success"|"failure"|null} criticalType
 * @return {number}
 */
export function rollQuality(total, criticalType) {
  if (criticalType === 'success') return Infinity;
  if (criticalType === 'failure') return -Infinity;
  return total;
}

/**
 * The three ways a generic (non-Angriffswurf) D20 roll can resolve - see
 * chooseGenericRollMode/evaluateD20WithMode. Mirrors helpers/attackRolls.mjs#
 * ATTACK_MODES, kept separate since generic rolls resolve in one step
 * (mode chosen BEFORE rolling, then rolled and evaluated immediately) rather
 * than an Angriffswurf's own roll-first-evaluate-later flow.
 */
const GENERIC_ROLL_MODES = [
  { id: 'neutral', label: 'SKSK.GenericRoll.ModeNeutral' },
  { id: 'advantage', label: 'SKSK.GenericRoll.ModeAdvantage' },
  { id: 'disadvantage', label: 'SKSK.GenericRoll.ModeDisadvantage' },
];

/**
 * Prompt for which mode a generic (non-Angriffswurf) D20 roll should use -
 * one button per GENERIC_ROLL_MODES entry, matching helpers/skillRolls.mjs#
 * chooseSkillRollVariant's own one-click dialog pattern. Used only by
 * player-triggered rolls (skill checks, attribute checks, saving throws, a
 * manual Restrained escape attempt); fully automatic background checks
 * (Restrained's own turn-start/end timing, Poison's recheck, Concentration)
 * skip this dialog entirely and use the actor's own GM-tab preset instead -
 * see data/actor-base.mjs#genericCriticalRollMode.
 * @return {Promise<string|null>} The chosen mode's id, or null/undefined if
 *   the dialog was closed without picking one - the caller should abort.
 */
export async function chooseGenericRollMode() {
  const buttons = GENERIC_ROLL_MODES.map(mode => ({
    action: mode.id,
    label: game.i18n.localize(mode.label),
    callback: () => mode.id,
  }));
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('SKSK.GenericRoll.ChooseModeTitle') },
    content: `<p>${game.i18n.localize('SKSK.GenericRoll.ChooseModePrompt')}</p>`,
    buttons,
    rejectClose: false,
  });
}

/**
 * Roll a generic (non-Angriffswurf) D20 check under a given mode: Neutral
 * rolls (and uses) a single d20; Vorteil/Nachteil roll two independent d20s
 * and pick the better/worse one (see rollQuality) - both evaluated and
 * resolved immediately, unlike an Angriffswurf's own deferred-evaluation
 * flow, since a generic check's target (DC) is already known at roll time.
 * @param {string} formula   A "1d20 + ..." formula (d20 term first).
 * @param {object} rollData
 * @param {"neutral"|"advantage"|"disadvantage"} mode
 * @return {Promise<{roll: Roll, criticalType: "success"|"failure"|null,
 *   doubleCritical: boolean, rollA: Roll, critA: "success"|"failure"|null,
 *   rollB: Roll|null, critB: "success"|"failure"|null, pickedB: boolean}>}
 *   roll/criticalType are the one that counts; doubleCritical is true only
 *   when BOTH d20s (Vorteil/Nachteil only, never Neutral) were natural
 *   criticals - see Luck's own "doubleCriticalRoll" FP trigger (helpers/
 *   skillFp.mjs), mirroring Präzision's own doubleCriticalHit rule.
 */
export async function evaluateD20WithMode(formula, rollData, mode) {
  const rollA = await new Roll(formula, rollData).evaluate();
  const critA = getGenericCriticalType(rollA);
  if (mode !== 'advantage' && mode !== 'disadvantage') {
    return { roll: rollA, criticalType: critA, doubleCritical: false, rollA, critA, rollB: null, critB: null, pickedB: false };
  }

  const rollB = await new Roll(formula, rollData).evaluate();
  const critB = getGenericCriticalType(rollB);
  const qualityA = rollQuality(rollA.total, critA);
  const qualityB = rollQuality(rollB.total, critB);
  const pickedB = mode === 'advantage' ? qualityB > qualityA : qualityB < qualityA;
  return {
    roll: pickedB ? rollB : rollA,
    criticalType: pickedB ? critB : critA,
    doubleCritical: critA === 'success' && critB === 'success',
    rollA, critA, rollB, critB, pickedB,
  };
}

/**
 * A short transparency line showing both of a Vorteil/Nachteil generic
 * roll's totals and which one counted - empty for Neutral (nothing to add,
 * the single roll speaks for itself).
 * @param {Awaited<ReturnType<typeof evaluateD20WithMode>>} result
 * @param {"neutral"|"advantage"|"disadvantage"} mode
 * @return {string}
 */
export function formatD20ModeSummaryLine(result, mode) {
  if (mode !== 'advantage' && mode !== 'disadvantage') return '';
  const modeLabel = game.i18n.localize(GENERIC_ROLL_MODES.find(m => m.id === mode)?.label ?? '');
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.GenericRoll.ModeSummary', {
    mode: modeLabel, totalA: result.rollA.total, totalB: result.rollB.total,
    chosen: result.pickedB ? 'B' : 'A',
  })}</div>`;
}
