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

// Vercel-deployed frontend needs to know the URL of its own backend.
// This logic automatically determines the API base URL for both production (Vercel) and local environments.
let API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
if (process.env.VERCEL_URL) {
  // In a Vercel environment, VERCEL_URL is the domain of the deployment.
  API_BASE_URL = `https://` + process.env.VERCEL_URL;
}

/**
 * Uploads the video to the backend server and returns an upload ID.
 */
export async function uploadVideo(blob: Blob): Promise<UploadResponse> {
  if (!blob || blob.size === 0) {
    throw new Error("The video to convert is missing.");
  }

  if (!API_BASE_URL) {
    console.warn(
      "NEXT_PUBLIC_API_BASE_URL is not set. Using mock data for upload. Polling will fail.",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { uploadId: "mock-id-for-ui-testing" };
  }

  const formData = new FormData();
  formData.append("file", blob, "video.webm");

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload video: ${response.status} ${errorText}`);
  }

  return response.json();
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
      // Stop polling if the server gives an error response
      throw new Error(`Failed to fetch conversion status: ${response.status}`);
    }

    const result: ConversionStatus = await response.json();

    if (result.status === "completed" && result.model_info) {
      // The backend returns a relative URL, so we prepend the base URL
      // to make it absolute for the 3D viewer component.
      return {
        ...result.model_info,
        url: `${API_BASE_URL}${result.model_info.url}`,
      };
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
