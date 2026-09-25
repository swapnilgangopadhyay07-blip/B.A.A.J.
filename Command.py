import socket
import struct
import threading
import time
import math
import json
import os
import sys

class DroneBridge:
    """High-speed asynchronous network adapter communicating with the Simulink quadrotor."""
    def __init__(self, cmd_ip="127.0.0.1", cmd_port=5001, telem_ip="0.0.0.0", telem_port=5002):
        self.cmd_addr = (cmd_ip, cmd_port)
        self.telem_addr = (telem_ip, telem_port)
        
        self.cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.cmd_sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024)
        
        self.telem_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.telem_sock.bind(self.telem_addr)
        self.telem_sock.settimeout(0.05)
        
        self.latest_telem = {}
        self.running = True
        
        self.rx_thread = threading.Thread(target=self._telemetry_listener, daemon=True)
        self.rx_thread.start()

    def send_command(self, cmd_id: int, p1=0.0, p2=0.0, p3=0.0, p4=0.0):
        """Packs and transmits an 18-byte binary command packet with zero latency."""
        packet = struct.pack('<BBffff', 0xAA, int(cmd_id), float(p1), float(p2), float(p3), float(p4))
        self.cmd_sock.sendto(packet, self.cmd_addr)

    def _telemetry_listener(self):
        """High-frequency non-blocking parser for the 20-double telemetry stream."""
        ref_lat, ref_lon = 26.99484, 88.28542
        while self.running:
            try:
                data, _ = self.telem_sock.recvfrom(512)
                if len(data) >= 160: # 20 doubles * 8 bytes
                    vals = struct.unpack('<20d', data[:160])
                    lat, lon = vals[0], vals[1]
                    north = (lat - ref_lat) * 111320.0
                    east  = (lon - ref_lon) * (111320.0 * math.cos(math.radians(ref_lat)))
                    self.latest_telem = {
                        "lat": lat,
                        "lon": lon,
                        "alt": vals[2],
                        "north": north,
                        "east": east,
                        "vx": vals[3],
                        "vy": vals[4],
                        "vz": vals[5],
                        "roll": math.degrees(vals[6]),
                        "pitch": math.degrees(vals[7]),
                        "yaw": math.degrees(vals[8]),
                        "thrust": vals[15],
                        "active_wp": int(vals[16]),
                        "num_route_pts": int(vals[17]),
                        "mission_phase": int(vals[18]),
                        "survivor_lock": (vals[19] > 0.5),
                        "timestamp": time.time()
                    }
            except socket.timeout:
                continue
            except Exception:
                break

    def get_telemetry(self):
        return self.latest_telem

    def close(self):
        self.running = False
        self.cmd_sock.close()
        self.telem_sock.close()


