/**
 * Copies a Foundry Active Effect "Attribute Key" to the clipboard and
 * confirms via a toast - shared between apps/effect-key-reference.mjs's own
 * copy buttons and actor-sheet.mjs's Ctrl+Right-click shortcut, so both
 * discovery paths behave identically.
 * @param {string} key   E.g. "system.attributeBonuses.str.special".
 */
export async function copyEffectKeyToClipboard(key) {
  await navigator.clipboard.writeText(key);
  ui.notifications.info(game.i18n.format('SKSK.EffectKeyReference.Copied', { key }));
}
