export type UploadResponse = {
  uploadId: string;
};

export type ConvertedModel = {
  url: string;
  type: "obj" | "stl";
  label: string;
};

export type ConversionStatus = {
  status: "processing" | "completed";
  model_info: ConvertedModel | null;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

/**
 * Uploads the video to the backend server and returns an upload ID.
 */
export async function uploadVideo(blob: Blob): Promise<UploadResponse> {
  if (!blob || blob.size === 0) {
    throw new Error("The video to convert is missing.");
  }

  if (!API_BASE_URL) {
    console.warn(
      "NEXT_PUBLIC_API_BASE_URL is not set. Using mock data. See instructions for running a local backend.",
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
    // Return mock data if the backend URL is not set
    await new Promise((resolve) => setTimeout(resolve, 10000)); // 10-second delay
    return {
      url: `/output.obj`, // Points to /public/output.obj
      type: "obj",
      label: `Custom Mockup`,
    };
  }

  // Poll the result endpoint until the status is 'completed'
  while (true) {
    const response = await fetch(`${API_BASE_URL}/api/result/${uploadId}`);
    if (!response.ok) {
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

    // Wait for 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
