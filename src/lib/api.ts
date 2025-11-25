export type UploadResponse = {
  uploadId: string;
};

export type ConvertedModel = {
  url: string;
  label: string;
};

export type ConversionStatus = {
  status: "processing" | "completed" | "failed";
  model_info: ConvertedModel | null;
  error?: string;
};

// This logic automatically determines the API base URL for both production (Vercel) and local environments.
let API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
// In a self-hosted scenario, VERCEL_URL will be undefined, so API_BASE_URL will correctly fall back
// to NEXT_PUBLIC_API_BASE_URL (which we set to "" for local dev, making requests relative).
if (process.env.VERCEL_URL) {
  API_BASE_URL = `https://` + process.env.VERCEL_URL;
}

const POLLING_INTERVAL_MS = 2500;
const MAX_POLLING_ATTEMPTS = 60; // 60 attempts * 2.5 seconds = 2.5 minutes timeout

/**
 * Uploads the video file directly to our self-hosted backend.
 */
export async function uploadVideo(blob: Blob, filename: string): Promise<UploadResponse> {
  if (!blob || blob.size === 0) {
    throw new Error("The video to convert is missing.");
  }

  const formData = new FormData();
  formData.append("file", blob, filename);

  // POST the file directly to the new /api/upload endpoint
  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload video: ${response.status} ${errorText}`);
  }

  // The backend now directly returns the job/upload ID
  return response.json();
}

/**
 * Polls the backend server for the result of the conversion.
 */
export async function fetchConvertedModel(uploadId: string): Promise<ConvertedModel> {
  // We use a relative path for API_BASE_URL in local dev, so this works.
  const pollUrl = `${API_BASE_URL}/api/result/${uploadId}`;

  for (let i = 0; i < MAX_POLLING_ATTEMPTS; i++) {
    const response = await fetch(pollUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch conversion status: ${response.status}`);
    }

    const result: ConversionStatus = await response.json();

    if (result.status === "completed" && result.model_info) {
      // The backend now returns a relative URL to the download endpoint, e.g., /api/download-result/{job_id}
      // The browser will resolve this correctly.
      return result.model_info;
    }

    if (result.status === "failed") {
      throw new Error(`Model conversion failed on the server. Reason: ${result.error || 'Unknown'}`);
    }

    // Wait for the specified interval before the next attempt
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  // If the loop finishes without returning, it means we've timed out
  throw new Error("Model conversion timed out.");
}
