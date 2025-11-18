import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { NextRequest } from "next/server";

// This API route dynamically serves files from the project root directory.
// e.g., a request to /api/static/output.obj will serve the file 'output.obj' from the root.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
    const filename = slug.join("/");
    if (!filename) {
      return new NextResponse("File not specified.", { status: 400 });
    }

    // Security: Prevent path traversal attacks.
    // This ensures the path does not go outside the project root.
    const projectRoot = process.cwd();
    const requestedPath = path.join(projectRoot, filename);
    if (!requestedPath.startsWith(projectRoot)) {
        return new NextResponse("Forbidden.", { status: 403 });
    }

    // Read the file content as a string, which is what the client-side loaders expect.
    const fileContent = await fs.readFile(requestedPath, "utf-8");

    // Determine content type based on file extension
    let contentType = "application/octet-stream";
    if (filename.endsWith(".obj")) {
      contentType = "text/plain; charset=utf-8";
    } else if (filename.endsWith(".mtl")) {
      contentType = "text/plain; charset=utf-8";
    }

    // Return the content with the appropriate content type
    return new NextResponse(fileContent, {
      status: 200,
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    console.error(`Failed to read file from root:`, error);
    return new NextResponse("File not found.", { status: 404 });
  }
}
