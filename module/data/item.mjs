import SKSKItemBase from "./item-base.mjs";

export default class SKSKItem extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 });
    schema.weight = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    schema.roll = new fields.SchemaField({
      diceNum: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      diceSize: new fields.StringField({ initial: "d20" }),
      diceBonus: new fields.StringField({ initial: "+@abilities.str.mod+ceil(@lvl / 2)" })
    });

    schema.formula = new fields.StringField({ blank: true });

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. a ring granting a flat -5 discount on a school.
    // percent stacks additively with every other source (including the
    // caster's own Magic Control/Ritualism-based discount); flatFormula
    // supports "L" for the actor's level. See
    // helpers/spells.mjs#computeSpellManaCost.
    schema.manaCostReductions = new fields.ArrayField(new fields.SchemaField({
      spellType: new fields.StringField({
        required: true, blank: false, initial: "simple",
        choices: ["simple", "advanced", "combined", "systemless"]
      }),
      school: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      percent: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0, max: 100 }),
      flatFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
    }));

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const roll = this.roll;
    this.formula = `${roll.diceNum}${roll.diceSize}${roll.diceBonus}`;
  }
}
