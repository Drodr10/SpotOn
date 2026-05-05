/**
 * CarModel3D — renders the car.glb 3D model using expo-gl + Three.js.
 *
 * On load: side profile (doors toward camera), then eases a few degrees on X
 * so a bit more roof is visible. No touch orbit — subtle parallax from device motion.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { DeviceMotion } from 'expo-sensors';
import Renderer from 'expo-three/build/Renderer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { registerGltfEmbeddedTexturesAsDataUris } from '@/src/utils/gltfEmbeddedTexturesDataUri';

// ─── Constants (tuning) ───────────────────────────────────────────────────────
// Intro tilt: INTRO_END_TILT_X (radians). More negative ⇒ more roof. Example: THREE.MathUtils.degToRad(-8)
// Intro speed: ANIM_DURATION (ms).
// Phone motion: MOTION_GAIN (strength), MOTION_MAX (rad cap each axis), MOTION_SMOOTH (0–1, higher = snappier).
// Space under car before SearchBar: set CAR_TO_SEARCH_GAP in Homescreen.tsx.
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MODEL_HEIGHT = 280;
/** After fitting the mesh to a cube, largest axis length in scene units. */
const MODEL_TARGET_MAX_AXIS = 5;
/** Final pitch (rad) after intro — negative tips the top toward camera / “see a bit more roof”. */
const INTRO_END_TILT_X = 0.1;
/**
 * Yaw (rad) so the camera (+Z) sees the door side, not the front.
 * Use `-Math.PI / 2` if the opposite flank faces you.
 */
const MODEL_YAW_FOR_SIDE_VIEW = Math.PI / 2;
const ANIM_DURATION = 2000;
const BG_COLOR = 0xdcdbd8;
/** Max extra rotation from device motion (rad) — iOS sends pitch/roll in radians. */
const MOTION_MAX = 0.065;
/** How much device pitch/roll delta moves the model (subtle parallax). */
const MOTION_GAIN = 0.8;
/** Low-pass smoothing for motion (0–1, higher = snappier). */
const MOTION_SMOOTH = 0.6;

/**
 * When true, replaces mesh materials with view-space normal colors — not PBR textures.
 */
const USE_RAINBOW_NORMAL_PREVIEW = true;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyRainbowNormalMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const replacement = mats.map(
        () => new THREE.MeshNormalMaterial({ flatShading: false }),
      );
      obj.material = replacement.length === 1 ? replacement[0]! : replacement;
    }
  });
}

async function assetToArrayBuffer(module: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error(`Asset.downloadAsync() did not produce a localUri for module ${module}`);
  }

  return new File(asset.localUri).arrayBuffer();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function shortestAngleDeltaRad(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CarModel3D() {
  const modelRef = useRef<THREE.Group | null>(null);
  const isAnimRef = useRef(true);
  const animStartRef = useRef<number | null>(null);

  const motionBaseRef = useRef<{ beta: number; gamma: number } | null>(null);
  const motionTargetRef = useRef({ x: 0, y: 0 });
  const motionSmoothRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let subscription: { remove: () => void } | null = null;

    (async () => {
      const available = await DeviceMotion.isAvailableAsync();
      if (!available) return;

      const perm = await DeviceMotion.getPermissionsAsync();
      if (perm.status !== 'granted') {
        const req = await DeviceMotion.requestPermissionsAsync();
        if (req.status !== 'granted') return;
      }

      DeviceMotion.setUpdateInterval(50);

      subscription = DeviceMotion.addListener((measurement) => {
        if (isAnimRef.current) return;

        const { beta, gamma } = measurement.rotation;
        if (!motionBaseRef.current) {
          motionBaseRef.current = { beta, gamma };
          motionTargetRef.current = { x: 0, y: 0 };
          motionSmoothRef.current = { x: 0, y: 0 };
          return;
        }

        const db = shortestAngleDeltaRad(beta, motionBaseRef.current.beta);
        const dg = shortestAngleDeltaRad(gamma, motionBaseRef.current.gamma);

        motionTargetRef.current = {
          x: clamp(db * MOTION_GAIN, -MOTION_MAX, MOTION_MAX),
          y: clamp(dg * MOTION_GAIN, -MOTION_MAX, MOTION_MAX),
        };
      });
    })();

    return () => {
      subscription?.remove();
      motionBaseRef.current = null;
    };
  }, []);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    const renderer = new Renderer({
      gl,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(BG_COLOR, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);

    const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    camera.position.set(0, 1.2, 5);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(5, 8, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xddddff, 0.6);
    fill.position.set(-5, 3, -3);
    scene.add(fill);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const arrayBuffer = await assetToArrayBuffer(require('../../../assets/models/car.glb'));

      await new Promise<void>((resolve, reject) => {
        const loader = new GLTFLoader();
        registerGltfEmbeddedTexturesAsDataUris(loader);
        loader.parse(
          arrayBuffer,
          '',
          (gltf) => {
            const model = gltf.scene;

            const box = new THREE.Box3().setFromObject(model);
            const centre = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            model.position.sub(centre);

            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) model.scale.setScalar(MODEL_TARGET_MAX_AXIS / maxDim);

            model.rotation.set(0, MODEL_YAW_FOR_SIDE_VIEW, 0);

            if (USE_RAINBOW_NORMAL_PREVIEW) {
              applyRainbowNormalMaterials(model);
            }

            scene.add(model);
            modelRef.current = model as unknown as THREE.Group;
            resolve();
          },
          (parseErr) => {
            const msg =
              parseErr instanceof Error
                ? parseErr.message
                : JSON.stringify(parseErr) ?? String(parseErr);
            reject(new Error(`GLTFLoader.parse failed: ${msg}`));
          },
        );
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CarModel3D] Failed to load car.glb:', msg);
    }

    const loop = (time: number) => {
      requestAnimationFrame(loop);

      const model = modelRef.current;
      if (model) {
        if (isAnimRef.current) {
          if (animStartRef.current === null) animStartRef.current = time;
          const progress = Math.min((time - animStartRef.current) / ANIM_DURATION, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          model.rotation.y = MODEL_YAW_FOR_SIDE_VIEW;
          model.rotation.x = INTRO_END_TILT_X * eased;
          model.rotation.z = 0;
          if (progress >= 1) {
            isAnimRef.current = false;
            motionBaseRef.current = null;
          }
        } else {
          const t = motionTargetRef.current;
          const s = motionSmoothRef.current;
          s.x += (t.x - s.x) * MOTION_SMOOTH;
          s.y += (t.y - s.y) * MOTION_SMOOTH;
          model.rotation.x = INTRO_END_TILT_X + s.x;
          model.rotation.y = MODEL_YAW_FOR_SIDE_VIEW + s.y;
          model.rotation.z = 0;
        }
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    requestAnimationFrame(loop);
  }, []);

  return (
    <View style={styles.container}>
      <GLView style={styles.glView} onContextCreate={onContextCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: MODEL_HEIGHT,
    overflow: 'hidden',
  },
  glView: {
    flex: 1,
  },
});
