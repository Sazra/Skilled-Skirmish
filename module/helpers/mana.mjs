import { getActorSkillLevel, evaluateSkillFormula } from './skills.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';

/**
 * An actor's maximum mana - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites system.mana.max
 * with this every time). Per level, a creature gains:
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
 * Components 1-4 are summed once, then multiplied by the actor's level (a
 * flat per-level rate); component 5's abilities are added after that
 * multiplication, since they scale independently. Finally, a flat,
 * Active-Effect-driven bonus (system.mana.bonus) is added on top.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxMana(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);

  let abilityManaBonus = 0;
  for (const item of actor.items) {
    if (item.type === 'class') {
      const unlockLevels = getClassAbilityLevels(item.system.classType, hasAdvancedClass);
      item.system.abilities?.forEach((ability, index) => {
        if (!ability.manaBonusFormula || level < (unlockLevels[index] ?? 1)) return;
        abilityManaBonus += evaluateSkillFormula(ability.manaBonusFormula, { lvl: level });
      });
    } else if (item.type === 'species') {
      for (const ability of item.system.abilities ?? []) {
        if (!ability.manaBonusFormula) continue;
        abilityManaBonus += evaluateSkillFormula(ability.manaBonusFormula, { lvl: level });
      }
    } else if (item.type === 'talent' && item.system.manaBonusFormula) {
      abilityManaBonus += evaluateSkillFormula(item.system.manaBonusFormula, { lvl: level });
    }
  }

  const perLevel = (actor.system.attributes?.aur?.value ?? 0)
    + getActorSkillLevel(actor, 'manaCapacity')
    + getActorSkillLevel(actor, 'sourceBound')
    + getActorSkillLevel(actor, 'manaCore') * 2;

  const flatBonus = actor.system.mana?.bonus ?? 0;

  return Math.max(0, Math.round(perLevel * level + abilityManaBonus + flatBonus));
}
