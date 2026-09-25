"""
command_web_bridge.py
----------------------
Exposes Command.py's DroneBridge + MissionDispatcher (a CLI-only tool,
blocking input() loop) to a web frontend over HTTP + Server-Sent Events.

Command.py is NOT modified -- this file only imports its classes and
drives them the same way run_cli() does, just from HTTP requests instead
of typed console commands.

Run this INSTEAD OF `python Command.py` (don't run both -- they'd both
try to bind UDP port 5002 for telemetry):

    python command_web_bridge.py

Requires Command.py to be in the same folder (imported by name).

Endpoints:
    GET  /telemetry        -- JSON snapshot, or SSE stream if
                               Accept: text/event-stream
    GET  /mission/status    -- current mission progress
    POST /command            -- {"type": "takeoff"|"hold"|"goto"|
                                 "search"|"rtl"|"land"|"sos", ...params}
    POST /mission/save         -- {"mission": {...}, "filename": "x.json" (optional)}
                                   Writes a mission JSON to disk (in
                                   MISSIONS_DIR) so it can subsequently
                                   be loaded with /mission/load. This
                                   exists because /mission/load only
                                   accepts a filepath (matching
                                   Command.py's MissionDispatcher.
                                   load_mission signature exactly) -- it
                                   has no way to accept a raw mission
                                   body directly, so the Mission Builder
                                   page needs somewhere to persist what
                                   it builds first. If filename is
                                   omitted, one is auto-generated from
                                   the mission's own mission_id + a
                                   timestamp.
    POST /mission/load           -- {"filepath": "mission_x.json"}
    POST /mission/run              -- {}
    POST /mission/pause              -- {}
    POST /mission/resume               -- {}
    POST /mission/abort                  -- {}
"""

import http.server
import json
import queue
import threading
import time
from pathlib import Path

# --- Import Command.py's classes UNCHANGED. Command.py's
# `if __name__ == "__main__": run_cli()` guard means importing it does
# NOT start the CLI loop -- only DroneBridge/MissionDispatcher get
# defined. ---
from Command import DroneBridge, MissionDispatcher

HOST = "127.0.0.1"
PORT = 8766

# --- EDIT HERE: where /mission/save writes mission JSON files, and
# where /mission/load will look for a bare filename (so the frontend
# doesn't need to know an absolute path). ---
MISSIONS_DIR = Path(__file__).parent / "missions"
MISSIONS_DIR.mkdir(exist_ok=True)

drone = DroneBridge()
dispatcher = MissionDispatcher(drone)

# ── SSE broadcasting of telemetry ────────────────────────────────────────────
_telem_subscribers = set()
_telem_subscribers_lock = threading.Lock()
_last_broadcast_telem = None


def _telemetry_broadcast_loop():
    """Polls DroneBridge.get_telemetry() (already populated by its own
    background thread inside Command.py) and pushes to any connected SSE
    clients. Command.py itself has no push mechanism -- this is purely
    additive, reading the same dict Command.py's own CLI reads."""
    global _last_broadcast_telem
    while True:
        telem = drone.get_telemetry()
        if telem and telem != _last_broadcast_telem:
            _last_broadcast_telem = telem
            payload = f"data: {json.dumps(telem)}\n\n".encode("utf-8")
            with _telem_subscribers_lock:
                dead = set()
                for q in _telem_subscribers:
                    try:
                        q.put_nowait(payload)
                    except Exception:
                        dead.add(q)
                _telem_subscribers.difference_update(dead)
        time.sleep(0.05)


threading.Thread(target=_telemetry_broadcast_loop, daemon=True).start()


# ── Command dispatch -- mirrors run_cli()'s verb handling exactly ───────────
def _handle_command(cmd: dict) -> dict:
    """Same command set as Command.py's run_cli(), just JSON-driven.
    Every branch calls the EXACT SAME DroneBridge / MissionDispatcher
    methods run_cli() calls, with the same defaults."""
    ctype = cmd.get("type", "").lower()

    if ctype == "takeoff":
        alt = float(cmd.get("alt", 14.0))
        drone.send_command(1, 0, 0, alt, 0)
        return {"ok": True, "action": "takeoff", "alt": alt}

    if ctype == "hold":
        drone.send_command(2)
        return {"ok": True, "action": "hold"}

    if ctype == "goto":
        n = float(cmd["north"])
        e = float(cmd["east"])
        alt = float(cmd.get("alt", 14.0))
        yaw = float(cmd.get("yaw", 0.0))
        drone.send_command(3, n, e, alt, yaw)
        return {"ok": True, "action": "goto", "north": n, "east": e, "alt": alt, "yaw": yaw}

    if ctype == "search":
        n = float(cmd.get("north", 145.0))
        e = float(cmd.get("east", 50.0))
        alt = float(cmd.get("alt", 14.0))
        pattern = str(cmd.get("pattern", "CREEPING_LINE")).upper()
        p4 = 2.0 if pattern == "CREEPING_LINE" else 1.0
        drone.send_command(4, n, e, alt, p4)
        return {"ok": True, "action": "search", "north": n, "east": e, "alt": alt, "pattern": pattern}

    if ctype == "rtl":
        drone.send_command(5)
        return {"ok": True, "action": "rtl"}

    if ctype == "land":
        drone.send_command(6)
        return {"ok": True, "action": "land"}

    if ctype == "sos":
        n = float(cmd["north"])
        e = float(cmd["east"])
        alt = float(cmd.get("alt", 14.0))
        triage = int(cmd.get("triage_code", 1))
        dispatcher.inject_sos_diversion(n, e, alt, triage)
        return {"ok": True, "action": "sos", "north": n, "east": e, "alt": alt,
                "triage_code": triage, "mission_paused": dispatcher.is_paused}

    return {"ok": False, "error": f"unknown command type '{ctype}'"}


