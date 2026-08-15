/**
 * A roll/action chat card's own heading - the attribute/skill/item name the
 * card belongs to, styled like the Soul Path item's own name field (Foundry
 * core's --font-h1, "Modesto Condensed") rather than Foundry's own small
 * flavor-text header. Strips a leading "[type] " bracket tag some callers
 * still pass for flavor's own sake (e.g. "[skill] Ausweichen"), which reads
 * fine in the collapsed chat-message list but not as a card heading.
 * @param {string} title
 * @return {string}
 */
export function formatRollCardHeading(title) {
  const clean = String(title ?? '').replace(/^\[[^\]]+\]\s*/, '');
  return `<h3 class="sksk-roll-card-heading">${clean}</h3>`;
}
