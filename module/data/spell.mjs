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

    // Whether the spell needs an attack roll at all (vs. the target's
    // Magic Resistance) is left as a placeholder switch for now - the
    // actual roll formula/resolution is built out in a later step. Some
    // spells fire more than one separate attack (e.g. multiple bolts),
    // hence a count rather than a plain toggle.
    schema.attackRoll = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      count: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
    });

    // Zero or more saving throws the target must beat. Each starts from a
    // flat base (usually 10) plus any number of attribute- and skill-based
    // bonuses. Every bonus is scaled by its own formula, where "@value"
    // stands for the chosen attribute's value/modifier or the chosen
    // skill's current level - e.g. a base of 10, an attribute bonus of the
    // Willpower modifier (formula "@value"), and a skill bonus of half the
    // Magic Control level (formula "@value / 2").
    schema.savingThrows = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      baseValue: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "wil" }),
        // true: the attribute's modifier: false: its full value.
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "magicControl" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
    }));

    // Zero or more damage instances. Each is independently tied to the
    // attack roll, to one specific saving throw (by index into
    // savingThrows above), or applied unconditionally. attributeBonuses/
    // skillBonuses scale the damage the same way a saving throw's bonuses
    // scale its value - a flat number to add once the formula is actually
    // rolled, each independently scaled by its own "@value" formula.
    schema.damages = new fields.ArrayField(new fields.SchemaField({
      formula: new fields.StringField({ required: true, blank: true, initial: "1d6" }),
      damageType: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
    }));

    // Zero or more status effects. Placeholder until the status-effect
    // system itself exists (a later step) - only the same trigger coupling
    // as Damage above (attack roll / a specific saving throw /
    // unconditional) plus a freeform description of the intended effect.
    schema.statusEffects = new fields.ArrayField(new fields.SchemaField({
      description: new fields.StringField({ required: true, blank: true }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    }));

    return schema;
  }
}
