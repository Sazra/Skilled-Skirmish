/**
 * Distances between tokens on the active scene, for the weapon properties
 * that depend on how far away the target is (Ranged: no attack at 2m or
 * less; Reach/Long/Very Long: attacks over more than 2m use other
 * attributes). Distances are in scene units (metres in this system) and
 * measured edge to edge, so two adjacent tokens are 0 apart.
 */

/**
 * The token that represents an actor for an attack: a controlled token of
 * it if there is one, otherwise its first active token on the scene.
 * @param {Actor} actor
 * @return {Token|null}
 */
export function getActorToken(actor) {
  if (!canvas?.ready || !actor) return null;
  const controlled = canvas.tokens?.controlled?.find(token => token.actor === actor);
  return controlled ?? actor.getActiveTokens()[0] ?? null;
}

/** The point of a rectangle closest to a given point. */
function closestPointOnRect(rect, point) {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  };
}

/**
 * The edge-to-edge distance between two tokens in scene units.
 * @param {Token} a
 * @param {Token} b
 * @return {number}
 */
export function measureTokenDistance(a, b) {
  const pointA = closestPointOnRect(a.bounds, b.center);
  const pointB = closestPointOnRect(b.bounds, pointA);
  const refinedA = closestPointOnRect(a.bounds, pointB);
  return canvas.grid.measurePath([refinedA, pointB]).distance;
}

/**
 * The distances from an attacker's token to every OTHER token the current
 * user has targeted. Empty if the attacker has no token on the scene or
 * nothing else is targeted - in that case no distance rule can be applied.
 * @param {Actor} attacker
 * @return {number[]}
 */
export function getTargetDistances(attacker) {
  const attackerToken = getActorToken(attacker);
  if (!attackerToken) return [];
  const distances = [];
  for (const target of game.user.targets ?? []) {
    if (target === attackerToken || target.actor === attacker) continue;
    distances.push(measureTokenDistance(attackerToken, target));
  }
  return distances;
}

/**
 * The distance to the nearest other targeted token, or null if it can't be
 * determined (see getTargetDistances).
 * @param {Actor} attacker
 * @return {number|null}
 */
export function getNearestTargetDistance(attacker) {
  const distances = getTargetDistances(attacker);
  return distances.length ? Math.min(...distances) : null;
}
