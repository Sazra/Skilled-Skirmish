/**
 * Ability choices ("Wähle eine/zwei der folgenden Fähigkeiten"): a Class or
 * Species ability can offer options, from which its owner learns a number.
 *
 * An option is an ordinary entry of the item's `abilities` array (so it has
 * every ability field - passive/active/once, costs, charges, effect spell,
 * its own Active Effects ...) that points to its parent with `optionOf` (the
 * parent's index, -1 for a normal ability). It only counts - is listed, can be
 * used, grants its effects - while `chosen` is set on the actor's copy of the
 * item. It unlocks with its parent's level.
 *
 * The parent carries `choiceCount` (a formula like the charges one, "2" or
 * "1 + (L >= 12)" ...) - how many options may be chosen - and optionally
 * `choiceExtraFrom`: a list of other parents' indexes whose options may also
 * be taken here once their own slots are full (Mönch: "or one more of the
 * normal Mönchsfähigkeiten"). Players may add choices while slots are free;
 * only the GM can take one back or exceed the slots.
 */

import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { evaluateChargeFormula } from './abilityCharges.mjs';

/** @param {{optionOf?: number}|null|undefined} entry   @return {boolean} */
export const isOptionEntry = (entry) => (entry?.optionOf ?? -1) >= 0;

/**
 * Whether an ability entry counts at all: a normal ability always, an option
 * only once chosen.
 * @param {object|null|undefined} entry
 * @return {boolean}
 */
export const isAbilityChosen = (entry) => !isOptionEntry(entry) || !!entry.chosen;

/**
 * The unlock level of an ability entry: its own slot's level, for an option
 * its parent's.
 * @param {number[]} levels   getClassAbilityLevels(...)
 * @param {object[]} abilities   The item's abilities array.
 * @param {number} index
 * @return {number}
 */
export function getAbilityUnlockLevel(levels, abilities, index) {
  const entry = abilities?.[index];
  const base = isOptionEntry(entry) ? entry.optionOf : index;
  return levels[base] ?? 1;
}

const parseIndexes = (text) => String(text ?? '').split(/[,;\s]+/).map(part => parseInt(part, 10)).filter(Number.isInteger);

/**
 * Every choice group of a Class/Species item (the abilities that have options
 * or a choice count), with the state of its slots.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object[]} [abilities]   Defaults to the item's own array (pass a modified copy to simulate).
 * @return {Array<{parentIndex: number, name: string, count: number, own: number[], extra: Array<{parentIndex: number, name: string, indexes: number[]}>,
 *   chosenOwn: number, usedExtra: number, used: number, free: number}>}
 */
export function getChoiceGroups(actor, item, abilities = item.system.abilities ?? []) {
  const groups = [];
  const optionsOf = (parent) => abilities.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.optionOf === parent).map(({ index }) => index);
  const countOf = (parent) => evaluateChargeFormula(abilities[parent]?.choiceCount, actor);
  const chosenOf = (parent) => optionsOf(parent).filter(index => abilities[index].chosen).length;

  // Parents whose overflow another group takes over (see choiceExtraFrom).
  const absorbed = new Set(abilities.flatMap(entry => (isOptionEntry(entry) ? [] : parseIndexes(entry.choiceExtraFrom))));

  abilities.forEach((entry, parentIndex) => {
    if (isOptionEntry(entry)) return;
    const own = optionsOf(parentIndex);
    if (!own.length && !String(entry.choiceCount ?? '').trim()) return;
    const extra = parseIndexes(entry.choiceExtraFrom)
      .filter(index => index !== parentIndex && abilities[index] && !isOptionEntry(abilities[index]))
      .map(index => ({ parentIndex: index, name: abilities[index].name, indexes: optionsOf(index) }));
    const count = countOf(parentIndex);
    const chosenOwn = chosenOf(parentIndex);
    // Choices of another parent's options only use up this group's slots
    // once that parent's own slots are full.
    const usedExtra = extra.reduce((sum, entryExtra) => sum + Math.max(0, chosenOf(entryExtra.parentIndex) - countOf(entryExtra.parentIndex)), 0);
    const used = (absorbed.has(parentIndex) ? Math.min(chosenOwn, count) : chosenOwn) + usedExtra;
    groups.push({ parentIndex, name: entry.name, count, own, extra, chosenOwn, usedExtra, used, free: count - used });
  });
  return groups;
}

/**
 * The "x/N" label of a parent ability for the Abilities tab, or '' if it has no options.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} parentIndex
 * @return {string}
 */
export function getChoiceLabel(actor, item, parentIndex) {
  const group = getChoiceGroups(actor, item).find(entry => entry.parentIndex === parentIndex);
  if (!group || (!group.own.length && !group.extra.some(entry => entry.indexes.length))) return '';
  return game.i18n.format('SKSK.Ability.Choice.Label', { used: group.used, count: group.count });
}

