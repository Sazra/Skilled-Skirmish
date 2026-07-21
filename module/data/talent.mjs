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

    // Zero or more overrides granting the ability to cast spells from a
    // specific combined magic school (CONFIG.SKSK.combinedMagicSchools) up
    // to a computed max level, bypassing that school's spells' own
    // combinedSkills prerequisite entirely - e.g. a demon casting Demomancy
    // spells up to their Willpower modifier. baseFormula supports "L" for
    // the actor's level (e.g. "L / 2"); attributeBonuses/skillBonuses scale
    // the same way a spell's saving throws/damage do, each independently
    // via its own "@value" formula. An actor's effective max level for a
    // school is the highest of every matching override across every
    // Class/Species/Talent item they hold.
    schema.combinedSchoolOverrides = new fields.ArrayField(new fields.SchemaField({
      combinedSchool: new fields.StringField({ required: true, blank: false, initial: "stormancy" }),
      baseFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "wil" }),
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "magicControl" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
    }));

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. a demon's 50% discount on Demomancy spells, or a
    // flat -5 discount from a piece of gear. percent stacks additively with
    // every other source (including the caster's own Magic Control/
    // Ritualism-based discount); flatFormula supports "L" for the actor's
    // level. See helpers/spells.mjs#computeSpellManaCost.
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
