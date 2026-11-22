import { getNearestTargetDistance } from './tokenDistance.mjs';

/**
 * Gameplay of the Weapon/Armor Model and Material properties (see CONFIG.SKSK.
 * modelProperties, helpers/properties.mjs): the flags a weapon attack carries
 * with it through hit evaluation and damage application, and the small
 * lookups the individual property rules share.
 *
 * Two kinds of flags travel with an attack:
 * - DAMAGE ENTRY flags (ENTRY_FLAG_KEYS) ride on every {damageType, amount}
 *   entry the attack produces, so they survive the Apply Damage button, the
 *   GM relay and the automatic resolution: antimagic (Magiestörend: double
 *   damage to Barrier), giantSlayer (Riesenfäller), rending (Abreißend),
 *   silvered (Versilbert: double damage to creatures weak to silver),
 *   shattering (Zerschmetternd), melee (a melee attack - Stachlig) and
 *   reflectable (damage of a real spell - Reflektierend).
 * - HIT flags ride on the attack's damageDice entries, for the moment the
 *   hit is evaluated: antimagic (ignores AC bonuses from spells),
 *   keepsConcealment (Versteckt) and stunStacks (Betäubend).
 */

/** The distance (m) up to which an attack counts as a melee attack. */
export const ATTACK_MELEE_RANGE = 2;

export const ENTRY_FLAG_KEYS = ['antimagic', 'giantSlayer', 'rending', 'silvered', 'shattering', 'melee', 'reflectable'];

/** The entry flags that also belong on bonus damage rolled at hit evaluation (Brutal, Attentat). */
export const BONUS_FLAG_KEYS = ['antimagic', 'giantSlayer', 'rending', 'silvered'];

/**
 * The flags of a damage entry/damageDice entry, limited to the given keys.
 * @param {object} source
 * @param {string[]} [keys]
 * @return {object}
 */
export function pickFlags(source, keys = ENTRY_FLAG_KEYS) {
  const flags = {};
  for (const key of keys) if (source?.[key]) flags[key] = true;
  return flags;
}

/**
 * Whether an item's effective properties include one.
 * @param {object} system   A Weapon/Armor's system data.
 * @param {string} key
 * @return {boolean}
 */
export function hasEffectiveProperty(system, key) {
  return (system?.effectiveProperties ?? []).some(entry => entry.property === key);
}

/**
 * @param {object} system
 * @param {string} key
 * @return {{property: string, value?: number, formula?: string, attributes?: string[]}|null}
 */
export function getEffectiveProperty(system, key) {
  return (system?.effectiveProperties ?? []).find(entry => entry.property === key) ?? null;
}

/**
 * Betäubend (Stunning): a critical attack gives Benommenheit stacks equal to
 * the weapon's Material bonus / 2, multiplied by X/10 if the weapon also has
 * Schwer (X). Rounded down, at least 1.
 * @param {Item} weapon
 * @return {number}
 */
export function computeStunStacks(weapon) {
  const materialBonus = weapon.system.materialAttackBonus ?? 0;
  const heavy = getEffectiveProperty(weapon.system, 'heavy')?.value ?? 0;
  const factor = heavy > 0 ? heavy / 10 : 1;
  return Math.max(1, Math.floor((materialBonus / 2) * factor));
}

/**
 * Everything a weapon attack carries through hit evaluation and damage
 * application (see the file comment).
 * @param {Item} weapon
 * @return {{entry: object, dice: object}}   entry: flags for damage entries;
 *   dice: those plus the hit flags, for the damageDice entries.
 */
export function buildWeaponFlags(weapon) {
  const has = key => hasEffectiveProperty(weapon.system, key);
  const entry = {
    ...(has('antimagic') ? { antimagic: true } : {}),
    ...(has('giantSlayer') ? { giantSlayer: true } : {}),
    ...(has('rending') ? { rending: true } : {}),
    ...(has('silvered') ? { silvered: true } : {}),
    ...(has('shattering') ? { shattering: true } : {}),
    ...(!has('ranged') ? { melee: true } : {}),
  };
  const dice = {
    ...entry,
    // Which weapon made the attack (Entwaffnend can take it away, see helpers/reactions.mjs).
    weaponUuid: weapon.uuid,
    ...(has('concealed') ? { keepsConcealment: true } : {}),
    ...(has('stunning') ? { stunStacks: computeStunStacks(weapon) } : {}),
  };
  return { entry, dice };
}

/**
 * The attributes an attack over more than 2m is rolled with instead of the
 * weapon's usual ones: every attribute picked on its Reach/Long/Very Long
 * property (see data/weapon.mjs#propertyOverrides). Empty if none was set.
 * @param {object} weaponSystem
 * @return {string[]}
 */
