import { getActorSkillLevel } from './skills.mjs';

/**
 * The Religion (Patrone/Glaube) system's shared logic - resolving an
 * actor's (or a Glaubensklasse's) chosen Patron from the world's
 * "deities" setting (see helpers/settings.mjs, apps/deities-config.mjs),
 * and computing the roll/damage bonuses a Patron's favored skills/elements
 * grant. "Glaube" (the existing `faith` skill) is the governing stat for
 * every bonus here - there is no separate "Gunst" skill.
 */

/**
 * The world's full list of configured Deities.
 * @returns {object[]}
 */
export function getWorldDeities() {
  return game.settings.get('sksk', 'deities') ?? [];
}

/**
 * @param {string} id
 * @returns {object|null}
 */
export function getDeityById(id) {
  if (!id) return null;
  return getWorldDeities().find(d => d.id === id) ?? null;
}

/**
 * The actor's own chosen Patron (system.religion.patronId), or null.
 * @param {Actor} actor
 * @returns {object|null}
 */
export function getActorPatron(actor) {
  return getDeityById(actor?.system.religion?.patronId);
}

/**
 * The effective Patron for one of an actor's Glaubensklasse Class items -
 * the class's own faithPatronId if set, otherwise the actor's own Patron.
 * @param {Actor} actor
 * @param {Item} classItem
 * @returns {object|null}
 */
export function getEffectiveClassPatron(actor, classItem) {
  const classPatronId = classItem?.system.faithPatronId;
  return classPatronId ? getDeityById(classPatronId) : getActorPatron(actor);
}

/**
 * @param {object|null} patron
 * @param {string} skillKey
 * @returns {boolean}
 */
export function isPatronSkill(patron, skillKey) {
  return !!skillKey && !!patron?.skills?.includes(skillKey);
}

/**
 * @param {object|null} patron
 * @param {string} damageType
 * @returns {boolean}
 */
export function isPatronElement(patron, damageType) {
  return !!damageType && !!patron?.elements?.includes(damageType);
}

/**
 * The flat roll bonus a check/attack roll of the given skill gets from the
 * actor's own chosen Patron - equal to their Glaube (faith) skill level if
 * that skill is one of the Patron's favored skills, otherwise 0.
 * @param {Actor} actor
 * @param {string} skillKey
 * @returns {number}
 */
export function computePatronRollBonus(actor, skillKey) {
  if (!isPatronSkill(getActorPatron(actor), skillKey)) return 0;
  return getActorSkillLevel(actor, 'faith');
}

/**
 * The flat damage bonus a weapon/spell damage roll gets from the actor's
 * own chosen Patron - equal to their Glaube (faith) skill level if either
 * the roll's skill (weaponType/magicSchool/combinedSchool) is one of the
 * Patron's favored skills, OR (only if the skill didn't already match) the
 * roll's damage type is one of the Patron's favored elements. Never both -
 * a skill+element match on the same roll grants the bonus exactly once.
 * @param {Actor} actor
 * @param {{skillKey?: string, damageType?: string}} options
 * @returns {number}
 */
export function computePatronDamageBonus(actor, { skillKey, damageType } = {}) {
  const patron = getActorPatron(actor);
  if (!patron) return 0;
  if (isPatronSkill(patron, skillKey) || isPatronElement(patron, damageType)) {
    return getActorSkillLevel(actor, 'faith');
  }
  return 0;
}

/**
 * The highest combined-magic-school-override level any of the actor's
 * "active" Patrons (their own Religion choice, plus every owned
 * Glaubensklasse Class item's own effective Patron) grants for the given
 * combined school - equal to the actor's Glaube skill level wherever a
 * matching Patron is found, or null if none grants that school at all.
 * Mirrors helpers/spells.mjs#getCombinedSchoolOverrideLevel's own
 * "highest across every source" convention.
 * @param {Actor} actor
 * @param {string} combinedSchool
 * @returns {number|null}
 */
export function getActivePatronCombinedSchoolLevel(actor, combinedSchool) {
  const patrons = [getActorPatron(actor)];
  for (const item of actor?.items ?? []) {
    if (item.type === 'class' && item.system.isFaithClass) patrons.push(getEffectiveClassPatron(actor, item));
  }
  const matches = patrons.some(patron => patron && patron.combinedSchoolOverride === combinedSchool);
  return matches ? getActorSkillLevel(actor, 'faith') : null;
}
