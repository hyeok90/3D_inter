import os
import shutil
import uuid
import httpx
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List
import gc
import sys

# --- VGGT and ML Imports ---
import cv2
import torch
import numpy as np
import open3d as o3d
from vggt.models.vggt import VGGT
from vggt.utils.load_fn import load_and_preprocess_images
from vggt.utils.pose_enc import pose_encoding_to_extri_intri
from vggt.utils.geometry import unproject_depth_map_to_point_map

# --- Global model instance ---
device = "cuda" if torch.cuda.is_available() else "cpu"
model = None

def load_model():
    """Load VGGT model once at startup"""
    global model
    if model is not None:
        return
    print("Initializing and loading VGGT model...")
    try:
        model = VGGT()
        _URL = "https://huggingface.co/facebook/VGGT-1B/resolve/main/model.pt"
        model.load_state_dict(torch.hub.load_state_dict_from_url(_URL))
        model.eval()
        model = model.to(device)
        print(f"Model loaded successfully on {device}")
    except Exception as e:
        print(f"FATAL: Could not load VGGT model: {e}")
        # In a real scenario, you might want to exit if the model fails to load.
        # For now, we'll let it run and it will fail on request.
        model = None


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    """Load model when server starts"""
    load_model()
    yield
    # Cleanup on shutdown
    global model
    del model
    gc.collect()
    torch.cuda.empty_cache()
    print("Shutting down and cleaning up resources...")

# --- Worker App ---
app = FastAPI(lifespan=lifespan)

# --- Directories Setup ---
# All processing happens in temporary directories, so these are not strictly needed
# but can be useful for debugging if you disable cleanup.
WORKER_UPLOAD_DIR = "worker_uploads"
WORKER_RESULT_DIR = "worker_results"
os.makedirs(WORKER_UPLOAD_DIR, exist_ok=True)
os.makedirs(WORKER_RESULT_DIR, exist_ok=True)


# --- Actual 3D Model Conversion Logic (from reference.py) ---

def extract_frames_from_video(video_path: str, output_dir: str, fps: float = 1.0) -> List[str]:
    print(f"Extracting frames from video: {video_path}")
    vs = cv2.VideoCapture(video_path)
    video_fps = vs.get(cv2.CAP_PROP_FPS)
    if video_fps == 0:
        raise ValueError("Could not get video FPS. The video file may be corrupt or invalid.")
    frame_interval = int(video_fps * (1.0 / fps))
    
    image_paths = []
    count = 0
    frame_num = 0
    
    while True:
        gotit, frame = vs.read()
        if not gotit:
            break
        
        # Ensure we read frames at the correct interval
        if count % frame_interval == 0:
            image_path = os.path.join(output_dir, f"{frame_num:06d}.png")
            cv2.imwrite(image_path, frame)
            image_paths.append(image_path)
            frame_num += 1
        count += 1
    
    vs.release()
    print(f"Extracted {len(image_paths)} frames")
    return sorted(image_paths)

def run_model_inference(target_dir: str, model_instance) -> dict:
    print(f"Processing images from {target_dir}")
    if model_instance is None:
        raise RuntimeError("VGGT model is not loaded.")

    image_names = glob.glob(os.path.join(target_dir, "*"))
    image_names = sorted(image_names)
    print(f"Found {len(image_names)} images for inference.")
    
    if len(image_names) == 0:
        raise ValueError("No images found to process.")

    images = load_and_preprocess_images(image_names).to(device)
    print(f"Preprocessed images tensor shape: {images.shape}")

    print("Running model inference...")
    dtype = torch.bfloat16 if torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8 else torch.float16
    
    with torch.no_grad():
        with torch.cuda.amp.autocast(dtype=dtype):
            predictions = model_instance(images)

    print("Converting pose encoding...")
    extrinsic, intrinsic = pose_encoding_to_extri_intri(predictions["pose_enc"], images.shape[-2:])
    predictions["extrinsic"] = extrinsic
    predictions["intrinsic"] = intrinsic

    for key in predictions.keys():
        if isinstance(predictions[key], torch.Tensor):
            predictions[key] = predictions[key].cpu().numpy().squeeze(0)
    
    print("Computing world points from depth map...")
    depth_map = predictions["depth"]
    world_points = unproject_depth_map_to_point_map(depth_map, predictions["extrinsic"], predictions["intrinsic"])
    predictions["world_points_from_depth"] = world_points

    return predictions

