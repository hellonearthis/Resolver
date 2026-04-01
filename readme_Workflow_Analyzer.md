# 🔀 Workflow Analyzer Module

## _under development_

The **Workflow Analyzer** is a specialized introspection and debugging tool designed to help you integrate ComfyUI workflows into the DaVinci Resolve Tools Dashboard.

When building dynamic AI pipelines (like LTX Video generation or audio stem separation), the application needs to know exactly which nodes to inject data into (like source images, audio, or prompts) and which nodes to extract results from (like generated video paths or image descriptions). The Workflow Analyzer makes discovering and verifying these nodes effortless.

---

## 🎯 Purpose

ComfyUI workflows can contain dozens or hundreds of nodes. When you export a workflow in **API Format** (Save (API format) in ComfyUI), the node connections are represented by numeric string IDs (e.g., `"14"`, `"92:3"`).

Instead of manually digging through a massive JSON file to find the ID of your LoadImage or SaveVideo node, the Workflow Analyzer automatically parses the file and extracts the exact IDs and input schemas for your integration points.

---

## 🔍 How to Use

### 1. Tag Your ComfyUI Nodes

Before exporting your workflow from ComfyUI, you must tag the specific nodes you want the application to interact with.

- **For Inputs** (Data sent _from_ the dashboard _to_ ComfyUI): Rename the node's title to include `[input]`.
  - _Example:_ `LoadAudio [input]` or `Video Prompt [input]`
- **For Outputs** (Results retrieved _from_ ComfyUI _by_ the dashboard): Rename the node's title to include `[output]`.
  - _Example:_ `SaveVideo [output]`

### 2. Export API JSON

In ComfyUI, ensure you have the "Enable Dev mode Options" setting checked in the settings menu, and click **Save (API format)** to get the correct JSON representation.

### 3. Load the Workflow

In the Workflow Analyzer module, you can load your JSON file in two ways:

- **Drag and Drop:** Simply drag your exported `.json` file into the "Drop ComfyUI API JSON File Here" zone.
- **Local Workflows Sidebar:** The app automatically scans the `./workflows` and `./comfyui_workflows` directories in your project. Any valid JSON files found there will be listed in the sidebar for 1-click loading.

---

## 📊 Analysis Results

Once a workflow is loaded, the analyzer provides three key views:

### Inputs

Displays a card for every node tagged with `[input]`.

- Shows the Node ID (e.g., `#92:3`), which is what you'll use in your React/Electron code to inject data.
- Lists the node's class type (e.g., `LoadImage`).
- Provides a quick look at the node's expected input fields (like `text`, `image`, `audio`).

### Outputs

Displays a card for every node tagged with `[output]`.

- Shows the Node ID, which corresponds to the keys in the WebSockets or API history responses where you will extract generated data.
- Shows the node's class type (e.g., `SaveImage`).

### All Nodes

An expandable table containing every single node detected in the workflow JSON.

- Useful for cross-referencing node classes or verifying that your workflow exported correctly.
- Tagged input and output nodes are highlighted with badges.

---

## ⚠️ Troubleshooting

- **"This looks like a ComfyUI Web format (not API export)"**: You exported the standard visual workflow (used for loading back into the ComfyUI UI). You must use the "Save (API format)" button in ComfyUI for the application to properly parse the execution graph.
- **No nodes tagged**: Ensure you actually renamed the node titles in ComfyUI (Right click a node -> Title) to include `[input]` or `[output]` before exporting.