class MissionDispatcher:
    """Deterministic Autonomous Mission Executor with real-time waypoint progression."""
    def __init__(self, bridge: DroneBridge):
        self.bridge = bridge
        self.active_mission = None
        self.step_idx = 0
        self.is_running = False
        self.is_paused = False
        self.thread = None

    def load_mission(self, filepath: str):
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Mission file '{filepath}' not found.")
        with open(filepath, 'r') as f:
            self.active_mission = json.load(f)
        self.step_idx = 0
        return self.active_mission.get("mission_id", "UNKNOWN_MISSION")

    def start_mission(self):
        if not self.active_mission:
            print("[DISPATCHER ERR] No mission loaded.")
            return False
        self.is_running = True
        self.is_paused = False
        self.step_idx = 0
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        return True

    def pause_mission(self):
        self.is_paused = True
        self.bridge.send_command(2)

    def resume_mission(self):
        self.is_paused = False

    def abort_mission(self):
        self.is_running = False
        self.bridge.send_command(5)
        print("[DISPATCHER WARN] Mission aborted! Emergency RTL dispatched.")

    def inject_sos_diversion(self, north: float, east: float, alt=14.0, triage_code=1):
        print(f"\n[SOS DIVERSION] Prioritizing survivor datum -> North: {north}m, East: {east}m [Triage: {triage_code}]")
        self.pause_mission()
        self.bridge.send_command(4, north, east, alt, 1.0)

    def _run_loop(self):
        steps = self.active_mission.get("plan", [])
        total_steps = len(steps)
        print(f"[DISPATCHER] Launching mission: {self.active_mission.get('mission_id')} ({total_steps} legs)")

        while self.is_running and self.step_idx < total_steps:
            if self.is_paused:
                time.sleep(0.2)
                continue

            step = steps[self.step_idx]
            action = step.get("action", "").upper()
            step_id = step.get("step", self.step_idx + 1)
            print(f"\n[LEG #{step_id}/{total_steps}] Action: {action}")

            if action == "TAKEOFF":
                alt = float(step.get("alt", 14.0))
                self.bridge.send_command(1, 0, 0, alt, 0)
                self._wait_altitude(alt, tolerance=1.5)

            elif action == "GOTO":
                n = float(step.get("north", 0.0))
                e = float(step.get("east", 0.0))
                alt = float(step.get("alt", 14.0))
                yaw = float(step.get("yaw", 0.0))
                self.bridge.send_command(3, n, e, alt, yaw)
                self._wait_position(n, e, tolerance=4.0)

            elif action == "SEARCH":
                n = float(step.get("north", 145.0))
                e = float(step.get("east", 50.0))
                alt = float(step.get("alt", 14.0))
                pattern = step.get("pattern", "CREEPING_LINE").upper()
                p4_code = 2.0 if pattern == "CREEPING_LINE" else 1.0
                
                print(f"[SEARCH] Dispatching pattern at N:{n}m, E:{e}m, Alt:{alt}m")
                self.bridge.send_command(4, n, e, alt, p4_code)
                time.sleep(1.0)
                self._wait_search_completion(timeout=180.0)

            elif action == "HOLD":
                dur = float(step.get("duration_sec", 4.0))
                print(f"[HOLD] Loitering for {dur} seconds...")
                self.bridge.send_command(2)
                time.sleep(dur)

            elif action == "RTL":
                self.bridge.send_command(5)
                self._wait_position(0.0, 0.0, tolerance=4.5)

            elif action == "LAND":
                self.bridge.send_command(6)
                self._wait_altitude(0.5, tolerance=0.5)

            self.step_idx += 1

        if self.is_running:
            print("\n[DISPATCHER SUCCESS] Full autonomous mission completed successfully.")
            self.is_running = False

    def _wait_position(self, target_n, target_e, tolerance=4.0, timeout=100.0):
        t0 = time.time()
        while time.time() - t0 < timeout and self.is_running and not self.is_paused:
            telem = self.bridge.get_telemetry()
            if telem:
                d = math.sqrt((telem["north"] - target_n)**2 + (telem["east"] - target_e)**2)
                if d <= tolerance:
                    return True
            time.sleep(0.1)
        return False

    def _wait_altitude(self, target_alt, tolerance=1.2, timeout=30.0):
        t0 = time.time()
        while time.time() - t0 < timeout and self.is_running and not self.is_paused:
            telem = self.bridge.get_telemetry()
            if telem and abs(telem["alt"] - target_alt) <= tolerance:
                return True
            time.sleep(0.1)
        return False

    def _wait_search_completion(self, timeout=180.0):
        """Waits for the drone to fly through all waypoints of the search pattern."""
        t0 = time.time()
        last_wp = 0
        while time.time() - t0 < timeout and self.is_running and not self.is_paused:
            telem = self.bridge.get_telemetry()
            if telem:
                act = telem.get("active_wp", 0)
                tot = telem.get("num_route_pts", 1)
                if act != last_wp and tot > 1:
                    print(f"  -> Traversed Search Leg {act}/{tot} [Lock: {telem.get('survivor_lock')}]")
                    last_wp = act
                if tot > 1 and act >= tot:
                    time.sleep(2.0)
                    print("[SEARCH COMPLETED] All legs traversed successfully.")
                    return True
            time.sleep(0.2)
        return False


def print_status_table(telem: dict):
    if not telem:
        print("[WARN] No telemetry received from drone simulation yet.")
        return
    spd = math.sqrt(telem['vx']**2 + telem['vy']**2)
    print("\n" + "═" * 62)
    print("           REAL-TIME HIGH-SPEED TELEMETRY MONITOR          ")
    print("═" * 62)
    print(f" Coordinates     : North: {telem['north']:>6.1f} m | East: {telem['east']:>6.1f} m")
    print(f" Altitude AGL    : {telem['alt']:>6.2f} m | Vz: {telem['vz']:>5.2f} m/s")
    print(f" Groundspeed     : {spd:>5.2f} m/s ({spd*3.6:>5.1f} km/h)")
    print(f" Attitude Angles : Roll: {telem['roll']:>5.1f}° | Pitch: {telem['pitch']:>5.1f}° | Yaw: {telem['yaw']:>5.1f}°")
    print(f" Pattern Status  : Leg #{telem['active_wp']} of {telem['num_route_pts']} | Phase: {telem['mission_phase']}")
    print(f" YOLO Target Lock: {'[YES - SURVIVOR LOCKED]' if telem['survivor_lock'] else '[NO - CLEAR]'}")
    print("═" * 62 + "\n")


