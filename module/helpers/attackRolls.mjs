import { getActorSkillLevel } from './skills.mjs';
import { getSpellSchool } from './spells.mjs';
import { computeNaturalMaterialBonus } from './defense.mjs';
import { applyD20Malus } from './statusEffects.mjs';

/**
 * The highest of a set of attribute modifiers, unless every one of them is
 * equal - in which case they're all summed instead. Shared by Masterful
 * weapons and every Martial Arts attack (see computeWeaponAttackBonus/
 * computeMartialArtsAttackBonus below) - both use this exact rule.
 * @param {number[]} mods
 * @return {number}
 */
function highestOrSumIfAllTied(mods) {
  if (!mods.length) return 0;
  const highest = Math.max(...mods);
  return mods.every(mod => mod === highest) ? mods.reduce((sum, mod) => sum + mod, 0) : highest;
}

/**
 * Among a Combined spell's own combinedSkills entries, the caster's actual
 * current level in each - the highest one is added as the attack bonus,
 * and every entry tied at that same highest level is summed instead of
 * just the one (e.g. a spell requiring Fire/Water/Air, caster at
 * Fire 3/Water 3/Air 2, contributes 3+3=6, not just 3).
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
function computeCombinedSkillAttackBonus(spellSystem, actor) {
  const levels = (spellSystem.combinedSkills ?? []).map(entry => getActorSkillLevel(actor, entry.skill));
  if (!levels.length) return 0;
  const highest = Math.max(...levels);
  return levels.filter(level => level === highest).reduce((sum, level) => sum + level, 0);
}

/**
 * A spell's Angriffswurf (attack roll) bonus, added to both of the two
 * d20s rolled for it - depends on spellType:
 * - Simple/Advanced: Willpower modifier + the caster's level in the
 *   spell's own magicSchool + Hit Correction skill level + that school's
 *   variable bonus/malus (system.magicSchoolAttackBonus.<school>, an
 *   Active-Effect-only field).
 * - Combined: Willpower modifier + Hit Correction skill level + the
 *   spell's own combinedSchool's variable bonus/malus
 *   (system.combinedMagicSchoolAttackBonus.<school>) + the combinedSkills
 *   bonus (see computeCombinedSkillAttackBonus).
 * - Systemless: Willpower modifier + Hit Correction skill level + Magic
 *   Control skill level.
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpellAttackBonus(spellSystem, actor) {
  const wilMod = actor.system.attributes?.wil?.mod ?? 0;
  const hitCorrection = getActorSkillLevel(actor, 'hitCorrection');

  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    const schoolLevel = getActorSkillLevel(actor, spellSystem.magicSchool);
    const schoolBonus = actor.system.magicSchoolAttackBonus?.[spellSystem.magicSchool] ?? 0;
    return wilMod + schoolLevel + hitCorrection + schoolBonus;
  }

  if (spellSystem.spellType === 'combined') {
    const schoolBonus = actor.system.combinedMagicSchoolAttackBonus?.[spellSystem.combinedSchool] ?? 0;
    return wilMod + hitCorrection + schoolBonus + computeCombinedSkillAttackBonus(spellSystem, actor);
  }

  // Systemless.
  return wilMod + hitCorrection + getActorSkillLevel(actor, 'magicControl');
}

/**
 * The attribute keys a weapon's Angriffswurf (attack roll) attribute bonus
 * draws from - its own attributeOverride if enabled (a unique variant of a
 * shared Model), otherwise its resolvedModel's own attributes list.
 * @param {object} weaponSystem
 * @return {string[]}
 */
function getWeaponAttributeKeys(weaponSystem) {
  if (weaponSystem.attributeOverride?.enabled) {
    return Object.entries(weaponSystem.attributeOverride.attributes ?? {})
      .filter(([, checked]) => checked).map(([key]) => key);
  }
  return weaponSystem.resolvedModel?.attributes ?? [];
}

/**
 * A weapon's attack-bonus attribute contribution - Masterful uses
 * highestOrSumIfAllTied; Refined/Specialized/no property just take the
 * highest (ties don't stack), with Specialized doubling the result.
 * @param {Actor} actor
 * @param {object} weaponSystem
 * @return {number}
 */
function computeWeaponAttributeBonus(actor, weaponSystem) {
  const keys = getWeaponAttributeKeys(weaponSystem);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  if (!mods.length) return 0;

  const properties = weaponSystem.effectiveProperties ?? [];
  const has = key => properties.some(p => p.property === key);

  if (has('masterful')) return highestOrSumIfAllTied(mods);
  const highest = Math.max(...mods);
  return has('specialized') ? highest * 2 : highest;
}

/**
 * A weapon item's Angriffswurf (attack roll) bonus, added to both of the
 * two d20s rolled for it: its matching weapon skill + its material's
 * attack bonus + its resolved Model's flat bonus + its attribute bonus
 * (see computeWeaponAttributeBonus).
 * @param {Actor} actor
 * @param {Item} weaponItem
 * @return {number}
 */
