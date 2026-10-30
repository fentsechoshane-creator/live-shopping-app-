/** A square, centred, 480 px JPEG for profile photos: small to upload and quick to show. */
export async function squarePhoto(file: Blob, size = 480): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((ok) => canvas.toBlob((b) => ok(b ?? file), "image/jpeg", 0.86));
  } catch {
    return file; // HEIC or an old phone: upload as it is
  }
}