def run_cli():
    drone = DroneBridge()
    dispatcher = MissionDispatcher(drone)
    print("═" * 66)
    print(" AUTONOMOUS SAR MISSION DISPATCHER & TACTICAL CLI COMMANDER")
    print("═" * 66)

    try:
        while True:
            cmd_line = input("sar@brain:~$ ").strip()
            if not cmd_line:
                continue

            tokens = cmd_line.split()
            verb = tokens[0].lower()

            if verb == "mission":
                if len(tokens) < 2:
                    print("Usage: mission <load|run|pause|resume|abort> [file]")
                    continue
                sub = tokens[1].lower()
                if sub == "load":
                    fname = tokens[2] if len(tokens) > 2 else "mission_us_cityblock.json"
                    try:
                        m_id = dispatcher.load_mission(fname)
                        print(f"[MISSION LOADED] ID: {m_id} from '{fname}'")
                    except Exception as e:
                        print(f"[ERROR] {e}")
                elif sub == "run":
                    if dispatcher.start_mission():
                        print("[MISSION STARTED] Autonomous dispatcher active.")
                elif sub == "pause":
                    dispatcher.pause_mission()
                    print("[MISSION PAUSED]")
                elif sub == "resume":
                    dispatcher.resume_mission()
                    print("[MISSION RESUMED]")
                elif sub == "abort":
                    dispatcher.abort_mission()

            elif verb == "sos":
                if len(tokens) < 3:
                    print("Usage: sos <North> <East> [Alt=14.0] [TriageCode=1]")
                    continue
                n, e = float(tokens[1]), float(tokens[2])
                alt = float(tokens[3]) if len(tokens) > 3 else 14.0
                trg = int(tokens[4]) if len(tokens) > 4 else 1
                dispatcher.inject_sos_diversion(n, e, alt, trg)

            elif verb == "takeoff":
                alt = float(tokens[1]) if len(tokens) > 1 else 14.0
                drone.send_command(1, 0, 0, alt, 0)
                print(f"[CMD] Climb dispatched to {alt}m AGL.")

            elif verb == "hold":
                drone.send_command(2)
                print("[CMD] Position hold engaged.")

            elif verb == "goto":
                if len(tokens) < 4:
                    print("Usage: goto <North> <East> <Alt> [YawDeg]")
                    continue
                n, e, alt = float(tokens[1]), float(tokens[2]), float(tokens[3])
                yaw = float(tokens[4]) if len(tokens) > 4 else 0.0
                drone.send_command(3, n, e, alt, yaw)
                print(f"[CMD] Transit vector -> N:{n}m, E:{e}m, Alt:{alt}m, Yaw:{yaw}°.")

            elif verb == "search":
                if len(tokens) < 3:
                    print("Usage: search <North> <East> [Alt=14.0] [1=Square|2=CreepingLine]")
                    continue
                n, e = float(tokens[1]), float(tokens[2])
                alt = float(tokens[3]) if len(tokens) > 3 else 14.0
                p_type = float(tokens[4]) if len(tokens) > 4 else 2.0
                drone.send_command(4, n, e, alt, p_type)
                print(f"[CMD] SAR sweep active at [{n}, {e}], Alt:{alt}m, Pattern:{p_type}.")

            elif verb == "rtl":
                drone.send_command(5)
                print("[CMD] Tactical RTL engaged.")

            elif verb == "land":
                drone.send_command(6)
                print("[CMD] Touchdown descent initiated.")

            elif verb == "status":
                print_status_table(drone.get_telemetry())

            elif verb in ["quit", "exit"]:
                print("Shutting down mission bridge...")
                break

            elif verb == "help":
                print("\nAvailable Tactical Operations:")
                print("  mission load <file.json>    - Ingest structured SAR mission plan")
                print("  mission run                 - Execute loaded plan autonomously with closed-loop feedback")
                print("  mission pause / resume      - Temporarily hold flight pattern or resume")
                print("  mission abort               - Terminate plan and perform immediate RTL")
                print("  sos <North> <East> [alt]    - Inject priority survivor alert and divert drone immediately")
                print("  goto <x> <y> <z> [yaw]      - Vector directly to coordinates")
                print("  search <x> <y> [alt] [type] - 1: Expanding Square, 2: Creeping Line")
                print("  takeoff / hold / rtl / land - Manual override primitives")
                print("  status                      - Display real-time telemetry metrics")
                print("  exit                        - Shutdown bridge\n")
            else:
                print(f"Unknown command: '{verb}'. Type 'help' for options.")

    except KeyboardInterrupt:
        print("\nTermination signal received.")
    finally:
        drone.close()

if __name__ == "__main__":
    run_cli()