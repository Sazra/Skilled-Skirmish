import { getSkillLabel } from '../helpers/skills.mjs';
import { copyEffectKeyToClipboard } from '../helpers/effectKeyReference.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds one category's rows from a CONFIG.SKSK vocab object, keyed the same
 * way the corresponding actor-schema SchemaField is keyed.
 * @param {Object<string,string>} vocab   E.g. CONFIG.SKSK.attributes.
 * @param {string} keyPrefix              E.g. "system.weaponAttackBonus.".
 * @return {Array<{label: string, key: string}>}
 */
function vocabRows(vocab, keyPrefix) {
  return Object.entries(vocab).map(([key, labelKey]) => ({
    label: game.i18n.localize(labelKey),
    key: `${keyPrefix}${key}`,
  }));
}

/**
 * GM-only settings menu app: a read-only, searchable catalog of every real
 * `system.*` path a Foundry ActiveEffect's own "Attribute Key" field can
 * legitimately target on an SKSK actor - built live from the same
 * CONFIG.SKSK vocab objects the schema fields themselves iterate (see
 * data/actor-base.mjs), so it can never drift out of sync with the schema.
 * No backing world setting of its own - purely derived/read-only, same
 * "no settings key" shape as apps/settings-export-import.mjs.
 */
export class SKSKEffectKeyReference extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-effect-key-reference',
    classes: ['sksk', 'effect-key-reference'],
    window: {
      title: 'SKSK.Settings.EffectKeyReference.Name',
      icon: 'fas fa-key',
    },
    position: { width: 560, height: 680 },
    actions: {
      copyEffectKey: SKSKEffectKeyReference.#copyEffectKey,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/effect-key-reference.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const skillRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skills.${key}.gain` }));
    const skillRollBonusRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skillRollBonus.${key}` }));

    context.categories = [
      {
        title: 'SKSK.EffectKeyReference.Category.Attributes',
        hint: 'SKSK.EffectKeyReference.Category.AttributesHint',
        rows: Object.entries(CONFIG.SKSK.attributes).flatMap(([key, labelKey]) => {
          const label = game.i18n.localize(labelKey);
          return [
            { label: `${label} (Base)`, key: `system.attributeBonuses.${key}.base` },
            { label: `${label} (Special)`, key: `system.attributeBonuses.${key}.special` },
            { label: `${label} (Modifier)`, key: `system.attributeBonuses.${key}.modifier` },
          ];
        }),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.Resources',
        rows: [
          { label: game.i18n.localize('SKSK.Resource.Life'), key: 'system.life.bonus' },
          { label: game.i18n.localize('SKSK.Resource.Mana'), key: 'system.mana.bonus' },
          { label: game.i18n.localize('SKSK.Resource.AP'), key: 'system.actionPoints.bonus' },
          { label: game.i18n.localize('SKSK.Resource.RP'), key: 'system.reactionPoints.bonus' },
          { label: game.i18n.localize('SKSK.Resource.AC'), key: 'system.customArmorClassBonus' },
          { label: game.i18n.localize('SKSK.Resource.MR'), key: 'system.customMagicResistanceBonus' },
        ],
      },
      {
        title: 'SKSK.EffectKeyReference.Category.Misc',
        rows: [
          { label: 'Natural Material Bonus', key: 'system.naturalMaterialBonus.bonus' },
          { label: 'Critical Hit Threshold', key: 'system.criticalHitThreshold' },
          { label: 'Critical Failure Threshold', key: 'system.criticalFailureThreshold' },
          { label: 'Generic Critical Roll Mode', key: 'system.genericCriticalRollMode' },
          { label: 'Assassination Bonus Dice', key: 'system.assassinationBonusDice' },
          { label: 'Overcharge Max Bonus', key: 'system.overchargeMaxBonus' },
          { label: 'Soul Path Breakthrough Bonus', key: 'system.soulPathBreakthroughBonus' },
          { label: 'Summon Slots Bonus', key: 'system.summonSlotsBonus' },
          { label: 'Totem Slots Bonus', key: 'system.totemSlotsBonus' },
          { label: 'Genereller Wurfbonus (alle Würfe)', key: 'system.allRollsBonus' },
          { label: 'Trefferbonus: alle Waffen (inkl. Kampfkunst)', key: 'system.weaponAttackBonusAll' },
          { label: 'Schadensbonus: alle Waffen (inkl. Kampfkunst)', key: 'system.damageBonusAll' },
          { label: 'Trefferbonus: alle Zauber', key: 'system.spellAttackBonusAll' },
          { label: 'Schadensbonus: alle Zauber', key: 'system.spellDamageBonusAll' },
        ],
      },
      {
        title: 'SKSK.EffectKeyReference.Category.MagicSchoolAttack',
        rows: [
          ...vocabRows(CONFIG.SKSK.simpleMagicSchools, 'system.magicSchoolAttackBonus.'),
          ...vocabRows(CONFIG.SKSK.advancedMagicSchools, 'system.magicSchoolAttackBonus.'),
          ...vocabRows(CONFIG.SKSK.combinedMagicSchools, 'system.combinedMagicSchoolAttackBonus.'),
        ],
      },
      {
        // CONFIG.SKSK.skills.weapons is keyed by skill DEFINITION objects
        // ({label, maxLevel, ...}), unlike the other vocab objects below
        // (keyed by a plain localization-key string) - vocabRows can't
        // handle this shape, so this one reuses getSkillLabel directly
        // (same as skillRows/skillRollBonusRows further down).
        title: 'SKSK.EffectKeyReference.Category.WeaponAttack',
        rows: Object.keys(CONFIG.SKSK.skills.weapons).map(key => ({
          label: game.i18n.localize(getSkillLabel(key)), key: `system.weaponAttackBonus.${key}`,
        })),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.DamageBonus',
        rows: vocabRows(CONFIG.SKSK.damageTypes, 'system.damageBonus.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.AttributeRoll',
        rows: vocabRows(CONFIG.SKSK.attributes, 'system.attributeRollBonus.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillRoll',
        rows: skillRollBonusRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillGain',
        rows: skillRows,
      },
    ];

    return context;
  }

  /** @private */
  static async #copyEffectKey(event, target) {
    await copyEffectKeyToClipboard(target.dataset.effectKey);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Plain substring filter over every row's "label key" search blob - no
    // existing search-box precedent in this codebase, so this is the first
    // one; kept as simple as possible (show/hide li, no re-render).
    this.element.querySelector('.effect-key-search')?.addEventListener('input', event => {
      const term = event.target.value.trim().toLowerCase();
      for (const row of this.element.querySelectorAll('.effect-key-list .item')) {
        row.style.display = row.dataset.search.toLowerCase().includes(term) ? '' : 'none';
      }
    });
  }
}
