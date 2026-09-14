"""
resolve_bridge.py
------------------
Runs INSIDE DaVinci Resolve: Workspace > Scripts > Utility > resolve_bridge

WHAT:
    A local loopback HTTP bridge server that exposes DaVinci Resolve's live internal
    scripting API over localhost JSON-RPC.

WHY:
    DaVinci Resolve Free edition prohibits external Python scripts from importing
    the gated 'DaVinciResolveScript' library. However, scripts executed from inside
    Resolve's 'Workspace > Scripts' menu receive the live global 'resolve' object
    on both Free and Studio editions. By hosting an authenticated local HTTP listener,
    external tools (such as the Resolver Electron desktop app) can drive Resolve
    interactively without requiring a Studio license or manual script menu clicks per export.

SECURITY:
    Listens strictly on loopback (127.0.0.1). Requires a matching BRIDGE_TOKEN in all
    requests to guard against unauthorized local processes.
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# WHAT: Default port and authentication token for local communication.
# WHY: Uses a predictable loopback port and a shared private token known to Resolver.
DEFAULT_BRIDGE_PORT = 8878
BRIDGE_TOKEN = os.environ.get("RESOLVER_BRIDGE_TOKEN", "resolver-local-bridge-key")

# WHAT: Acquire the active DaVinci Resolve application handle.
# WHY: In Resolve's script environment, 'resolve' is provided as a pre-injected global.
# When launched via Fusion menus, 'bmd.scriptapp("Resolve")' or 'fusion.GetResolve()' serves as fallback.
davinci_resolve_application_handle = None
try:
    davinci_resolve_application_handle = resolve  # noqa: F821
except NameError:
    try:
        import bmd
        davinci_resolve_application_handle = bmd.scriptapp("Resolve")
    except (ImportError, AttributeError):
        pass

if davinci_resolve_application_handle is None:
    raise RuntimeError(
        "Could not obtain DaVinci Resolve handle. Please run this script from "
        "DaVinci Resolve's top menu: Workspace > Scripts > Utility > resolve_bridge"
    )

# WHAT: In-memory registry of live DaVinci Resolve API objects.
# WHY: C++ wrapped Resolve objects (Projects, Timelines, MediaPoolItems) cannot be
# directly serialized to JSON. We register them with integer IDs and pass remote references
# back to the client. Reference 0 is always reserved for the root Resolve application handle.
remote_object_registry = {0: davinci_resolve_application_handle}
next_available_object_identifier = [1]
registry_thread_lock = threading.Lock()

JSON_PRIMITIVE_TYPES = (type(None), bool, int, float, str)


def register_remote_object(target_object):
    """
    WHAT: Assigns a unique integer identifier to an internal Resolve API object.
    WHY: Enables subsequent RPC calls from external clients to address this object by ref ID.
    """
    with registry_thread_lock:
        assigned_identifier = next_available_object_identifier[0]
        next_available_object_identifier[0] += 1
        remote_object_registry[assigned_identifier] = target_object
        return assigned_identifier


def serialize_to_wire_format(source_value):
    """
    WHAT: Converts Python data types and Resolve C++ proxies into JSON-serializable payloads.
    WHY: Primitives are transmitted directly; complex Resolve objects are encoded as wire references.
    """
    if isinstance(source_value, JSON_PRIMITIVE_TYPES):
        return source_value
    if isinstance(source_value, (list, tuple)):
        return [serialize_to_wire_format(element) for element in source_value]
    if isinstance(source_value, dict):
        return {str(key): serialize_to_wire_format(val) for key, val in source_value.items()}

    assigned_id = register_remote_object(source_value)
    return {
        "__ref__": assigned_id,
        "__type__": type(source_value).__name__
    }


def deserialize_from_wire_format(wire_payload):
    """
    WHAT: Resolves wire references back to their corresponding internal Resolve objects.
    WHY: Allows clients to pass previously returned Resolve objects as arguments to API methods.
    """
    if isinstance(wire_payload, dict):
        if "__ref__" in wire_payload:
            return remote_object_registry.get(wire_payload["__ref__"])
        return {key: deserialize_from_wire_format(val) for key, val in wire_payload.items()}
    if isinstance(wire_payload, list):
        return [deserialize_from_wire_format(element) for element in wire_payload]
    return wire_payload


def execute_rpc_payload(incoming_payload):
    """
    WHAT: Executes an RPC invocation on a registered Resolve API object.
    WHY: Translates client method name, arguments, and kwargs into a live Python attribute call.
    """
    client_token = incoming_payload.get("token")
    if client_token != BRIDGE_TOKEN:
        return {"ok": False, "error": "Unauthorized: invalid bridge token"}

    object_reference_id = incoming_payload.get("ref", 0)
    target_attribute_name = incoming_payload.get("attr")
    invocation_arguments = [deserialize_from_wire_format(arg) for arg in incoming_payload.get("args", [])]
    invocation_kwargs = {
        key: deserialize_from_wire_format(val)
        for key, val in incoming_payload.get("kwargs", {}).items()
    }

    target_object = remote_object_registry.get(object_reference_id)
    if target_object is None:
        return {"ok": False, "error": f"Unknown object reference: {object_reference_id}"}

    try:
        resolved_attribute = getattr(target_object, target_attribute_name)
    except AttributeError as attribute_error:
        return {"ok": False, "error": f"AttributeError: {attribute_error}"}

    try:
        execution_result = (
            resolved_attribute(*invocation_arguments, **invocation_kwargs)
            if callable(resolved_attribute)
            else resolved_attribute
        )
        return {"ok": True, "value": serialize_to_wire_format(execution_result)}
    except Exception as runtime_error:  # noqa: BLE001
        return {"ok": False, "error": f"{type(runtime_error).__name__}: {runtime_error}"}


class BridgeHttpHandler(BaseHTTPRequestHandler):
    """
    WHAT: HTTP Request Handler managing JSON-RPC and health status queries.
    WHY: Provides cross-origin preflight responses and clean JSON serialization.
    """

    def log_message(self, format_specifier, *arguments):
        # WHAT: Suppress standard access logging in the Resolve console.
        # WHY: Avoids cluttering DaVinci Resolve's script output window.
        pass

    def send_cors_headers(self):
        """
        WHAT: Adds permissive CORS headers for local connections.
        WHY: Allows browser-based fetch calls or Electron renderers to interact without security blocks.
        """
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        """
        WHAT: Handle HTTP CORS preflight requests.
        WHY: Modern browsers and Electron renderers send OPTIONS before POST requests.
        """
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        """
        WHAT: Liveness and status check endpoint.
        WHY: Allows Resolver to verify whether the bridge is online without sending an authenticated RPC payload.
        """
        if self.path in ("/ping", "/status", "/"):
            project_manager = davinci_resolve_application_handle.GetProjectManager()
            current_project = project_manager.GetCurrentProject() if project_manager else None
            project_name = current_project.GetName() if current_project else None

            current_timeline = current_project.GetCurrentTimeline() if current_project else None
            timeline_name = current_timeline.GetName() if current_timeline else None

            response_data = json.dumps({
                "ok": True,
                "status": "online",
                "app": "DaVinci Resolve",
                "project": project_name,
                "timeline": timeline_name,
                "version": davinci_resolve_application_handle.GetVersionString() if hasattr(davinci_resolve_application_handle, "GetVersionString") else "Unknown"
            }).encode("utf-8")

            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_data)))
            self.end_headers()
            self.wfile.write(response_data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        """
        WHAT: Processes incoming JSON-RPC method invocation requests.
        WHY: Dispatches the call against Resolve's live API and returns serialized results.
        """
        content_byte_length = int(self.headers.get("Content-Length", 0))
        request_body_bytes = self.rfile.read(content_byte_length)

        try:
            parsed_json_payload = json.loads(request_body_bytes.decode("utf-8"))
            execution_response = execute_rpc_payload(parsed_json_payload)
        except Exception as json_parsing_error:  # noqa: BLE001
            execution_response = {"ok": False, "error": f"Invalid JSON payload: {json_parsing_error}"}

        response_bytes = json.dumps(execution_response).encode("utf-8")
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)


def start_bridge_server():
    """
    WHAT: Starts the ThreadingHTTPServer on 127.0.0.1.
    WHY: Handles concurrent requests without blocking the Resolve UI thread unnecessarily.
    """
    server_address = ("127.0.0.1", DEFAULT_BRIDGE_PORT)
    bridge_http_server = ThreadingHTTPServer(server_address, BridgeHttpHandler)
    print(f"==================================================")
    print(f"DaVinci Resolve Bridge listening on http://127.0.0.1:{DEFAULT_BRIDGE_PORT}")
    print(f"Token: {BRIDGE_TOKEN}")
    print(f"Ready for external commands from Resolver.")
    print(f"Leave running while editing. Close Resolve or stop script to terminate.")
    print(f"==================================================")
    bridge_http_server.serve_forever()


if __name__ == "__main__":
    start_bridge_server()
