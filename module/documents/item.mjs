import { rollSpellItem } from '../helpers/spell-rolls.mjs';
import { rollWeaponItem, rollItemUsage } from '../helpers/actions.mjs';
import { activateTechnique } from '../helpers/technique-rolls.mjs';
import { isDurabilityEnabled } from '../helpers/materials.mjs';

/**
 * Extend the basic Item document.
 * @extends {Item}
 */
export class SKSKItem extends Item {
  /** @override */
  prepareData() {
    super.prepareData();
  }

  /**
   * A freshly created Weapon/Armor/(non-Consumable) Item starts at full
   * Haltbarkeit (Durability) - system.durability.value defaults to the
   * freshly computed system.maxDurability (see data/weapon.mjs/armor.mjs/
   * item.mjs#prepareDerivedData), rather than the schema's own static
   * initial of 0. Skipped whenever the incoming data already specifies a
   * value explicitly (duplicating an item, or importing one from a
   * compendium/export, must preserve its existing wear instead of
   * resetting it) - see helpers/materials.mjs#resolveMaterialDurability.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    if (!isDurabilityEnabled()) return;
    if (!['weapon', 'armor', 'item'].includes(this.type)) return;
    if (this.type === 'item' && this.system.consumable) return;
    if (foundry.utils.getProperty(data, 'system.durability.value') !== undefined) return;
    this.updateSource({ 'system.durability.value': this.system.maxDurability });
  }

  /** @override */
  getRollData() {
    const rollData = { ...super.getRollData() };
    if (!this.actor) return rollData;
    Object.assign(rollData, this.actor.getRollData());
    return rollData;
  }

  /** @override */
  async roll(overchargeCount = 0) {
    if (this.type === 'spell') return rollSpellItem(this, overchargeCount);
    if (this.type === 'weapon') return rollWeaponItem(this);
    if (this.type === 'technique') return activateTechnique(this.actor, this);
    if (this.type === 'item') return rollItemUsage(this);
  }
}
