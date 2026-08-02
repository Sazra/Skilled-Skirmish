import { getSkillBonusChoices } from '../helpers/skills.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only settings menu app for managing the world's list of Training
 * methods (see helpers/training.mjs). A plain world setting (an untyped
 * Array) has no native config UI, so this provides one, following the same
 * add/remove-array-entry pattern used elsewhere (see also
 * apps/materials-config.mjs). Each method has one main skill (mandatory)
 * plus a variable number of secondary skills, each with its own FP/hour
 * rate - both nested arrays are flattened back out on submit the same way
 * the top-level list itself is.
 */
export class SKSKTrainingMethodsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-training-methods-config',
    tag: 'form',
    classes: ['sksk', 'training-methods-config'],
    window: {
      title: 'SKSK.Settings.TrainingMethods.Name',
      icon: 'fas fa-dumbbell',
    },
    position: { width: 560, height: 640 },
    form: {
      handler: SKSKTrainingMethodsConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addMethod: SKSKTrainingMethodsConfig.#addMethod,
      removeMethod: SKSKTrainingMethodsConfig.#removeMethod,
      addSecondarySkill: SKSKTrainingMethodsConfig.#addSecondarySkill,
      removeSecondarySkill: SKSKTrainingMethodsConfig.#removeSecondarySkill,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/training-methods-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.methods = game.settings.get('sksk', 'trainingMethods') ?? [];
    context.skillChoices = getSkillBonusChoices();
    return context;
  }

  /**
   * Parse the submitted form's flat "methods.<index>.<field>" and nested
   * "methods.<index>.secondarySkills.<subIndex>.<field>" keys back into
   * arrays and persist them as the world setting. Ids are carried over from
   * the existing stored value (not form fields) so they stay stable.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'trainingMethods') ?? [];
    const methods = Object.entries(expanded.methods ?? {}).map(([index, m]) => ({
      id: existing[index]?.id ?? foundry.utils.randomID(),
      name: m.name ?? '',
      mainSkill: m.mainSkill ?? '',
      mainRate: Number(m.mainRate) || 0,
      secondarySkills: Object.values(m.secondarySkills ?? {}).map(s => ({
        skill: s.skill ?? '',
        rate: Number(s.rate) || 0,
      })),
    }));
    await game.settings.set('sksk', 'trainingMethods', methods);
  }

  /** @private */
  static async #addMethod(event, target) {
    const methods = foundry.utils.deepClone(game.settings.get('sksk', 'trainingMethods') ?? []);
    methods.push({ id: foundry.utils.randomID(), name: '', mainSkill: '', mainRate: 0, secondarySkills: [] });
    await game.settings.set('sksk', 'trainingMethods', methods);
    this.render();
  }

  /** @private */
  static async #removeMethod(event, target) {
    const index = Number(target.dataset.index);
    const methods = foundry.utils.deepClone(game.settings.get('sksk', 'trainingMethods') ?? []);
    methods.splice(index, 1);
    await game.settings.set('sksk', 'trainingMethods', methods);
    this.render();
  }

  /** @private */
  static async #addSecondarySkill(event, target) {
    const methodIndex = Number(target.dataset.methodIndex);
    const methods = foundry.utils.deepClone(game.settings.get('sksk', 'trainingMethods') ?? []);
    methods[methodIndex]?.secondarySkills.push({ skill: '', rate: 0 });
    await game.settings.set('sksk', 'trainingMethods', methods);
    this.render();
  }

  /** @private */
  static async #removeSecondarySkill(event, target) {
    const methodIndex = Number(target.dataset.methodIndex);
    const index = Number(target.dataset.index);
    const methods = foundry.utils.deepClone(game.settings.get('sksk', 'trainingMethods') ?? []);
    methods[methodIndex]?.secondarySkills.splice(index, 1);
    await game.settings.set('sksk', 'trainingMethods', methods);
    this.render();
  }
}
