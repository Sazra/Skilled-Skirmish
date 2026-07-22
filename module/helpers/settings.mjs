/**
 * Register world-scoped game settings for the system.
 */
export function registerSettings() {
  game.settings.register('sksk', 'skillPointsLevel5', {
    name: 'SKSK.Settings.SkillPointsLevel5.Name',
    hint: 'SKSK.Settings.SkillPointsLevel5.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 400,
  });

  game.settings.register('sksk', 'skillPointsLevel10', {
    name: 'SKSK.Settings.SkillPointsLevel10.Name',
    hint: 'SKSK.Settings.SkillPointsLevel10.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 200,
  });

  // The base max carry weight, before the size-category multiplier (see
  // helpers/inventory.mjs#computeMaxCarryWeight). Evaluated as a real Roll
  // formula against the actor's own roll data, so it can reference
  // "@attributes.str.value", "@attributes.str.mod", "@skills.<key>",
  // "@lvl", etc.
  game.settings.register('sksk', 'carryWeightFormula', {
    name: 'SKSK.Settings.CarryWeightFormula.Name',
    hint: 'SKSK.Settings.CarryWeightFormula.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: '@attributes.str.value * 5',
  });
}
