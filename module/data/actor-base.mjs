import { computeSkillBonusTotals, evaluateSkillFormula, getSkillLevel } from '../helpers/skills.mjs';
import { computeMaxLife } from '../helpers/life.mjs';

export default class SKSKActorBase extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    schema.life = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      // No longer directly user-editable - overwritten every data
      // preparation by helpers/life.mjs#computeMaxLife (see
      // prepareDerivedData below).
      max: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      // Flat bonus added on top of the computed max life, after every
      // other multiplier - not meant to be hand-edited, but targeted by
      // Active Effects via "system.life.bonus".
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Damage taken after life reaches 0 is deducted from negative life
    // instead of killing the character outright.
    schema.negativeLife = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 10 })
    });
    // Usually-temporary pool that shields life (or negative life) from damage.
    schema.barrier = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.mana = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 5 })
    });
    schema.actionPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 3 })
    });
    schema.reactionPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1 })
    });
    // Attack rolls must exceed this to deal weapon damage.
    schema.armorClass = new fields.NumberField({ ...requiredInteger, initial: 10 });
    // Attack rolls must exceed this for a spell to have full effect.
    schema.magicResistance = new fields.NumberField({ ...requiredInteger, initial: 10 });
    schema.biography = new fields.StringField({ required: true, blank: true });

    // Character tab's "Data" section - free-flavor fields shown alongside
    // the biography, none of which feed into any calculation.
    schema.gender = new fields.StringField({
      required: true, blank: false, initial: "genderless",
      choices: ["male", "female", "hermaphrodite", "genderless"]
    });
    schema.age = new fields.StringField({ required: true, blank: true });
    // Independent of sizeCategory (that's a coarse combat-relevant
    // category; this is the actual, precise height).
    schema.height = new fields.StringField({ required: true, blank: true });
    schema.skinColor = new fields.StringField({ required: true, blank: true });
    schema.hairColor = new fields.StringField({ required: true, blank: true });
    schema.eyeColor = new fields.StringField({ required: true, blank: true });
    // User-extensible list of further free-flavor data points (numbers or
    // words), e.g. "Zodiac Sign: Leo" or "Weight: 70kg".
    schema.additionalData = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      value: new fields.StringField({ required: true, blank: true }),
    }));

    schema.resources = new fields.SchemaField({
      level: new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 1 })
      }),
    });

    // User-extensible list of additional trackable resources (e.g. Rage,
    // Ki points), shown on the General tab alongside Life/Mana/AP/etc.
    // abbreviation (up to 4 letters, enforced by the input's maxlength
    // rather than here) exposes this resource's current value as a roll
    // formula variable - see getRollData below.
    schema.customResources = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      abbreviation: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    }));

    // Overrides the size category (CONFIG.SKSK.sizeCategories) this actor
    // would otherwise inherit from its main Species item - e.g. an
    // individual that's smaller than typical for its species. Blank means
    // "use the species default" - see helpers/movement.mjs#getActorSizeCategory.
    schema.sizeCategory = new fields.StringField({ required: true, blank: true, initial: "" });

    // Base movement speeds (in meters), one per CONFIG.SKSK.movementTypes -
    // shown as a horizontal list on the General tab. See
    // helpers/movement.mjs#computeMovementSpeeds for how item-granted
    // bonuses (general or type-specific) stack on top of these.
    const movementSchema = {};
    for (const key of Object.keys(CONFIG.SKSK.movementTypes)) {
      movementSchema[key] = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    }
    schema.movement = new fields.SchemaField(movementSchema);

    const attributeKeys = Object.keys(CONFIG.SKSK.attributes);
    const attributesSchema = {};
    for (const attribute of attributeKeys) {
      attributesSchema[attribute] = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
        mod: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        label: new fields.StringField({ required: true, blank: true })
      });
    }
    schema.attributes = new fields.SchemaField(attributesSchema);

    // One entry per skill, flattened across every category in
    // CONFIG.SKSK.skills (skill keys are unique across categories).
    // Characters enter points/toggle directly; NPCs instead get a formula
    // (points-per-level for multi-level skills, or a 1-means-unlocked
    // formula for binary/1-level skills) so a template scales with level.
    const skillsSchema = {};
    for (const category of Object.values(CONFIG.SKSK.skills)) {
      for (const key of Object.keys(category)) {
        skillsSchema[key] = new fields.SchemaField({
          points: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
          toggle: new fields.BooleanField({ initial: false }),
          formula: new fields.StringField({ required: true, blank: true }),
          // Favorited skills show just their level on the General tab.
          favorite: new fields.BooleanField({ initial: false }),
        });
      }
    }
    schema.skills = new fields.SchemaField(skillsSchema);

    return schema;
  }

  prepareBaseData() {
    super.prepareBaseData();
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    if (!this.attributes) return;
    for (const key in this.attributes) {
      if (!this.attributes[key]) continue;
      this.attributes[key].mod = Math.floor((this.attributes[key].value - 10) / 2);
      this.attributes[key].label = game.i18n.localize(CONFIG.SKSK.attributes[key]) ?? key;
    }

    // Depends on the Constitution modifier just computed above, so must
    // run after the attributes loop. Requires this.parent (the owning
    // Actor, for its items and skill levels) - unavailable in a few edge
    // cases (e.g. schema validation off a bare data model).
    if (this.parent) {
      this.life.max = computeMaxLife(this.parent);
    }
  }

  getRollData() {
    const data = {};

    if (this.attributes) {
      data.attributes = {};
      for (let [k, v] of Object.entries(this.attributes)) {
        data.attributes[k] = foundry.utils.deepClone(v);
      }
    }

    data.lvl = this.resources.level.value;

    // Every skill's current level, so world-configurable formulas (e.g.
    // the carry-weight setting) can reference "@skills.<key>" - 0 for
    // binary/stackable skills, which have no real "level" to begin with.
    // Deliberately NOT calling the shared getActorSkillLevel helper here:
    // for NPCs it evaluates the skill's formula via actor.getRollData(),
    // which would call straight back into this method - infinite
    // recursion. Uses the "lvl" already computed above instead.
    if (this.parent) {
      data.skills = {};
      const isNpc = this.parent.type === 'npc';
      const skillBonusTotals = computeSkillBonusTotals(this.parent);
      for (const category of Object.values(CONFIG.SKSK.skills)) {
        for (const [key, def] of Object.entries(category)) {
          if (def.maxLevel !== 5 && def.maxLevel !== 10) {
            data.skills[key] = 0;
            continue;
          }
          const skillData = this.skills?.[key] ?? {};
          const bonus = skillBonusTotals[key] ?? 0;
          const points = isNpc
            ? evaluateSkillFormula(skillData.formula ?? '', { lvl: data.lvl })
            : (skillData.points ?? 0);
          data.skills[key] = getSkillLevel(points, def.maxLevel, bonus);
        }
      }
    }

    // Each custom resource with an abbreviation set exposes its current
    // value as "@<abbreviation, lowercased>" in any roll formula (damage,
    // the generic Item roll formula, attribute rolls, etc).
    for (const resource of this.customResources ?? []) {
      if (!resource.abbreviation) continue;
      data[resource.abbreviation.toLowerCase()] = resource.value;
    }

    return data;
  }
}
