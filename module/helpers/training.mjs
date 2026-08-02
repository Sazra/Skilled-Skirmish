import { getSkillLabel } from './skills.mjs';
import { postActionChatCard } from './actions.mjs';

/**
 * The GM-configured list of Training methods (world setting, edited via the
 * Training Methods settings menu - see apps/training-methods-config.mjs),
 * each shaped {id, name, mainSkill, mainRate, secondarySkills: [{skill,
 * rate}]}. mainRate/rate are FP generated per hour of training, and may be
 * fractional (see computeTrainingPreview).
 * @return {Array<object>}
 */
export function getTrainingMethods() {
  return game.settings.get('sksk', 'trainingMethods') ?? [];
}

/**
 * Look up a single Training method by id.
 * @param {string} id
 * @return {object|null}
 */
export function getTrainingMethod(id) {
  if (!id) return null;
  return getTrainingMethods().find(m => m.id === id) ?? null;
}

/**
 * A Training method's own main skill plus its secondary skills, flattened
 * into one uniform list.
 * @param {object|null} method
 * @return {Array<{skill: string, rate: number}>}
 */
function getMethodEntries(method) {
  if (!method) return [];
  const entries = [];
  if (method.mainSkill) entries.push({ skill: method.mainSkill, rate: Number(method.mainRate) || 0 });
  for (const secondary of method.secondarySkills ?? []) {
    if (secondary.skill) entries.push({ skill: secondary.skill, rate: Number(secondary.rate) || 0 });
  }
  return entries;
}

/**
 * A live preview of what training with the given method for the given
 * number of hours would grant per skill - the per-hour rate may be
 * fractional, but the actual FP granted is always floored (e.g. a 0.25
 * FP/hour rate grants nothing below 4 hours). Used both by the Training
 * dialog's own preview and by applyTraining itself, to keep the two in sync.
 * @param {object|null} method
 * @param {number} hours
 * @return {Array<{skill: string, label: string, rate: number, gain: number}>}
 */
export function computeTrainingPreview(method, hours) {
  const h = Math.max(0, Number(hours) || 0);
  return getMethodEntries(method).map(({ skill, rate }) => ({
    skill,
    label: game.i18n.localize(getSkillLabel(skill)),
    rate,
    gain: Math.floor(h * rate),
  }));
}

/**
 * Apply a Training session to a Character: for the method's main skill and
 * every secondary skill, floor(hours * rate) FP is added to that skill's
 * pending "gain" (not yet integrated into real skill points - see
 * helpers/rest.mjs#applyRest, which folds "gain" into "points" on an
 * Anpassungs-/Genesungspause). Posts a chat summary either way.
 * @param {Actor} actor
 * @param {{methodId: string, hours: number}} options
 * @return {Promise<ChatMessage>}
 */
export async function applyTraining(actor, options) {
  const method = getTrainingMethod(options.methodId);
  const hours = Math.max(0, Number(options.hours) || 0);

  const updates = {};
  const lines = [];
  for (const entry of computeTrainingPreview(method, hours)) {
    if (entry.gain <= 0) continue;
    const current = actor.system.skills?.[entry.skill]?.gain ?? 0;
    updates[`system.skills.${entry.skill}.gain`] = current + entry.gain;
    lines.push(game.i18n.format('SKSK.Training.SkillGained', { skill: entry.label, amount: entry.gain }));
  }
  if (Object.keys(updates).length) await actor.update(updates);

  const title = `${game.i18n.localize('SKSK.Training.Title')}: ${method?.name ?? ''}`;
  const extraHTML = (lines.length ? lines : [game.i18n.localize('SKSK.Training.NoGain')])
    .map(line => `<div class="sksk-roll-line">${line}</div>`).join('');
  return postActionChatCard(actor, title, null, 0, extraHTML);
}
