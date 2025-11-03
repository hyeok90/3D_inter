export type UploadResponse = {
  uploadId: string;
};

export type ConvertedModel = {
  url: string;
  type: "obj" | "stl";
  label: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/**
 * Placeholder upload implementation. Replace with a POST to FastAPI `/api/upload` when backend is ready.
 */
export async function uploadVideo(blob: Blob): Promise<UploadResponse> {
  if (!blob || blob.size === 0) {
    throw new Error("녹화된 영상이 없습니다.");
  }

  if (API_BASE_URL) {
    console.info("uploadVideo: Replace this stub with POST", `${API_BASE_URL}/api/upload`);
  }

  // Simulate network latency so UI states can be tested now.
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    uploadId: "mock-upload-id",
  };
}

/**
 * Placeholder fetch implementation. Replace with GET to FastAPI `/api/result/:id` when backend is ready.
 */
export async function fetchConvertedModel(uploadId: string): Promise<ConvertedModel> {
  if (API_BASE_URL) {
    console.info("fetchConvertedModel: Replace this stub with GET", `${API_BASE_URL}/api/result/:id`);
  }

  // Simulate conversion time.
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    url: `/models/demo-mesh.obj?mock=${uploadId}`,
    type: "obj",
    label: `Demo star mesh · Backend not connected yet (#${uploadId})`,
  };
}
