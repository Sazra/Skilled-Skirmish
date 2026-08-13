import SKSKItemBase from "./item-base.mjs";
import { computeTotalManaCapacity, resolveMaterialBonus } from "../helpers/materials.mjs";

export default class SKSKItem extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // min 0 (not 1) - see schema.charges below: a consumable item's own
    // quantity can drop to 0 once its last copy's charges are used up.
    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.weight = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    // Whether this item can be equipped at all (a ring, wand, etc. -
    // as opposed to a mundane trade good). equipped/enchanted are only
    // meaningful (and only shown) once this is on.
    schema.equippable = new fields.BooleanField({ initial: false });
    schema.equipped = new fields.BooleanField({ initial: false });
    schema.enchanted = new fields.BooleanField({ initial: false });
    schema.consumable = new fields.BooleanField({ initial: false });

    // Whether this item tracks charges at all - value/max are only shown
    // once this is on. Both Consumable and Equippable items can have
    // charges, but they behave differently once depleted (charges.value
    // reaches 0) - see the updateItem hook in sksk.mjs: a Consumable
    // item's own quantity drops by 1 and its charges reset to max (a fresh
    // copy takes its place); an Equippable (non-Consumable) item's charges
    // instead just stay at 0 - it isn't used up, it just needs recharging
    // some other way.
    schema.charges = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
    });

    // AP cost to Use this item from the actor sheet's Actions tab - see
    // helpers/actions.mjs#useItem.
    schema.useApCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    schema.roll = new fields.SchemaField({
      diceNum: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      diceSize: new fields.StringField({ initial: "d20" }),
      diceBonus: new fields.StringField({ initial: "+@abilities.str.mod+ceil(@lvl / 2)" })
    });

    schema.formula = new fields.StringField({ blank: true });

    // Manakern's own flat FP grant (to the "manaCore" skill) whenever this
    // item is used - a designer-set value on the item itself, not a GM-
    // configured rate. See helpers/skillFp.mjs#grantFlatSkillFp.
    schema.manaCoreFpGrant = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. a ring granting a flat -5 discount on a school.
    // percent stacks additively with every other source (including the
    // caster's own Magic Control/Ritualism-based discount); flatFormula
    // supports "L" for the actor's level. Flat reductions apply before
    // percent ones, and the result normally can't drop below 1 -
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
    // or to all of them at once via "all" - e.g. Boots of Speed. See
    // helpers/movement.mjs#computeMovementSpeeds.
    schema.movementBonuses = new fields.ArrayField(new fields.SchemaField({
      movementType: new fields.StringField({
        required: true, blank: false, initial: "all",
        choices: ["all", "walking", "flying", "hovering", "swimming", "climbing", "digging"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    }));

    // The material this item is made of (a name from the GM-configured
    // world setting - see helpers/materials.mjs), or blank for none.
    schema.material = new fields.StringField({ required: true, blank: true, initial: "" });
    // Only used when the selected material's own materialBonus/manaCapacity
    // is "?" (individually configurable per item) - see
    // helpers/materials.mjs#resolveMaterialBonus/resolveMaterialManaCapacity.
    schema.materialBonusOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    schema.manaCapacityOverride = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    // See helpers/materials.mjs - the material grants an automatic bonus to
    // this item's own roll (mirrors Weapon's materialAttackBonus), and its
    // mana capacity for every 0.1kg of this item's own weight.
    this.materialRollBonus = resolveMaterialBonus(this);
    const roll = this.roll;
    this.formula = `${roll.diceNum}${roll.diceSize}${roll.diceBonus} + ${this.materialRollBonus}`;
    this.totalManaCapacity = computeTotalManaCapacity(this);
  }
}
