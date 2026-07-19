import SKSKItemBase from "./item-base.mjs";

export default class SKSKSpecies extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // A species is either used directly (main) or stacked onto a main
    // species as an extension (sub), e.g. main species Orc + sub-species
    // Cambion (half-demon).
    schema.speciesType = new fields.StringField({
      required: true, blank: false, initial: "main", choices: ["main", "sub"]
    });

    // Base value granted to the Aura attribute. A character's Aura is the
    // sum of this value from their main species and (if any) sub-species.
    schema.aura = new fields.NumberField({ ...requiredInteger, initial: 10, min: 8, max: 20 });

    // Bonuses to attributes other than Aura. Player-extensible list.
    schema.attributeBonuses = new fields.ArrayField(new fields.SchemaField({
      attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // Starting bonuses to skills, always granted. Player-extensible list;
    // "skill" holds a key from CONFIG.SKSK.skills (multi-level skills only).
    // "bonus" is a number of whole skill LEVELS granted (e.g. bonus 1 on
    // Axe grants Axe at level 1), not skill points.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // 1-3 species abilities, each a freeform description (passive or
    // actively used).
    schema.abilities = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      description: new fields.StringField({ required: true, blank: true })
    }));

    return schema;
  }
}
