from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
import os
import uuid
import httpx
import redis
import json
from vercel_blob import generate_signed_url, vercel_blob

app = FastAPI()

# --- Configuration ---
WORKER_API_URL = os.getenv("WORKER_API_URL", "http://localhost:8001")

# --- Vercel KV (Redis) Client Setup ---
def get_redis_client():
    redis_url = os.getenv("KV_URL")
    if not redis_url:
        print("Warning: KV_URL not found. State management will not work.")
        return None
    try:
        return redis.from_url(redis_url)
    except Exception as e:
        print(f"Error connecting to Redis: {e}")
        return None

redis_client = get_redis_client()

# --- Pydantic Models ---
class UploadURLRequest(BaseModel):
    filename: str

class UploadURLResponse(BaseModel):
    uploadUrl: str
    downloadUrl: str

class StartConversionRequest(BaseModel):
    downloadUrl: str
    
class UploadResponse(BaseModel):
    uploadId: str

class ConvertedModel(BaseModel):
    url: str
    label: str

class ConversionStatus(BaseModel):
    status: str
    model_info: ConvertedModel | None = None

# --- Worker Communication ---
async def call_worker_for_conversion(upload_id: str, video_url: str, base_url: str):
    webhook_url = f"{base_url.rstrip('/')}/api/webhook/conversion-complete"
    print(f"Calling worker at {WORKER_API_URL} for uploadId: {upload_id}")

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            data = {"uploadId": upload_id, "webhookUrl": webhook_url, "videoUrl": video_url}
            response = await client.post(f"{WORKER_API_URL}/convert", data=data)
            response.raise_for_status()
    except httpx.RequestError as e:
        print(f"Error calling worker for {upload_id}: {e}")
        if redis_client:
            redis_client.hset(upload_id, "status", "failed")

# --- API Endpoints ---
@app.post("/api/upload-url", response_model=UploadURLResponse)
async def create_upload_url(request: UploadURLRequest):
    """
    Generates a pre-signed URL for the client to upload a file directly to Vercel Blob.
    """
    try:
        blob = generate_signed_url(operation='put', pathname=request.filename)
        return UploadURLResponse(uploadUrl=blob.upload_url, downloadUrl=blob.download_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {e}")

@app.post("/api/start-conversion", response_model=UploadResponse)
async def start_conversion(
    request: StartConversionRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
):
    """
    Starts the conversion process after a file has been uploaded to Vercel Blob.
    """
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")

    upload_id = str(uuid.uuid4())
    redis_client.hset(upload_id, mapping={"status": "processing", "model_info": ""})
    
    base_url = str(http_request.base_url)
    background_tasks.add_task(call_worker_for_conversion, upload_id, request.downloadUrl, base_url)

    return UploadResponse(uploadId=upload_id)


@app.post("/api/webhook/conversion-complete")
async def conversion_complete_webhook(
    uploadId: str = Form(...), 
    objFile: UploadFile = File(...)
):
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")

    if not redis_client.exists(uploadId):
        raise HTTPException(status_code=404, detail="Upload ID not found for webhook.")

    # Upload the resulting .obj file from the worker to our own Vercel Blob storage
    try:
        result_pathname = f"results/{uploadId}.obj"
        blob_result = vercel_blob.put(pathname=result_pathname, body=objFile.file.read())
        
        model_info = ConvertedModel(
            url=blob_result.url, # Use the public URL from Vercel Blob
            label=f"Model #{uploadId[:8]}"
        )
        
        redis_client.hset(uploadId, mapping={
            "status": "completed",
            "model_info": json.dumps(model_info.dict())
        })
    except Exception as e:
        print(f"Webhook error: Failed to upload result to blob or update Redis. Error: {e}")
        redis_client.hset(uploadId, "status", "failed")
        raise HTTPException(status_code=500, detail="Failed to process conversion result.")

    return JSONResponse(content={"message": "Webhook processed successfully."})

@app.get("/api/result/{upload_id}", response_model=ConversionStatus)
async def get_conversion_result(upload_id: str):
    if not redis_client:
        raise HTTPException(status_code=503, detail="Database connection not available.")

    job_data = redis_client.hgetall(upload_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Upload ID not found.")

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

# This endpoint is no longer needed as files are served from Vercel Blob directly
# @app.get("/api/result-file/{filename}")
# async def get_result_file(filename: str):
#     ...

