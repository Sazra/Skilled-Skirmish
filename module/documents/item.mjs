import { rollSpellItem } from '../helpers/spell-rolls.mjs';
import { rollWeaponItem } from '../helpers/actions.mjs';
import { grantFlatSkillFp, formatSkillFpGrantLine } from '../helpers/skillFp.mjs';
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

    const item = this;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get('core', 'rollMode');
    const label = `[${item.type}] ${item.name}`;

    // Manakern's own flat FP grant (system.manaCoreFpGrant) - generic Items
    // only, matching Spells' own equivalent in helpers/spell-rolls.mjs#
    // rollSpellItem.
    const fpHTML = this.type === 'item'
      ? formatSkillFpGrantLine(await grantFlatSkillFp(this.actor, 'manaCore', this.system.manaCoreFpGrant))
      : '';

    if (!this.system.formula) {
      return ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: (item.system.description ?? '') + fpHTML,
      });
    }

    const rollData = this.getRollData();
    const roll = await new Roll(rollData.formula, rollData).evaluate();
    const messageData = {
      speaker: speaker,
      flavor: label,
      content: `${await roll.render()}${fpHTML}`,
      rolls: [roll],
    };
    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
    return roll;
  }
}
