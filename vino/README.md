# 🍷 Vino Integration: Gemma 3 on Intel NPU

This folder contains the logic and configuration for running **Gemma 3** Multimodal prompt expansion locally on your **Intel AI Boost (NPU)**. 

In this application, we use Gemma 3 for the **"✨ Reword"** feature in the Storyboard, transforming simple scene notes into high-fidelity cinematic prompts.

---

## 🛠️ Prerequisites

Before using the NPU features, ensure you have:

1.  **Hardware**: An Intel® Core™ Ultra processor (or newer) with an integrated **NPU**.
2.  **Drivers**: Latest [Intel® NPU Drivers](https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html) installed (v32.0.100.3122 or newer).
3.  **Python**: Installed and available in your PATH (for the model downloader).

---

## 📥 Setup Instructions

### 1. Download the Model
We use a specific OpenVINO-optimized version of Gemma 3. Run the provided Python script to fetch the ~2GB model data:

```bash
# In this directory (resolver/vino)
pip install huggingface-hub
python download_model.py
```

This will create a `gemma-3-openvino/` folder. **Do not rename this folder**, as the Electron app look for this exact path.

### 2. Dependency Check
Ensure you have run `npm install` in the project root to install `openvino-genai-node`.

---

## 🧠 Hardware Optimization

The integration in `main.ts` uses several critical flags for peak performance on Intel silicon:

- **`KV_CACHE_PRECISION: "u8"`**: Drastically reduces memory usage.
- **`NPUW_LLM_PREFILL_HINT: "STATIC"`**: Ensures stability on the Gemma model family.
- **Hardware Cache**: Compiled models are saved to `ov_cache/` to make subsequent loads instant.

---

## 🧪 Troubleshooting

### "Reword Error: OpenVino library not found"
Run `npm install` in the root of the `resolver` project. This is a native dependency that must be compiled for your specific environment.

### "Model not found"
Ensure the `gemma-3-openvino/` directory exists inside `resolver/vino/` and contains `.xml` and `.bin` files.

### High CPU usage instead of NPU
Check Windows Task Manager > Performance tab. If the **NPU** usage is at 0% during generation, ensure your Intel NPU drivers are up to date. The app is hardcoded to request the "NPU" device.

---

_Integrated with ❤️ for the Intel AI Boost community._
