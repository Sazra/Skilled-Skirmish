/**
 * The GM-configured list of Kampfstile (combat/technique styles) - see
 * apps/combat-styles-config.mjs. Each entry is {id, name}.
 * @return {Array<{id: string, name: string}>}
 */
export function getCombatStyles() {
  return game.settings.get('sksk', 'combatStyles') ?? [];
}

/**
 * A single combat style's display name by id, or "" if unknown/blank.
 * @param {string} id
 * @return {string}
 */
export function getCombatStyleName(id) {
  if (!id) return '';
  return getCombatStyles().find(s => s.id === id)?.name ?? '';
}
