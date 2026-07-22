import { getActorSkillLevel, evaluateSkillFormula } from './skills.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';

/**
 * An actor's maximum life - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites system.life.max
 * with this every time). Per level, a creature gains:
 * 1. The first Class's flat life value (system.life on the Class item).
 * 2. The second Class's flat life value, but only once the actor's level
 *    reaches the level its own first ability would unlock at (13, or 14
 *    with an Advanced Class - see getClassAbilityLevels).
 * 3. Its Constitution modifier.
 * 4. Its Health skill level.
 * 5. Every unlocked Class/Species/Talent ability's own scaling life bonus
 *    (lifeBonusFormula, "L" = the actor's level) - these already scale on
 *    their own, so they're added directly rather than multiplied by level
 *    again. A Class ability only counts once unlocked at the actor's
 *    current level; Species/Talent abilities always count.
 * 6. +20, once the actor's level reaches 13 AND it holds an Advanced Class.
 *
 * Components 1-4 and 6 are summed once, then multiplied by the actor's
 * level (a flat per-level rate); component 5's abilities are added after
 * that multiplication, since they scale independently. The result is then
 * multiplied by (1 + 0.2 per Tenacity skill level), and finally a flat,
 * Active-Effect-driven bonus (system.life.bonus) is added on top.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxLife(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);

  let perLevel = 0;
  let abilityLifeBonus = 0;

  for (const item of actor.items) {
    if (item.type === 'class') {
      if (item.system.classType === 'first') {
        perLevel += item.system.life ?? 0;
      } else if (item.system.classType === 'second') {
        const [threshold] = getClassAbilityLevels('second', hasAdvancedClass);
        if (level >= threshold) perLevel += item.system.life ?? 0;
      }
      const unlockLevels = getClassAbilityLevels(item.system.classType, hasAdvancedClass);
      item.system.abilities?.forEach((ability, index) => {
        if (!ability.lifeBonusFormula || level < (unlockLevels[index] ?? 1)) return;
        abilityLifeBonus += evaluateSkillFormula(ability.lifeBonusFormula, { lvl: level });
      });
    } else if (item.type === 'species') {
      for (const ability of item.system.abilities ?? []) {
        if (!ability.lifeBonusFormula) continue;
        abilityLifeBonus += evaluateSkillFormula(ability.lifeBonusFormula, { lvl: level });
      }
    } else if (item.type === 'talent' && item.system.lifeBonusFormula) {
      abilityLifeBonus += evaluateSkillFormula(item.system.lifeBonusFormula, { lvl: level });
    }
  }

  perLevel += actor.system.attributes?.con?.mod ?? 0;
  perLevel += getActorSkillLevel(actor, 'health');
  if (hasAdvancedClass && level >= 13) perLevel += 20;

  const toughnessMultiplier = 1 + 0.2 * getActorSkillLevel(actor, 'tenacity');
  const flatBonus = actor.system.life?.bonus ?? 0;

  return Math.max(0, Math.round((perLevel * level + abilityLifeBonus) * toughnessMultiplier + flatBonus));
}