def predictions_to_obj(predictions: dict, obj_path: str, conf_thres: float = 50.0, poisson_depth: int = 8):
    print(f"Creating OBJ mesh with Poisson reconstruction: {obj_path}")
    
    pred_world_points = predictions["world_points_from_depth"]
    pred_world_points_conf = predictions.get("depth_conf", np.ones_like(pred_world_points[..., 0]))
    images = predictions["images"]
    
    vertices_3d = pred_world_points.reshape(-1, 3)
    colors_rgb = np.transpose(images, (0, 2, 3, 1))
    colors_rgb = colors_rgb.reshape(-1, 3)
    
    confidence_flat = pred_world_points_conf.reshape(-1)
    conf_threshold_val = np.percentile(confidence_flat, conf_thres)
    valid_mask = confidence_flat >= conf_threshold_val
    
    filtered_vertices = vertices_3d[valid_mask]
    filtered_colors = colors_rgb[valid_mask]
    
    print(f"Creating point cloud with {len(filtered_vertices)} points...")
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(filtered_vertices)
    pcd.colors = o3d.utility.Vector3dVector(filtered_colors)
    
    print("Estimating normals...")
    pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.05, max_nn=20))
    pcd.orient_normals_consistent_tangent_plane(k=15)
    
    print(f"Running Poisson surface reconstruction (depth={poisson_depth})...")
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=poisson_depth)
    
    print("Cleaning mesh...")
    vertices_to_remove = densities < np.quantile(densities, 0.01)
    mesh.remove_vertices_by_mask(vertices_to_remove)
    
    print(f"Exporting to OBJ: {obj_path}")
    o3d.io.write_triangle_mesh(obj_path, mesh, write_vertex_colors=True)
    print(f"OBJ mesh created. Vertices: {len(mesh.vertices)}, Triangles: {len(mesh.triangles)}")


# --- Background Task for Conversion and Webhook ---
async def process_and_notify(upload_id: str, video_url: str, webhook_url: str):
    """
    Downloads the video from a URL, runs the full conversion pipeline, 
    and sends the result back to the main app's webhook.
    """
    temp_dir = Path(WORKER_RESULT_DIR) / upload_id
    images_dir = temp_dir / "images"
    os.makedirs(images_dir, exist_ok=True)
    
    temp_video_path = str(temp_dir / f"{upload_id}_source_video.mp4")
    result_obj_filename = f"{upload_id}.obj"
    result_obj_path = str(temp_dir / result_obj_filename)
    
    try:
        # 1. Download the video from the provided URL
        print(f"Downloading video from: {video_url}")
        async with httpx.AsyncClient(timeout=None) as client:
            with open(temp_video_path, "wb") as f:
                async with client.stream("GET", video_url) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
        print(f"Video downloaded to: {temp_video_path}")

        # 2. Extract frames from the downloaded video
        extract_frames_from_video(temp_video_path, str(images_dir), fps=3.0)

        # 3. Run model inference
        predictions = run_model_inference(str(images_dir), model)
        
        # 4. Create OBJ file
        predictions_to_obj(predictions, result_obj_path, conf_thres=50.0, poisson_depth=8)
        
        # Clean up model-related resources
        del predictions
        gc.collect()
        torch.cuda.empty_cache()

        # 5. Send the result back to the main app's webhook
        print(f"Sending result for {upload_id} to webhook: {webhook_url}")
        async with httpx.AsyncClient(timeout=None) as client:
            with open(result_obj_path, "rb") as f:
                files = {"objFile": (result_obj_filename, f, "application/octet-stream")}
                data = {"uploadId": upload_id}
                response = await client.post(webhook_url, data=data, files=files)
                response.raise_for_status()
                print(f"Successfully sent webhook for {upload_id}")

    except Exception as e:
        print(f"FATAL: Conversion pipeline failed for {upload_id}: {e}")
    finally:
        # 6. Clean up all temporary files and directories for this job
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        print(f"Cleaned up all temporary files for job {upload_id}")


# --- Worker API Endpoint ---
@app.post("/convert")
async def convert_video(
    background_tasks: BackgroundTasks,
    uploadId: str = Form(...),
    webhookUrl: str = Form(...),
    videoUrl: str = Form(...),
):
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded. Worker is not ready.")

    print(f"Worker received job: {uploadId}. Starting conversion in background.")
    
    # Add the long-running task to the background
    background_tasks.add_task(process_and_notify, uploadId, videoUrl, webhookUrl)
    
    # Immediately return a response to the main app
    return {"message": "Conversion task accepted and is running in the background."}

# --- Health Check Endpoint ---
@app.get("/")
def health_check():
    return {
        "status": "Worker is alive",
        "model_loaded": model is not None,
        "device": device
    }
