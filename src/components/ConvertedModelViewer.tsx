"use client";

import { Suspense, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Mesh, MeshStandardMaterial } from "three";

type ConvertedModelViewerProps = {
  modelUrl: string;
  onLoaded?: () => void;
};

function ObjectModel({ url, onLoaded }: { url: string; onLoaded?: () => void }) {
  const object = useLoader(OBJLoader, url);

  useEffect(() => {
    object.traverse((child) => {
      if (child instanceof Mesh) {
        // Apply a standard material to the mesh
        child.material = new MeshStandardMaterial({
          color: "#eee", // A light grey color
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
  }, [object, onLoaded]);

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
            <ObjectModel url={modelUrl} onLoaded={onLoaded} />
          </group>
          <Environment preset="city" />
        </Suspense>

        {/* Add a ground plane to receive shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <shadowMaterial opacity={0.3} />
        </mesh>
        
        <OrbitControls enablePan enableZoom enableRotate />
      </Canvas>
    </div>
  );
}
