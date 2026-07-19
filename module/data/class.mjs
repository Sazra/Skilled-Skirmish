import SKSKItemBase from "./item-base.mjs";

export default class SKSKClass extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.classType = new fields.StringField({
      required: true, blank: false, initial: "first", choices: ["first", "second", "third", "advanced"]
    });

    // A character/NPC's base life is the first + second class's life
    // values added together, multiplied by level.
    schema.life = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Starting bonuses to skills. Player-extensible list; "skill" holds a
    // key from CONFIG.SKSK.skills (multi-level skills only). "bonus" is a
    // number of whole skill LEVELS granted (e.g. bonus 1 on Axe grants Axe
    // at level 1), not skill points. Only granted when classType is "first"
    // - for second/third/advanced classes the sheet instead presents this
    // same list as skill prerequisites.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // A class always has exactly 3 abilities, each a freeform description
    // that can carry its own Active Effects.
    schema.abilities = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      description: new fields.StringField({ required: true, blank: true })
    }), {
      initial: [{ name: "", description: "" }, { name: "", description: "" }, { name: "", description: "" }]
    });

    return schema;
  }
}
