import os
import shutil
import httpx
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
from pathlib import Path
import gc
import sys
import glob

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
# These directories are now managed by the orchestrator, but the worker needs to know about them.
RESULTS_DIR = "worker_results"
WORKER_TEMP_DIR = "worker_temp" # For intermediate files like frames
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(WORKER_TEMP_DIR, exist_ok=True)


# --- Actual 3D Model Conversion Logic (largely unchanged) ---

def extract_frames_from_video(video_path: str, output_dir: str, fps: float = 3.0) -> list[str]:
    print(f"Extracting frames from video: {video_path}")
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found at {video_path}")
    
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

async def notify_orchestrator(webhook_url: str, job_id: str, result_path: str):
    """Notifies the main app that the conversion is complete."""
    print(f"Sending result for {job_id} to webhook: {webhook_url}")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            payload = {"job_id": job_id, "result_path": result_path}
            response = await client.post(webhook_url, json=payload)
            response.raise_for_status()
            print(f"Successfully sent webhook for {job_id}")
    except httpx.RequestError as e:
        print(f"Failed to send webhook for {job_id}: {e}")

# --- Background Task for Conversion and Webhook ---
async def process_and_notify(job_id: str, video_path: str, webhook_url: str):
    """
    Runs the full conversion pipeline from a local file path and notifies the orchestrator.
    """
    temp_processing_dir = Path(WORKER_TEMP_DIR) / job_id
    images_dir = temp_processing_dir / "images"
    os.makedirs(images_dir, exist_ok=True)
    
    result_obj_path = os.path.abspath(os.path.join(RESULTS_DIR, f"{job_id}.obj"))
    
    try:
        # 1. Extract frames from the local video file
        extract_frames_from_video(video_path, str(images_dir), fps=2.0)

        # 2. Run model inference
        predictions = run_model_inference(str(images_dir), model)
        
        # 3. Create OBJ file in the shared results directory
        predictions_to_obj(predictions, result_obj_path, conf_thres=50.0, poisson_depth=8)
        
        # 4. Clean up model-related resources
        del predictions
        gc.collect()
        torch.cuda.empty_cache()

        # 5. Notify the orchestrator that the job is complete
        await notify_orchestrator(webhook_url, job_id, result_obj_path)

    except Exception as e:
        print(f"FATAL: Conversion pipeline failed for {job_id}: {e}")
        # Optionally, notify orchestrator of failure
    finally:
        # 6. Clean up INTERMEDIATE files for this job (frames)
        if temp_processing_dir.exists():
            shutil.rmtree(temp_processing_dir)
            print(f"Cleaned up intermediate files for job {job_id}")
        
        # 7. Clean up the original SOURCE video file
        if os.path.exists(video_path):
            os.remove(video_path)
            print(f"Cleaned up source video for job {job_id}: {video_path}")

# --- Worker API Endpoint ---
class ConversionRequest(BaseModel):
    job_id: str
    video_path: str
    webhook_url: str

@app.post("/convert")
async def convert_video(request: ConversionRequest, background_tasks: BackgroundTasks):
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded. Worker is not ready.")

    print(f"Worker received job: {request.job_id}. Starting conversion in background.")
    
    background_tasks.add_task(process_and_notify, request.job_id, request.video_path, request.webhook_url)
    
    return {"message": "Conversion task accepted and is running in the background."}

# --- Health Check Endpoint ---
@app.get("/")
def health_check():
    return {
        "status": "Worker is alive",
        "model_loaded": model is not None,
        "device": device
    }
