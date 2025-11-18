import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export async function GET() {
  try {
    // Get the project root directory
    const projectRoot = process.cwd();
    // Create the full path to the output.obj file
    const filePath = path.join(projectRoot, "output.obj");

    // Read the file content
    const fileContent = await fs.readFile(filePath, "utf-8");

    // Return the content with the appropriate content type
    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  } catch (error) {
    console.error("Failed to read mock model file:", error);
    return new NextResponse("Mock model file not found.", { status: 404 });
  }
}