/**
 * Whether choosing the given option breaks no limit of the item's groups
 * (a player's choice; the GM is not limited).
 * @param {Actor} actor
 * @param {Item} item
 * @param {object[]} abilities   The abilities array with the choices to check.
 * @return {boolean}
 */
export function choicesWithinLimits(actor, item, abilities) {
  // An overflow of a group's own slots is only fine if another group takes it
  // over (its usedExtra), and that group's own limit then decides.
  return getChoiceGroups(actor, item, abilities).every(group => group.used <= group.count);
}

/**
 * Open the dialog to choose the options of one ability. The GM may change
 * anything; a player may only add choices while slots are free (a made choice
 * is locked).
 * @param {Actor} actor
 * @param {Item} item   The Class/Species item.
 * @param {number} parentIndex
 * @return {Promise<void>}
 */
export async function openAbilityChoice(actor, item, parentIndex) {
  const abilities = item.system.abilities ?? [];
  const group = getChoiceGroups(actor, item).find(entry => entry.parentIndex === parentIndex);
  if (!group) return;
  const isGM = game.user.isGM;
  const esc = foundry.utils.escapeHTML;

  const renderOption = (index) => {
    const entry = abilities[index];
    const locked = entry.chosen && !isGM;
    return `<div class="sksk-choice-option"><label class="checkbox">
      <input type="checkbox" name="opt-${index}" ${entry.chosen ? 'checked' : ''} ${locked ? 'disabled' : ''} />
      <strong>${esc(entry.name || item.name)}</strong></label>
      <p class="hint">${esc(entry.description ?? '')}</p></div>`;
  };
  let content = `<p>${game.i18n.format('SKSK.Ability.Choice.Intro', { name: esc(group.name || item.name), count: group.count })}</p>`
    + `<p class="hint">${game.i18n.localize(isGM ? 'SKSK.Ability.Choice.HintGM' : 'SKSK.Ability.Choice.HintPlayer')}</p>`;
  content += group.own.map(renderOption).join('');
  for (const extra of group.extra) {
    if (!extra.indexes.length) continue;
    content += `<h4>${game.i18n.format('SKSK.Ability.Choice.ExtraFrom', { name: esc(extra.name || item.name) })}</h4>`;
    content += extra.indexes.map(renderOption).join('');
  }

  const allIndexes = [...group.own, ...group.extra.flatMap(entry => entry.indexes)];
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format('SKSK.Ability.Choice.Title', { name: group.name || item.name }) },
    content: `<div class="sksk-ability-choice">${content}</div>`,
    ok: {
      label: game.i18n.localize('SKSK.Ability.Choice.Confirm'),
      callback: (event, button) => Object.fromEntries(allIndexes.map(index => [index, !!button.form.elements[`opt-${index}`]?.checked])),
    },
    rejectClose: false,
  });
  if (!picked) return;

  const updated = foundry.utils.deepClone(abilities);
  let changed = false;
  for (const [index, chosen] of Object.entries(picked)) {
    const entry = updated[index];
    if (!entry || !!entry.chosen === chosen) continue;
    entry.chosen = chosen;
    // Taking a choice back also ends its activation.
    if (!chosen) Object.assign(entry, { active: false, roundsRemaining: 0 });
    changed = true;
  }
  if (!changed) return;
  if (!isGM && !choicesWithinLimits(actor, item, updated)) {
    ui.notifications.warn(game.i18n.localize('SKSK.Ability.Choice.TooMany'));
    return;
  }
  await item.update({ 'system.abilities': updated });
}

/**
 * Whether an Active Effect belongs to an option nobody chose (it is then
 * suppressed).
 * @param {ActiveEffect} effect
 * @return {boolean}
 */
export function isEffectOfUnchosenOption(effect) {
  const parent = effect.parent;
  if (parent?.documentName !== 'Item' || (parent.type !== 'class' && parent.type !== 'species')) return false;
  const index = effect.getFlag?.('sksk', 'abilityIndex');
  if (!Number.isInteger(index)) return false;
  const entry = parent.system.abilities?.[index];
  return isOptionEntry(entry) && !entry.chosen;
}

/**
 * Whether the actor may currently use an ability entry: chosen (if an option)
 * and unlocked by level (Class only).
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} index
 * @return {boolean}
 */
export function isAbilityAvailable(actor, item, index) {
  const abilities = item.system.abilities ?? [];
  if (!isAbilityChosen(abilities[index])) return false;
  if (item.type !== 'class') return true;
  const levels = getClassAbilityLevels(item.system.classType, actorHasAdvancedClass(actor));
  return (actor.system.resources?.level?.value ?? 1) >= getAbilityUnlockLevel(levels, abilities, index);
}
