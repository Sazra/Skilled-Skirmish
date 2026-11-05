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
    context.categories = SKSKEffectKeyReference.buildCategories();
    return context;
  }

  /**
   * Every category (title localization key + {label, key} rows) of the
   * catalog - also the source of the Active Effect sheet's key autocomplete
   * (helpers/effectKeyAutocomplete.mjs).
   * @return {Array<{title: string, hint?: string, rows: Array<{label: string, key: string}>}>}
   */
  static buildCategories() {
    const skillRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skills.${key}.gain` }));
    const skillRollBonusRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skillRollBonus.${key}` }));
    const skillLevelRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skillLevelBonus.${key}` }));
    const skillRollApCostRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skillRollApCostModifier.${key}` }));
    const skillRollRpCostRows = Object.values(CONFIG.SKSK.skills)
      .flatMap(category => Object.keys(category))
      .map(key => ({ label: game.i18n.localize(getSkillLabel(key)), key: `system.skillRollRpCostModifier.${key}` }));

    // Actor-wide Active-Effect counterparts of the bonus lists on Species/
    // Class/Talent items (and Items/Armor/Weapons for cost reductions and
    // movement) - see data/actor-base.mjs.
    const chargeRows = Object.entries(CONFIG.SKSK.chargeResources).flatMap(([key, labelKey]) => {
      const label = game.i18n.localize(labelKey);
      return [
        { label: `${label} (Flat)`, key: `system.chargeBonusFlat.${key}` },
        { label: `${label} (%)`, key: `system.chargeBonusPercent.${key}` },
      ];
    });
    const schoolVocab = {
      ...CONFIG.SKSK.simpleMagicSchools, ...CONFIG.SKSK.advancedMagicSchools,
      ...CONFIG.SKSK.combinedMagicSchools, ...CONFIG.SKSK.systemlessMagicCategories,
    };
    const schoolCostRows = Object.entries(schoolVocab).flatMap(([key, labelKey]) => {
      const label = game.i18n.localize(labelKey);
      return [
        { label: `${label} - Mana (%)`, key: `system.manaCostReductionPercentBySchool.${key}` },
        { label: `${label} - Mana (Flat)`, key: `system.manaCostReductionFlatBySchool.${key}` },
        { label: `${label} - AP (Flat)`, key: `system.apCostReductionBySchool.${key}` },
      ];
    });
    const movementRows = [
      ...Object.entries(CONFIG.SKSK.movementTypes).map(([key, labelKey]) => ({
        label: game.i18n.localize(labelKey), key: `system.movementBonus.${key}`,
      })),
      { label: game.i18n.localize('SKSK.EffectKeyReference.Category.MovementBonusAll'), key: 'system.movementBonusAll' },
    ];
    const attributeMaxRows = Object.entries(CONFIG.SKSK.attributes).flatMap(([key, labelKey]) => {
      const label = game.i18n.localize(labelKey);
      return [
        { label: `${label} (Max +/-)`, key: `system.attributeMaxBonus.${key}` },
        { label: `${label} (Max ×)`, key: `system.attributeMaxMultiplier.${key}` },
      ];
    });

    return [
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
          { label: 'Mana Cost Reduction (%)', key: 'system.manaCostReductionPercent' },
          { label: 'Mana Cost Reduction (flat)', key: 'system.manaCostReductionFlat' },
          { label: 'Manakosten dürfen unter 1 fallen (Schalter)', key: 'system.manaCostAllowBelowOne' },
          { label: 'Rituale: Magiekontrolle-Rabatt zusätzlich (Schalter)', key: 'system.ritualsUseMagicControl' },
          { label: 'AP-Kosten-Reduktion: alle Zauber (flat)', key: 'system.apCostReductionFlat' },
          { label: 'Critical Hit Threshold', key: 'system.criticalHitThreshold' },
          { label: 'Critical Failure Threshold', key: 'system.criticalFailureThreshold' },
          { label: 'Generic Critical Roll Mode', key: 'system.genericCriticalRollMode' },
          { label: 'Assassination Bonus Dice', key: 'system.assassinationBonusDice' },
          { label: 'Overcharge Max Bonus', key: 'system.overchargeMaxBonus' },
          { label: 'Überladung: Mana-Mehrkosten (% pro Überladung)', key: 'system.overchargeManaPercentBonus' },
          { label: 'Überladung: Mana-Mehrkosten (flat pro Überladung)', key: 'system.overchargeManaFlatBonus' },
          { label: 'Überladung: AP-Mehrkosten (pro Überladung)', key: 'system.overchargeApCostBonus' },
          { label: 'Zusatzschaden an Barrieren (%)', key: 'system.barrierDamageBonus' },
          { label: 'Soul Path Breakthrough Bonus', key: 'system.soulPathBreakthroughBonus' },
          { label: 'Summon Slots Bonus', key: 'system.summonSlotsBonus' },
          { label: 'Totem Slots Bonus', key: 'system.totemSlotsBonus' },
          { label: 'Genereller Wurfbonus (alle Würfe)', key: 'system.allRollsBonus' },
          { label: 'Initiative-Bonus', key: 'system.initiativeBonus' },
          { label: 'Tödliche Angriffe (Schalter)', key: 'system.damageRerollTwiceWeapon' },
          { label: 'Tödliche Magie (Schalter)', key: 'system.damageRerollTwiceSpell' },
          { label: 'Trefferbonus: alle Waffen (inkl. Kampfkunst)', key: 'system.weaponAttackBonusAll' },
          { label: 'Schadensbonus: alle Waffen (inkl. Kampfkunst)', key: 'system.damageBonusAll' },
          { label: 'Trefferbonus: alle Zauber', key: 'system.spellAttackBonusAll' },
          { label: 'Schadensbonus: alle Zauber', key: 'system.spellDamageBonusAll' },
          { label: 'Verbesserte Magieresistenz (Schalter)', key: 'system.improvedMagicResistance' },
          { label: 'Tarnung bricht nicht solange nicht getroffen (Schalter)', key: 'system.concealmentBreaksOnlyOnHit' },
          { label: 'Tarnung bricht nicht bei Angriff (Schalter)', key: 'system.concealmentNeverBreaksOnAttack' },
          { label: 'AP-Kosten-Modifikator: alle Fertigkeits-/Attributswürfe', key: 'system.skillRollApCostModifierAll' },
          { label: 'RP-Kosten-Modifikator: alle Fertigkeits-/Attributswürfe', key: 'system.skillRollRpCostModifierAll' },
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
        title: 'SKSK.EffectKeyReference.Category.MagicSchoolDamage',
        rows: [
          ...vocabRows(CONFIG.SKSK.simpleMagicSchools, 'system.magicSchoolDamageBonus.'),
          ...vocabRows(CONFIG.SKSK.advancedMagicSchools, 'system.magicSchoolDamageBonus.'),
          ...vocabRows(CONFIG.SKSK.combinedMagicSchools, 'system.combinedMagicSchoolDamageBonus.'),
        ],
      },
      {
        title: 'SKSK.EffectKeyReference.Category.WeaponDamage',
        rows: Object.keys(CONFIG.SKSK.skills.weapons).map(key => ({
          label: game.i18n.localize(getSkillLabel(key)), key: `system.weaponDamageBonus.${key}`,
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
        title: 'SKSK.EffectKeyReference.Category.AttributeReroll',
        rows: vocabRows(CONFIG.SKSK.attributes, 'system.attributeRerollEnabled.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.DamageRerollOnes',
        rows: vocabRows(CONFIG.SKSK.damageTypes, 'system.damageRerollOnesElements.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillRoll',
        rows: skillRollBonusRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillLevel',
        hint: 'SKSK.EffectKeyReference.Category.SkillLevelHint',
        rows: skillLevelRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.ChargeBonus',
        hint: 'SKSK.EffectKeyReference.Category.ChargeBonusHint',
        rows: chargeRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SchoolCost',
        hint: 'SKSK.EffectKeyReference.Category.SchoolCostHint',
        rows: schoolCostRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.MovementBonus',
        hint: 'SKSK.EffectKeyReference.Category.MovementBonusHint',
        rows: movementRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.AttributeMax',
        hint: 'SKSK.EffectKeyReference.Category.AttributeMaxHint',
        rows: attributeMaxRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.ElementalChargeApCost',
        hint: 'SKSK.EffectKeyReference.Category.ElementalChargeApCostHint',
        rows: vocabRows(CONFIG.SKSK.simpleMagicSchools, 'system.elementalChargeApCost.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.ElementalSpecialization',
        hint: 'SKSK.EffectKeyReference.Category.ElementalSpecializationHint',
        rows: vocabRows(CONFIG.SKSK.simpleMagicSchools, 'system.elementalSpecialization.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillRollApCost',
        rows: skillRollApCostRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillRollRpCost',
        rows: skillRollRpCostRows,
      },
      {
        title: 'SKSK.EffectKeyReference.Category.AttributeRollApCost',
        rows: vocabRows(CONFIG.SKSK.attributes, 'system.attributeRollApCostModifier.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.AttributeRollRpCost',
        rows: vocabRows(CONFIG.SKSK.attributes, 'system.attributeRollRpCostModifier.'),
      },
      {
        title: 'SKSK.EffectKeyReference.Category.SkillGain',
        rows: skillRows,
      },
    ];
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
