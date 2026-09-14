# ⚡ Model Context Protocol (MCP) Control for Resolver & DaVinci Resolve

Resolver provides a native, official **Model Context Protocol (MCP)** server that exposes **DaVinci Resolve** (Free & Studio), **Resolver Storyboard & Project Management**, and **ComfyUI Workflows** to external AI agents including **Claude Desktop**, **Antigravity**, **Cursor**, **Zed**, and autonomous LangChain/Python agents.

---

## 🚀 Quick Setup (1-Click in Resolver)

1. Open the **Resolver** desktop app.
2. In the left navigation sidebar, click **⚡ MCP Control**.
3. Under **🤖 1-Click AI Client Configuration**, select your target client:
   - **Claude Desktop**
   - **Antigravity**
   - **Cursor**
   - **Terminal / CLI**
4. Click **📋 Copy Configuration** and paste into your assistant's settings file.
5. Restart your AI assistant. All 13 Resolver and DaVinci Resolve tools will now be available in chat!

---

## 🛠 Manual Client Configuration

### 1. Claude Desktop (`claude_desktop_config.json`)

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the `resolver` server under `mcpServers`:

```json
{
  "mcpServers": {
    "resolver": {
      "command": "node",
      "args": [
        "C:/Users/Desktop-Dev/Desktop/resolver/scripts/resolver-mcp-server.mjs"
      ]
    }
  }
}
```

### 2. Antigravity (`mcp_config.json`)

Add to `C:\Users\<User>\.gemini\antigravity-ide\mcp_config.json` or your workspace `.agents/mcp_config.json`:

```json
{
  "mcpServers": {
    "resolver": {
      "command": "node",
      "args": [
        "C:/Users/Desktop-Dev/Desktop/resolver/scripts/resolver-mcp-server.mjs"
      ]
    }
  }
}
```

### 3. Cursor (`.cursor/mcp.json`)

Add to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "resolver": {
      "command": "node",
      "args": [
        "C:/Users/Desktop-Dev/Desktop/resolver/scripts/resolver-mcp-server.mjs"
      ]
    }
  }
}
```

---

## 🧰 Exposed Tools Catalog

### DaVinci Resolve Control Tools

| Tool Name | Purpose | Parameters |
| :--- | :--- | :--- |
| `resolve_get_status` | Checks connection to DaVinci Resolve via the local bridge (port 8878), reporting active project, active timeline, and FPS. | *(None)* |
| `resolve_install_bridge` | Installs `resolve_bridge.py` into Resolve's Utility scripts folder across Windows, macOS, and Linux. | *(None)* |
| `resolve_push_markers` | Pushes beat, onset, loudness, or chapter markers directly onto Resolve's active timeline with frame precision and custom colors. | `markers`: Array of `{ frame, timestamp, color, note, type, duration_sec }` |
| `resolve_import_media` | Directly imports audio tracks and/or video clips into Resolve's active Media Pool. | `audio_file_path`, `video_file_paths_collection` |
| `resolve_reconstruct_timeline` | Reconstructs or updates a timeline with an audio track on track 1 and video clips positioned at exact timestamps. | `project_name`, `audio_file_path`, `timeline_frame_rate`, `timeline_clips_collection` |
| `resolve_execute_rpc` | Executes arbitrary remote Python API method calls directly on the live DaVinci Resolve application handle (`ref: 0`). | `attribute_name`, `reference_identifier`, `invocation_arguments` |

### Resolver Project & Storyboard Tools

| Tool Name | Purpose | Parameters |
| :--- | :--- | :--- |
| `resolver_list_projects` | Lists all beat and storyboard projects discovered in the project output directory (`PRJ_*` bundles). | `custom_projects_directory_path` *(optional)* |
| `resolver_get_project` | Retrieves full JSON details of a project (clips, visual prompts, beat markers, stems, duration). | `project_identifier`, `custom_projects_directory_path` *(optional)* |
| `resolver_update_project` | Saves modified project properties or entire bundles to disk. | `project_data`, `custom_projects_directory_path` *(optional)* |
| `resolver_update_clip_prompt` | Updates a specific shot's visual prompt, action notes, camera direction, or duration. | `project_identifier`, `clip_identifier`, `prompt_text`, `action_notes`, `camera_movement`, `duration_seconds` |
| `resolver_add_clip` | Appends a new shot card to a project storyboard with start/end images and prompt. | `project_identifier`, `prompt_text`, `action_notes`, `duration_seconds`, `start_image_path`, `end_image_path` |

### ComfyUI Integration Tools

| Tool Name | Purpose | Parameters |
| :--- | :--- | :--- |
| `comfyui_get_status` | Checks connection to local ComfyUI server and retrieves GPU device telemetry. | `comfyui_host_url` *(optional, default 8188)* |
| `comfyui_list_workflows` | Lists bundled workflow JSON templates (Extract Stems, Minimax H3, Qwen description). | *(None)* |

---

## 📚 Exposed Resources Catalog (`resolver://`)

