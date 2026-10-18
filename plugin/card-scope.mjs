// A Studio working-copy UUID is the card lineage. Revisions are fixed Run
// snapshots, not distinct cards. Never infer identity from titles or actors.
export const STUDIO_PROVIDER = '@local/dsh-card-studio-scean-test';
export function snapshotCardScope(snapshot) {
  const source = snapshot?.source;
  if (source?.provider !== STUDIO_PROVIDER || typeof snapshot.cardId !== 'string' ||
      !snapshot.cardId || source.card?.id !== snapshot.cardId ||
      source.card.revision !== snapshot.revision) return null;
  return {provider: source.provider, cardId: snapshot.cardId};
}
export function sameCardScope(a, b) {
  return !!a && !!b && a.provider === STUDIO_PROVIDER &&
    a.provider === b.provider && a.cardId === b.cardId;
}
export function sameCardContext(a, b) {
  return sameCardScope(a, b) && a.authoringSessionId === b.authoringSessionId &&
    a.generation === b.generation;
}