export function getDistantAttackAttributes(weaponSystem) {
  const keys = new Set();
  for (const property of ['reach', 'long', 'veryLong']) {
    for (const attribute of getEffectiveProperty(weaponSystem, property)?.attributes ?? []) keys.add(attribute);
  }
  return [...keys];
}

/**
 * Whether the attack is aimed at a target more than 2m away - from the
 * nearest targeted token. false if that can't be measured (no token/target).
 * @param {Actor} attacker
 * @return {boolean}
 */
export function isDistantAttack(attacker) {
  const distance = getNearestTargetDistance(attacker);
  return distance !== null && distance > ATTACK_MELEE_RANGE;
}

/**
 * Fernkampf (Ranged): such a weapon can't attack at 2m or less. True if a
 * targeted token is that close (so the attack is not allowed).
 * @param {Actor} attacker
 * @return {boolean}
 */
export function isRangedAttackBlocked(attacker) {
  const distance = getNearestTargetDistance(attacker);
  return distance !== null && distance <= ATTACK_MELEE_RANGE;
}

/**
 * The creature categories of an actor (those of its Species items).
 * @param {Actor} actor
 * @return {Set<string>}
 */
export function getActorCreatureCategories(actor) {
  const categories = new Set();
  for (const item of actor.items) {
    if (item.type !== 'species') continue;
    for (const category of item.system.creatureCategories ?? []) categories.add(category);
  }
  return categories;
}

/**
 * Abreißend (Rending): double damage to constructs, MATERIAL undead (see
 * data/species.mjs#undeadForm), objects.
 * TODO(Gebäude): buildings are not implemented - once Buildings get a sheet
 * of their own (or a creature category), add them here and deal Rending's
 * double damage to them as well. Objects (creature category "object") are
 * modelled as NPCs for now (their Life stands in for the Haltbarkeit);
 * TODO(Objekte): if objects ever get a real durability, count the damage
 * against that instead.
 * @param {Actor} defender
 * @return {boolean}
 */
export function isRendingTarget(defender) {
  for (const item of defender.items) {
    if (item.type !== 'species') continue;
    const categories = item.system.creatureCategories ?? [];
    if (categories.includes('construct') || categories.includes('object')) return true;
    if (categories.includes('undead') && item.system.undeadForm !== 'immaterial') return true;
  }
  return false;
}

/**
 * Versilbert (Silvered): whether the creature is weak to silver - the
 * switch on the actor itself (GM tab) or on one of its Species.
 * @param {Actor} defender
 * @return {boolean}
 */
export function isSilverWeak(defender) {
  if (defender.system.silverWeakness) return true;
  return defender.items.some(item => item.type === 'species' && item.system.silverWeakness);
}

/** Riesenfäller (Giant Slayer): extra damage by the target's size category. */
const GIANT_SLAYER_FACTORS = { huge: 1.25, gigantic: 1.5, titanic: 2 };

/**
 * @param {Actor} defender
 * @return {number}   1 for a creature smaller than Huge.
 */
export function getGiantSlayerFactor(defender) {
  return GIANT_SLAYER_FACTORS[defender.system.sizeCategory] ?? 1;
}

/**
 * The properties (see hasEffectiveProperty) of an actor's equipped armor
 * pieces - body armor and shields.
 * @param {Actor} actor
 * @param {string} key
 * @return {Item[]}   The equipped armor items that have it.
 */
export function getEquippedArmorWithProperty(actor, key) {
  return actor.items.filter(item => item.type === 'armor' && item.system.equipped && hasEffectiveProperty(item.system, key));
}

/**
 * Laut (Loud) and heavy armor: equipped armor that makes the stealth roll
 * worse - only ever RECOMMENDED (a chat note on the roll), never enforced,
 * since it depends on the situation. Heavy armor counts unless it also has
 * Leicht (X) with X of at least 6.
 * @param {Actor} actor
 * @return {Array<{item: Item, reason: "loud"|"heavy"}>}
 */
