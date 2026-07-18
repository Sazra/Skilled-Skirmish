import SKSKItemBase from "./item-base.mjs";

export default class SKSKTalent extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.talentType = new fields.StringField({
      required: true, blank: false, initial: "level6",
      choices: ["level6", "level12", "level18", "level24", "mythic", "bonus", "bloodline"]
    });

    // Bonuses to attributes. Player-extensible list, like species/class.
    schema.attributeBonuses = new fields.ArrayField(new fields.SchemaField({
      attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // Starting bonuses to skills. Player-extensible list; free-text skill
    // name for now since the skill system doesn't exist yet.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: true }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // A talent grants exactly one ability, described here (no name needed).
    // Any Active Effects on the item itself belong to this ability.
    schema.ability = new fields.StringField({ required: true, blank: true });

    return schema;
  }
}
