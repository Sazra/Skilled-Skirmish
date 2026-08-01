import { findSkillDefinition, getSkillThresholdLevel } from './skills.mjs';

const GRANTED = 'granted';

/**
 * Every attribute key, used whenever a threshold's mode is "all".
 * @return {string[]}
 */
function allAttributeKeys() {
  return Object.keys(CONFIG.SKSK.attributes);
}

/**
 * The attributes a resolved (non-empty) choice value actually grants a
 * point to - a stored attribute key for "choice" mode, or every attribute
 * named by the threshold itself for the choice-less "all"/"and" modes
 * (their stored value is just the GRANTED sentinel, not an attribute key).
 * @param {object} threshold
 * @param {string} choice
 * @return {string[]}
 */
function resolveGrantedAttributes(threshold, choice) {
  if (!choice) return [];
  if (threshold.mode === 'choice') return [choice];
  return threshold.mode === 'all' ? allAttributeKeys() : threshold.attributes;
}

/**
 * For an NPC only: the live total bonus every attribute currently gets
 * from skill-threshold attribute bonuses, recomputed fresh every data
 * preparation from the NPC's current (formula-derived) skill levels -
 * never written to rawValue, unlike a Character's one-time permanent
 * grant (see applyPendingAutoGrants/chooseAttributeBonus below). A
 * "choice" mode threshold only contributes once its stored choice is set
 * (the dropdown is shown from the start for NPCs, per spec, but grants
 * nothing until chosen); "all"/"and" thresholds need no stored choice at
 * all and simply apply whenever their level is currently reached.
 * @param {Actor} actor
 * @return {Object<string, number>}
 */
export function computeNpcAttributeThresholdBonuses(actor) {
  const bonuses = Object.fromEntries(allAttributeKeys().map(k => [k, 0]));

  for (const category of Object.values(CONFIG.SKSK.skills)) {
    for (const [skillKey, def] of Object.entries(category)) {
      const thresholds = def.attributeBonusThresholds;
      if (!thresholds?.length) continue;

      const currentLevel = getSkillThresholdLevel(actor, skillKey);
      const choices = actor.system.skillAttributeBonusChoices?.[skillKey] ?? [];

      thresholds.forEach((threshold, index) => {
        if (currentLevel < threshold.level) return;
        const choice = threshold.mode === 'choice' ? (choices[index] || '') : GRANTED;
        for (const attribute of resolveGrantedAttributes(threshold, choice)) {
          if (attribute in bonuses) bonuses[attribute] += 1;
        }
      });
    }
  }

  return bonuses;
}

/**
 * Every choice-mode threshold, across every skill, that should show a
 * dropdown on this actor's Skills tab right now - a Character only once
 * its skill has actually reached the threshold's level; an NPC always,
 * from the very start, regardless of its current (formula-derived) level
 * (see the class's own doc comment). Already-chosen thresholds are never
 * included - the dropdown disappears for good once resolved.
 * @param {Actor} actor
 * @param {string} skillKey
 * @return {Array<{index: number, level: number, attributes: string[], choice: string}>}
 */
export function getVisibleAttributeBonusDropdowns(actor, skillKey) {
  const def = findSkillDefinition(skillKey);
  const thresholds = def?.attributeBonusThresholds;
  if (!thresholds?.length) return [];

  const isNpc = actor.type === 'npc';
  const currentLevel = getSkillThresholdLevel(actor, skillKey);
  const choices = actor.system.skillAttributeBonusChoices?.[skillKey] ?? [];

  const rows = [];
  thresholds.forEach((threshold, index) => {
    if (threshold.mode !== 'choice') return;
    if (choices[index]) return;
    if (!isNpc && currentLevel < threshold.level) return;
    rows.push({ index, level: threshold.level, attributes: threshold.attributes, choice: '' });
  });
  return rows;
}

/**
 * Every threshold (any mode) that already has a resolved choice, across
 * every skill - used for the GM tab's reset list. "granted" (the "all"/
 * "and" sentinel) is shown with every attribute it actually grants,
 * localized and joined.
 * @param {Actor} actor
 * @return {Array<{skillKey: string, skillLabel: string, index: number, level: number, attributeLabel: string}>}
 */
export function getResolvedAttributeBonuses(actor) {
  const resolved = [];
  for (const category of Object.values(CONFIG.SKSK.skills)) {
    for (const [skillKey, def] of Object.entries(category)) {
      const thresholds = def.attributeBonusThresholds;
      if (!thresholds?.length) continue;
      const choices = actor.system.skillAttributeBonusChoices?.[skillKey] ?? [];

      thresholds.forEach((threshold, index) => {
        const choice = choices[index];
        if (!choice) return;
        const attributes = resolveGrantedAttributes(threshold, choice);
        resolved.push({
          skillKey,
          skillLabel: def.label,
          index,
          level: threshold.level,
          attributeLabel: attributes.map(a => game.i18n.localize(CONFIG.SKSK.attributes[a])).join(' + '),
        });
      });
    }
  }
  return resolved;
}

/**
 * Resolve a "choice" mode threshold for a Character or NPC: store the
 * chosen attribute, and - Character only - immediately (and permanently)
 * add +1 to that attribute's rawValue. An NPC's choice is stored the same
 * way, but grants nothing directly; its bonus stays fully dynamic (see
 * computeNpcAttributeThresholdBonuses) so it tracks the NPC's live level.
 * A no-op if this threshold was already resolved.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} index
 * @param {string} attributeKey
 * @return {Promise<void>}
 */
