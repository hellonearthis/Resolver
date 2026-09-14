"""
resolve_client.py
------------------
Talk to a running resolve_bridge.py from any external Python process.
No Resolve Studio license needed -- this rides the loopback bridge instead
of the gated DaVinciResolveScript module.

Usage:
    from resolve_client import ResolveBridge

    # Connects using the default shared token (or custom token / env variable)
    rb = ResolveBridge()
    pm = rb.root.GetProjectManager()
    project = pm.GetCurrentProject()
    print("Active project:", project.GetName())

    media_pool = project.GetMediaPool()
    media_pool.ImportMedia(["/path/to/clip.mov"])

Every call you would normally make on a Resolve API object (project, timeline,
mediaPool, etc.) works transparently here -- attribute access returns a bound
call that round-trips to Resolve over local HTTP and back. Objects Resolve returns
(projects, timelines, clips...) come back as RemoteObject proxies you can
keep chaining calls on, exactly like the real API.
"""

import json
import os
import urllib.request

DEFAULT_BRIDGE_PORT = 8878
DEFAULT_BRIDGE_TOKEN = os.environ.get("RESOLVER_BRIDGE_TOKEN", "resolver-local-bridge-key")


class RemoteObject(object):
    """
    WHAT: Dynamic proxy representing an object existing inside DaVinci Resolve.
    WHY: Translates Python attribute calls into JSON-RPC messages sent across HTTP.
    """

    def __init__(self, bridge_client, reference_identifier, object_type_name=None):
        object.__setattr__(self, "_bridge", bridge_client)
        object.__setattr__(self, "_ref", reference_identifier)
        object.__setattr__(self, "_type", object_type_name)

    def __getattr__(self, attribute_name):
        def _invoke_callable(*arguments, **kwargs):
            return self._bridge._invoke(self._ref, attribute_name, arguments, kwargs)
        return _invoke_callable

    def __repr__(self):
        return f"<RemoteObject {self._type or '?'} ref={self._ref}>"


class ResolveBridge(object):
    """
    WHAT: Client session managing local HTTP communication with resolve_bridge.py.
    WHY: Exposes the live 'resolve' root object to any external Python process.
    """

    def __init__(self, host="127.0.0.1", port=DEFAULT_BRIDGE_PORT, token=DEFAULT_BRIDGE_TOKEN):
        self._url = f"http://{host}:{port}"
        self._token = token

    @property
    def root(self):
        """The live `resolve` application object, as a RemoteObject proxy."""
        return RemoteObject(self, 0, "Resolve")

    def ping(self):
        """
        WHAT: Checks if resolve_bridge.py is active and listening.
        WHY: Fast diagnostic check without raising API exceptions.
        """
        try:
            request = urllib.request.Request(f"{self._url}/status")
            with urllib.request.urlopen(request, timeout=3) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:
            return {"ok": False, "error": str(error)}

    def _to_wire(self, value):
        if isinstance(value, RemoteObject):
            return {"__ref__": value._ref}
        if isinstance(value, (list, tuple)):
            return [self._to_wire(item) for item in value]
        if isinstance(value, dict):
            return {key: self._to_wire(val) for key, val in value.items()}
        return value

    def _from_wire(self, value):
        if isinstance(value, dict):
            if "__ref__" in value:
                return RemoteObject(self, value["__ref__"], value.get("__type__"))
            return {key: self._from_wire(val) for key, val in value.items()}
        if isinstance(value, list):
            return [self._from_wire(item) for item in value]
        return value

    def _invoke(self, reference_identifier, attribute_name, arguments, kwargs):
        payload = {
            "token": self._token,
            "ref": reference_identifier,
            "attr": attribute_name,
            "args": [self._to_wire(arg) for arg in arguments],
            "kwargs": {key: self._to_wire(val) for key, val in kwargs.items()},
        }
        encoded_data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=encoded_data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        if not result.get("ok"):
            raise RuntimeError(result.get("error", "Unknown bridge error"))

        return self._from_wire(result.get("value"))
