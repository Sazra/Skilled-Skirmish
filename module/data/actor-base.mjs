export default class SKSKActorBase extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    schema.life = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 10 })
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

    schema.resources = new fields.SchemaField({
      level: new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 1 })
      }),
    });

    // User-extensible list of additional trackable resources (e.g. Rage,
    // Ki points), shown on the General tab alongside Life/Mana/AP/etc.
    schema.customResources = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    }));

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

    return data;
  }
}
