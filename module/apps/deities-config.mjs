import { getSkillBonusChoices } from '../helpers/skills.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only settings menu app for managing the world's list of Patrone
 * (Deities) - see helpers/settings.mjs (the "deities"/"deityAbilityCount"
 * settings) and helpers/religion.mjs (how this data is consumed). Follows
 * the same add/remove-array-entry + submitOnChange pattern as
 * apps/training-methods-config.mjs. Elements/Patron-Fertigkeiten are
 * rendered as checkbox grids (see templates/apps/soul-path-elements-
 * dialog.hbs and templates/apps/martial-arts-attacks-dialog.hbs for the two
 * existing precedents this follows) bound as per-key booleans under a
 * submitOnChange form, then flattened to plain key arrays on submit -
 * functionally identical to a native multi-select, but consistent with
 * every other array-valued field on this form.
 *
 * Every Deity's "abilities" array is always kept exactly
 * `deityAbilityCount` entries long (padded/truncated on every submit, see
 * #onSubmit), so a Glaubensklasse can reference "Patron-Fähigkeit #N" and
 * have it resolve for any Deity regardless of which one an actor follows.
 */
export class SKSKDeitiesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-deities-config',
    tag: 'form',
    classes: ['sksk', 'deities-config'],
    window: {
      title: 'SKSK.Settings.Deities.Name',
      icon: 'fas fa-hands-praying',
    },
    // Same width as materials-config.mjs/training-methods-config.mjs/etc.
    position: { width: 820, height: 640 },
    form: {
      handler: SKSKDeitiesConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addDeity: SKSKDeitiesConfig.#addDeity,
      removeDeity: SKSKDeitiesConfig.#removeDeity,
      addDomain: SKSKDeitiesConfig.#addDomain,
      removeDomain: SKSKDeitiesConfig.#removeDomain,
      addDeed: SKSKDeitiesConfig.#addDeed,
      removeDeed: SKSKDeitiesConfig.#removeDeed,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/deities-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.deities = game.settings.get('sksk', 'deities') ?? [];
    context.deityAbilityCount = game.settings.get('sksk', 'deityAbilityCount') ?? 3;
    context.elementChoices = Object.entries(CONFIG.SKSK.damageTypes)
      .filter(([key]) => key !== 'aether')
      .map(([key, label]) => ({ key, label }));
    context.skillChoices = getSkillBonusChoices();
    context.combinedSchoolChoices = { '': 'SKSK.Deity.NoCombinedSchoolOverride', ...CONFIG.SKSK.combinedMagicSchools };
    context.deedTypeChoices = { passive: 'SKSK.Deity.Deed.Passive', active: 'SKSK.Deity.Deed.Active' };
    return context;
  }

  /**
   * Reassemble the submitted flat/nested "deities.<index>.<field>" keys
   * (elements/skills submitted as per-key boolean maps, see class doc)
   * back into arrays and persist. Ids are carried over from the existing
   * stored value, not form fields. Every Deity's abilities array is padded
   * or truncated to the submitted deityAbilityCount.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'deities') ?? [];
    const abilityCount = Math.max(1, Number(expanded.deityAbilityCount) || 1);

    const toKeyArray = obj => Object.entries(obj ?? {}).filter(([, checked]) => checked).map(([key]) => key);
    const toValueArray = obj => Object.values(obj ?? {});

    const deities = Object.entries(expanded.deities ?? {}).map(([index, d]) => {
      const abilities = toValueArray(d.abilities).map(a => ({ name: a.name ?? '', description: a.description ?? '' }));
      while (abilities.length < abilityCount) abilities.push({ name: '', description: '' });
      abilities.length = abilityCount;

      return {
        id: existing[index]?.id ?? foundry.utils.randomID(),
        name: d.name ?? '',
        description: d.description ?? '',
        elements: toKeyArray(d.elements),
        skills: toKeyArray(d.skills),
        combinedSchoolOverride: d.combinedSchoolOverride ?? '',
        domains: toValueArray(d.domains).map(v => v ?? ''),
        deeds: Object.entries(d.deeds ?? {}).map(([deedIndex, deed]) => ({
          id: existing[index]?.deeds?.[deedIndex]?.id ?? foundry.utils.randomID(),
          name: deed.name ?? '',
          amount: Number(deed.amount) || 0,
          type: deed.type === 'active' ? 'active' : 'passive',
        })),
        abilities,
      };
    });

    await game.settings.set('sksk', 'deityAbilityCount', abilityCount);
    await game.settings.set('sksk', 'deities', deities);
  }

  /** @private */
  static async #addDeity(event, target) {
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    const abilityCount = game.settings.get('sksk', 'deityAbilityCount') ?? 3;
    deities.push({
      id: foundry.utils.randomID(), name: '', description: '', elements: [], skills: [],
      combinedSchoolOverride: '', domains: [], deeds: [],
      abilities: Array.from({ length: abilityCount }, () => ({ name: '', description: '' })),
    });
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }

  /** @private */
  static async #removeDeity(event, target) {
    const index = Number(target.dataset.index);
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    deities.splice(index, 1);
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }

  /** @private */
  static async #addDomain(event, target) {
    const deityIndex = Number(target.dataset.deityIndex);
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    deities[deityIndex]?.domains.push('');
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }

  /** @private */
  static async #removeDomain(event, target) {
    const deityIndex = Number(target.dataset.deityIndex);
    const index = Number(target.dataset.index);
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    deities[deityIndex]?.domains.splice(index, 1);
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }

  /** @private */
  static async #addDeed(event, target) {
    const deityIndex = Number(target.dataset.deityIndex);
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    deities[deityIndex]?.deeds.push({ id: foundry.utils.randomID(), name: '', amount: 0, type: 'passive' });
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }

  /** @private */
  static async #removeDeed(event, target) {
    const deityIndex = Number(target.dataset.deityIndex);
    const index = Number(target.dataset.index);
    const deities = foundry.utils.deepClone(game.settings.get('sksk', 'deities') ?? []);
    deities[deityIndex]?.deeds.splice(index, 1);
    await game.settings.set('sksk', 'deities', deities);
    this.render();
  }
}
