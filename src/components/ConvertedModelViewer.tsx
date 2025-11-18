"use client";

import { Suspense, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Mesh, MeshStandardMaterial } from "three";

export type ModelType = "obj" | "stl";

type ConvertedModelViewerProps = {
  modelUrl: string;
  modelType: ModelType;
  onLoaded?: () => void;
};

function ObjModel({ url, onLoaded }: { url: string; onLoaded?: () => void }) {
  // From the obj url, derive the mtl url.
  const mtlUrl = url.replace(/\.obj$/, ".mtl");
  
  // Load the materials first
  const materials = useLoader(MTLLoader, mtlUrl);
  
  // Load the object, and apply the materials
  const object = useLoader(OBJLoader, url, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useEffect(() => {
    object.traverse((child) => {
      if (child instanceof Mesh) {
        // Apply DoubleSide rendering to all materials to fix invisible faces
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => {
            material.side = 2; // THREE.DoubleSide
          });
        } else {
          child.material.side = 2; // THREE.DoubleSide
        }
        // Ensure all meshes can cast shadows
        child.castShadow = true;
      }
    });
    
    // Fire the onLoaded callback once the object is loaded.
    onLoaded?.();
  }, [object, onLoaded]);

  return <primitive object={object} />;
}

function StlModel({ url, onLoaded }: { url: string; onLoaded?: () => void }) {
  const geometry = useLoader(STLLoader, url);

  useEffect(() => {
    onLoaded?.();
  }, [onLoaded, geometry]);

  return (
    <mesh geometry={geometry as unknown as Mesh["geometry"]}>
      <meshStandardMaterial color="#8ec5ff" metalness={0.1} roughness={0.4} />
    </mesh>
  );
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

function ModelHost({
  modelUrl,
  modelType,
  onLoaded,
}: ConvertedModelViewerProps) {
  if (modelType === "stl") {
    return <StlModel url={modelUrl} onLoaded={onLoaded} />;
  }
  return <ObjModel url={modelUrl} onLoaded={onLoaded} />;
}

export function ConvertedModelViewer({
  modelUrl,
  modelType,
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
            <ModelHost modelType={modelType} modelUrl={modelUrl} onLoaded={onLoaded} />
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
