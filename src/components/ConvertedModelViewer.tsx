"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";

type ConvertedModelViewerProps = {
  modelUrl: string;
  onLoaded?: () => void;
};

function ObjectModel({
  url,
  onLoaded,
  setOrbitTarget,
}: {
  url: string;
  onLoaded?: () => void;
  setOrbitTarget: (target: [number, number, number]) => void;
}) {
  const object = useLoader(OBJLoader, url);

  useEffect(() => {
    // This effect runs once after the model has loaded
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());

    // Set the orbit controls target to the center of the model
    setOrbitTarget([center.x, center.y, center.z]);

    object.traverse((child) => {
      if (child instanceof Mesh) {
        // Apply a standard material to the mesh
        child.material = new MeshStandardMaterial({
          vertexColors: true, // Use vertex colors from the model
          side: 2, // THREE.DoubleSide
          metalness: 0.1,
          roughness: 0.6,
        });
        // Ensure all meshes can cast shadows
        child.castShadow = true;
      }
    });

    // Fire the onLoaded callback once the object is loaded and processed.
    onLoaded?.();
  }, [object, onLoaded, setOrbitTarget]);

  return <primitive object={object} />;
}

function CanvasFallback() {
  return (
    <Html center>
      <div className="flex min-w-[140px] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/70 px-5 py-4 text-xs text-slate-100 shadow-lg shadow-sky-500/20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        <span className="text-xs font-medium tracking-wide">모델 로딩 중…</span>
      </div>
    </Html>
  );
}

export function ConvertedModelViewer({
  modelUrl,
  onLoaded,
}: ConvertedModelViewerProps) {
  const [orbitTarget, setOrbitTarget] = useState<[number, number, number]>([0, 0, 0]);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position: [0, 2, 5], fov: 50 }} dpr={[1, 2]}>
        <hemisphereLight intensity={0.2} groundColor="black" />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={1.5}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-5, 3, 2]} intensity={0.7} />

        <Suspense fallback={<CanvasFallback />}>
          <group scale={1.4}>
            <ObjectModel url={modelUrl} onLoaded={onLoaded} setOrbitTarget={setOrbitTarget} />
          </group>
          <Environment preset="city" />
        </Suspense>

        {/* Add a ground plane to receive shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <shadowMaterial opacity={0.3} />
        </mesh>
        
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          target={orbitTarget} // Set the rotation center dynamically
        />
      </Canvas>
    </div>
  );
}
