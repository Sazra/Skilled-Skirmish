import SKSKItemBase from "./item-base.mjs";
import { resolveMaterialBonus, computeTotalManaCapacity } from "../helpers/materials.mjs";
import { getArmorModel } from "../helpers/models.mjs";
import { computeEffectiveProperties } from "../helpers/properties.mjs";

export default class SKSKArmor extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.weight = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    // Armor is always equippable, unlike the generic Item type.
    schema.equipped = new fields.BooleanField({ initial: false });
    schema.enchanted = new fields.BooleanField({ initial: false });

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. an enchanted piece of armor granting a flat -5
    // discount on a school. percent stacks additively with every other
    // source (including the caster's own Magic Control/Ritualism-based
    // discount); flatFormula supports "L" for the actor's level. Flat
    // reductions apply before percent ones, and the result normally can't
    // drop below 1 - allowBelowOne lets THIS entry's flat reduction push it
    // as low as 0. See helpers/spells.mjs#computeSpellManaCost.
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

    // The material this armor is made of (a name from the GM-configured
    // world setting - see helpers/materials.mjs), or blank for none.
    schema.material = new fields.StringField({ required: true, blank: true, initial: "" });
    // Only used when the selected material's own materialBonus/manaCapacity
    // is "?" (individually configurable per item) - see
    // helpers/materials.mjs#resolveMaterialBonus/resolveMaterialManaCapacity.
    schema.materialBonusOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    schema.manaCapacityOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // This armor's type (Light Armor, Heavy Armor, Shield) - determines
    // which Armor Models (see helpers/models.mjs) are selectable below.
    schema.armorType = new fields.StringField({
      required: true, blank: false, initial: "lightArmor",
      choices: ["lightArmor", "heavyArmor", "shield"],
    });
    // The Armor Model this armor uses (a name from the GM-configured world
    // setting, filtered to this armor's own armorType), or blank for none.
    schema.model = new fields.StringField({ required: true, blank: true, initial: "" });
    // Zero or more manual property add/remove overrides layered on top of
    // the properties granted by this armor's Material and Model - e.g. a
    // bespoke suit of armor loses the Heavy property it'd otherwise have.
    // See helpers/properties.mjs#computeEffectiveProperties.
    schema.propertyOverrides = new fields.ArrayField(new fields.SchemaField({
      property: new fields.StringField({ required: true, blank: false, initial: "hardened" }),
      mode: new fields.StringField({ required: true, blank: false, initial: "add", choices: ["add", "remove"] }),
      value: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 }),
    }));

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // See helpers/materials.mjs - the material grants an automatic armor
    // bonus, and its mana capacity for every 0.1kg of this armor's weight.
    this.materialArmorBonus = resolveMaterialBonus(this);
    this.totalManaCapacity = computeTotalManaCapacity(this);
    this.resolvedModel = getArmorModel(this.model);
    this.effectiveProperties = computeEffectiveProperties(this, this.resolvedModel);
  }
}