export function computeWeaponAttackBonus(actor, weaponItem) {
  const system = weaponItem.system;
  const skillLevel = getActorSkillLevel(actor, system.weaponType);
  const materialBonus = system.materialAttackBonus ?? 0;
  const modelFlat = system.resolvedModel?.flatBonus ?? 0;
  const attributeBonus = computeWeaponAttributeBonus(actor, system);
  return skillLevel + materialBonus + modelFlat + attributeBonus;
}

/**
 * A Martial Arts attack's attribute bonus contribution - always
 * highestOrSumIfAllTied, regardless of that attack's own attributeUsage
 * (which only governs its damage roll - see helpers/actions.mjs#
 * resolveMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
function computeMartialArtsAttributeBonus(actor, attack) {
  const keys = Object.entries(attack.attributes ?? {}).filter(([, checked]) => checked).map(([key]) => key);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  return highestOrSumIfAllTied(mods);
}

/**
 * A Martial Arts attack's Angriffswurf (attack roll) bonus, added to both
 * of the two d20s rolled for it: the Martial Arts skill level + the
 * actor's natural material bonus (no weapon Model, so no flat bonus term)
 * + its attribute bonus (see computeMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
export function computeMartialArtsAttackBonus(actor, attack) {
  const skillLevel = getActorSkillLevel(actor, 'martialArts');
  const materialBonus = computeNaturalMaterialBonus(actor);
  const attributeBonus = computeMartialArtsAttributeBonus(actor, attack);
  return skillLevel + materialBonus + attributeBonus;
}

/**
 * Roll the Angriffswurf (attack roll): two independent d20s, each with the
 * same flat bonus and the actor's current D20 malus (Exhaustion only -
 * attributeKey stays null, since no single attribute cleanly represents an
 * arbitrary weapon/spell attack the way it does for e.g. a Constitution
 * check). The two rolls are never combined into one - see
 * renderAttackPairHTML.
 * @param {number} bonus
 * @param {Actor|null} actor
 * @return {Promise<[Roll, Roll]>}
 */
export async function rollAttackPair(bonus, actor) {
  const baseFormula = bonus ? `1d20 + ${bonus}` : '1d20';
  const formula = actor ? applyD20Malus(baseFormula, actor) : baseFormula;
  const rollA = await new Roll(formula, actor?.getRollData()).evaluate();
  const rollB = await new Roll(formula, actor?.getRollData()).evaluate();
  return [rollA, rollB];
}

/**
 * Render an Angriffswurf (attack roll) pair's chat HTML: both d20s shown
 * side by side (never summed), plus a button any user can click later
 * (see resolveHitEvaluationFromChat) to resolve hit/miss against a
 * defender's Armor Class or Magic Resistance.
 * @param {[Roll, Roll]} rolls
 * @param {"armorClass"|"magicResistance"} comparisonType
 * @return {Promise<string>}
 */
export async function renderAttackPairHTML([rollA, rollB], comparisonType) {
  const renderedA = await rollA.render();
  const renderedB = await rollB.render();
  return `
    <div class="sksk-attack-roll-pair">
      <div class="sksk-attack-roll-single">
        <div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.RollA')}</div>
        ${renderedA}
      </div>
      <div class="sksk-attack-roll-single">
        <div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.RollB')}</div>
        ${renderedB}
      </div>
    </div>
    <button type="button" class="sksk-roll-hit-eval" data-action="resolveHitEvaluation"
      data-roll-a="${rollA.total}" data-roll-b="${rollB.total}" data-comparison-type="${comparisonType}">
      ${game.i18n.localize('SKSK.AttackRoll.Evaluate')}
    </button>
  `;
}

/**
 * Handle a click on an Angriffswurf's "Evaluate" button: resolves the
 * defender as whoever the clicking user is currently targeting (their
 * first target), falling back to their own assigned character if they
 * have no target selected, then compares both of the attack's already-
 * rolled d20 totals against that defender's Armor Class or Magic
 * Resistance (per the button's own data-comparison-type) and posts the
 * outcome as a new chat message, speaking as the defender.
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function resolveHitEvaluationFromChat(button) {
  const targets = Array.from(game.user.targets ?? []);
  const defender = targets[0]?.actor ?? game.user.character;
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const comparisonType = button.dataset.comparisonType;
  const statValue = comparisonType === 'magicResistance' ? defender.system.magicResistance : defender.system.armorClass;
  const statLabel = game.i18n.localize(comparisonType === 'magicResistance' ? 'SKSK.Resource.MR' : 'SKSK.Resource.AC');

  const renderLine = (rollTotal, rollLabel) => {
    const hit = rollTotal >= statValue;
    const outcome = game.i18n.localize(hit ? 'SKSK.AttackRoll.Hit' : 'SKSK.AttackRoll.Miss');
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.EvaluationLine', {
      label: rollLabel, total: rollTotal, statLabel, statValue, outcome,
    })}</div>`;
  };

  const content = `<div class="sksk-chat-card sksk-action-card">`
    + renderLine(Number(button.dataset.rollA), game.i18n.localize('SKSK.AttackRoll.RollA'))
    + renderLine(Number(button.dataset.rollB), game.i18n.localize('SKSK.AttackRoll.RollB'))
    + `</div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name }),
    content,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
