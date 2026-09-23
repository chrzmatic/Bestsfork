export function normalizeKey(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function artistKey(name) {
  const key = normalizeKey(name);
  if (!key) throw new Error('Nome de artista vazio');
  return key;
}

export function resolveArtist(name, musicbrainzId, existing) {
  const list = existing || [];
  if (musicbrainzId) {
    const byMbid = list.find((a) => a.musicbrainzId === musicbrainzId);
    if (byMbid) return { id: byMbid.id, isNew: false, data: null, patch: null };
  }

  const key = artistKey(name);
  const byKey = list.find((a) => a.id === key);
  if (byKey) {
    const patch = musicbrainzId && !byKey.musicbrainzId ? { musicbrainzId } : null;
    return { id: byKey.id, isNew: false, data: null, patch };
  }

  return {
    id: key,
    isNew: true,
    data: { name: String(name).trim(), musicbrainzId: musicbrainzId || null },
    patch: null,
  };
}