def _mission_status() -> dict:
    m = dispatcher.active_mission
    return {
        "loaded": m is not None,
        "mission_id": m.get("mission_id") if m else None,
        "running": dispatcher.is_running,
        "paused": dispatcher.is_paused,
        "step_idx": dispatcher.step_idx,
        "total_steps": len(m.get("plan", [])) if m else 0,
    }


def _save_mission(body: dict) -> dict:
    """Writes a mission JSON built by the frontend's Mission Builder page
    to MISSIONS_DIR, so it can then be passed to /mission/load by
    filename. This is a NEW endpoint (Command.py's load_mission() only
    ever reads from disk, it has no way to accept a mission body
    directly) -- required for the Mission Builder page to actually work,
    since there is no other way to get a built mission into
    MissionDispatcher without going through a file.

    filename is OPTIONAL -- if omitted, one is auto-generated from the
    mission's own mission_id plus a timestamp, so the operator never has
    to name a file themselves."""
    mission = body.get("mission")

    if not isinstance(mission, dict):
        return {"ok": False, "error": "expected {mission: object} (filename is optional)"}

    if "mission_id" not in mission or "plan" not in mission:
        return {"ok": False, "error": "mission must have 'mission_id' and 'plan'"}

    filename = body.get("filename")
    if not filename:
        # Auto-generate: <mission_id>_<YYYYMMDD_HHMMSS>.json, with the
        # mission_id sanitized to safe filename characters.
        safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(mission["mission_id"]))
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"{safe_id}_{timestamp}.json"

    if not filename.endswith(".json"):
        filename += ".json"
    # Prevent path traversal -- only ever write inside MISSIONS_DIR
    safe_name = Path(filename).name
    filepath = MISSIONS_DIR / safe_name

    try:
        with open(filepath, "w") as f:
            json.dump(mission, f, indent=2)
    except OSError as e:
        return {"ok": False, "error": f"failed to write mission file: {e}"}

    return {"ok": True, "filepath": str(filepath), "filename": safe_name}


# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):

    def _send_json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def do_OPTIONS(self):
        self._send_json({}, 204)

    def do_GET(self):
        if self.path == "/telemetry":
            accept = self.headers.get("Accept", "")
            if "text/event-stream" in accept:
                q = queue.Queue(maxsize=20)
                with _telem_subscribers_lock:
                    _telem_subscribers.add(q)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    self.wfile.write(f"data: {json.dumps(drone.get_telemetry())}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    while True:
                        self.wfile.write(q.get())
                        self.wfile.flush()
                except (ConnectionError, BrokenPipeError, OSError):
                    pass
                finally:
                    with _telem_subscribers_lock:
                        _telem_subscribers.discard(q)
            else:
                self._send_json(drone.get_telemetry() or {})
        elif self.path == "/mission/status":
            self._send_json(_mission_status())
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        try:
            body = self._read_json_body()
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"ok": False, "error": "invalid JSON body"}, 400)
            return

        if self.path == "/command":
            try:
                self._send_json(_handle_command(body))
            except (KeyError, ValueError) as e:
                self._send_json({"ok": False, "error": f"bad command params: {e}"}, 400)

        elif self.path == "/mission/save":
            self._send_json(_save_mission(body))

        elif self.path == "/mission/load":
            filepath = body.get("filepath")
            if not filepath:
                self._send_json({"ok": False, "error": "expected {filepath}"}, 400)
                return
            # Convenience: if a bare filename is given and it exists in
            # MISSIONS_DIR (e.g. just saved via /mission/save), resolve
            # it there automatically so the frontend doesn't need to
            # track absolute paths.
            candidate = MISSIONS_DIR / filepath
            resolved = str(candidate) if candidate.exists() else filepath
            try:
                m_id = dispatcher.load_mission(resolved)
                self._send_json({"ok": True, "mission_id": m_id, "resolved_path": resolved})
            except FileNotFoundError as e:
                self._send_json({"ok": False, "error": str(e)}, 404)

        elif self.path == "/mission/run":
            started = dispatcher.start_mission()
            self._send_json({"ok": started, **_mission_status()})

        elif self.path == "/mission/pause":
            dispatcher.pause_mission()
            self._send_json({"ok": True, **_mission_status()})

        elif self.path == "/mission/resume":
            dispatcher.resume_mission()
            self._send_json({"ok": True, **_mission_status()})

        elif self.path == "/mission/abort":
            dispatcher.abort_mission()
            self._send_json({"ok": True, **_mission_status()})

        else:
            self._send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        print(f"[command_web_bridge] {fmt % args}")


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[command_web_bridge] Listening on http://{HOST}:{PORT}")
    print(f"[command_web_bridge] Mission files saved/loaded from: {MISSIONS_DIR}")
    print("[command_web_bridge] Wrapping Command.py's DroneBridge + "
          "MissionDispatcher (imported unmodified)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[command_web_bridge] Shutting down.")
        drone.close()
        server.server_close()
