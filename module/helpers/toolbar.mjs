import { getActorSkillLevel } from './skills.mjs';
import { computeSummonSlots } from './summoning.mjs';
import { computeTotemSlots } from './totem.mjs';
import { getAllLehrenDefinitions, getInvestedLehreLevel } from './lehren.mjs';

/**
 * Which of the actor sheet's TopBar buttons (templates/actor/parts/
 * header-toolbar.hbs) can be used at all right now - the others are not shown.
 * Each button's requirement is listed here, in one place:
 *
 * - actions:      always (the Actions window itself)
 * - rest:         always
 * - training:     Characters only (NPCs don't generate FP)
 * - religion:     always (the Patron is chosen inside the dialog)
 * - summoning:    Characters only; Beschwörung skill level 1+ and at least one summon slot
 * - totem:        at least one Totem slot (Totem skill level 1+, or via the GM tab bonus)
 * - source:       Characters only; Quellengebunden or Ätherquellengebunden skill level 1+
 * - productionFp: Characters only; Alchemie/Herstellung/Kochen/Verzauberung skill level 1+
 * - lehren:       at least one Lehre that can be used: its skill level reaches the Lehre's minimum (a minimum of 0 always
 *                 does), or points are already invested in it
 * @param {Actor} actor
 * @return {{actions: boolean, rest: boolean, training: boolean, religion: boolean, summoning: boolean,
 *   totem: boolean, source: boolean, productionFp: boolean, lehren: boolean}}
 */
export function getToolbarAvailability(actor) {
  const isNpc = actor.type === 'npc';
  const level = key => getActorSkillLevel(actor, key);

  return {
    actions: true,
    rest: true,
    training: !isNpc,
    religion: true,
    summoning: !isNpc && level('summoning') >= 1 && computeSummonSlots(actor) > 0,
    totem: computeTotemSlots(actor) > 0,
    source: !isNpc && (level('sourceBound') >= 1 || level('etherBound') >= 1),
    productionFp: !isNpc && ['alchemy', 'crafting', 'cooking', 'enchanting'].some(key => level(key) >= 1),
    lehren: hasUsableLehren(actor),
  };
}

/**
 * Whether the actor has a Lehre (see helpers/lehren.mjs) it can put points into or
 * already has points in - the same unlock rule as apps/lehren-dialog.mjs (a
 * Lehre is locked below its own minimum skill level).
 * @param {Actor} actor
 * @return {boolean}
 */
function hasUsableLehren(actor) {
  return Object.entries(getAllLehrenDefinitions()).some(([skillKey, definitions]) => {
    if (!definitions?.length) return false;
    const skillLevel = getActorSkillLevel(actor, skillKey);
    return definitions.some(def => skillLevel >= (def.minSkillLevel ?? 0) || getInvestedLehreLevel(actor, skillKey, def.id) > 0);
  });
}
