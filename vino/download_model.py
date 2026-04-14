from huggingface_hub import snapshot_download
from pathlib import Path

# This downloads the specific OpenVINO-optimized Gemma 3
# Provided by the Intel OpenVINO community
repo_id = "OpenVINO/gemma-3-4b-it-int4-cw-ov"
local_dir = Path("gemma-3-openvino")

print(f"Downloading {repo_id} to {local_dir}...")
snapshot_download(repo_id=repo_id, local_dir=local_dir)
print("Done!")