export function getStealthRecommendations(actor) {
  const result = [];
  for (const item of actor.items) {
    if (item.type !== 'armor' || !item.system.equipped) continue;
    if (hasEffectiveProperty(item.system, 'loud')) result.push({ item, reason: 'loud' });
    else if (item.system.armorType === 'heavyArmor' && (getEffectiveProperty(item.system, 'light')?.value ?? 0) < 6) {
      result.push({ item, reason: 'heavy' });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Requirements: Schwer / Fordernd / Zehrend
// ---------------------------------------------------------------------------

/** Schwer needs Strength, Fordernd Dexterity, Zehrend Constitution. */
const REQUIREMENT_ATTRIBUTES = { heavy: 'str', demanding: 'dex', draining: 'con' };

/** The attribute VALUE of an actor (not its modifier). */
function getAttributeValue(actor, key) {
  return actor?.system?.attributes?.[key]?.value ?? 0;
}

function attributeLabel(key) {
  return game.i18n.localize(`SKSK.Attribute.${key.charAt(0).toUpperCase()}${key.slice(1)}.long`);
}

/**
 * The Schwer/Fordernd/Zehrend requirements an actor does NOT meet for an
 * item. While one is unmet, the item gives none of its wielder's attribute
 * and skill bonuses (its own Material bonus stays).
 * @param {Actor|null} actor
 * @param {object} system   A Weapon/Armor's system data.
 * @return {Array<{property: string, attribute: string, required: number, value: number}>}
 */
export function getUnmetRequirements(actor, system) {
  if (!actor) return [];
  const unmet = [];
  for (const [property, attribute] of Object.entries(REQUIREMENT_ATTRIBUTES)) {
    const required = getEffectiveProperty(system, property)?.value ?? 0;
    if (!required) continue;
    const value = getAttributeValue(actor, attribute);
    if (value < required) unmet.push({ property, attribute, required, value });
  }
  return unmet;
}

/**
 * The chat line telling that requirements are unmet ('' if all are met).
 * @param {Actor|null} actor
 * @param {object} system
 * @return {string}
 */
export function renderUnmetRequirementsLine(actor, system) {
  const unmet = getUnmetRequirements(actor, system);
  if (!unmet.length) return '';
  const text = unmet.map(u => `${attributeLabel(u.attribute)} ${u.value} &lt; ${u.required}`).join(', ');
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.WeaponProperty.RequirementUnmet', { requirements: text })}</div>`;
}

// ---------------------------------------------------------------------------
// One-handed / two-handed (Zweihändig, Flexibel)
// ---------------------------------------------------------------------------

/** Without Schwer/Fordernd/Zehrend a Two-Handed weapon may be held one-handed from this attribute value. */
const ONE_HANDED_ATTRIBUTE_VALUE = 16;

/**
 * Whether a weapon has the hand switch: Zweihändig or Flexibel.
 * @param {object} system
 * @return {boolean}
 */
export function hasHandSwitch(system) {
  // Bows can't be held one-handed - no switch for them.
  if (system?.weaponType === 'bow') return false;
  return hasEffectiveProperty(system, 'twoHanded') || hasEffectiveProperty(system, 'flexible');
}

/**
 * Whether the actor may hold the weapon one-handed. A Flexible weapon always
 * may. A Two-Handed one needs, for each of its Schwer/Fordernd/Zehrend (X),
 * the attribute at X + 25% of X (rounded up) - or, with none of those, 16 in
 * the (highest) attribute its attack uses.
 * @param {Actor|null} actor
 * @param {object} system
 * @return {{allowed: boolean, needs: string}}   needs: what is missing, for the hint ('' if allowed).
 */
export function checkOneHandedAllowed(actor, system) {
  if (!hasEffectiveProperty(system, 'twoHanded') || hasEffectiveProperty(system, 'flexible')) return { allowed: true, needs: '' };
  if (!actor) return { allowed: true, needs: '' };

  const missing = [];
  let anyRequirement = false;
  for (const [property, attribute] of Object.entries(REQUIREMENT_ATTRIBUTES)) {
    const required = getEffectiveProperty(system, property)?.value ?? 0;
    if (!required) continue;
    anyRequirement = true;
    const needed = Math.ceil(required + required * 0.25);
    if (getAttributeValue(actor, attribute) < needed) missing.push(`${attributeLabel(attribute)} ${needed}`);
  }
  if (!anyRequirement) {
    const keys = getAttackAttributeKeysForHands(system);
    const best = Math.max(0, ...keys.map(key => getAttributeValue(actor, key)));
    if (best < ONE_HANDED_ATTRIBUTE_VALUE) {
      missing.push(`${keys.map(attributeLabel).join('/') || '?'} ${ONE_HANDED_ATTRIBUTE_VALUE}`);
    }
  }
  return { allowed: !missing.length, needs: missing.join(', ') };
}

/** The attributes a weapon's attack uses (model attributes, or the per-item override). */
function getAttackAttributeKeysForHands(system) {
  if (system.attributeOverride?.enabled) {
    return Object.entries(system.attributeOverride.attributes ?? {}).filter(([, on]) => on).map(([key]) => key);
  }
  return system.resolvedModel?.attributes ?? [];
}

/**
 * Whether the weapon is EFFECTIVELY held one-handed right now: the switch is
 * on AND the actor may do it (the check is hard - a two-handed weapon whose
 * wielder lacks the attributes counts as held with both hands).
 * @param {Actor|null} actor
 * @param {object} system
 * @return {boolean}
 */
export function isHeldOneHanded(actor, system) {
  if (!system?.heldOneHanded || !hasHandSwitch(system)) return false;
  return checkOneHandedAllowed(actor, system).allowed;
}
