/**
 * Embedded GLB textures on React Native:
 * - `Blob(arrayBuffer)` is unsupported (Three's default path).
 * - Data URIs still go through Three's ImageLoader, which needs `document` / DOM <img>.
 *
 * Fix: write the image buffer to a cache file and load with expo-three's TextureLoader
 * (Image.getSize + texture upload compatible with expo-gl).
 */

import { Platform } from 'react-native';
import type { LoadingManager, Texture } from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { File, Paths } from 'expo-file-system';
import ExpoTextureLoader from 'expo-three/build/TextureLoader';

function assignGltfExtras(target: { userData: Record<string, unknown> }, def: { extras?: unknown }) {
  if (def.extras === undefined) return;
  if (typeof def.extras === 'object' && def.extras !== null) {
    Object.assign(target.userData, def.extras as object);
  } else {
    console.warn('THREE.GLTFLoader: Ignoring primitive type .extras,', def.extras);
  }
}

function mimeTypeFromUri(uri: string): string {
  if (/\.jpe?g($|\?)/i.test(uri) || /^data:image\/jpeg/i.test(uri)) return 'image/jpeg';
  if (/\.webp($|\?)/i.test(uri) || /^data:image\/webp/i.test(uri)) return 'image/webp';
  if (/\.ktx2($|\?)/i.test(uri) || /^data:image\/ktx2/i.test(uri)) return 'image/ktx2';
  return 'image/png';
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m === 'image/jpg') return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('png')) return '.png';
  return '.png';
}

function loadTextureFromCacheFile(
  fileUri: string,
  manager: LoadingManager,
): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const loader = new ExpoTextureLoader(manager);
    loader.load(
      fileUri,
      (texture) => resolve(texture),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

type GltfParserWithEmbeddedTextures = {
  json: { images: { uri?: string; bufferView?: number; mimeType?: string; extras?: unknown }[] };
  options: { path: string; manager: LoadingManager };
  sourceCache: Record<number, Promise<Texture>>;
  getDependency: (type: string, index: number) => Promise<ArrayBuffer>;
  loadImageSource: (sourceIndex: number, imageLoader: unknown) => Promise<Texture>;
};

/**
 * Patches the internal GLTFParser (via loader.register).
 */
export function registerGltfEmbeddedTexturesAsDataUris(loader: GLTFLoader): void {
  if (Platform.OS === 'web') return;

  loader.register((parser) => {
    const p = parser as unknown as GltfParserWithEmbeddedTextures;
    const original = p.loadImageSource.bind(p);

    p.loadImageSource = function (sourceIndex, imageLoader) {
      const sourceDef = p.json.images[sourceIndex];

      if (sourceDef.bufferView === undefined) {
        return original(sourceIndex, imageLoader);
      }

      if (p.sourceCache[sourceIndex] !== undefined) {
        return p.sourceCache[sourceIndex].then((texture) => texture.clone());
      }

      const mimeType = sourceDef.mimeType || 'image/png';
      const ext = extensionForMime(mimeType);

      const promise = p
        .getDependency('bufferView', sourceDef.bufferView)
        .then(async (bufferView) => {
          const cacheFile = new File(Paths.cache, `spoton-gltf-tex-${sourceIndex}${ext}`);
          cacheFile.write(new Uint8Array(bufferView));
          const texture = await loadTextureFromCacheFile(cacheFile.uri, p.options.manager);
          assignGltfExtras(texture, sourceDef);
          texture.userData.mimeType = sourceDef.mimeType || mimeTypeFromUri(sourceDef.uri ?? '');
          return texture;
        })
        .catch((error: unknown) => {
          console.error("THREE.GLTFLoader: couldn't load embedded texture", error);
          throw error;
        });

      p.sourceCache[sourceIndex] = promise;
      return promise;
    };

    return { name: 'SPOTON_embedded_texture_cache_file' };
  });
}
