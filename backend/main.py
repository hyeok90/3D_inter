from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import shutil
import os
import uuid
import threading

app = FastAPI()

# --- Directories Setup ---
# Create directories for uploads and results
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
    type: str
    label: str

class ConversionStatus(BaseModel):
    status: str
    model_info: ConvertedModel | None = None

# --- In-memory database to track conversion status ---
# In a production environment, you would use a real database like Redis or a database.
conversion_jobs = {}

# --- VGGT Model Processing Function ---
def process_video_with_vggt(upload_id: str, video_path: str):
    """
    This is where you integrate the VGGT model.
    This function runs in a background thread to avoid blocking the API.
    """
    print(f"Starting VGGT conversion for uploadId: {upload_id}...")
    
    # 1. Load your VGGT model.
    #    model = load_vggt_model()

    # 2. Preprocess the video file at `video_path`.
    #    frames = preprocess_video(video_path)

    # 3. Run the model inference.
    #    obj_content = model.predict(frames)
    
    # For now, we'll simulate a long process and create a mock file.
    import time
    time.sleep(10) # Simulate a 10-second conversion time.
    
    mock_obj_content = f"""
# Mock OBJ file for uploadId: {upload_id}
# Generated after a simulated 10-second process.
v 1.0 1.0 -1.0
v 1.0 -1.0 -1.0
v 1.0 1.0 1.0
v 1.0 -1.0 1.0
v -1.0 1.0 -1.0
v -1.0 -1.0 -1.0
v -1.0 1.0 1.0
v -1.0 -1.0 1.0
f 1 2 4 3
f 5 6 8 7
f 1 5 7 3
f 2 6 8 4
f 1 5 6 2
f 3 7 8 4
"""
    result_filename = f"{upload_id}.obj"
    result_path = os.path.join(RESULT_DIR, result_filename)
    with open(result_path, "w") as f:
        f.write(mock_obj_content)

    # 4. Update the job status to 'completed'.
    model_info = ConvertedModel(
        url=f"/results/{result_filename}",
        type="obj",
        label=f"VGGT Model #{upload_id[:8]}"
    )
    conversion_jobs[upload_id] = {"status": "completed", "model_info": model_info}
    
    print(f"Finished VGGT conversion for uploadId: {upload_id}")


# --- API Endpoints ---
@app.post("/api/upload", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)):
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

    # Update job status and start background processing
    conversion_jobs[upload_id] = {"status": "processing", "model_info": None}
    
    # Run the heavy processing in a background thread
    thread = threading.Thread(target=process_video_with_vggt, args=(upload_id, file_path))
    thread.start()

    return UploadResponse(uploadId=upload_id)


@app.get("/api/result/{upload_id}", response_model=ConversionStatus)
async def get_conversion_result(upload_id: str):
    job = conversion_jobs.get(upload_id)

    if not job:
        raise HTTPException(status_code=404, detail="Upload ID not found.")

    if job["status"] == "processing":
        return ConversionStatus(status="processing")
    
    if job["status"] == "completed":
        return ConversionStatus(status="completed", model_info=job["model_info"])

    raise HTTPException(status_code=500, detail="Unknown job status.")
