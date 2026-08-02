import { SKSKMaterialsConfig } from '../apps/materials-config.mjs';
import { SKSKModelsConfig } from '../apps/models-config.mjs';
import { SKSKStatusEffectsConfig } from '../apps/status-effects-config.mjs';
import { SKSKTrainingMethodsConfig } from '../apps/training-methods-config.mjs';

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

  // GM-configurable list of materials selectable on Item/Armor/Weapon
  // items - see apps/materials-config.mjs and helpers/materials.mjs.
  // No native config UI for an array setting, so it's edited via the menu
  // registered below instead (config: false hides it from the normal
  // settings list).
  game.settings.register('sksk', 'materials', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu('sksk', 'materialsMenu', {
    name: 'SKSK.Settings.Materials.Name',
    hint: 'SKSK.Settings.Materials.Hint',
    label: 'SKSK.Settings.Materials.Label',
    icon: 'fas fa-gem',
    type: SKSKMaterialsConfig,
    restricted: true,
  });

  // GM-configurable lists of Weapon Models (by weapon type) and Armor
  // Models (Light Armor/Heavy Armor/Shield) - see apps/models-config.mjs
  // and helpers/models.mjs.
  game.settings.register('sksk', 'weaponModels', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register('sksk', 'armorModels', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu('sksk', 'modelsMenu', {
    name: 'SKSK.Settings.Models.Name',
    hint: 'SKSK.Settings.Models.Hint',
    label: 'SKSK.Settings.Models.Label',
    icon: 'fas fa-shapes',
    type: SKSKModelsConfig,
    restricted: true,
  });

  // GM-configurable list of status effects (each entry {id, predefined,
  // name, img, description}) - see apps/status-effects-config.mjs and
  // helpers/statusEffects.mjs. Seeded with the system's predefined,
  // mechanically-automated effects (CONFIG.SKSK.predefinedStatusEffects) on
  // "ready" if missing; a GM can also add fully custom, flavor-only ones.
  game.settings.register('sksk', 'statusEffects', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu('sksk', 'statusEffectsMenu', {
    name: 'SKSK.Settings.StatusEffects.Name',
    hint: 'SKSK.Settings.StatusEffects.Hint',
    label: 'SKSK.Settings.StatusEffects.Label',
    icon: 'fas fa-skull-crossbones',
    type: SKSKStatusEffectsConfig,
    restricted: true,
  });

  // GM-configurable list of Training methods (each entry {id, name,
  // mainSkill, mainRate, secondarySkills: [{skill, rate}]}) - see
  // apps/training-methods-config.mjs and helpers/training.mjs. Characters
  // use the header's Training button to spend hours training via one of
  // these, generating FP/hour into the trained skills' pending "gain".
  game.settings.register('sksk', 'trainingMethods', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu('sksk', 'trainingMethodsMenu', {
    name: 'SKSK.Settings.TrainingMethods.Name',
    hint: 'SKSK.Settings.TrainingMethods.Hint',
    label: 'SKSK.Settings.TrainingMethods.Label',
    icon: 'fas fa-dumbbell',
    type: SKSKTrainingMethodsConfig,
    restricted: true,
  });
}
