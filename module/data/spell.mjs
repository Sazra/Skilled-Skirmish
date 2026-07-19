import SKSKItemBase from "./item-base.mjs";

export default class SKSKSpell extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Simple/Advanced spells belong to a single magic school (see
    // CONFIG.SKSK.simpleMagicSchools / advancedMagicSchools); Combined
    // spells instead require levels in a combination of skills; Systemless
    // spells belong to no school at all.
    schema.spellType = new fields.StringField({
      required: true, blank: false, initial: "simple",
      choices: ["simple", "advanced", "combined", "systemless"]
    });

    // Only meaningful for spellType "simple" or "advanced" - a skill key
    // from that tier's magic-school list.
    schema.magicSchool = new fields.StringField({ required: true, blank: false, initial: "fire" });

    // Only meaningful for spellType "combined": the skills (any category,
    // not just magic schools) and levels required to cast this spell.
    schema.combinedSkills = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      level: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 })
    }));

    schema.manaCost = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.apCost = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 });

    // One or more ranges, each paired with the indicator describing how
    // that leg of the spell travels/applies (e.g. a fireball is a 30m
    // Projectile followed by a 6m Radius explosion).
    schema.ranges = new fields.ArrayField(new fields.SchemaField({
      distance: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      indicator: new fields.StringField({
        required: true, blank: false, initial: "projectile",
        choices: ["self", "touch", "targeted", "projectile", "line", "radius", "cone", "square"]
      })
    }), {
      initial: [{ distance: 10, indicator: "projectile" }]
    });

    schema.duration = new fields.StringField({ required: true, blank: true });

    // How the spell is cast; multiple methods can be selected at once.
    schema.castingMethods = new fields.SchemaField({
      vocal: new fields.BooleanField({ initial: false }),
      runes: new fields.BooleanField({ initial: false }),
      movement: new fields.BooleanField({ initial: false }),
      sacrifice: new fields.BooleanField({ initial: false }),
      medium: new fields.BooleanField({ initial: false }),
      ritual: new fields.BooleanField({ initial: false }),
      concentration: new fields.BooleanField({ initial: false }),
    });
    schema.sacrificeDescription = new fields.StringField({ required: true, blank: true });
    schema.mediumDescription = new fields.StringField({ required: true, blank: true });

    // What "mastered" affects is implemented later.
    schema.mastered = new fields.BooleanField({ initial: false });

    return schema;
  }
}
