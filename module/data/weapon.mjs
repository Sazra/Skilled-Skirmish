import SKSKItemBase from "./item-base.mjs";
import { resolveMaterialBonus, computeTotalManaCapacity } from "../helpers/materials.mjs";
import { getWeaponModel, combineDiceFormulas } from "../helpers/models.mjs";
import { computeEffectiveProperties } from "../helpers/properties.mjs";

// Weapon types that use a second, separately-selected Ammunition Model
// alongside their own Weapon Model - see schema.ammunitionModel and
// prepareDerivedData below.
const RANGED_WEAPON_TYPES = ["bow", "firearms"];

export default class SKSKWeapon extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.weight = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    // Weapons are always equippable, unlike the generic Item type.
    schema.equipped = new fields.BooleanField({ initial: false });
    schema.enchanted = new fields.BooleanField({ initial: false });

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. an enchanted weapon granting a flat -5 discount on
    // a school. percent stacks additively with every other source
    // (including the caster's own Magic Control/Ritualism-based discount);
    // flatFormula supports "L" for the actor's level. Flat reductions apply
    // before percent ones, and the result normally can't drop below 1 -
    // allowBelowOne lets THIS entry's flat reduction push it as low as 0.
    // See helpers/spells.mjs#computeSpellManaCost.
    schema.manaCostReductions = new fields.ArrayField(new fields.SchemaField({
      spellType: new fields.StringField({
        required: true, blank: false, initial: "simple",
        choices: ["simple", "advanced", "combined", "systemless"]
      }),
      school: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      percent: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0, max: 100 }),
      flatFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      allowBelowOne: new fields.BooleanField({ initial: false }),
    }));

    // Zero or more AP-cost discounts for a specific magic school (of any
    // spellType) - flat only (AP costs are small integers, a percentage
    // doesn't make sense here). Only ever applies to a spell that's
    // Mastered or otherwise has its prerequisites met/overridden - see
    // helpers/spells.mjs#computeSpellApCost, which also then applies the
    // caster's Chant Shortening skill on top (down to a floor of 2, unless
    // this reduction already got it lower).
    schema.apCostReductions = new fields.ArrayField(new fields.SchemaField({
      spellType: new fields.StringField({
        required: true, blank: false, initial: "simple",
        choices: ["simple", "advanced", "combined", "systemless"]
      }),
      school: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      flatFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
    }));

    // Zero or more bonuses to a movement speed (CONFIG.SKSK.movementTypes),
    // or to all of them at once via "all". See
    // helpers/movement.mjs#computeMovementSpeeds.
    schema.movementBonuses = new fields.ArrayField(new fields.SchemaField({
      movementType: new fields.StringField({
        required: true, blank: false, initial: "all",
        choices: ["all", "walking", "flying", "hovering", "swimming", "climbing", "digging"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    }));

    // The material this weapon is made of (a name from the GM-configured
    // world setting - see helpers/materials.mjs), or blank for none.
    schema.material = new fields.StringField({ required: true, blank: true, initial: "" });
    // Only used when the selected material's own materialBonus/manaCapacity
    // is "?" (individually configurable per item) - see
    // helpers/materials.mjs#resolveMaterialBonus/resolveMaterialManaCapacity.
    schema.materialBonusOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    schema.manaCapacityOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // AP cost to Use this weapon from the actor sheet's Actions tab - see
    // helpers/actions.mjs#useItem.
    schema.useApCost = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // This weapon's type (axe, bow, sword, etc.) - determines which Weapon
    // Models (see helpers/models.mjs) are selectable below. Mirrors
    // CONFIG.SKSK.skills.weapons' keys, hardcoded here since static schema
    // fields evaluate before the init hook populates CONFIG.SKSK (same
    // reasoning as the movementBonuses choices above).
    schema.weaponType = new fields.StringField({
      required: true, blank: false, initial: "axe",
      choices: ["axe", "bow", "bluntWeapon", "dagger", "firearms", "martialArts", "polearms", "sword"],
    });
    // The Weapon Model this weapon uses (a name from the GM-configured
    // world setting, filtered to this weapon's own weaponType), or blank
    // for none.
    schema.model = new fields.StringField({ required: true, blank: true, initial: "" });
    // Only meaningful when weaponType is one of RANGED_WEAPON_TYPES (Bow/
    // Feuerwaffen): a second Model, filtered to that same weaponType's own
    // "ammunition"-kind Models (see helpers/models.mjs), whose diceFormula/
    // flatBonus combine with the weapon Model's own in prepareDerivedData
    // below. Attribute bonus, damage type, and properties still come from
    // the weapon Model alone - only the damage roll itself combines.
    schema.ammunitionModel = new fields.StringField({ required: true, blank: true, initial: "" });
    // Zero or more manual property add/remove overrides layered on top of
    // the properties granted by this weapon's Material and Model - e.g. a
    // bespoke weapon crafted to be throwable gains Throwable plus a Range
    // value despite neither its material nor model normally having it.
    // See helpers/properties.mjs#computeEffectiveProperties.
    schema.propertyOverrides = new fields.ArrayField(new fields.SchemaField({
      property: new fields.StringField({ required: true, blank: false, initial: "throwable" }),
      mode: new fields.StringField({ required: true, blank: false, initial: "add", choices: ["add", "remove"] }),
      value: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 }),
    }));
    // Per-item override of the Model's shared `attributes` list - e.g. a
    // unique variant of a Model normally shared by many weapons. When
    // disabled (the default), this weapon's Angriffswurf (attack roll)
    // attribute bonus is computed from its resolvedModel's own attributes
    // instead - see helpers/attackRolls.mjs#getWeaponAttributeKeys. Keys
    // hardcoded (same reasoning as weaponType above).
    schema.attributeOverride = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      attributes: new fields.SchemaField(Object.fromEntries(
        ["str", "dex", "con", "per", "wil", "aur", "cha", "app"].map(key => [key, new fields.BooleanField({ initial: false })])
      )),
    });
    // Per-item override of the Model's own damageType - same enabled/
    // fallback pattern as attributeOverride above. When disabled (the
    // default), this weapon's damage type for Resistance/Weakness/
    // Immunity/Absorption purposes comes from its resolvedModel instead -
    // see helpers/attackRolls.mjs#getWeaponDamageType.
    schema.damageTypeOverride = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      damageType: new fields.StringField({ required: true, blank: false, initial: "blunt" }),
    });

    // Zero or more bonuses adjusting a specific skill's pending FP gain
    // ("gain" - see actor-base.mjs) whenever it's granted - positive/negative
    // flat amounts, a multiplicative percentage (multiple multiplicative
    // entries combine additively before applying), or an unconditional
    // "forceZero" override. See helpers/skillFp.mjs#applySkillFpGainBonus.
    schema.fpGainBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: true, initial: "" }),
      bonusType: new fields.StringField({
        required: true, blank: false, initial: "positive",
        choices: ["positive", "negative", "multiplicative", "forceZero"]
      }),
      amount: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      allowZero: new fields.BooleanField({ initial: false }),
    }));

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // See helpers/materials.mjs - the material grants an automatic attack
    // and damage bonus, and its mana capacity for every 0.1kg of this
    // weapon's weight.
    const materialBonus = resolveMaterialBonus(this);
    this.materialAttackBonus = materialBonus;
    this.materialDamageBonus = materialBonus;
    this.totalManaCapacity = computeTotalManaCapacity(this);
    this.resolvedModel = getWeaponModel(this.model);
    this.effectiveProperties = computeEffectiveProperties(this, this.resolvedModel);
    // Only Bow/Feuerwaffen actually resolve an Ammunition Model - every
    // other weaponType ignores a stale system.ammunitionModel value left
    // over from before a switch away from one of those two types.
    this.resolvedAmmunitionModel = RANGED_WEAPON_TYPES.includes(this.weaponType)
      ? getWeaponModel(this.ammunitionModel) : null;

    // The roll formula used by SKSKItem#roll (Actions tab's "Use" button,
    // Items tab's roll button) - same field name as the generic Item type's
    // own system.formula, so the document's existing roll() logic just
    // works unchanged. The Model's own dice formula (if any) combined with
    // the Ammunition Model's own (see helpers/models.mjs#
    // combineDiceFormulas - a no-op combine when there's no Ammunition
    // Model), plus the Material's attack bonus and both Models' own flat
    // bonuses.
    const flatBonus = materialBonus + (this.resolvedModel?.flatBonus ?? 0) + (this.resolvedAmmunitionModel?.flatBonus ?? 0);
    const diceFormula = combineDiceFormulas(this.resolvedModel?.diceFormula, this.resolvedAmmunitionModel?.diceFormula);
    this.formula = diceFormula ? `${diceFormula} + ${flatBonus}` : `${flatBonus}`;
  }
}
