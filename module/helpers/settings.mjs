import { SKSKMaterialsConfig } from '../apps/materials-config.mjs';
import { SKSKModelsConfig } from '../apps/models-config.mjs';
import { SKSKStatusEffectsConfig } from '../apps/status-effects-config.mjs';
import { SKSKTrainingMethodsConfig } from '../apps/training-methods-config.mjs';
import { SKSKCombatStylesConfig } from '../apps/combat-styles-config.mjs';
import { SKSKSettingsExportImport } from '../apps/settings-export-import.mjs';
import { SKSKSkillUsageFpConfig } from '../apps/skill-usage-fp-config.mjs';
import { SKSKLehrenConfig } from '../apps/lehren-config.mjs';
import { SKSKEffectKeyReference } from '../apps/effect-key-reference.mjs';
import { SKSKGeneralSettingsConfig } from '../apps/general-settings-config.mjs';

/**
 * Register world-scoped game settings for the system.
 */
export function registerSettings() {
  // Bundled behind the General Settings menu below (apps/general-settings-
  // config.mjs) rather than rendered as separate config:true fields by
  // Foundry's own Settings dialog - config:false hides them from that
  // native list.
  game.settings.register('sksk', 'skillPointsLevel10', {
    scope: 'world',
    config: false,
    type: Number,
    default: 200,
  });

  game.settings.register('sksk', 'skillPointsLevel5', {
    scope: 'world',
    config: false,
    type: Number,
    default: 400,
  });

  // The base max carry weight, before the size-category multiplier (see
  // helpers/inventory.mjs#computeMaxCarryWeight). Evaluated as a real Roll
  // formula against the actor's own roll data, so it can reference
  // "@attributes.str.value", "@attributes.str.mod", "@skills.<key>",
  // "@lvl", etc. Carry weight is a resource (see data/actor-base.mjs's
  // attribute schema), so the default deliberately references
  // "@attributes.str.baseValue" (Base-tier bonus only) rather than
  // ".value" - a GM authoring a custom formula should do the same unless
  // they specifically want Spezial-/Modifikator-Boni to affect it too.
  game.settings.register('sksk', 'carryWeightFormula', {
    scope: 'world',
    config: false,
    type: String,
    default: '@attributes.str.baseValue * 5',
  });

  // GM-only menu bundling the three plain settings above into one dialog -
  // see apps/general-settings-config.mjs. Registered first so its button is
  // the first entry in the Skilled Skirmish settings list.
  game.settings.registerMenu('sksk', 'generalSettingsMenu', {
    name: 'SKSK.Settings.GeneralSettings.Name',
    hint: 'SKSK.Settings.GeneralSettings.Hint',
    label: 'SKSK.Settings.GeneralSettings.Label',
    icon: 'fas fa-sliders-h',
    type: SKSKGeneralSettingsConfig,
    restricted: true,
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

  // GM-configurable list of Kampfstile (each entry {id, name}) - see
  // apps/combat-styles-config.mjs and data/technique.mjs. A Technique item
  // stores the chosen style's id and resolves it against this live list at
  // render/roll time, same convention as Training Methods below.
  game.settings.register('sksk', 'combatStyles', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu('sksk', 'combatStylesMenu', {
    name: 'SKSK.Settings.CombatStyles.Name',
    hint: 'SKSK.Settings.CombatStyles.Hint',
    label: 'SKSK.Settings.CombatStyles.Label',
    icon: 'fas fa-fist-raised',
    type: SKSKCombatStylesConfig,
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

  // GM-configurable catalog of Lehren (Lore), per skill - see apps/lehren-
  // config.mjs and helpers/lehren.mjs. Each skill has its own list; a
  // Character freely distributes a shared pool of 5 levels across one
  // skill's own Lehren (apps/lehren-dialog.mjs), gated per-Lehre by its own
  // minSkillLevel.
  game.settings.register('sksk', 'lehren', {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu('sksk', 'lehrenMenu', {
    name: 'SKSK.Settings.Lehren.Name',
    hint: 'SKSK.Settings.Lehren.Hint',
    label: 'SKSK.Settings.Lehren.Label',
    icon: 'fas fa-book',
    type: SKSKLehrenConfig,
    restricted: true,
  });

  // GM-configurable FP-per-usage rates, keyed by skill - see
  // apps/skill-usage-fp-config.mjs and helpers/skillFp.mjs. Characters only
  // (like Training); NPCs never generate FP this way.
  game.settings.register('sksk', 'skillUsageFp', {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu('sksk', 'skillUsageFpMenu', {
    name: 'SKSK.Settings.SkillUsageFp.Name',
    hint: 'SKSK.Settings.SkillUsageFp.Hint',
    label: 'SKSK.Settings.SkillUsageFp.Label',
    icon: 'fas fa-bolt',
    type: SKSKSkillUsageFpConfig,
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

  // GM-only export/import of every world setting above as one JSON file -
  // see apps/settings-export-import.mjs. No backing setting of its own,
  // just a menu opening the export/import app.
  game.settings.registerMenu('sksk', 'exportImportMenu', {
    name: 'SKSK.Settings.ExportImport.Name',
    hint: 'SKSK.Settings.ExportImport.Hint',
    label: 'SKSK.Settings.ExportImport.Label',
    icon: 'fas fa-file-export',
    type: SKSKSettingsExportImport,
    restricted: true,
  });

  // GM-only read-only reference: every real system.* path a Foundry Active
  // Effect can target on an SKSK actor - see apps/effect-key-reference.mjs.
  // No backing setting - purely derived from CONFIG.SKSK at render time.
  game.settings.registerMenu('sksk', 'effectKeyReferenceMenu', {
    name: 'SKSK.Settings.EffectKeyReference.Name',
    hint: 'SKSK.Settings.EffectKeyReference.Hint',
    label: 'SKSK.Settings.EffectKeyReference.Label',
    icon: 'fas fa-key',
    type: SKSKEffectKeyReference,
    restricted: true,
  });
}