Resolver exposes schemas, references, workflows, and active storyboard states as passive **MCP Resources**. Connected agents can consult these without consuming a tool invocation round-trip.

| Resource URI | MIME Type | Description |
| :--- | :--- | :--- |
| `resolver://schemas/project-bundle` | `application/json` | JSON Schema specification of Resolver project and storyboard bundles (`project.json`). |
| `resolver://resolve/marker-conventions` | `text/markdown` | Color coding standards (Green for beats, Yellow for onsets, Cyan for vocals, Purple for drops, Red for cuts) and frame conversion math. |
| `resolver://resolve/rpc-cheatsheet` | `text/markdown` | DaVinci Resolve Python scripting API reference for `resolve_execute_rpc` (Resolve, ProjectManager, Timeline, MediaPool). |
| `resolver://projects/active` | `application/json` | Dynamic snapshot of the most recently modified storyboard project bundle currently on disk. |
| `resolver://comfyui/workflows/{name}` | `application/json` | Raw ComfyUI workflow JSON templates (e.g. `Extract_Stems.json`, `Minimax_H3.json`). |

---

## 🧠 Built-In Agent Instructions

The server automatically broadcasts built-in operational instructions during the MCP handshake (`initialize` result). Any connected client (Claude Desktop, Cursor, Antigravity) receives these guidelines without manual prompt tuning:

1. **Pre-Flight Status Checks:** Verifies DaVinci Resolve connection (`resolve_get_status`) and ComfyUI GPU status (`comfyui_get_status`) before dispatching actions.
2. **High-Level Tools Over Raw RPC:** Prioritizes structured tools (`resolve_push_markers`, `resolve_reconstruct_timeline`) over raw Python reflection (`resolve_execute_rpc`).
3. **Safe Media Pipeline:** Enforces that media files are imported to the Media Pool (`resolve_import_media`) prior to timeline append operations.
4. **Color & Timing Standards:** Mandates standard timeline marker colors and frame calculation formulas (`frame = Math.round(seconds * fps)`).

---

## 🎬 Example Agent Workflows

### Scenario 1: AI Prompt Director (Storyboard Tuning)
```
Agent: "I'll inspect your storyboard in project 'Cyberpunk_Teaser', refine the shot descriptions, and update the camera directions."
1. Calls `resolver_get_project(project_identifier: "Cyberpunk_Teaser")`
2. Analyzes shot pacing and narrative continuity.
3. Calls `resolver_update_clip_prompt` for shots 1 through 6 with enhanced cinematic lighting and camera directions.
```

### Scenario 2: Autonomous Timeline Assembly in DaVinci Resolve
```
Agent: "Let's load the generated AI video clips and construct a timeline matching the beat markers."
1. Calls `resolve_get_status` -> Confirms DaVinci Resolve is open.
2. Calls `resolve_import_media` -> Imports generated clips into Media Pool.
3. Calls `resolve_reconstruct_timeline` -> Automatically places clips on video track 1 & 2 synced to song beats.
4. Calls `resolve_push_markers` -> Adds green beat markers and yellow onset markers.
```

---

## 🧪 Testing the Server Directly

You can test the MCP server directly from your terminal using `npm run mcp`:

```bash
npm run mcp
```

Or test individual tools using the interactive **Interactive Tool Tester** in Resolver's **⚡ MCP Control** dashboard module!
