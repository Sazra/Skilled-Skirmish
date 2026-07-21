import SKSKItemBase from "./item-base.mjs";

export default class SKSKArmor extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. an enchanted piece of armor granting a flat -5
    // discount on a school. percent stacks additively with every other
    // source (including the caster's own Magic Control/Ritualism-based
    // discount); flatFormula supports "L" for the actor's level. See
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
}
