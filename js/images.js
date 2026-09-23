// Qual imagem mostrar para álbuns e artistas, sem baixar tamanho cheio nas listas.
import { albumGroupScore } from './stats.js';

// A capa automática do Cover Art Archive tem versão de 250 px para listas.
export function smallCoverUrl(url) {
  return typeof url === 'string' ? url.replace(/\/front-(500|1200)$/, '/front-250') : null;
}

export function listCover(album) {
  return album?.customCover || smallCoverUrl(album?.coverUrl) || null;
}

// Na página, a capa escolhida pelo admin vem de media/; sem ela, a automática.
export function pageCover(album, media) {
  if (album?.customCover) return media?.data || album.customCover;
  return album?.coverUrl || null;
}

// Capa do álbum mais bem avaliado do artista, ou de qualquer álbum dele.
export function fallbackArtistCover(artistId, albums, results, memberUids) {
  const mine = (albums || []).filter((a) => a.artistId === artistId && listCover(a));
  if (mine.length === 0) return null;
  const score = (a) => albumGroupScore(a, results?.[a.id], memberUids) ?? -1;
  const best = [...mine].sort((a, b) => score(b) - score(a))[0];
  return listCover(best);
}

// Imagem do artista: manual, automática ou capa. `null` vira avatar com a inicial.
export function artistImage(artist, { size = 'list', media, albums, results, memberUids } = {}) {
  if (artist?.customPhoto) return size === 'page' ? media?.data || artist.customPhoto : artist.customPhoto;
  const auto = size === 'page' ? artist?.photoUrl : artist?.photoThumbUrl || artist?.photoUrl;
  if (auto) return auto;
  return fallbackArtistCover(artist?.id, albums, results, memberUids);
}
