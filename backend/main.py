from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Request, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import shutil
import os
import uuid
import httpx
import redis
import json

app = FastAPI()

# --- Configuration ---
WORKER_API_URL = os.getenv("WORKER_API_URL", "http://localhost:8001")

# --- Vercel KV (Redis) Client Setup ---
def get_redis_client():
    # Vercel KV provides the KV_URL environment variable.
    redis_url = os.getenv("KV_URL")
    if not redis_url:
        # This is a fallback for local development and will not work on Vercel
        # unless you have a local Redis instance and set KV_URL manually.
        print("Warning: KV_URL not found. State will not persist across requests.")
        return None
    try:
        # Use from_url to connect to Redis
        return redis.from_url(redis_url)
    except Exception as e:
        print(f"Error connecting to Redis: {e}")
        return None

redis_client = get_redis_client()

# In Vercel, we can only write to the /tmp directory
UPLOAD_DIR = "/tmp/uploads"
RESULT_DIR = "/tmp/results"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)

# Note: StaticFiles mounting will not work as expected in a Vercel serverless environment.
# A proper implementation would upload results to a storage service like Vercel Blob or S3.
# For now, the result URL will be relative, but serving it might require another function.
# app.mount("/results", StaticFiles(directory=RESULT_DIR), name="results")


# --- Pydantic Models (Data Structures) ---
class UploadResponse(BaseModel):
    uploadId: str

class ConvertedModel(BaseModel):
    url: str
    type: str
    label: str

class ConversionStatus(BaseModel):
    status: str
    model_info: ConvertedModel | None = None

# --- Worker Communication ---
async def call_worker_for_conversion(upload_id: str, video_path: str, base_url: str):
    webhook_url = f"{base_url.rstrip('/')}/api/webhook/conversion-complete"
    print(f"Calling worker at {WORKER_API_URL} for uploadId: {upload_id}")

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            with open(video_path, "rb") as f:
                files = {"videoFile": (os.path.basename(video_path), f, "video/mp4")}
                data = {"uploadId": upload_id, "webhookUrl": webhook_url}
                response = await client.post(f"{WORKER_API_URL}/convert", data=data, files=files)
                response.raise_for_status()
    except httpx.RequestError as e:
        print(f"Error calling worker for {upload_id}: {e}")
        if redis_client:
            redis_client.hset(upload_id, "status", "failed")

# --- API Endpoints ---
@app.post("/api/upload", response_model=UploadResponse)
async def upload_video(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...)
):
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video.")

    upload_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{upload_id}_{file.filename}")

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Set initial job status in Redis
    redis_client.hset(upload_id, mapping={"status": "processing", "model_info": ""})
    
    base_url = str(request.base_url)
    background_tasks.add_task(call_worker_for_conversion, upload_id, file_path, base_url)

    return UploadResponse(uploadId=upload_id)


@app.post("/api/webhook/conversion-complete")
async def conversion_complete_webhook(
    uploadId: str = Form(...), 
    objFile: UploadFile = File(...)
):
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")

    print(f"Received webhook for completed conversion: {uploadId}")
    
    if not redis_client.exists(uploadId):
        raise HTTPException(status_code=404, detail="Upload ID not found for webhook.")

    # In a real Vercel deployment, you'd upload this to Vercel Blob, not save locally.
    # For this example, we save to /tmp, but it's ephemeral.
    result_filename = f"{uploadId}.obj"
    result_path = os.path.join(RESULT_DIR, result_filename)
    try:
        with open(result_path, "wb") as buffer:
            shutil.copyfileobj(objFile.file, buffer)
    except Exception as e:
        # If saving fails, we don't want to leave the job in a bad state.
        # For now, we'll log it. In production, you might set status to 'failed'.
        print(f"Failed to save result file for {uploadId}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save result file: {e}")

    model_info = ConvertedModel(
        url=f"/api/result-file/{result_filename}", # This URL needs a new endpoint to serve the file
        type="obj",
        label=f"Model #{uploadId[:8]}"
    )
    
    # Update the job status to 'completed' in Redis
    redis_client.hset(uploadId, mapping={
        "status": "completed",
        "model_info": model_info.model_dump_json()
    })

    return JSONResponse(content={"message": "Webhook processed successfully."})

@app.get("/api/result/{upload_id}", response_model=ConversionStatus)
async def get_conversion_result(upload_id: str):
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")

    job_data = redis_client.hgetall(upload_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Upload ID not found.")

    # hgetall returns bytes, so we decode them
    job = {k.decode('utf-8'): v.decode('utf-8') for k, v in job_data.items()}
    status = job.get("status")
    
    if status in ("processing", "failed"):
        return ConversionStatus(status=status)
    
    if status == "completed":
        model_info_json = job.get("model_info", "{}")
        model_info_data = json.loads(model_info_json)
        return ConversionStatus(
            status="completed", 
            model_info=ConvertedModel(**model_info_data) if model_info_data else None
        )

    raise HTTPException(status_code=500, detail="Unknown job status.")

# This new endpoint serves the file from the /tmp directory.
# This is required because StaticFiles doesn't work on Vercel for the /tmp dir.
from fastapi.responses import FileResponse
@app.get("/api/result-file/{filename}")
async def get_result_file(filename: str):
    file_path = os.path.join(RESULT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type='application/octet-stream', filename=filename)
    raise HTTPException(status_code=404, detail="File not found.")

