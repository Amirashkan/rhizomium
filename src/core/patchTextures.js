// patchTextures.js — put a saved project's inlined images and videos back on
// the GPU.
//
// Lifted out of SaveLoadManager so the read-only web viewer (src/viewer/) can
// restore a published patch's media without instantiating the editor's whole
// save/load stack. SaveLoadManager delegates here, so both paths obey the same
// rule about what a patch is allowed to point at:
//
//   Only inline `data:` URLs are loaded. The field is named dataUrl but it
//   arrives from a patch file, and patches are downloaded from the gallery and
//   opened by other people. Nothing stops a patch from putting
//   `https://attacker.example/x.png` there, and assigning that to img.src fires
//   an outbound request on open — enough to log the viewer's IP and tell the
//   author their patch was opened, before a single pixel is drawn. The inlined
//   payload that makes a patch self-contained is always a data: URL, so
//   anything else is refused rather than fetched.
//
// That rule matters more here than it did in the editor: the viewer's whole job
// is opening other people's patches.

import { dataUrlToBlob } from './dataUrl.js';

/**
 * Restore an inline image into the texture manager and upload it to the GPU.
 *
 * @param {object} textureManager the live TextureManager
 * @param {string} nodeId texture node the image belongs to
 * @param {string} dataUrl inline `data:image/...` URL
 * @param {string} [filename] display label kept with the texture
 * @param {{onTextureChanged?: (nodeId: string) => void}} [options]
 */
export async function restoreImageTexture(textureManager, nodeId, dataUrl, filename, options = {}) {
  if (typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl.trim())) {
    throw new Error('Texture source must be an inline data: image URL');
  }

  await new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = async () => {
      try {
        const bitmap = await createImageBitmap(img);

        if (textureManager && textureManager.device) {
          textureManager.textures.set(nodeId, {
            bitmap,
            width: img.width,
            height: img.height,
            filename,
            dataUrl,
          });

          const gpuTexture = textureManager.device.createTexture({
            size: [img.width, img.height, 1],
            format: 'rgba8unorm',
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });

          textureManager.device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture: gpuTexture },
            [img.width, img.height],
          );

          const sampler = textureManager.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
          });

          // gpuTextures is what the renderer checks when it binds.
          if (!textureManager.gpuTextures) textureManager.gpuTextures = new Map();
          textureManager.gpuTextures.set(nodeId, { texture: gpuTexture, sampler });

          // New textures invalidate the cached bind group.
          textureManager.bindGroup = null;

          options.onTextureChanged?.(nodeId);
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('Failed to load texture image'));
    img.src = dataUrl;
  });
}

/**
 * Restore an inline video, handing the decoded bytes to TextureManager as a
 * File so the node goes through the same path as a fresh upload.
 */
export async function restoreVideoTexture(textureManager, nodeId, dataUrl, filename, options = {}) {
  if (typeof dataUrl !== 'string' || !/^data:video\//i.test(dataUrl.trim())) {
    throw new Error('Video source must be an inline data: video URL');
  }
  if (!textureManager) return;

  const blob = dataUrlToBlob(dataUrl);
  const file =
    typeof File === 'function'
      ? new File([blob], filename || 'video', { type: blob.type })
      : Object.assign(blob, { name: filename || 'video' });

  // Pass the data URL straight back through so a restored node can be saved
  // again without re-encoding the same bytes.
  await textureManager.uploadVideo(nodeId, file, { dataUrl });

  options.onTextureChanged?.(nodeId);
}

/**
 * Restore every texture in a saved project's `textures` map.
 *
 * One unusable texture must not cost the rest of the patch — a rejected or
 * refused source leaves that node without its image and the graph still opens.
 *
 * @returns {Promise<{restored: number, failed: number}>}
 */
export async function restorePatchTextures(textureManager, textureData, options = {}) {
  if (!textureData || !textureManager) return { restored: 0, failed: 0 };

  const restorePromises = [];

  for (const [nodeId, texInfo] of Object.entries(textureData)) {
    // A video too large to inline has no dataUrl; the node keeps its name.
    if (!texInfo?.dataUrl) continue;

    const isVideo = texInfo.isVideo || /^data:video\//i.test(String(texInfo.dataUrl).trim());
    restorePromises.push(
      isVideo
        ? restoreVideoTexture(textureManager, nodeId, texInfo.dataUrl, texInfo.filename, options)
        : restoreImageTexture(textureManager, nodeId, texInfo.dataUrl, texInfo.filename, options),
    );
  }

  if (restorePromises.length === 0) return { restored: 0, failed: 0 };

  const results = await Promise.allSettled(restorePromises);
  let failed = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      failed += 1;
      console.warn(
        'Skipped a texture while restoring patch:',
        result.reason?.message ?? result.reason,
      );
    }
  }

  return { restored: results.length - failed, failed };
}
