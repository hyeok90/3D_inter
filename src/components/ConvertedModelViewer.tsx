"use client";

import { Suspense, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Mesh } from "three";

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
      <Canvas camera={{ position: [1.6, 1.2, 1.6], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 3, 4]} intensity={0.9} />
        <Suspense fallback={<CanvasFallback />}>
          <group scale={1.4}>
            <ModelHost modelType={modelType} modelUrl={modelUrl} onLoaded={onLoaded} />
          </group>
          <Environment preset="city" />
        </Suspense>
        <OrbitControls enablePan enableZoom enableRotate />
      </Canvas>
    </div>
  );
}
