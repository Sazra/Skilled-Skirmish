/**
 * Ressourcen-Definitionen: frequently used custom resources (Leere, Glaube,
 * Yin/Yang, ...) are defined once in the world setting "resourceDefinitions"
 * (apps/resources-config.mjs) and granted by Class/Species/Talent items
 * (system.grantedResources). The actor then carries one entry in its
 * customResources list per granted definition, marked with definitionId:
 * name, abbreviation and maximum come live from the definition (see
 * applyResourceDefinitions), only the current value (and the recovery
 * bookkeeping) is stored on the actor.
 *
 * A definition: {id, name, abbreviation, description, startValue, maxFormula,
 * recovery: [{mode, interval, direction, amountFormula}]}.
 * - maxFormula: like the charge formulas of abilities ("L" = level,
 *   "@attributes.con.mod", "@skills.<skill>", floor()/min()/...); blank = no
 *   maximum.
 * - recovery: when and how the value changes by itself. mode "turnStart" (the
 *   owner's Combat turn), "segments" (every `interval` Abschnitte of a
 *   Pause), "day" (change of day - Calendaria; without it after an
 *   Anpassungspause). direction "increase"/"decrease" by the amount, or "set"
 *   the value to it.
 *
 * Every defined abbreviation is always part of an actor's roll data
 * ("@leere", 0 when the actor has none), so formulas never break.
 */

export const RESOURCE_RECOVERY_MODES = ['turnStart', 'segments', 'day'];
export const RESOURCE_RECOVERY_DIRECTIONS = ['increase', 'decrease', 'set'];

/** The item types that can grant resources. */
export const RESOURCE_GRANTING_TYPES = ['class', 'species', 'talent'];

/**
 * The world's resource definitions.
 * @return {object[]}
 */
export function getResourceDefinitions() {
  try {
    return (game.settings.get('sksk', 'resourceDefinitions') ?? []).filter(def => def?.id);
  } catch (error) {
    return [];
  }
}

/**
 * @param {string} id
 * @return {object|null}
 */
export function getResourceDefinition(id) {
  return getResourceDefinitions().find(def => def.id === id) ?? null;
}

/**
 * The roll-data key of an abbreviation ("Leere" -> "leere").
 * @param {string} abbreviation
 * @return {string}
 */
export function resourceRollKey(abbreviation) {
  return String(abbreviation ?? '').trim().toLowerCase();
}

/**
 * Evaluate a resource formula for an actor (signed - unlike the charge
 * formulas - and rounded down).
 * @param {string} formula
 * @param {Actor} actor
 * @return {number}   0 for a blank/invalid formula.
 */
