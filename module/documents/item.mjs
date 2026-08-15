import { rollSpellItem } from '../helpers/spell-rolls.mjs';
import { rollWeaponItem, rollItemUsage } from '../helpers/actions.mjs';
import { activateTechnique } from '../helpers/technique-rolls.mjs';

/**
 * Extend the basic Item document.
 * @extends {Item}
 */
export class SKSKItem extends Item {
  /** @override */
  prepareData() {
    super.prepareData();
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
