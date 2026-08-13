import { getActorSkillLevel, evaluateSkillFormula } from './skills.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';

/**
 * The shared building blocks behind computeMaxLife, computeMaxNegativeLife
 * and getLifeBreakdown (the tooltip shown over the Life/Negative Life
 * labels on the actor sheet) - the single source of truth for all three,
 * so the tooltip can never drift out of sync with the actual numbers.
 * Per level, a creature gains:
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
 * @return {{
 *   rows: Array<{label: string, perLevel: (number|null), value: number}>,
 *   subtotal: number,
 *   toughnessMultiplier: number,
 *   flatBonus: number
 * }} rows are components 1-6 above, individually - perLevel is the raw
 *   per-level rate (null for ability bonuses, which already scale on their
 *   own via their own formula) and value is that row's contribution to
 *   subtotal (components 1-4/6 multiplied by level; ability bonuses as-is).
 *   subtotal is max life before Tenacity's multiplier and the flat bonus.
 */
function computeLifeComponents(actor) {
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
      if (item.system.classType === 'first' && item.system.life) {
        rows.push({
          label: game.i18n.format('SKSK.Breakdown.ClassLife', { name: item.name }),
          perLevel: item.system.life, value: item.system.life * level,
        });
      } else if (item.system.classType === 'second') {
        const [threshold] = getClassAbilityLevels('second', hasAdvancedClass);
        if (level >= threshold && item.system.life) {
          rows.push({
            label: game.i18n.format('SKSK.Breakdown.ClassLife', { name: item.name }),
            perLevel: item.system.life, value: item.system.life * level,
          });
        }
      }
      const unlockLevels = getClassAbilityLevels(item.system.classType, hasAdvancedClass);
      item.system.abilities?.forEach((ability, index) => {
        if (level < (unlockLevels[index] ?? 1)) return;
        pushAbility(ability.name || item.name, ability.lifeBonusFormula);
      });
    } else if (item.type === 'species') {
      for (const ability of item.system.abilities ?? []) {
        pushAbility(ability.name || item.name, ability.lifeBonusFormula);
      }
    } else if (item.type === 'talent') {
      pushAbility(item.name, item.system.lifeBonusFormula);
    }
  }

  const conMod = actor.system.attributes?.con?.mod ?? 0;
  rows.push({ label: game.i18n.localize('SKSK.Attribute.Con.long'), perLevel: conMod, value: conMod * level });

  const healthLevel = getActorSkillLevel(actor, 'health');
  rows.push({ label: game.i18n.localize('SKSK.Skill.Fighter.Health'), perLevel: healthLevel, value: healthLevel * level });

  if (hasAdvancedClass && level >= 13) {
    rows.push({ label: game.i18n.localize('SKSK.Breakdown.AdvancedClassBonus'), perLevel: 20, value: 20 * level });
  }

  const lehrenBonus = computeLehrenTargetBonus(actor, 'life');
  if (lehrenBonus) rows.push({ label: game.i18n.localize('SKSK.Breakdown.LehrenBonus'), perLevel: null, value: lehrenBonus });

  const subtotal = rows.reduce((sum, row) => sum + row.value, 0);

  return {
    rows,
    subtotal,
    toughnessMultiplier: 1 + 0.2 * getActorSkillLevel(actor, 'tenacity'),
    flatBonus: actor.system.life?.bonus ?? 0,
  };
}

/**
 * An actor's maximum life - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites system.life.max
 * with this every time). subtotal (see computeLifeComponents) is multiplied
 * by (1 + 0.2 per Tenacity skill level), and finally a flat,
 * Active-Effect-driven bonus (system.life.bonus) is added on top.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxLife(actor) {
  const { subtotal, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  return Math.max(0, Math.round(subtotal * toughnessMultiplier + flatBonus));
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
  const { subtotal, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  const includeToughness = actor.system.negativeLife?.includeToughness ?? false;
  const coreMaxLife = subtotal * (includeToughness ? toughnessMultiplier : 1);
  const actualMaxLife = subtotal * toughnessMultiplier + flatBonus;
  return Math.max(0, Math.round(Math.min(coreMaxLife, actualMaxLife)));
}

/**
 * The itemized breakdown shown in the tooltip over the Life/Negative Life
 * labels on the actor sheet - see helpers/tooltips.mjs#renderBreakdownHtml.
 * @param {Actor} actor
 * @return {{
 *   rows: Array, subtotal: number,
 *   multiplier: {label: string, factor: number},
 *   flatBonus: number, total: number
 * }}
 */
export function getLifeBreakdown(actor) {
  const { rows, subtotal, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  const tenacityLevel = getActorSkillLevel(actor, 'tenacity');
  return {
    rows,
    subtotal,
    multiplier: {
      label: game.i18n.format('SKSK.Breakdown.ToughnessMultiplier', { level: tenacityLevel }),
      factor: toughnessMultiplier,
    },
    flatBonus,
    total: computeMaxLife(actor),
  };
}

/**
 * The itemized breakdown shown in the tooltip over the Negative Life
 * label - the same per-level components as Life, but ending in the
 * "lower of the two" comparison instead of a flat flatBonus addition (see
 * computeMaxNegativeLife).
 * @param {Actor} actor
 * @return {{
 *   rows: Array, subtotal: number,
 *   multiplier: {label: string, factor: number},
 *   withoutToughness: number, withToughness: number, total: number
 * }}
 */
export function getNegativeLifeBreakdown(actor) {
  const { rows, subtotal, toughnessMultiplier, flatBonus } = computeLifeComponents(actor);
  const tenacityLevel = getActorSkillLevel(actor, 'tenacity');
  const includeToughness = actor.system.negativeLife?.includeToughness ?? false;
  return {
    rows,
    subtotal,
    multiplier: {
      label: game.i18n.format('SKSK.Breakdown.ToughnessMultiplier', { level: tenacityLevel }),
      // Only genuinely in effect for Negative Life when includeToughness
      // is on (see computeMaxNegativeLife/withoutToughness below) - shown
      // as ×1 otherwise so the tooltip's own "a ×1 multiplier changes
      // nothing" rule hides it, rather than always displaying the
      // Tenacity bonus even while its checkbox is off.
      factor: includeToughness ? toughnessMultiplier : 1,
    },
    withoutToughness: Math.round(subtotal * (includeToughness ? toughnessMultiplier : 1)),
    withToughness: Math.round(subtotal * toughnessMultiplier + flatBonus),
    total: computeMaxNegativeLife(actor),
  };
}
