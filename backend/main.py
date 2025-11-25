from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Request, Form
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import shutil
import os
import uuid
import httpx

app = FastAPI()

# --- Configuration ---
# This is the address of your external GPU worker.
# You must change this to the actual address of your worker.
WORKER_API_URL = os.getenv("WORKER_API_URL", "http://localhost:8001")


# --- Directories Setup ---
UPLOAD_DIR = "uploads"
RESULT_DIR = "results"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)

# Mount the results directory to serve the final .obj files
app.mount("/results", StaticFiles(directory=RESULT_DIR), name="results")

# --- Pydantic Models (Data Structures) ---
class UploadResponse(BaseModel):
    uploadId: str

class ConvertedModel(BaseModel):
    url: str
    label: str

class ConversionStatus(BaseModel):
    status: str
    model_info: ConvertedModel | None = None

# --- In-memory database to track conversion status ---
conversion_jobs = {}

# --- Worker Communication ---
async def call_worker_for_conversion(upload_id: str, video_path: str, base_url: str):
    """
    Calls the external worker API to process the video.
    This runs in a background task.
    """
    webhook_url = f"{base_url.rstrip('/')}/api/webhook/conversion-complete"
    print(f"Calling worker at {WORKER_API_URL} for uploadId: {upload_id}")

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            with open(video_path, "rb") as f:
                files = {"videoFile": (os.path.basename(video_path), f, "video/mp4")}
                data = {"uploadId": upload_id, "webhookUrl": webhook_url}
                
                response = await client.post(f"{WORKER_API_URL}/convert", data=data, files=files)
                response.raise_for_status() # Raise an exception for 4xx or 5xx status codes

    except httpx.RequestError as e:
        print(f"Error calling worker for {upload_id}: {e}")
        conversion_jobs[upload_id] = {"status": "failed", "model_info": None}


# --- API Endpoints ---
@app.post("/api/upload", response_model=UploadResponse)
async def upload_video(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...)
):
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video.")

    upload_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{upload_id}_{file.filename}")

    # Save the uploaded video file
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Set initial job status
    conversion_jobs[upload_id] = {"status": "processing", "model_info": None}
    
    # Delegate the heavy processing to the worker in the background
    base_url = str(request.base_url)
    background_tasks.add_task(call_worker_for_conversion, upload_id, file_path, base_url)

    return UploadResponse(uploadId=upload_id)


@app.post("/api/webhook/conversion-complete")
async def conversion_complete_webhook(
    uploadId: str = Form(...), 
    objFile: UploadFile = File(...)
):
    """
    This endpoint is called by the worker when the conversion is finished.
    """
    print(f"Received webhook for completed conversion: {uploadId}")
    
    # 1. Check if the job exists
    if uploadId not in conversion_jobs:
        raise HTTPException(status_code=404, detail="Upload ID not found for webhook.")

    # 2. Save the resulting .obj file
    result_filename = f"{uploadId}.obj"
    result_path = os.path.join(RESULT_DIR, result_filename)
    try:
        with open(result_path, "wb") as buffer:
            shutil.copyfileobj(objFile.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save result file: {e}")

    # 3. Update the job status to 'completed'
    model_info = ConvertedModel(
        url=f"/results/{result_filename}",
        label=f"Model #{uploadId[:8]}"
    )
    conversion_jobs[uploadId] = {"status": "completed", "model_info": model_info}

    return JSONResponse(content={"message": "Webhook processed successfully."})


@app.get("/api/result/{upload_id}", response_model=ConversionStatus)
async def get_conversion_result(upload_id: str):
    job = conversion_jobs.get(upload_id)

    if not job:
        raise HTTPException(status_code=404, detail="Upload ID not found.")
    
    status = job.get("status")
    
    if status in ("processing", "failed"):
        return ConversionStatus(status=status)
    
    if status == "completed":
        return ConversionStatus(status="completed", model_info=job["model_info"])

    raise HTTPException(status_code=500, detail="Unknown job status.")
