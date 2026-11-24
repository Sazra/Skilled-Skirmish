import {
  RESOURCE_RECOVERY_MODES, RESOURCE_RECOVERY_DIRECTIONS, RESOURCE_EFFECT_TYPES, RESOURCE_EFFECT_PHASES,
} from '../helpers/resourceDefinitions.mjs';
import { SKSKEffectKeyReference } from './effect-key-reference.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only settings menu app for the world's Resource definitions (Leere,
 * Glaube, Yin/Yang, ...) - see helpers/resourceDefinitions.mjs. A Class/
 * Species/Talent item grants one or more of them (its GM tab); the owner then
 * gets the resource with this name, abbreviation, maximum and recovery.
 * Follows the add/remove-array-entry pattern of apps/combat-styles-config.mjs,
 * each definition carrying its own list of recovery rules.
 */
export class SKSKResourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-resources-config',
    tag: 'form',
    classes: ['sksk', 'resources-config'],
    window: {
      title: 'SKSK.Settings.Resources.Name',
      icon: 'fas fa-gem',
    },
    position: { width: 560, height: 680 },
    form: {
      handler: SKSKResourcesConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addDefinition: SKSKResourcesConfig.#addDefinition,
      removeDefinition: SKSKResourcesConfig.#removeDefinition,
      addRecovery: SKSKResourcesConfig.#addRecovery,
      removeRecovery: SKSKResourcesConfig.#removeRecovery,
      addPerPoint: SKSKResourcesConfig.#addPerPoint,
      removePerPoint: SKSKResourcesConfig.#removePerPoint,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/resources-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.definitions = (game.settings.get('sksk', 'resourceDefinitions') ?? []).map(def => ({
      ...def, recovery: def.recovery ?? [], perPoint: def.perPoint ?? [],
    }));
    context.modeChoices = Object.fromEntries(RESOURCE_RECOVERY_MODES.map(mode => [mode, `SKSK.Resource.Definition.Mode.${mode}`]));
    context.directionChoices = Object.fromEntries(RESOURCE_RECOVERY_DIRECTIONS.map(dir => [dir, `SKSK.Resource.Definition.Direction.${dir}`]));
    context.typeChoices = Object.fromEntries(RESOURCE_EFFECT_TYPES.map(type => [type, `SKSK.Resource.Definition.EffectType.${type}`]));
    context.phaseChoices = Object.fromEntries(RESOURCE_EFFECT_PHASES.map(phase => [phase, `SKSK.Resource.Definition.EffectPhase.${phase}`]));
    // Suggestions for the effect key: every key of the effect key catalog plus
    // the derived maximums that need type "custom"/phase "final".
    const keys = new Set(['system.life.max', 'system.mana.max', 'system.actionPoints.max', 'system.reactionPoints.max']);
    try {
      for (const category of SKSKEffectKeyReference.buildCategories()) for (const row of category.rows) keys.add(row.key);
    } catch (error) {
      console.warn('SKSK | Could not build the effect key suggestions', error);
    }
    context.effectKeys = [...keys];
    return context;
  }

  /**
   * Parse the flat "definitions.<i>.<field>" / "definitions.<i>.recovery.<j>.<field>"
   * form keys back into the stored array - ids come from the existing value
   * (not form fields) so they stay stable.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'resourceDefinitions') ?? [];
    const definitions = Object.entries(expanded.definitions ?? {}).map(([index, def]) => ({
      id: existing[index]?.id ?? foundry.utils.randomID(),
      name: String(def.name ?? '').trim(),
      // The roll-data name: no spaces or special characters.
      abbreviation: String(def.abbreviation ?? '').replace(/[^\p{L}\p{N}_]/gu, ''),
      description: def.description ?? '',
      startValue: Math.max(0, Math.floor(Number(def.startValue) || 0)),
      maxFormula: String(def.maxFormula ?? '').trim(),
      recovery: Object.values(def.recovery ?? {}).map(rule => ({
        mode: RESOURCE_RECOVERY_MODES.includes(rule.mode) ? rule.mode : 'turnStart',
        interval: Math.max(1, Math.floor(Number(rule.interval) || 1)),
        direction: RESOURCE_RECOVERY_DIRECTIONS.includes(rule.direction) ? rule.direction : 'increase',
        amountFormula: String(rule.amountFormula ?? '').trim(),
      })),
      perPoint: Object.values(def.perPoint ?? {}).map(rule => ({
        key: String(rule.key ?? '').trim(),
        type: RESOURCE_EFFECT_TYPES.includes(rule.type) ? rule.type : 'add',
        phase: RESOURCE_EFFECT_PHASES.includes(rule.phase) ? rule.phase : 'initial',
        value: String(rule.value ?? '').trim(),
      })),
    }));
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
  }

  /** @private */
  static async #addDefinition() {
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    definitions.push({
      id: foundry.utils.randomID(), name: '', abbreviation: '', description: '', startValue: 0, maxFormula: '', recovery: [], perPoint: [],
    });
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }

  /** @private */
  static async #removeDefinition(event, target) {
    const index = Number(target.dataset.index);
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('SKSK.Resource.Definition.RemoveTitle') },
      content: `<p>${game.i18n.format('SKSK.Resource.Definition.RemoveConfirm', { name: definitions[index]?.name ?? '' })}</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    definitions.splice(index, 1);
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }

  /** @private */
  static async #addRecovery(event, target) {
    const index = Number(target.dataset.index);
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    if (!definitions[index]) return;
    definitions[index].recovery = [...(definitions[index].recovery ?? []),
      { mode: 'turnStart', interval: 1, direction: 'increase', amountFormula: '1' }];
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }

  /** @private */
  static async #addPerPoint(event, target) {
    const index = Number(target.dataset.index);
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    if (!definitions[index]) return;
    definitions[index].perPoint = [...(definitions[index].perPoint ?? []), { key: '', type: 'add', phase: 'initial', value: '@value' }];
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }

  /** @private */
  static async #removePerPoint(event, target) {
    const index = Number(target.dataset.index);
    const ruleIndex = Number(target.dataset.rule);
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    if (!definitions[index]) return;
    definitions[index].perPoint?.splice(ruleIndex, 1);
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }

  /** @private */
  static async #removeRecovery(event, target) {
    const index = Number(target.dataset.index);
    const ruleIndex = Number(target.dataset.rule);
    const definitions = foundry.utils.deepClone(game.settings.get('sksk', 'resourceDefinitions') ?? []);
    if (!definitions[index]) return;
    definitions[index].recovery?.splice(ruleIndex, 1);
    await game.settings.set('sksk', 'resourceDefinitions', definitions);
    this.render();
  }
}