export function evaluateResourceFormula(formula, actor) {
  const text = String(formula ?? '').trim();
  if (!text) return 0;
  try {
    const expression = text.replace(/\bL\b/g, '@lvl').replace(/\^/g, '**');
    const total = new Roll(expression, actor.getRollData()).evaluateSync({ strict: false }).total;
    return Number.isFinite(total) ? Math.floor(total) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Called while an actor's data is derived: give every definition-bound
 * resource entry its name, abbreviation, description and maximum from the
 * definition.
 * @param {object} system   The actor's system data.
 */
export function applyResourceDefinitions(system) {
  const actor = system.parent;
  const entries = system.customResources ?? [];
  if (!actor || !entries.some(entry => entry.definitionId)) return;
  const definitions = getResourceDefinitions();
  // Names/abbreviations first: the maximum formulas may use them.
  for (const entry of entries) {
    if (!entry.definitionId) continue;
    const def = definitions.find(candidate => candidate.id === entry.definitionId);
    if (!def) continue;
    entry.name = def.name;
    entry.abbreviation = def.abbreviation;
    entry.description = def.description ?? '';
  }
  for (const entry of entries) {
    if (!entry.definitionId) continue;
    const def = definitions.find(candidate => candidate.id === entry.definitionId);
    if (!def) continue;
    entry.max = Math.max(0, evaluateResourceFormula(def.maxFormula, actor));
  }
}

/**
 * The definitions the actor's Class/Species/Talent items grant.
 * @param {Actor} actor
 * @return {Set<string>}
 */
export function getGrantedDefinitionIds(actor) {
  const ids = new Set();
  for (const item of actor.items) {
    if (!RESOURCE_GRANTING_TYPES.includes(item.type)) continue;
    for (const id of item.system.grantedResources ?? []) {
      if (getResourceDefinition(id)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Make the actor's definition-bound resource entries match what its items
 * grant: add the missing ones (with the definition's start value), remove
 * those no longer granted. Writes only if something changed.
 * @param {Actor} actor
 * @return {Promise<boolean>}   Whether the actor was changed.
 */
export async function syncGrantedResources(actor) {
  if (!actor?.isOwner || !actor.system?.customResources) return false;
  const desired = getGrantedDefinitionIds(actor);
  const resources = foundry.utils.deepClone(actor._source.system.customResources ?? []);
  let changed = false;

  for (let index = resources.length - 1; index >= 0; index--) {
    const id = resources[index].definitionId;
    if (id && !desired.has(id)) {
      resources.splice(index, 1);
      changed = true;
    }
  }
  const present = new Set(resources.map(entry => entry.definitionId).filter(Boolean));
  for (const id of desired) {
    if (present.has(id)) continue;
    const def = getResourceDefinition(id);
    resources.push({
      name: def.name, abbreviation: def.abbreviation, definitionId: id,
      value: Math.max(0, Math.floor(Number(def.startValue) || 0)), max: 0,
    });
    changed = true;
  }
  if (changed) await actor.update({ 'system.customResources': resources });
  return changed;
}

/**
 * Sync every world actor the current user may change.
 * @return {Promise<void>}
 */
export async function syncAllActors() {
  for (const actor of game.actors) {
    try {
      await syncGrantedResources(actor);
    } catch (error) {
      console.error('SKSK | Could not sync the resources of', actor.name, error);
    }
  }
}

/**
 * Apply the recovery rules of the given event to the actor's resources.
 * @param {Actor} actor
 * @param {{mode: "turnStart"|"rest"|"day", segments?: number, isBreak?: boolean, tier?: string|null,
 *   calendariaActive?: boolean, days?: number}} event
 * @return {Promise<string[]>}   Chat lines for the resources that changed.
 */
export async function recoverResources(actor, event) {
  const prepared = actor.system?.customResources ?? [];
  if (!prepared.some(entry => entry.definitionId)) return [];
  const resources = foundry.utils.deepClone(actor._source.system.customResources ?? []);
  const lines = [];
  let changed = false;

  resources.forEach((entry, index) => {
    const def = entry.definitionId ? getResourceDefinition(entry.definitionId) : null;
    if (!def?.recovery?.length) return;
    const max = prepared[index]?.max ?? 0;
    const before = entry.value ?? 0;
    let value = before;
    const carry = [...(entry.recoveryCarry ?? [])];

    const apply = (rule, times) => {
      if (times <= 0) return;
      const amount = evaluateResourceFormula(rule.amountFormula, actor);
      if (rule.direction === 'set') value = amount;
      else value += (rule.direction === 'decrease' ? -1 : 1) * amount * times;
    };

    def.recovery.forEach((rule, ruleIndex) => {
      if (event.mode === 'turnStart' && rule.mode === 'turnStart') apply(rule, 1);
      else if (event.mode === 'day' && rule.mode === 'day') apply(rule, rule.direction === 'set' ? 1 : (event.days ?? 1));
      else if (event.mode === 'rest') {
        if (rule.mode === 'segments' && event.isBreak) {
          const interval = Math.max(1, rule.interval ?? 1);
          const total = (carry[ruleIndex] ?? 0) + (event.segments ?? 0);
          const times = Math.floor(total / interval);
          carry[ruleIndex] = total - times * interval;
          apply(rule, times);
        } else if (rule.mode === 'day' && !event.calendariaActive && (event.tier === 'anpassung' || event.tier === 'genesung')) {
          apply(rule, 1);
        }
      }
    });

    value = Math.max(0, max > 0 ? Math.min(max, value) : value);
    const carryChanged = JSON.stringify(Array.from(carry, number => number ?? 0)) !== JSON.stringify(entry.recoveryCarry ?? []);
    if (value === before && !carryChanged) return;
    entry.value = value;
    entry.recoveryCarry = Array.from(carry, number => number ?? 0);
    changed = true;
    if (value !== before) {
      lines.push(game.i18n.format('SKSK.Resource.Definition.Recovered', { name: def.name, from: before, to: value }));
    }
  });

  if (changed) await actor.update({ 'system.customResources': resources });
  return lines;
}

/**
 * Hooks keeping the granted resources in sync: an owned Class/Species/Talent
 * is added, removed or has its list of granted resources changed, the world
 * setting changes, or the world is opened. Each change is written by the
 * client that made it (items) or the active GM (setting, world start).
 */
export function registerResourceHooks() {
  const syncOwner = (item, userId) => {
    if (userId !== game.user.id) return;
    const actor = item.parent;
    if (actor?.documentName !== 'Actor' || !RESOURCE_GRANTING_TYPES.includes(item.type)) return;
    syncGrantedResources(actor);
  };
  Hooks.on('createItem', (item, options, userId) => syncOwner(item, userId));
  Hooks.on('deleteItem', (item, options, userId) => syncOwner(item, userId));
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (foundry.utils.hasProperty(changes, 'system.grantedResources')) syncOwner(item, userId);
  });

  // Called from the 'ready' hook, so the world is open already.
  if (game.user.id === game.users.activeGM?.id) syncAllActors();
}

/**
 * The definitions changed (apps/resources-config.mjs): the active GM syncs
 * all actors, everyone re-prepares and re-renders theirs.
 * @return {Promise<void>}
 */
export async function onResourceDefinitionsChanged() {
  if (game.user.id === game.users.activeGM?.id) await syncAllActors();
  for (const actor of game.actors) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render();
    } catch (error) {
      console.warn('SKSK | Could not refresh', actor.name, error);
    }
  }
}
