import { rollSpellItem } from '../helpers/spell-rolls.mjs';
import { rollWeaponItem } from '../helpers/actions.mjs';

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
  async roll() {
    if (this.type === 'spell') return rollSpellItem(this);
    if (this.type === 'weapon') return rollWeaponItem(this);

    const item = this;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label = `[${item.type}] ${item.name}`;

    if (!this.system.formula) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? '',
      });
    } else {
      const rollData = this.getRollData();
      const roll = new Roll(rollData.formula, rollData);
      roll.toMessage({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
      });
      return roll;
    }
  }
}
