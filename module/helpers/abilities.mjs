/**
 * The level at which each of a class's 3 abilities unlocks, by class type.
 * Also used as the threshold at which a Second Class's own life value
 * starts contributing to max life (see helpers/life.mjs#computeMaxLife) -
 * that's the same level its first ability unlocks at.
 * @param {string} classType
 * @param {boolean} hasAdvancedClass  Whether the actor also holds an
 *   Advanced Class, which shifts the Second Class's thresholds from
 *   13/18/24 to 14/19/25.
 * @return {number[]} The 3 unlock levels, in ability order.
 */
export function getClassAbilityLevels(classType, hasAdvancedClass) {
  switch (classType) {
    case 'first': return [1, 6, 12];
    case 'second': return hasAdvancedClass ? [14, 19, 25] : [13, 18, 24];
    case 'advanced': return [13, 13, 13];
    case 'third': return [25, 25, 25];
    default: return [1, 1, 1];
  }
}

/**
 * Whether an actor holds an Advanced Class item - raises the Second
 * Class's ability/life unlock thresholds (see getClassAbilityLevels).
 * @param {Actor} actor
 * @return {boolean}
 */
export function actorHasAdvancedClass(actor) {
  return actor.items.some(i => i.type === 'class' && i.system.classType === 'advanced');
}
