import { evaluateBonusFormula, findSkillDefinition, getActorSkillLevel } from './skills.mjs';

/**
 * The maximum level a single Lehre can be invested at - purely a byproduct
 * of LEHREN_POOL_SIZE (a skill's own shared pool), never enforced on its
 * own beyond that.
 */
export const LEHRE_MAX_LEVEL = 5;

/**
 * The shared pool of Lehre levels a Character may freely distribute across
 * one skill's own Lehren catalog (5 in one, or split e.g. 2+2+1 across
 * three) - see setInvestedLehreLevel.
 */
export const LEHREN_POOL_SIZE = 5;

/**
 * The only bonus targets whose "scope" (see CONFIG.SKSK.lehrenBonusScopes)
 * actually matters - every other target is inherently actor-wide and
 * ignores the {skillKey, kind} context entirely.
 */
const SCOPED_TARGETS = new Set(['attackBonus', 'damageBonus']);

/**
 * The GM-defined Lehren catalog for one skill - [] if none defined yet.
 * @param {string} skillKey
 * @return {Array<{id: string, name: string, description: string, minSkillLevel: number, bonuses: Array<{target: string, scope: string, formula: string}>}>}
 */
export function getLehrenDefinitions(skillKey) {
  return getAllLehrenDefinitions()[skillKey] ?? [];
}

/**
 * The whole world Lehren catalog, keyed by skill - used by the player
 * dialog to build its own tabs and by computeLehrenTargetBonus to scan
 * every skill's own Lehren at once.
 * @return {Object<string, Array>}
 */
export function getAllLehrenDefinitions() {
  return game.settings.get('sksk', 'lehren') ?? {};
}

/**
 * One Lehre definition by (skillKey, id), or null.
 * @param {string} skillKey
 * @param {string} lehreId
 * @return {object|null}
 */
export function findLehreDefinition(skillKey, lehreId) {
  return getLehrenDefinitions(skillKey).find(d => d.id === lehreId) ?? null;
}

/**
 * An actor's currently invested level (0 if none) in one Lehre.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string} lehreId
 * @return {number}
 */
export function getInvestedLehreLevel(actor, skillKey, lehreId) {
  return actor.system.skills?.[skillKey]?.lehren?.[lehreId] ?? 0;
}

/**
 * The sum of every invested level across one skill's own Lehren - the
 * shared pool's current total (see LEHREN_POOL_SIZE).
 * @param {Actor} actor
 * @param {string} skillKey
 * @return {number}
 */
export function getInvestedLehrenPoolTotal(actor, skillKey) {
  const invested = actor.system.skills?.[skillKey]?.lehren ?? {};
  return Object.values(invested).reduce((sum, level) => sum + level, 0);
}

/**
 * Attempt to set one Lehre's invested level (0-5), enforcing both gates:
 * the Lehre's own minSkillLevel (checked against the actor's CURRENT skill
 * level, so it can lock/unlock as the skill itself levels up or down) and
 * the skill's shared 5-level pool (this Lehre's own new level plus every
 * other Lehre of the same skill's currently invested level). A no-op
 * (warns, returns false) without writing anything if either gate fails.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string} lehreId
 * @param {number} newLevel
 * @return {Promise<boolean>}
 */
export async function setInvestedLehreLevel(actor, skillKey, lehreId, newLevel) {
  const def = findLehreDefinition(skillKey, lehreId);
  if (!def) return false;
  const clamped = Math.max(0, Math.min(LEHRE_MAX_LEVEL, Math.round(newLevel) || 0));

  if (clamped > 0 && getActorSkillLevel(actor, skillKey) < (def.minSkillLevel ?? 0)) {
    ui.notifications.warn(game.i18n.format('SKSK.LehrenDialog.MinLevelNotMet', {
      skill: game.i18n.localize(findSkillDefinition(skillKey)?.label ?? skillKey),
      level: def.minSkillLevel ?? 0,
    }));
    return false;
  }

  const currentLevel = getInvestedLehreLevel(actor, skillKey, lehreId);
  const poolTotal = getInvestedLehrenPoolTotal(actor, skillKey) - currentLevel + clamped;
  if (poolTotal > LEHREN_POOL_SIZE) {
    ui.notifications.warn(game.i18n.format('SKSK.LehrenDialog.PoolExceeded', { pool: LEHREN_POOL_SIZE }));
    return false;
  }

  // A plain nested-object update (e.g. writing back a whole deep-cloned
  // "lehren" object) MERGES with the existing value rather than replacing
  // it - an update to {} would silently be a no-op against an existing key,
  // never actually clearing it. Patching a single dotted key instead avoids
  // that entirely, and Foundry's own "-=key" syntax is what actually
  // deletes a key from an ObjectField (setting it to 0 does not - an
  // explicit 0 would still merge in as a literal value, not remove it).
  const path = `system.skills.${skillKey}.lehren`;
  const update = clamped <= 0 ? { [`${path}.-=${lehreId}`]: null } : { [`${path}.${lehreId}`]: clamped };
  await actor.update(update);
  return true;
}

/**
 * The actor-wide total bonus for one target (a CONFIG.SKSK.lehrenBonusTargets
 * key), summed across EVERY skill's own invested Lehren - not just one -
 * since a Lehre's bonus rows may target something entirely unrelated to the
 * skill it belongs to (e.g. an Axt Lehre granting +MR). Each matching row's
 * formula is evaluated with "@value" bound to the actor's own invested
 * level in that specific Lehre (see helpers/skills.mjs#evaluateBonusFormula
 * - the same mechanism spell damage bonus rows already use).
 *
 * For attackBonus/damageBonus specifically, a row only counts if its own
 * scope matches the roll actually being made: "everything" always counts,
 * "thisSkill" only if the Lehre's own owning skill is the roll's skillKey,
 * "allWeapons"/"allSpells" only if the roll's kind matches. Every other
 * target ignores {skillKey, kind} entirely (always actor-wide).
 * @param {Actor} actor
 * @param {string} target
 * @param {{skillKey?: string|null, kind?: ('weapon'|'spell')|null}} [context]
 * @return {number}
 */
export function computeLehrenTargetBonus(actor, target, { skillKey = null, kind = null } = {}) {
  const catalog = getAllLehrenDefinitions();
  let total = 0;
  for (const [ownerSkillKey, defs] of Object.entries(catalog)) {
    const invested = actor.system.skills?.[ownerSkillKey]?.lehren ?? {};
    for (const def of defs) {
      const level = invested[def.id] ?? 0;
      if (level <= 0) continue;
      for (const row of def.bonuses ?? []) {
        if (row.target !== target) continue;
        if (SCOPED_TARGETS.has(target)) {
          const matches = row.scope === 'everything'
            || (row.scope === 'thisSkill' && ownerSkillKey === skillKey)
            || (row.scope === 'allWeapons' && kind === 'weapon')
            || (row.scope === 'allSpells' && kind === 'spell');
          if (!matches) continue;
        }
        total += evaluateBonusFormula(row.formula, level);
      }
    }
  }
  return total;
}
