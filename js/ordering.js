// Ordem de "Recentes": o admin pode reordenar gravando `sortKey` no álbum.
// Sem `sortKey`, vale a data de criação.

const STEP = 60_000;

export function albumSortKey(album) {
  if (typeof album?.sortKey === 'number' && Number.isFinite(album.sortKey)) return album.sortKey;
  const t = album?.createdAt?.getTime?.();
  // Álbum recém-criado ainda sem data do servidor fica no topo.
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

export function sortRecent(albums) {
  return [...(albums || [])].sort((a, b) => albumSortKey(b) - albumSortKey(a));
}

// Nova chave para mover `list[index]` uma posição (dir -1 sobe, +1 desce) na lista já ordenada.
// Devolve null se não dá para mover.
export function moveKey(list, index, dir) {
  const keys = list.map(albumSortKey);
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  if (dir < 0) {
    const above = keys[target - 1];
    return above === undefined ? keys[target] + STEP : (above + keys[target]) / 2;
  }
  const below = keys[target + 1];
  return below === undefined ? keys[target] - STEP : (keys[target] + below) / 2;
}

export function topKey(list) {
  return list.length ? albumSortKey(list[0]) + STEP : Date.now();
}