export async function chooseAttributeBonus(actor, skillKey, index, attributeKey) {
  const choices = foundry.utils.deepClone(actor.system.skillAttributeBonusChoices[skillKey] ?? []);
  if (choices[index]) return;
  choices[index] = attributeKey;

  const updateData = { [`system.skillAttributeBonusChoices.${skillKey}`]: choices };
  if (actor.type !== 'npc') {
    const current = actor.system.attributes[attributeKey].rawValue;
    updateData[`system.attributes.${attributeKey}.rawValue`] = current + 1;
  }
  await actor.update(updateData);
}

/**
 * Every "all"/"and" mode threshold (no choice to make) that a Character
 * has newly reached but hasn't been granted yet - lazily detected and
 * applied on render (see sheets/actor-sheet.mjs), since there's no single
 * "skill level changed" event to hook that covers every way a Character's
 * skill levels can move (points, Species/Class bonuses, items). Not
 * relevant for NPCs - their "all"/"and" bonuses are always fully dynamic,
 * see computeNpcAttributeThresholdBonuses.
 * @param {Actor} actor
 * @return {Array<{skillKey: string, index: number, threshold: object}>}
 */
export function getPendingAutoGrants(actor) {
  if (actor.type === 'npc') return [];

  const pending = [];
  for (const category of Object.values(CONFIG.SKSK.skills)) {
    for (const [skillKey, def] of Object.entries(category)) {
      const thresholds = def.attributeBonusThresholds;
      if (!thresholds?.length) continue;
      const currentLevel = getSkillThresholdLevel(actor, skillKey);
      const choices = actor.system.skillAttributeBonusChoices?.[skillKey] ?? [];

      thresholds.forEach((threshold, index) => {
        if (threshold.mode === 'choice') return;
        if (currentLevel < threshold.level) return;
        if (choices[index]) return;
        pending.push({ skillKey, index, threshold });
      });
    }
  }
  return pending;
}

/**
 * Apply every currently-pending "all"/"and" auto-grant (see
 * getPendingAutoGrants) in one atomic update - permanently adds to
 * rawValue and marks each threshold GRANTED so it's never re-applied.
 * A no-op (and no document update at all) when nothing is pending.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function applyPendingAutoGrants(actor) {
  const pending = getPendingAutoGrants(actor);
  if (!pending.length) return;

  const rawValueDeltas = {};
  const choiceClones = {};
  for (const { skillKey, index, threshold } of pending) {
    for (const attribute of resolveGrantedAttributes(threshold, GRANTED)) {
      rawValueDeltas[attribute] = (rawValueDeltas[attribute] ?? 0) + 1;
    }
    if (!choiceClones[skillKey]) {
      choiceClones[skillKey] = foundry.utils.deepClone(actor.system.skillAttributeBonusChoices[skillKey]);
    }
    choiceClones[skillKey][index] = GRANTED;
  }

  const updateData = {};
  for (const [attribute, delta] of Object.entries(rawValueDeltas)) {
    updateData[`system.attributes.${attribute}.rawValue`] = actor.system.attributes[attribute].rawValue + delta;
  }
  for (const [skillKey, choices] of Object.entries(choiceClones)) {
    updateData[`system.skillAttributeBonusChoices.${skillKey}`] = choices;
  }
  await actor.update(updateData);
}

/**
 * Undo one resolved threshold (any mode) and clear it back to "" so its
 * dropdown (if "choice" mode) can reappear - Character only: also
 * subtracts the rawValue it originally granted. Does NOT touch the
 * underlying skill level/points at all. A no-op if nothing was resolved.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} index
 * @return {Promise<void>}
 */
export async function resetAttributeBonusChoice(actor, skillKey, index) {
  const choices = foundry.utils.deepClone(actor.system.skillAttributeBonusChoices[skillKey] ?? []);
  const choice = choices[index];
  if (!choice) return;

  const def = findSkillDefinition(skillKey);
  const threshold = def?.attributeBonusThresholds?.[index];
  const updateData = {};
  if (actor.type !== 'npc' && threshold) {
    for (const attribute of resolveGrantedAttributes(threshold, choice)) {
      const current = actor.system.attributes[attribute].rawValue;
      updateData[`system.attributes.${attribute}.rawValue`] = Math.max(0, current - 1);
    }
  }
  choices[index] = '';
  updateData[`system.skillAttributeBonusChoices.${skillKey}`] = choices;
  await actor.update(updateData);
}

/**
 * Undo every resolved threshold on this actor at once (GM tab's "reset
 * all"), in a single atomic update - see resetAttributeBonusChoice for
 * the per-entry semantics.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function resetAllAttributeBonusChoices(actor) {
  const isNpc = actor.type === 'npc';
  const rawValueDeltas = {};
  const updateData = {};

  for (const category of Object.values(CONFIG.SKSK.skills)) {
    for (const [skillKey, def] of Object.entries(category)) {
      const thresholds = def.attributeBonusThresholds;
      if (!thresholds?.length) continue;
      const choices = actor.system.skillAttributeBonusChoices?.[skillKey] ?? [];
      if (!choices.some(Boolean)) continue;

      const clearedChoices = choices.map((choice, index) => {
        if (!choice) return choice;
        if (!isNpc) {
          for (const attribute of resolveGrantedAttributes(thresholds[index], choice)) {
            rawValueDeltas[attribute] = (rawValueDeltas[attribute] ?? 0) - 1;
          }
        }
        return '';
      });
      updateData[`system.skillAttributeBonusChoices.${skillKey}`] = clearedChoices;
    }
  }

  if (!Object.keys(updateData).length) return;
  for (const [attribute, delta] of Object.entries(rawValueDeltas)) {
    const current = actor.system.attributes[attribute].rawValue;
    updateData[`system.attributes.${attribute}.rawValue`] = Math.max(0, current + delta);
  }
  await actor.update(updateData);
}
