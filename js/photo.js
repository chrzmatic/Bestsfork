const SIZE = 256;
const MAX_BYTES = 200 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir essa imagem. Tente outra foto.')); };
    img.src = url;
  });
}

// Recorta o centro em quadrado, reduz para 256x256 e devolve um data URL JPEG.
export async function photoToDataUrl(file) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const bytes = Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
  if (bytes > MAX_BYTES) throw new Error('A foto ficou grande demais depois de comprimida. Tente outra.');
  return dataUrl;
}
