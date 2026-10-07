# ⚡ DaVinci Resolve External Control Bridge (Free & Studio)

A local loopback JSON-RPC HTTP bridge that provides **real-time, external API control** over **DaVinci Resolve Free** and **Studio** editions.

> ⚠️ **Requirement**: Requires **DaVinci Resolve 21.0.4.5** (or later). Compatible with both Free and Studio editions.

---

## 💡 How It Works & Why It Bypasses Free Edition Restrictions

| Traditional Scripting (`DaVinciResolveScript`) | External Control Bridge (`resolve_bridge.py`) |
| :--- | :--- |
| External Python process attempts `import DaVinciResolveScript`. | Python script runs **inside** DaVinci Resolve via menu. |
| **Gated to Studio only**: Fails on Free edition. | **Works on Free & Studio (v21.0.4.5+)**: Internal scripts receive the live `resolve` handle on all editions. |
| Slow: Requires spawning Python processes and managing file handles. | **Fast**: Keeps a persistent, sub-50ms HTTP listener open on `127.0.0.1:8878`. |
| Language locked: External scripts must run in Python with matching ABI. | **Language agnostic**: Controlled from Node.js, TypeScript, Python, cURL, or browser fetch! |

---

## 📂 Bridge Folder Structure

```
bridge/
├── README.md                   # This comprehensive documentation
├── resolve_bridge.py           # Runs INSIDE DaVinci Resolve (HTTP listener & RPC gateway)
├── resolve_client.py           # Runs in external Python processes (transparent remote proxy)
└── example_add_beat_markers.py # Standalone worked Python example
```

---

## 🚀 Quick Setup (1-Click in Resolver)

If you are using the **Resolver** desktop app:

1. Open **Script Manager** in Resolver (`📜 Script Manager` tab).
2. Under the **⚡ DaVinci Resolve Bridge** card, click **"⚡ Install Bridge Script"**.
   - *Resolver automatically copies `resolve_bridge.py` into DaVinci Resolve's Utility scripts folder.*
3. Open **DaVinci Resolve** with any project open.
4. Go to top menu: **Workspace ▸ Scripts ▸ Utility ▸ resolve_bridge**.
   - Resolve's console will display:
     ```text
     ==================================================
     DaVinci Resolve Bridge listening on http://127.0.0.1:8878
     Token: resolver-local-bridge-key
     Ready for external commands from Resolver.
     ==================================================
     ```
5. Leave Resolve open! In Resolver, the status badge turns **🟢 Connected**. You can now use the **⚡ Live Load Media**, **⚡ Live Place Clips**, and **⚡ Live Push Markers** buttons in the Video Assembler for instant synchronization.

---

## 🛠 Manual Installation

If you prefer to install manually or are using the bridge without the Resolver UI:

Copy `bridge/resolve_bridge.py` into DaVinci Resolve's **Utility** scripts folder for your OS:

- **Windows**: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility\`
  *(Alternative user path: `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`)*
- **macOS**: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`
- **Linux**: `~/.local/share/DaVinciResolve/Fusion/Scripts/Utility/`

---

## 💻 Driving the Bridge

### 1. From Node.js / TypeScript (Resolver Architecture)

Resolver talks directly to the bridge using native `fetch()` without running Python in Node:

```typescript
import { ResolveBridgeClient } from './src/services/resolveBridgeClient';

const bridge = new ResolveBridgeClient('127.0.0.1', 8878, 'resolver-local-bridge-key');

// Chained API calls through ES6 Proxy:
const resolve = bridge.root;
const projectManager = await resolve.GetProjectManager();
const project = await projectManager.GetCurrentProject();
const timeline = await project.GetCurrentTimeline();

console.log('Active project:', await project.GetName());

// Push markers in ~50ms
await bridge.pushMarkersToActiveTimeline(markers);
```

### 2. From Python

Use `resolve_client.py` for transparent Python attribute chaining:

```python
from resolve_client import ResolveBridge

rb = ResolveBridge()
pm = rb.root.GetProjectManager()
project = pm.GetCurrentProject()
print("Project:", project.GetName())

media_pool = project.GetMediaPool()
media_pool.ImportMedia(["C:/Videos/Clip_01.mp4"])
```

Try the included worked example:
```bash
python bridge/example_add_beat_markers.py
```

---

## 📡 Protocol & API Endpoints

The bridge listens on `http://127.0.0.1:8878` and provides two main endpoints:

### 1. Health & Liveness (`GET /status` or `GET /ping`)
- Returns `200 OK` with JSON status:
```json
{
  "ok": true,
  "status": "online",
  "app": "DaVinci Resolve",
  "project": "Cyberpunk_Music_Video",
  "timeline": "Master_Timeline",
  "version": "19.1.0"
}
```

### 2. JSON-RPC Invocation (`POST /`)
- Headers: `Content-Type: application/json`
- Request body:
```json
{
  "token": "resolver-local-bridge-key",
  "ref": 0,
  "attr": "GetProjectManager",
  "args": [],
  "kwargs": {}
}
```
- Success response:
```json
{
  "ok": true,
  "value": {
    "__ref__": 1,
    "__type__": "ProjectManager"
  }
}
```

---

## 🔒 Security & Tokens

- The bridge binds exclusively to `127.0.0.1` (loopback).
- All RPC calls require matching `token: "resolver-local-bridge-key"` (or the value set in the `RESOLVER_BRIDGE_TOKEN` environment variable).
- You can change the token by setting `RESOLVER_BRIDGE_TOKEN` in your environment or editing `BRIDGE_TOKEN` in `resolve_bridge.py`.
