import { getSkillLabel } from './skills.mjs';
import { postActionChatCard } from './actions.mjs';
import { applyTrainingFpGainBonus, resolveTrainingFpDestination } from './skillFp.mjs';

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
 * With an actor, its own FP-gain bonuses are folded in (see
 * helpers/skillFp.mjs#applyTrainingFpGainBonus: multiplicative per hour,
 * flat once per full 2 hours), then the same two destination rules usage
 * FP follows (see helpers/skillFp.mjs#resolveTrainingFpDestination): a
 * Resistance's own gain cap, and Seelenstärke at level 5+ feeding
 * Seelenmacht instead (soulPower: true, labelled accordingly); without an
 * actor, the raw rate-only gain.
 * @param {object|null} method
 * @param {number} hours
 * @param {Actor|null} [actor]
 * @return {Array<{skill: string, label: string, rate: number, gain: number, soulPower: boolean}>}
 */
export function computeTrainingPreview(method, hours, actor = null) {
  const h = Math.max(0, Number(hours) || 0);
  return getMethodEntries(method).map(({ skill, rate }) => {
    const label = game.i18n.localize(getSkillLabel(skill));
    if (!actor) return { skill, label, rate, gain: Math.floor(h * rate), soulPower: false };
    const { amount, soulPower } = resolveTrainingFpDestination(actor, skill, applyTrainingFpGainBonus(actor, skill, h, rate));
    return { skill, label: soulPower ? game.i18n.localize('SKSK.Resource.SoulPower') : label, rate, gain: amount, soulPower };
  });
}

/**
 * Apply a Training session to a Character: for the method's main skill and
 * every secondary skill, the computeTrainingPreview gain (bonuses, caps and
 * Seelenmacht redirect included) is added to that skill's
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
  for (const entry of computeTrainingPreview(method, hours, actor)) {
    if (entry.gain <= 0) continue;
    const path = entry.soulPower ? 'system.soulPower.value' : `system.skills.${entry.skill}.gain`;
    const current = updates[path] ?? foundry.utils.getProperty(actor, path) ?? 0;
    updates[path] = current + entry.gain;
    lines.push(game.i18n.format('SKSK.Training.SkillGained', { skill: entry.label, amount: entry.gain }));
  }
  if (Object.keys(updates).length) await actor.update(updates);

  const title = `${game.i18n.localize('SKSK.Training.Title')}: ${method?.name ?? ''}`;
  const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Training.Description', { name: actor.name, hours })}</div>`;
  const extraHTML = descriptionHTML + (lines.length ? lines : [game.i18n.localize('SKSK.Training.NoGain')])
    .map(line => `<div class="sksk-roll-line sksk-roll-fp-gain">${line}</div>`).join('');
  return postActionChatCard(actor, title, null, 0, extraHTML);
}
