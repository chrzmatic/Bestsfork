const PROFILE_SIZE = 256;
const PROFILE_MAX_BYTES = 200 * 1024;

// Miniatura vai dentro do documento que as listas leem; a cheia fica em media/.
const THUMB_SIZE = 160;
const THUMB_MAX_BYTES = 40 * 1024;
const FULL_SIZE = 640;
const FULL_MAX_BYTES = 600 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir essa imagem. Tente outra foto.')); };
    img.src = url;
  });
}

function byteSize(dataUrl) {
  return Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
}

// Recorta o centro em quadrado e reduz para `size` px em JPEG.
function squareJpeg(img, size, quality) {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const out = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', quality);
}

async function checkedImage(file) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  return loadImage(file);
}

export async function photoToDataUrl(file) {
  const img = await checkedImage(file);
  const dataUrl = squareJpeg(img, PROFILE_SIZE, 0.8);
  if (byteSize(dataUrl) > PROFILE_MAX_BYTES) throw new Error('A foto ficou grande demais depois de comprimida. Tente outra.');
  return dataUrl;
}

// Capa de álbum ou foto de artista escolhida pelo admin.
export async function imageToVariants(file) {
  const img = await checkedImage(file);
  let full = squareJpeg(img, FULL_SIZE, 0.82);
  if (byteSize(full) > FULL_MAX_BYTES) full = squareJpeg(img, FULL_SIZE, 0.6);
  if (byteSize(full) > FULL_MAX_BYTES) throw new Error('A imagem ficou grande demais depois de comprimida. Tente outra.');
  const thumb = squareJpeg(img, THUMB_SIZE, 0.72);
  if (byteSize(thumb) > THUMB_MAX_BYTES) throw new Error('A miniatura ficou grande demais. Tente outra imagem.');
  return { thumb, full };
}
