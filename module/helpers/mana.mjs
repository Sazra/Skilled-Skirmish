import { getActorSkillLevel, evaluateSkillFormula } from './skills.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';

/**
 * The shared building blocks behind computeMaxMana and getManaBreakdown
 * (the tooltip shown over the Mana label on the actor sheet) - the single
 * source of truth for both, so the tooltip can never drift out of sync
 * with the actual number. Per level, a creature gains:
 * 1. Its Aura attribute's value (not modifier).
 * 2. Its Mana Capacity skill level.
 * 3. Its Source Bound skill level.
 * 4. Its Mana Core skill level, doubled.
 * 5. Every unlocked Class/Species/Talent ability's own scaling mana bonus
 *    (manaBonusFormula, "L" = the actor's level) - these already scale on
 *    their own, so they're added directly rather than multiplied by level
 *    again. A Class ability only counts once unlocked at the actor's
 *    current level; Species/Talent abilities always count.
 *
 * Components 1-4 are individually multiplied by the actor's level (each a
 * flat per-level rate); component 5's abilities are added as-is, since
 * they scale independently. Finally, a flat, Active-Effect-driven bonus
 * (system.mana.bonus) is added on top by computeMaxMana.
 * @param {Actor} actor
 * @return {{
 *   rows: Array<{label: string, perLevel: (number|null), value: number}>,
 *   subtotal: number, flatBonus: number
 * }} subtotal is max mana before the flat bonus.
 */
function computeManaComponents(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);

  const rows = [];
  const pushAbility = (name, formula) => {
    if (!formula) return;
    const value = evaluateSkillFormula(formula, { lvl: level });
    if (value) rows.push({ label: game.i18n.format('SKSK.Breakdown.Ability', { name }), perLevel: null, value });
  };

  for (const item of actor.items) {
    if (item.type === 'class') {
      const unlockLevels = getClassAbilityLevels(item.system.classType, hasAdvancedClass);
      item.system.abilities?.forEach((ability, index) => {
        if (level < (unlockLevels[index] ?? 1)) return;
        pushAbility(ability.name || item.name, ability.manaBonusFormula);
      });
    } else if (item.type === 'species') {
      for (const ability of item.system.abilities ?? []) {
        pushAbility(ability.name || item.name, ability.manaBonusFormula);
      }
    } else if (item.type === 'talent') {
      pushAbility(item.name, item.system.manaBonusFormula);
    }
  }

  // baseValue, not value - Mana is a resource, so it only ever grows from
  // Base-tier bonuses (Species/Talent/Status Effects), never Spezial-/
  // Modifikator-Boni.
  const aura = actor.system.attributes?.aur?.baseValue ?? 0;
  rows.push({ label: game.i18n.localize('SKSK.Attribute.Aur.long'), perLevel: aura, value: aura * level });

  const manaCapacityLevel = getActorSkillLevel(actor, 'manaCapacity');
  rows.push({ label: game.i18n.localize('SKSK.Skill.Magic.ManaCapacity'), perLevel: manaCapacityLevel, value: manaCapacityLevel * level });

  const sourceBoundLevel = getActorSkillLevel(actor, 'sourceBound');
  rows.push({ label: game.i18n.localize('SKSK.Skill.Magic.SourceBound'), perLevel: sourceBoundLevel, value: sourceBoundLevel * level });

  const manaCoreLevel = getActorSkillLevel(actor, 'manaCore') * 2;
  rows.push({ label: game.i18n.format('SKSK.Breakdown.Doubled', { name: game.i18n.localize('SKSK.Skill.Magic.ManaCore') }), perLevel: manaCoreLevel, value: manaCoreLevel * level });

  const lehrenBonus = computeLehrenTargetBonus(actor, 'mana');
  if (lehrenBonus) rows.push({ label: game.i18n.localize('SKSK.Breakdown.LehrenBonus'), perLevel: null, value: lehrenBonus });

  const subtotal = rows.reduce((sum, row) => sum + row.value, 0);

  return { rows, subtotal, flatBonus: actor.system.mana?.bonus ?? 0, lehrenBonus, upkeepTotal: computeActiveSpellUpkeepTotal(actor) };
}

/**
 * The sum of every currently-sustaining Spell Item's own Unterhalt
 * (upkeep) on this actor - see data/spell.mjs#upkeep/sustaining. A
 * continuous reduction of MAXIMUM mana (see computeMaxMana), not a
 * per-round drain from current mana (that's manaCostPerRound instead - see
 * helpers/statusEffects.mjs#handleSpellUpkeepTurnStart).
 * @param {Actor} actor
 * @return {number}
 */
export function computeActiveSpellUpkeepTotal(actor) {
  let total = 0;
  for (const item of actor.items) {
    if (item.type === 'spell' && item.system.sustaining) total += item.system.upkeep ?? 0;
  }
  return total;
}

/**
 * An actor's maximum mana - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites system.mana.max
 * with this every time). See computeManaComponents for the per-level
 * subtotal; a flat, Active-Effect-driven bonus (system.mana.bonus) is
 * added on top.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxMana(actor) {
  const { subtotal, flatBonus, upkeepTotal } = computeManaComponents(actor);
  return Math.max(0, Math.round(subtotal + flatBonus) - upkeepTotal);
}

/**
 * Max mana stripped down to only its permanent-progression components, for
 * Lebenszeit (Longevity - see helpers/longevity.mjs): excludes flatBonus
 * (Item/Active-Effect-driven, freely equipped/unequipped) and the Lehren
 * bonus (a training assignment, not a fixed character-progression gain) -
 * see computePermanentMaxLife in helpers/life.mjs for the same reasoning.
 * @param {Actor} actor
 * @return {number}
 */
export function computePermanentMaxMana(actor) {
  const { subtotal, lehrenBonus } = computeManaComponents(actor);
  return Math.max(0, Math.round(subtotal - lehrenBonus));
}

/**
 * The itemized breakdown shown in the tooltip over the Mana label on the
 * actor sheet - see helpers/tooltips.mjs#renderBreakdownHtml.
 * @param {Actor} actor
 * @return {{rows: Array, subtotal: number, flatBonus: number, total: number}}
 */
export function getManaBreakdown(actor) {
  const { rows, subtotal, flatBonus, upkeepTotal } = computeManaComponents(actor);
  const breakdownRows = upkeepTotal
    ? [...rows, { label: game.i18n.localize('SKSK.Breakdown.SpellUpkeep'), perLevel: null, value: -upkeepTotal }]
    : rows;
  return { rows: breakdownRows, subtotal, flatBonus, total: computeMaxMana(actor) };
}
