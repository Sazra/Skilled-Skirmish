/**
 * A tiny GM-delegation socket relay: lets a player's client ask whichever
 * ONE connected GM Foundry itself elects (game.users.activeGM - the same
 * built-in mechanism modules use for exactly this "do this with the GM's
 * own permissions instead" pattern) to run a small, named action with
 * this client's own choice of arguments, whenever that player lacks
 * Owner permission on whatever the action would otherwise need to write
 * to (typically a GM-owned NPC's Life/FP/Durability - see helpers/
 * attackRolls.mjs#autoResolveAttackForTargets/helpers/damageApplication.mjs#
 * applyDamageFromChat/rollAndApplyManualDamage, this module's only
 * current callers). Arguments must be plain JSON-serializable data
 * (Actor/Item UUIDs, not the Documents themselves) - the GM's own client
 * resolves them fresh via fromUuid on its own end.
 *
 * If no GM is currently connected at all, requestGmAction returns false
 * and does nothing - every caller falls back to its own pre-existing
 * "can't do this, here's why" warning in that case, exactly as if this
 * module didn't exist.
 */

const SOCKET_NAME = 'system.sksk';

/** @type {Object<string, (data: object) => Promise<void>>} */
const actionHandlers = {};

/**
 * Register a named action's own GM-side handler - call once per action,
 * at module load time, from whichever helper module owns that action
 * (see this file's own doc comment for the current callers). A pure
 * side-effect-free registration (just stores the function reference for
 * later) - safe to run at top-level even across this codebase's usual
 * circular-import setups, since it never calls anything itself.
 * @param {string} action
 * @param {(data: object) => Promise<void>} handler
 */
export function registerGmRelayAction(action, handler) {
  actionHandlers[action] = handler;
}

/**
 * Wire up this module's single shared socket listener - call exactly
 * once, from sksk.mjs's own init hook (after every helper module's own
 * top-level registerGmRelayAction calls have already run). Only the
 * single elected activeGM ever actually runs a handler, even if several
 * GMs are connected at once, so a relayed action never executes twice.
 */
export function initGmRelay() {
  game.socket.on(SOCKET_NAME, async ({ action, data } = {}) => {
    if (game.user !== game.users.activeGM) return;
    const handler = actionHandlers[action];
    if (!handler) return;
    await handler(data ?? {});
  });
}

/**
 * Ask the currently active GM's client to run `action` with `data` (see
 * registerGmRelayAction) - fire-and-forget, since the GM's own handler
 * posts whatever chat message the action produces itself; the requesting
 * client doesn't wait for (or need) a reply.
 * @param {string} action
 * @param {object} data   Plain JSON-serializable payload for that action's
 *   own handler - see each call site's own doc comment for its shape.
 * @return {boolean} true if a GM is connected to relay to (the caller
 *   should treat this as "handled"), false if not (the caller should fall
 *   back to its own local warning instead).
 */
export function requestGmAction(action, data) {
  if (!game.users.activeGM) return false;
  game.socket.emit(SOCKET_NAME, { action, data });
  return true;
}
