import { computeSkillBonusTotals, evaluateSkillFormula, getSkillLevel } from '../helpers/skills.mjs';
import { computeUnlimitedAttributeBonus, computeAttributeMax } from '../helpers/attributes.mjs';
import { computeNpcAttributeThresholdBonuses } from '../helpers/attributeBonuses.mjs';
import { computeMaxLife, computeMaxNegativeLife } from '../helpers/life.mjs';
import { computeMaxMana } from '../helpers/mana.mjs';
import { computeMaxActionPoints, computeMaxReactionPoints } from '../helpers/points.mjs';
import { computeNaturalMaterialBonus, computeArmorClass, computeMagicResistance } from '../helpers/defense.mjs';
import {
  computeMaxMeditationCharges, computeMaxRegenerationCharges,
  computeMaxInspirationCharges, computeMaxAdrenalinCharges, computeMaxLuckCharges,
} from '../helpers/generalResources.mjs';

export default class SKSKActorBase extends foundry.abstract.TypeDataModel {

  /**
   * Seed the new "rawValue" accumulator from pre-existing "value" data the
   * first time an actor saved before that field existed loads - otherwise
   * every actor's attributes would silently reset to the schema default
   * instead of carrying forward whatever score they actually had.
   * @param {object} source
   * @return {object}
   */
  static migrateData(source) {
    if (source.attributes) {
      for (const attr of Object.values(source.attributes)) {
        if (attr && attr.rawValue === undefined && attr.value !== undefined) {
          attr.rawValue = attr.value;
        }
      }
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    schema.life = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/life.mjs#computeMaxLife (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      // Flat bonus added on top of the computed max life, after every
      // other multiplier - not meant to be hand-edited, but targeted by
      // Active Effects via "system.life.bonus".
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Damage taken after life reaches 0 is deducted from negative life
    // instead of killing the character outright.
    schema.negativeLife = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/life.mjs#computeMaxNegativeLife (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      // Whether Tenacity's multiplier (see helpers/life.mjs#computeMaxLife)
      // also raises max negative life, instead of acting purely as a
      // buffer that protects it from max-life reductions without
      // extending it - see helpers/life.mjs#computeMaxNegativeLife.
      includeToughness: new fields.BooleanField({ initial: false })
    });
    // Usually-temporary pool that shields life (or negative life) from
    // damage - unlike every other resource, it's theoretically unbounded,
    // so it has no max.
    schema.barrier = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });
    schema.mana = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/mana.mjs#computeMaxMana (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 5 }),
      // Flat bonus added on top of the computed max mana - not meant to be
      // hand-edited, but targeted by Active Effects via "system.mana.bonus".
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.actionPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/points.mjs#computeMaxActionPoints (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 3 }),
      // Flat bonus added on top of the computed max AP - not meant to be
      // hand-edited, but targeted by Active Effects via
      // "system.actionPoints.bonus".
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.reactionPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/points.mjs#computeMaxReactionPoints (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      // Flat bonus added on top of the computed max RP - not meant to be
      // hand-edited, but targeted by Active Effects via
      // "system.reactionPoints.bonus".
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // General resources every creature tracks charges for (General tab's
    // Overview sub-tab, alongside the user-extensible customResources, but
    // not itself editable/removable there) - see
    // helpers/generalResources.mjs. max is no longer directly
    // user-editable - overwritten every data preparation below.
    schema.meditationCharges = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.regenerationCharges = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Locked (max 0) until the Inspiration skill reaches level 1 - see
    // helpers/generalResources.mjs#computeMaxInspirationCharges.
    schema.inspirationCharges = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // The Inspiration die this actor currently holds, granted by another
    // actor (or itself, via a self-roll) - see helpers/inspiration.mjs.
    // size is the die's face count (4/6/8/10/12, matching the granter's own
    // Inspiration skill level 1-5), 0 = none held. Shown on both Character
    // and NPC sheet headers - clicking it rolls and clears the die
    // (helpers/inspiration.mjs#rollGrantedInspirationDie), crediting
    // grantedByUuid's own Inspiration skill with "inspirationUsed" FP (if
    // that actor still exists and is a Character). Granting a new die only
    // overwrites an already-held one if its size is strictly higher.
    schema.inspirationDie = new fields.SchemaField({
      size: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      grantedByUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
      grantedByName: new fields.StringField({ required: true, blank: true, initial: "" }),
    });
    // Locked (max 0) until the Adrenalin skill reaches level 1 - see
    // helpers/generalResources.mjs#computeMaxAdrenalinCharges.
    schema.adrenalinCharges = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Locked (max 0) until the Luck skill reaches level 1 - see
    // helpers/generalResources.mjs#computeMaxLuckCharges.
    schema.luckCharges = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Attack rolls must exceed this to deal weapon damage. No longer
    // directly user-editable - overwritten every data preparation by
    // helpers/defense.mjs#computeArmorClass (see prepareDerivedData below).
    schema.armorClass = new fields.NumberField({ ...requiredInteger, initial: 10 });
    // Attack rolls must exceed this for a spell to have full effect. No
    // longer directly user-editable - overwritten every data preparation by
    // helpers/defense.mjs#computeMagicResistance (see prepareDerivedData below).
    schema.magicResistance = new fields.NumberField({ ...requiredInteger, initial: 10 });
    // Grund-AC's own base value (before the Constitution modifier that's
    // folded in on top) - a plain field, directly user-editable on the GM
    // tab and equally targetable by Active Effects (see
    // helpers/defense.mjs#computeArmorClass).
    schema.baseArmorClass = new fields.NumberField({ ...requiredInteger, initial: 10 });
    // A flat AC/MR bonus (positive or negative) layered on top of every
    // other AC-Boni/MR component - plain fields, directly user-editable on
    // the GM tab and equally targetable by Active Effects (see
    // helpers/defense.mjs#computeArmorClass/computeMagicResistance).
    schema.customArmorClassBonus = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.customMagicResistanceBonus = new fields.NumberField({ ...requiredInteger, initial: 0 });
    // Angriffswurf (attack roll) critical thresholds - a natural d20 result
    // at or above criticalHitThreshold is a critical success; at or below
    // criticalFailureThreshold, a critical failure (see helpers/
    // criticalRolls.mjs#getAttackCriticalThresholds). Plain fields, directly
    // user-editable on the GM tab and equally targetable by Active Effects,
    // same convention as baseArmorClass above. Every other (non-attack) D20
    // roll always uses a fixed natural 20/1 instead - see
    // helpers/criticalRolls.mjs#getGenericCriticalType.
    schema.criticalHitThreshold = new fields.NumberField({ ...requiredInteger, initial: 20, min: 10, max: 20 });
    schema.criticalFailureThreshold = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 10 });
    // The Neutral/Vorteil/Nachteil mode preset used by generic (non-
    // Angriffswurf) D20 rolls that trigger fully automatically, with no
    // player-facing choice dialog (Restrained's own turn-start/end escape
    // check, Poison's recheck, Concentration) - see helpers/criticalRolls.mjs
    // #evaluateD20WithMode. Player-triggered generic rolls (skill checks,
    // attribute checks, saving throws, a manual Restrained escape attempt)
    // instead prompt fresh every time via chooseGenericRollMode, ignoring
    // this field entirely. Plain, directly user-editable on the GM tab and
    // equally targetable by Active Effects, same convention as
    // criticalHitThreshold above.
    schema.genericCriticalRollMode = new fields.StringField({
      required: true, blank: false, initial: "neutral",
      choices: ["neutral", "advantage", "disadvantage"],
    });
    // Extra dice added to Assassination's own bonus damage (see helpers/
    // attackRolls.mjs#rollAssassinationBonusDamage), on top of whatever
    // dice its own skill-level table already grants - same convention as
    // criticalHitThreshold above (plain, directly user-editable on the GM
    // tab and equally targetable by Active Effects). Has no effect at
    // Assassination level 0, which grants a flat bonus with no die size to
    // extend.
    schema.assassinationBonusDice = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // A creature's innate "natural armor" bonus, scaling with level - see
    // helpers/defense.mjs#computeNaturalMaterialBonus. adjustment is a
    // plain, user-editable (GM tab) flat modifier; bonus is not meant to be
    // hand-edited, but targeted by Active Effects via
    // "system.naturalMaterialBonus.bonus"; value is the computed total, no
    // longer directly user-editable - overwritten every data preparation.
    schema.naturalMaterialBonus = new fields.SchemaField({
      adjustment: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    });

    // A variable per-magic-school Angriffswurf (attack roll) bonus/malus -
    // not meant to be hand-edited, purely an Active Effect target (e.g.
    // "system.magicSchoolAttackBonus.fire"), same convention as
    // naturalMaterialBonus.bonus above. Keys hardcoded (static schema
    // fields evaluate before the init hook populates CONFIG.SKSK) as the
    // union of CONFIG.SKSK.simpleMagicSchools + .advancedMagicSchools -
    // every value a Simple/Advanced spell's own magicSchool field can take.
    // See helpers/attackRolls.mjs#computeSpellAttackBonus.
    schema.magicSchoolAttackBonus = new fields.SchemaField(Object.fromEntries([
      'fire', 'water', 'earth', 'air', 'life', 'death', 'light', 'nature', 'dark', 'trickery',
      'martialArts', 'bardic', 'space', 'time', 'blood', 'divination',
    ].map(key => [key, new fields.NumberField({ ...requiredInteger, initial: 0 })])));
    // The same, but for a Combined spell's own combinedSchool - keys
    // hardcoded from CONFIG.SKSK.combinedMagicSchools for the same reason.
    schema.combinedMagicSchoolAttackBonus = new fields.SchemaField(Object.fromEntries([
      'stormancy', 'chaomancy', 'demomancy', 'drakomancy', 'necromancy', 'miracles',
      'feymancy', 'geomancy', 'biomancy', 'cryomancy', 'witchery',
    ].map(key => [key, new fields.NumberField({ ...requiredInteger, initial: 0 })])));
    // A flat bonus to the maximum number of Überladungen (Overcharge
    // stacks) a caster may apply to a single spell cast, beyond "1 + their
    // Überladen skill level" - not meant to be hand-edited, purely an
    // Active Effect target ("system.overchargeMaxBonus"), same convention
    // as naturalMaterialBonus.bonus above. See helpers/spells.mjs#
    // computeMaxOverchargeCount.
    schema.overchargeMaxBonus = new fields.NumberField({ ...requiredInteger, initial: 0 });

    schema.biography = new fields.StringField({ required: true, blank: true });

    // Character tab's "Data" section - free-flavor fields shown alongside
    // the biography, none of which feed into any calculation.
    schema.gender = new fields.StringField({
      required: true, blank: false, initial: "genderless",
      choices: ["male", "female", "hermaphrodite", "genderless"]
    });
    schema.age = new fields.StringField({ required: true, blank: true });
    // Independent of sizeCategory (that's a coarse combat-relevant
    // category; this is the actual, precise height).
    schema.height = new fields.StringField({ required: true, blank: true });
    schema.skinColor = new fields.StringField({ required: true, blank: true });
    schema.hairColor = new fields.StringField({ required: true, blank: true });
    schema.eyeColor = new fields.StringField({ required: true, blank: true });
    // User-extensible list of further free-flavor data points (numbers or
    // words), e.g. "Zodiac Sign: Leo" or "Weight: 70kg".
    schema.additionalData = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      value: new fields.StringField({ required: true, blank: true }),
    }));

    schema.resources = new fields.SchemaField({
      level: new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 1 })
      }),
    });

    // User-extensible list of additional trackable resources (e.g. Rage,
    // Ki points), shown on the General tab alongside Life/Mana/AP/etc.
    // abbreviation (up to 4 letters, enforced by the input's maxlength
    // rather than here) exposes this resource's current value as a roll
    // formula variable - see getRollData below.
    schema.customResources = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      abbreviation: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    }));

    // Overrides the size category (CONFIG.SKSK.sizeCategories) this actor
    // would otherwise inherit from its main Species item - e.g. an
    // individual that's smaller than typical for its species. Blank means
    // "use the species default" - see helpers/movement.mjs#getActorSizeCategory.
    schema.sizeCategory = new fields.StringField({ required: true, blank: true, initial: "" });

    // Base movement speeds (in meters), one per CONFIG.SKSK.movementTypes -
    // shown as a horizontal list on the General tab. See
    // helpers/movement.mjs#computeMovementSpeeds for how item-granted
    // bonuses (general or type-specific) stack on top of these.
    const movementSchema = {};
    for (const key of Object.keys(CONFIG.SKSK.movementTypes)) {
      movementSchema[key] = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    }
    schema.movement = new fields.SchemaField(movementSchema);

    // GM-defined custom Martial Arts Attacks (General tab's Actions
    // sub-tab lets any owner roll one - see helpers/actions.mjs). attributes
    // is a SchemaField of booleans (one per CONFIG.SKSK.attributes key) -
    // unlike a Weapon Model's own array-of-keys attributes field, this one
    // has to submit through the actor sheet's plain default form handler
    // (no custom static form.handler like apps/models-config.mjs has), so
    // each checkbox needs to map straight onto its own schema field rather
    // than needing server-side reassembly into an array. attributeUsage
    // (CONFIG.SKSK.attributeUsageTypes) decides how the checked attributes'
    // modifiers combine into one bonus - see helpers/actions.mjs#
    // resolveMartialArtsAttributeBonus. Defaults to the two universal
    // unarmed strikes every creature has - Main Hand/Off Hand - editable/
    // removable like any other entry.
    const attackAttributesSchema = {};
    for (const attribute of Object.keys(CONFIG.SKSK.attributes)) {
      attackAttributesSchema[attribute] = new fields.BooleanField({ initial: false });
    }
    schema.martialArtsAttacks = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      formula: new fields.StringField({ required: true, blank: true, initial: "1d4" }),
      apCost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // For Resistance/Weakness/Immunity/Absorption purposes (see
      // helpers/defense.mjs#applyElementalDefense) - a weapon Item resolves
      // this from its Model/attributeOverride instead (see
      // helpers/attackRolls.mjs#getWeaponDamageType); a Martial Arts attack
      // has no such Model to draw from, so it's a plain per-entry field.
      damageType: new fields.StringField({ required: true, blank: false, initial: "blunt" }),
      attributes: new fields.SchemaField(attackAttributesSchema),
      attributeUsage: new fields.StringField({
        required: true, blank: false, initial: "highestMultiple",
        choices: ["highestSingle", "all", "highestMultiple"],
      }),
    }), {
      // Every attribute key must be explicitly present (true or false) -
      // schema validation doesn't fill in a nested BooleanField's own
      // default for keys missing entirely from a provided initial object.
      initial: () => {
        const strDexOnly = Object.fromEntries(
          Object.keys(CONFIG.SKSK.attributes).map(key => [key, key === 'str' || key === 'dex'])
        );
        return [
          {
            name: game.i18n.localize('SKSK.MartialArtsAttack.DefaultMainHand'),
            formula: "1d4", apCost: 2, damageType: "blunt", attributes: strDexOnly, attributeUsage: "highestMultiple",
          },
          {
            name: game.i18n.localize('SKSK.MartialArtsAttack.DefaultOffHand'),
            formula: "1d4", apCost: 1, damageType: "blunt", attributes: { ...strDexOnly }, attributeUsage: "highestMultiple",
          },
        ];
      },
    });

    // Actions tab (General tab's Actions sub-tab) fields - see
    // helpers/actions.mjs. Regeneration/Meditation's AP cost is directly
    // user-editable there (0 is a valid, explicitly allowed value).
    schema.regenerationApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.meditationApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // apps/source-dialog.mjs's own AP/Mana costs - directly user-editable
    // there (0 is a valid, explicitly allowed value), same convention as
    // regenerationApCost/meditationApCost above. "Quelle aktivieren"
    // (Source-Bound) and "Ätherquelle öffnen" (Ether-Bound) each spend their
    // own independent amount before granting their own FP trigger.
    schema.sourceAbilityApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.sourceAbilityManaCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.etherSourceApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.etherSourceManaCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Actions tab's Inspiration row (helpers/inspiration.mjs) - directly
    // user-editable there (0 allowed), same convention as regeneration/
    // meditationApCost above. Shared by the grant/shift-consume/right-click
    // self-roll variants alike.
    schema.inspirationApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // The last Combat round the Move action was used for free in - not
    // meant to be hand-edited. null outside of (or before ever using Move
    // in) combat. See helpers/actions.mjs#useMove.
    schema.lastFreeMoveRound = new fields.NumberField({ required: true, nullable: true, integer: true, initial: null });
    // Lifetime count of Adrenalin uses - never reset automatically (not
    // even by a Rest), since each use permanently costs more max Life than
    // the last. Not meant to be hand-edited. See helpers/actions.mjs#rollAdrenalin.
    schema.adrenalinUsedCount = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Mana Capacity/Mana Regeneration's own FP accumulators (GM tab,
    // editable) - real mana cost paid for spells cast / mana actually
    // restored (Meditation, passive regen from time/Rest), summed up since
    // the last Anpassungs-/Genesungspause. Multiplied by the skillUsageFp
    // "dailyManaSpent" rate and floored on the next qualifying Pause, then
    // reset to 0 - see helpers/rest.mjs#applyRest.
    schema.manaCapacityAccumulator = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.manaRegenerationAccumulator = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Reflexe's own "Reflexaktion" FP trigger has already fired this Combat
    // turn - reset to false every turn start. Not meant to be hand-edited.
    // See helpers/skillFp.mjs#checkReflexActionTrigger.
    schema.reflexActionGranted = new fields.BooleanField({ initial: false });
    // Beschwörung's (Summoning) own list of active summon slots - resized
    // (padded/truncated) to the current slot count whenever apps/summoning-
    // dialog.mjs renders, see helpers/summoning.mjs#getResizedSummons. An
    // empty slot has blank name/summoned false; "Beschwören" fills name/
    // level and sets summoned true (granting Summoning's "summonLevel" FP,
    // scaled by level), "Löschen" clears it back to empty. Every still-
    // summoned slot grants "summonExistenceDay" FP on the next Anpassungs-/
    // Genesungspause - see helpers/rest.mjs#applyRest.
    schema.summons = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      level: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      summoned: new fields.BooleanField({ initial: false }),
    }));
    // GM-tab adjustments to Summoning's own slot count, on top of the
    // Willpower modifier - summonSlotsBonus is added first (positive or
    // negative), summonSlotsMultiplier applied after; floored, never below
    // 0. See helpers/summoning.mjs#computeSummonSlots.
    schema.summonSlotsBonus = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.summonSlotsMultiplier = new fields.NumberField({ required: true, nullable: false, initial: 1, min: 0 });
    // Totem's own list of totem slots - resized (padded/truncated) to the
    // current slot count whenever apps/totem-dialog.mjs renders, see
    // helpers/totem.mjs#getResizedTotems. An empty slot has blank name/
    // bound false; "Totem binden" fills name, sets bound true (granting
    // Totem's "totemBond" FP) and creates a linked, initially-disabled
    // ActiveEffect (effectId) the player configures via the dialog's own
    // Effects button (Foundry's native effect editor - free-form Changes).
    // "Totem aktivieren" pays 2 AP + manaCostPerRound Mana up front,
    // flips active true and that effect's own disabled false (granting
    // "totemUsed" FP); "Totem deaktivieren" reverses both, no FP. Every
    // still-active totem drains manaCostPerRound Mana at this actor's own
    // Combat turn start, auto-deactivating on insufficient Mana - see
    // helpers/statusEffects.mjs#handleTotemTurnStart. "Zeile löschen/
    // freigeben" clears the slot AND deletes its linked effect.
    schema.totems = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      bound: new fields.BooleanField({ initial: false }),
      active: new fields.BooleanField({ initial: false }),
      effectId: new fields.StringField({ required: true, blank: true, initial: "" }),
      manaCostPerRound: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    }));
    // GM-tab adjustments to Totem's own slot count, on top of the Totem
    // skill's own level - same convention as summonSlotsBonus/
    // summonSlotsMultiplier above. See helpers/totem.mjs#computeTotemSlots.
    schema.totemSlotsBonus = new fields.NumberField({ ...requiredInteger, initial: 0 });
    schema.totemSlotsMultiplier = new fields.NumberField({ required: true, nullable: false, initial: 1, min: 0 });
    // GM-tab switch gating Seelenstärke's "meditationUsedInCombat" FP
    // trigger (helpers/actions.mjs#rollMeditation) - off by default, since
    // unlike every other skill-usage trigger (gated purely by its own GM-
    // configured rate being > 0) this one is disruptive enough to combat
    // pacing that the GM opted for an explicit extra switch on top.
    schema.soulforceMeditationCombatFpEnabled = new fields.BooleanField({ initial: false });
    // Seelenstärke's own "Seelenmacht" (Soul Power) resource - a collection
    // pool with no maximum (like barrier above), meant to be fed by
    // SoulPowerTraded's own trade-in mechanic once that's designed (see
    // soulPowerMechanicEnabled below). Shown on the resources sidebar once
    // Seelenstärke reaches its own max level (5) or soulPowerResourceEnabled
    // is on - see sheets/actor-sheet.mjs#_prepareGeneral.
    schema.soulPower = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });
    // GM-tab switch that shows the Soul Power resource above even before
    // Seelenstärke reaches level 5 - off by default (the resource is shown
    // regardless once that level is reached, so this only matters early).
    schema.soulPowerResourceEnabled = new fields.BooleanField({ initial: false });
    // GM-tab switch reserved for Soul Power's own trade-in mechanic - not
    // yet implemented (see helpers/skillFp.mjs's "soulPowerTraded" trigger,
    // still unwired); to be designed and wired up once every skill-usage FP
    // trigger is fully implemented. Currently has no effect on its own.
    schema.soulPowerMechanicEnabled = new fields.BooleanField({ initial: false });
    // A spell whose AP cost couldn't be fully paid at cast time - itemId
    // (blank = none pending) references the spell Item still owed apCost
    // AP, paid off gradually at the start of this actor's later Combat
    // turns while Concentration remains active. Not meant to be
    // hand-edited. See helpers/spell-rolls.mjs#rollSpellItem/
    // handlePendingSpellTurnStart.
    schema.pendingSpell = new fields.SchemaField({
      itemId: new fields.StringField({ required: true, blank: true, initial: "" }),
      apCost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // A "minutes"-unit spell's own debt kind (see helpers/spell-rolls.mjs#
      // rollSpellItem/handlePendingSpellTurnStart) - counts down by 1 every
      // Combat turn start, draining all AP each time, instead of apCost's
      // fixed amount paid down incrementally. Only one of apCost/
      // roundsRemaining is ever active at once for a given pendingSpell.
      roundsRemaining: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // How many times this pending spell was overcharged at cast time
      // (see helpers/spells.mjs#computeMaxOverchargeCount) - carried
      // through to whichever later moment it actually resolves (see
      // helpers/spell-rolls.mjs#resolvePendingSpell), so a deferred
      // overcharged cast still scales its saving throws/ranges/damage.
      overchargeCount: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });

    const attributeKeys = Object.keys(CONFIG.SKSK.attributes);
    const attributesSchema = {};
    for (const attribute of attributeKeys) {
      attributesSchema[attribute] = new fields.SchemaField({
        // The true, ever-growing accumulator (direct edits, Species/Class/
        // Talent bonuses, skill-threshold bonuses) - never itself clamped
        // to the attribute's max, so excess above a since-lowered max isn't
        // lost, and "value" self-adjusts the instant the max rises again.
        rawValue: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
        // Derived every data preparation: min(rawValue [+ an NPC's live
        // skill-threshold bonus], max). "mod" is computed from THIS, not
        // rawValue, so capped-out excess never affects the roll modifier.
        value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
        // Derived every data preparation - see helpers/attributes.mjs#
        // computeAttributeMax.
        max: new fields.NumberField({ ...requiredInteger, initial: 20, min: 1 }),
        mod: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        label: new fields.StringField({ required: true, blank: true }),
        // "Unbegrenzte X"/Corpus Immortalis/Umlimitiert bonus to this one
        // attribute's own roll - see prepareDerivedData below.
        unlimitedBonus: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
      });
    }
    schema.attributes = new fields.SchemaField(attributesSchema);

    // One entry per (skill, threshold) pair for every skill with
    // CONFIG.SKSK.skills[...].attributeBonusThresholds - the attribute
    // chosen for that threshold ("" until chosen), or the sentinel
    // "granted" for thresholds with no choice at all (attributeMode "all"/
    // "and") once applied. See helpers/attributeBonuses.mjs.
    const attributeBonusChoicesSchema = {};
    for (const category of Object.values(CONFIG.SKSK.skills)) {
      for (const [key, def] of Object.entries(category)) {
        if (!def.attributeBonusThresholds?.length) continue;
        attributeBonusChoicesSchema[key] = new fields.ArrayField(
          new fields.StringField({ required: true, blank: true, initial: "" }),
          { initial: def.attributeBonusThresholds.map(() => "") }
        );
      }
    }
    schema.skillAttributeBonusChoices = new fields.SchemaField(attributeBonusChoicesSchema);

    // One entry per skill, flattened across every category in
    // CONFIG.SKSK.skills (skill keys are unique across categories).
    // Characters enter points/toggle directly; NPCs instead get a formula
    // (points-per-level for multi-level skills, or a 1-means-unlocked
    // formula for binary/1-level skills) so a template scales with level.
    const skillsSchema = {};
    for (const category of Object.values(CONFIG.SKSK.skills)) {
      for (const key of Object.keys(category)) {
        skillsSchema[key] = new fields.SchemaField({
          points: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
          toggle: new fields.BooleanField({ initial: false }),
          formula: new fields.StringField({ required: true, blank: true }),
          // Favorited skills show just their level on the General tab.
          favorite: new fields.BooleanField({ initial: false }),
          // Not-yet-integrated skill points, entered here as they're earned
          // - only added into "points" (and reset to 0) once an Anpassungs-
          // or Genesungspause is taken. See helpers/rest.mjs#applyRest.
          gain: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        });
      }
    }
    schema.skills = new fields.SchemaField(skillsSchema);

    return schema;
  }

  prepareBaseData() {
    super.prepareBaseData();
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    if (!this.attributes) return;

    // An NPC's skill-threshold attribute bonuses stay fully dynamic
    // (never written to rawValue) so they track its formula-derived skill
    // levels live - see helpers/attributeBonuses.mjs. A Character's own
    // bonuses are instead permanent additions already folded into
    // rawValue (via chooseAttributeBonus/applyPendingAutoGrants), so there
    // is nothing further to add here for them.
    const npcAttributeBonuses = (this.parent?.type === 'npc')
      ? computeNpcAttributeThresholdBonuses(this.parent)
      : null;

    for (const key in this.attributes) {
      if (!this.attributes[key]) continue;
      const attribute = this.attributes[key];
      // Derived every preparation - see helpers/attributes.mjs#computeAttributeMax.
      attribute.max = this.parent ? computeAttributeMax(this.parent, key) : 20;
      // rawValue never itself gets clamped, so a since-lowered max's
      // excess isn't lost - "value" (and everything derived from it, like
      // "mod" below) is simply re-capped fresh every preparation.
      const dynamicBonus = npcAttributeBonuses ? (npcAttributeBonuses[key] ?? 0) : 0;
      attribute.value = Math.min(attribute.rawValue + dynamicBonus, attribute.max);
      attribute.mod = Math.floor((attribute.value - 10) / 2);
      attribute.label = game.i18n.localize(CONFIG.SKSK.attributes[key]) ?? key;
      // "Unbegrenzte X"/Corpus Immortalis/Umlimitiert - see
      // helpers/attributes.mjs#computeUnlimitedAttributeBonus. Only ever
      // added to this one attribute's own "reiner" roll (attributes.hbs),
      // not to skill checks that merely use it as one of their modifiers.
      attribute.unlimitedBonus = this.parent ? computeUnlimitedAttributeBonus(this.parent, key) : 0;
    }

    // Depends on the Constitution modifier just computed above, so must
    // run after the attributes loop. Requires this.parent (the owning
    // Actor, for its items and skill levels) - unavailable in a few edge
    // cases (e.g. schema validation off a bare data model).
    if (this.parent) {
      this.life.max = computeMaxLife(this.parent);
      this.negativeLife.max = computeMaxNegativeLife(this.parent);
      this.mana.max = computeMaxMana(this.parent);
      this.actionPoints.max = computeMaxActionPoints(this.parent);
      this.reactionPoints.max = computeMaxReactionPoints(this.parent);
      // naturalMaterialBonus.value must be computed before armorClass,
      // which uses it as a floor under worn armor's own bonus.
      this.naturalMaterialBonus.value = computeNaturalMaterialBonus(this.parent);
      this.armorClass = computeArmorClass(this.parent);
      this.magicResistance = computeMagicResistance(this.parent);
      this.meditationCharges.max = computeMaxMeditationCharges(this.parent);
      this.regenerationCharges.max = computeMaxRegenerationCharges(this.parent);
      this.inspirationCharges.max = computeMaxInspirationCharges(this.parent);
      this.adrenalinCharges.max = computeMaxAdrenalinCharges(this.parent);
      this.luckCharges.max = computeMaxLuckCharges(this.parent);
    }
  }

  getRollData() {
    const data = {};

    if (this.attributes) {
      data.attributes = {};
      for (let [k, v] of Object.entries(this.attributes)) {
        data.attributes[k] = foundry.utils.deepClone(v);
      }
    }

    data.lvl = this.resources.level.value;

    // Every skill's current level, so world-configurable formulas (e.g.
    // the carry-weight setting) can reference "@skills.<key>" - 0 for
    // binary/stackable skills, which have no real "level" to begin with.
    // Deliberately NOT calling the shared getActorSkillLevel helper here:
    // for NPCs it evaluates the skill's formula via actor.getRollData(),
    // which would call straight back into this method - infinite
    // recursion. Uses the "lvl" already computed above instead.
    if (this.parent) {
      data.skills = {};
      const isNpc = this.parent.type === 'npc';
      const skillBonusTotals = computeSkillBonusTotals(this.parent);
      for (const category of Object.values(CONFIG.SKSK.skills)) {
        for (const [key, def] of Object.entries(category)) {
          if (def.maxLevel !== 5 && def.maxLevel !== 10) {
            data.skills[key] = 0;
            continue;
          }
          const skillData = this.skills?.[key] ?? {};
          const bonus = skillBonusTotals[key] ?? 0;
          const points = isNpc
            ? evaluateSkillFormula(skillData.formula ?? '', { lvl: data.lvl })
            : (skillData.points ?? 0);
          data.skills[key] = getSkillLevel(points, def.maxLevel, bonus);
        }
      }
    }

    // Each custom resource with an abbreviation set exposes its current
    // value as "@<abbreviation, lowercased>" in any roll formula (damage,
    // the generic Item roll formula, attribute rolls, etc).
    for (const resource of this.customResources ?? []) {
      if (!resource.abbreviation) continue;
      data[resource.abbreviation.toLowerCase()] = resource.value;
    }

    return data;
  }
}
