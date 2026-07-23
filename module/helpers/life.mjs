import { getActorSkillLevel, evaluateSkillFormula } from './skills.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';

/**
 * The shared building blocks behind both computeMaxLife and
 * computeMaxNegativeLife. Per level, a creature gains:
 * 1. The first Class's flat life value (system.life on the Class item).
 * 2. The second Class's flat life value, but only once the actor's level
 *    reaches the level its own first ability would unlock at (13, or 14
 *    with an Advanced Class - see getClassAbilityLevels).
 * 3. Its Constitution modifier.
 * 4. Its Health skill level.
 * 5. Every unlocked Class/Species/Talent ability's own scaling life bonus
 *    (lifeBonusFormula, "L" = the actor's level) - these already scale on
 *    their own, but (like 1-4) still get multiplied by Tenacity below,
 *    since they're part of the same per-level rate.
 * 6. +20, once the actor's level reaches 13 AND it holds an Advanced Class.
 *
 * @param {Actor} actor
 * @return {{rawBase: number, toughnessMultiplier: number, flatBonus: number}}
 *   rawBase is components 1-6 above, summed and multiplied by level -
 *   i.e. max life before Tenacity's multiplier and the flat bonus.
 */
function computeLifeComponents(actor) {
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

  return {
    rawBase: perLevel * level + abilityLifeBonus,
    toughnessMultiplier: 1 + 0.2 * getActorSkillLevel(actor, 'tenacity'),
    flatBonus: actor.system.life?.bonus ?? 0,
  };
}

/**
 * An actor's maximum life - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites system.life.max
 * with this every time). rawBase (see computeLifeComponents) is multiplied
 * by (1 + 0.2 per Tenacity skill level), and finally a flat,
 * Active-Effect-driven bonus (system.life.bonus) is added on top.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxLife(actor) {
  const { rawBase, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  return Math.max(0, Math.round(rawBase * toughnessMultiplier + flatBonus));
}

/**
 * An actor's maximum negative life - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.negativeLife.max with this every time).
 *
 * By default, it equals max life WITHOUT Tenacity's multiplier - i.e. the
 * portion of max life that Tenacity itself adds acts as a pure "buffer"
 * that protects max negative life from reductions, without extending it
 * (system.negativeLife.includeToughness switches this off, making
 * Tenacity's multiplier count for max negative life too, same as it does
 * for max life).
 *
 * Anything that changes actual max life (e.g. an Active Effect adjusting
 * system.life.bonus) is only reflected in max negative life once it
 * pushes actual max life BELOW that unmultiplied baseline - a reduction
 * smaller than Tenacity's surplus is fully absorbed by it; a reduction
 * larger than that surplus carries the excess through to max negative
 * life. Equivalent to simply taking the smaller of the two:
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxNegativeLife(actor) {
  const { rawBase, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  const includeToughness = actor.system.negativeLife?.includeToughness ?? false;
  const coreMaxLife = rawBase * (includeToughness ? toughnessMultiplier : 1);
  const actualMaxLife = rawBase * toughnessMultiplier + flatBonus;
  return Math.max(0, Math.round(Math.min(coreMaxLife, actualMaxLife)));
}
