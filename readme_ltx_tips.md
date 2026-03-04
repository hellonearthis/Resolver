# LTX-Video 2.0 Testing & Frame Rate Tips

This document contains insights and tips for testing the LTX-Video generator, particularly concerning valid frame counts, audio-sync drifting, and timeline math.

---

## 1. Frame Rate (FPS) Comparison for the `(n × 8) + 1` Rule

LTX-Video forces the frame count to align to the `(n × 8) + 1` formula. When converting between seconds and frames on a timeline, rounding errors can cause noticeable audio-sync drifting if the math doesn't result in perfectly clean decimals. Here is a breakdown of how different frame rates perform:

### 20 FPS (Excellent Balance / Recommended)
At 20 FPS, 1 frame is exactly **0.05 seconds**. Every single valid frame count produces a mathematically perfect, clean duration. It completely eliminates floating-point drift, requires about 20% less VRAM/generation time than 25 FPS, and is fast enough that the motion still looks smooth.
- 9 frames = **0.45s**
- 17 frames = **0.85s**
- 25 frames = **1.25s**
- 41 frames = **2.05s**
- 81 frames = **4.05s**

### 25 FPS (The Cleanest Math)
At 25 FPS, 1 frame is exactly **0.04 seconds**. Expanding chunks is perfect and drift is zero.
- 25 frames = **1.00s** *(Perfect 1 second!)*
- 41 frames = **1.64s**
- 81 frames = **3.24s**
- 105 frames = **4.20s**
- 225 frames = **9.00s** *(Perfect 9 seconds!)*

### 10 FPS (Mathematically Perfect, but Choppy)
At 10 FPS, 1 frame is exactly **0.1 seconds**. Because it's a base-10 number, every valid frame count produces a mathematically perfect duration with zero drift.
- 9 frames = **0.9s**
- 17 frames = **1.7s**
- 81 frames = **8.1s**
*Note: 10 FPS looks very stylized or "stop-motion" choppy as a video format.*

### 24 FPS and 30 FPS (Not Recommended)
These standard frame rates often fall into 3-decimal limits or repeating decimals (`0.041666...` and `0.0333...`). 
Because `8n + 1` is always odd, it can never perfectly represent an integer second multiplier for 24 or 30 FPS. 
When stringing multiple clips together on a timeline, these repeating decimals can cause micro-drifts or 1-millisecond gaps.

### 15 FPS (Messy Math)
At 15 FPS, 1 frame is **0.0666... seconds** (repeating). This works *only* if you memorize the frame counts that are multiples of 3 (9, 33, 57, 81, 105). If you pick anything else (like 17, 25, or 41 frames), Javascript will struggle with the recurring decimals on your timeline.

---

## 2. Mocking the "Silent" or "Intro" Chunks
If your workflow overview has chunks that are just intro padding (e.g., waiting for the vocals to start), test those with LTX using a much **lower step count** (like 10 steps instead of 20) in the advanced parameters. Since there's not much dynamic motion or audio driving those particular segments, lowering the steps will save you a ton of VRAM and generation time without sacrificing much quality. 

---

## 3. Implement an "Auto-Trim" Feature on the Audio
Right now, you are passing the start duration down to ComfyUI's Trim Audio node. An alternative idea for production (if ComfyUI proves to be slow at trimming) is to use `ffmpeg` via the Electron backend to physically slice the audio into a temporary `.wav` file first. Sending a perfectly cut 4.2s audio file to ComfyUI rather than making ComfyUI load and trim the entire original 3-minute MP3 every time might speed up your test generation times significantly.

---

## 4. Batch Generation for Testing
Since you are using mocked data to run example tests, consider setting up a test sequence that queues up 3 short clips simultaneously (e.g., 3 separate prompts with 3 different audio start points, each for 17 frames). This will help you:
- Verify that your `/free` VRAM management actually prevents the GPU from running out of memory between consecutive calls.
- Confirm exactly how the ComfyUI queue responds to the Node API in sequential order.

---

## 5. Negative Prompting for Transitions
If you plan to stitch these exported chunks back together in the NLE assembler later, consider adding terms like `"fade, crossfade, transition, black screen, title sequence"` to your Negative Prompt for the test. LTX-Video has a tendency to generate "movie endings" (fading to black) if it thinks the chunk is finishing, which makes stitching them seamlessly a nightmare.
