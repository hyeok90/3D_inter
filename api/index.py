import os
import uuid
import asyncio
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

# --- Configuration ---
# Allow all origins for simplicity in a local environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKER_URL = os.environ.get("WORKER_URL", "http://localhost:8001")
UPLOADS_DIR = "worker_uploads"
RESULTS_DIR = "worker_results"

# In-memory dictionary to act as a simple database for job tracking
JOBS = {}

# --- Helper Functions ---
def cleanup_files(files_to_delete: list[str]):
    """Delete files in the background."""
    for file_path in files_to_delete:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Cleaned up file: {file_path}")
        except OSError as e:
            print(f"Error cleaning up file {file_path}: {e}")

async def call_worker_for_conversion(job_id: str, video_path: str):
    """Asynchronously calls the worker to start the conversion process."""
    # Assuming orchestrator is reachable via localhost from the worker
    # If running in different containers/machines, this needs to be the orchestrator's reachable IP
    webhook_url = f"http://localhost:8000/api/webhook/conversion-complete"
    
    async with httpx.AsyncClient(timeout=None) as client:
        try:
            # The worker now expects a path, not a URL
            await client.post(
                f"{WORKER_URL}/convert",
                json={"job_id": job_id, "video_path": os.path.abspath(video_path), "webhook_url": webhook_url},
            )
        except httpx.RequestError as e:
            print(f"Error calling worker: {e}")
            JOBS[job_id] = {"status": "failed", "error": "Worker could not be reached."}

# --- Endpoints ---
@app.on_event("startup")
def startup_event():
    """Create necessary directories on server startup."""
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

@app.post("/api/upload")
async def upload_video_for_conversion(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """
    Accepts a video upload, saves it locally, and triggers the conversion worker.
    """
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a video.")

    job_id = str(uuid.uuid4())
    # Use a generic extension for simplicity, or derive properly
    video_path = os.path.join(UPLOADS_DIR, f"{job_id}.tmp")

    # Save the uploaded file locally
    try:
        with open(video_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")


    # Set initial job status
    JOBS[job_id] = {"status": "processing", "input_path": video_path}

    # Trigger worker in the background
    background_tasks.add_task(call_worker_for_conversion, job_id, video_path)

    return JSONResponse(content={"uploadId": job_id})

@app.post("/api/webhook/conversion-complete")
async def conversion_complete_webhook(payload: dict):
    """Webhook for the worker to call when conversion is done."""
    job_id = payload.get("job_id")
    result_path = payload.get("result_path")

    if not job_id or job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job ID not found.")

    if not result_path or not os.path.exists(result_path):
        JOBS[job_id] = {"status": "failed", "error": "Worker did not provide a valid result."}
        raise HTTPException(status_code=400, detail="Invalid result path from worker.")

    JOBS[job_id].update({"status": "completed", "result_path": result_path})
    return JSONResponse(content={"message": "Webhook received successfully."})

@app.get("/api/result/{job_id}")
def get_conversion_result(job_id: str):
    """Pollable endpoint for the frontend to check the conversion status."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job["status"] == "completed":
        return {"status": "completed", "model_info": {"url": f"/api/download-result/{job_id}", "label": f"{job_id}.obj"}}
    else:
        return {"status": job["status"], "error": job.get("error")}

@app.get("/api/download-result/{job_id}")
async def download_result(job_id: str, background_tasks: BackgroundTasks):
    """Serves the final .obj file and then cleans it up along with the original upload."""
    job = JOBS.get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Result not ready or job not found.")

    result_path = job.get("result_path")
    input_path = job.get("input_path") # Original video file
    
    if not result_path or not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="Result file not found.")

    # Schedule both original and result files for cleanup
    files_to_delete = [result_path]
    if input_path:
        files_to_delete.append(input_path)
    background_tasks.add_task(cleanup_files, files_to_delete)
    
    # Immediately remove the job from tracking
    JOBS.pop(job_id, None)

    return FileResponse(
        path=result_path,
        media_type="application/octet-stream",
        filename=f"{job_id}.obj",
    )

