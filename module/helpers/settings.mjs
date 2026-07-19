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
}
