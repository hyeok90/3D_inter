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
};

// This logic automatically determines the API base URL for both production (Vercel) and local environments.
let API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
if (process.env.VERCEL_URL) {
  API_BASE_URL = `https://` + process.env.VERCEL_URL;
}

const POLLING_INTERVAL_MS = 2500;
const MAX_POLLING_ATTEMPTS = 60; // 60 attempts * 2.5 seconds = 2.5 minutes timeout

/**
 * Orchestrates the direct-to-blob upload process and starts the conversion.
 */
export async function uploadVideo(blob: Blob, filename: string): Promise<UploadResponse> {
  if (!blob || blob.size === 0) {
    throw new Error("The video to convert is missing.");
  }
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is not set. Cannot process upload.");
  }

  // 1. Get a pre-signed URL from our backend for direct blob upload.
  const uploadUrlResponse = await fetch(`${API_BASE_URL}/api/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!uploadUrlResponse.ok) {
    throw new Error("Failed to get a pre-signed URL for upload.");
  }
  const { uploadUrl, downloadUrl } = await uploadUrlResponse.json();

  // 2. Upload the file directly to Vercel Blob using the pre-signed URL.
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
  });
  if (!uploadResponse.ok) {
    throw new Error("Failed to upload file to Blob storage.");
  }

  // 3. Notify our backend that the upload is complete and start the conversion.
  const startResponse = await fetch(`${API_BASE_URL}/api/start-conversion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ downloadUrl }),
  });
  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new Error(`Failed to start conversion: ${startResponse.status} ${errorText}`);
  }

  return startResponse.json();
}

/**
 * Polls the backend server for the result of the conversion.
 */
export async function fetchConvertedModel(uploadId: string): Promise<ConvertedModel> {
  if (!API_BASE_URL) {
    throw new Error("Cannot fetch model result because API_BASE_URL is not set.");
  }

  for (let i = 0; i < MAX_POLLING_ATTEMPTS; i++) {
    const response = await fetch(`${API_BASE_URL}/api/result/${uploadId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch conversion status: ${response.status}`);
    }

    const result: ConversionStatus = await response.json();

    if (result.status === "completed" && result.model_info) {
      // The backend now returns a full, absolute URL from Vercel Blob.
      // No need to prepend the base URL.
      return result.model_info;
    }

    if (result.status === "failed") {
      throw new Error("Model conversion failed on the server.");
    }

    // Wait for the specified interval before the next attempt
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  // If the loop finishes without returning, it means we've timed out
  throw new Error("Model conversion timed out.");
}
