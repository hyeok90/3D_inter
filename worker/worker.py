import os
import shutil
import uuid
import httpx
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks, HTTPException

# --- Worker App ---
app = FastAPI()

# --- Directories Setup ---
WORKER_UPLOAD_DIR = "worker_uploads"
WORKER_RESULT_DIR = "worker_results"
os.makedirs(WORKER_UPLOAD_DIR, exist_ok=True)
os.makedirs(WORKER_RESULT_DIR, exist_ok=True)


# --- Actual 3D Model Conversion Logic ---
def run_vggt_conversion(video_path: str, output_obj_path: str):
    """
    THIS IS WHERE YOU INTEGRATE YOUR REAL VGGT MODEL.
    
    This function takes an input video file path and should produce
    an .obj file at the specified output path.
    """
    print(f"Starting actual GPU conversion for: {video_path}")
    
    # ==============================================================================
    # TODO: Replace this mock logic with your actual model inference code.
    #
    # 1. Load your VGGT model.
    #    model = load_vggt_model()
    #
    # 2. Preprocess the video file at `video_path`.
    #    frames = preprocess_video(video_path)
    #
    # 3. Run the model inference.
    #    obj_content = model.predict(frames)
    #
    # 4. Save the output to `output_obj_path`.
    #
    # ==============================================================================

    # For now, we'll simulate a long process and create a mock file.
    import time
    time.sleep(15) # Simulate a 15-second GPU conversion time.
    
    mock_obj_content = f"""
# Mock OBJ file from worker for video: {os.path.basename(video_path)}
# Generated after a simulated 15-second process.
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
    with open(output_obj_path, "w") as f:
        f.write(mock_obj_content)
        
    print(f"Finished GPU conversion. Output saved to: {output_obj_path}")


# --- Background Task for Conversion and Webhook ---
async def process_and_notify(
    upload_id: str,
    video_path: str,
    webhook_url: str
):
    """
    Runs the conversion and sends the result back to the main app's webhook.
    """
    result_obj_filename = f"{upload_id}.obj"
    result_obj_path = os.path.join(WORKER_RESULT_DIR, result_obj_filename)
    
    # 1. Run the actual conversion
    try:
        run_vggt_conversion(video_path, result_obj_path)
    except Exception as e:
        print(f"Conversion failed for {upload_id}: {e}")
        # Optionally, you could add a webhook call here to notify failure
        return

    # 2. Send the result back to the main app's webhook
    print(f"Sending result for {upload_id} to webhook: {webhook_url}")
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            with open(result_obj_path, "rb") as f:
                files = {"objFile": (result_obj_filename, f, "application/octet-stream")}
                data = {"uploadId": upload_id}
                
                response = await client.post(webhook_url, data=data, files=files)
                response.raise_for_status()
                print(f"Successfully sent webhook for {upload_id}")

    except httpx.RequestError as e:
        print(f"Failed to send webhook for {upload_id}: {e}")
    finally:
        # Clean up the temporary files on the worker
        os.remove(video_path)
        os.remove(result_obj_path)


# --- Worker API Endpoint ---
@app.post("/convert")
async def convert_video(
    background_tasks: BackgroundTasks,
    uploadId: str = Form(...),
    webhookUrl: str = Form(...),
    videoFile: UploadFile = File(...),
):
    """
    Receives a video file from the main app, processes it in the background,
    and calls a webhook upon completion.
    """
    try:
        # Save the uploaded file temporarily on the worker
        video_path = os.path.join(WORKER_UPLOAD_DIR, f"{uploadId}_{videoFile.filename}")
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(videoFile.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file on worker: {e}")

    print(f"Worker received job: {uploadId}. Starting conversion in background.")
    
    # Add the long-running task to the background
    background_tasks.add_task(process_and_notify, uploadId, video_path, webhookUrl)
    
    # Immediately return a response to the main app
    return {"message": "Conversion task accepted and is running in the background."}

# --- Health Check Endpoint ---
@app.get("/")
def health_check():
    return {"status": "Worker is alive"}

