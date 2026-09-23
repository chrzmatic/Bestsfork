import { getReleaseGroupGenres, getArtistInfo, findArtistId } from './musicbrainz.js';
import { pickGenre } from './genres.js';

// Gênero amplo pelo MusicBrainz: o do álbum, ou o do artista se o álbum não tiver.
export async function autoGenre({ releaseGroupId, artistMbid, artistName }) {
  try {
    if (releaseGroupId) {
      const fromAlbum = pickGenre(await getReleaseGroupGenres(releaseGroupId));
      if (fromAlbum) return fromAlbum;
    }
    const mbid = artistMbid || (artistName ? await findArtistId(artistName) : null);
    if (!mbid) return null;
    return pickGenre((await getArtistInfo(mbid)).genres);
  } catch {
    return null;
  }
}
