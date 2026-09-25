<div align="center">

<img src="https://github.com/user-attachments/assets/0b842cf0-5c3f-4856-8616-5957653eb8d8" alt="B.A.A.J. Logo" width="300">

# Project B.A.A.J.
### Broad Spectrum Autonomous Aerial Joint Rescue

<em>An autonomous aerial search-and-rescue ecosystem for disaster response</em>

<p>
 <img src="https://img.shields.io/badge/SIH-2026-FF6B35?style=for-the-badge&labelColor=1a1a1a" alt="SIH 2026">
 <img src="https://img.shields.io/badge/Problem%20Statement-SIH26206-2E86AB?style=for-the-badge&labelColor=1a1a1a" alt="Problem Statement">
 <img src="https://img.shields.io/badge/Category-Software-6A4C93?style=for-the-badge&labelColor=1a1a1a" alt="Category">
 <img src="https://img.shields.io/badge/Status-Prototype-1B998B?style=for-the-badge&labelColor=1a1a1a" alt="Status">
</p>

<p>
 <img src="https://img.shields.io/badge/React-149ECA?style=flat-square&logo=react&logoColor=white" alt="React">
 <img src="https://img.shields.io/badge/CesiumJS-1A1A1A?style=flat-square&logo=cesium&logoColor=6FC6E6" alt="CesiumJS">
 <img src="https://img.shields.io/badge/Python-FFD43B?style=flat-square&logo=python&logoColor=blue" alt="Python">
 <img src="https://img.shields.io/badge/MATLAB%2FSimulink-D95319?style=flat-square&logo=mathworks&logoColor=white" alt="MATLAB/Simulink">
 <img src="https://img.shields.io/badge/YOLOv8n-00FFFF?style=flat-square&logo=ultralytics&logoColor=black" alt="YOLOv8n">
</p>

</div>

---

## Table of Contents

- [1. System Ecosystem Overview](#1-system-ecosystem-overview)
- [2. Prototype Architecture & Operational Workflow](#2-prototype-architecture--operational-workflow)
- [3. Demonstration](#3-demonstration)
- [4. Nomenclature & Tactical Directory](#4-nomenclature--tactical-directory)
- [5. Available Support for Role-Specific UAVs](#5-available-support-for-role-specific-uavs)
- [6. CivTAK Integration: Inspiration vs. Custom Implementation](#6-civtak-integration-inspiration-vs-custom-implementation)
- [7. Simulation & Modelling: Why MATLAB / Simulink?](#7-simulation--modelling-why-matlab--simulink)
- [8. Future Roadmap](#8-future-roadmap)

---

## 1. System Ecosystem Overview

Project B.A.A.J. is a multi-tier, hardware-agnostic autonomous aerial search-and-rescue (SAR) ecosystem designed for immediate deployment during humanitarian assistance and disaster relief (HADR) operations. The architecture unifies national-scale alert aggregation, edge autonomy, and tactical command into a closed loop:

| Component | Description |
|---|---|
| **Cloud Event Engine** | Automated ingest services pull early warning feeds (GDACS, IMD, Red Cross) and route geographic incident metadata to regional Ground Control Units (GCUs). |
| **Tactical Command Dashboard ("Sentinel")** | A lightweight React and Cesium 3D geospatial interface that enables field operators to supervise telemetry, configure mission grids, and validate automated flight routes via a Human-In-The-Loop (HITL) gate. |
| **Hardware-Agnostic Edge Brain** | An onboard compute runtime deployed on quadcopters to conduct autonomous obstacle avoidance, GPS-denied navigation, sensor fusion, and real-time survivor detection. |
| **Resilient Field Mesh** | An ad-hoc hybrid network combining Layer-2 routing, edge pub/sub, and sub-GHz store-and-forward links to maintain operations across compromised communication infrastructure. |

---

## 2. Prototype Architecture & Operational Workflow

The functioning prototype executes disaster reconnaissance through an automated four-phase pipeline:

<div align="center">
<img width="900" alt="Prototype architecture overview" src="https://github.com/user-attachments/assets/15a8cc42-36f0-4af1-83dd-c6167a7a82eb">
</div>

> [!NOTE]
> Every mission passes through a mandatory Human-In-The-Loop (HITL) checkpoint (Phase 2) before any autonomous flight command is dispatched.

1. **Alert Parsing & Tactical Assignment**
   Cloud dispatchers (`dispatcher.py`) process disaster coordinates and query Firebase for the closest active rescue battalion. The tactical GCU generates optimised search polygons based on terrain topography.

2. **HITL Validation & Plan Compilation**
   Operators review proposed mission vectors on the 3D Cesium interface. Confirmed missions are serialised into compact JSON mission binaries and Cursor-on-Target (CoT) XML packets.

3. **Autonomous GPS-Denied Ingress**
   Companion computers execute onboard Error-State Kalman Filtering (ESKF), combining downward LiDAR altimetry, optical flow odometry, and high-rate IMU telemetry to traverse dust, smoke, or signal-jammed areas without satellite dependency.

4. **Edge Triage & Survivor Mapping**
   Ultralytics YOLOv8n runs inference over thermal camera feeds directly on edge compute boards, delivering **30 FPS at 7–15 W**. Confirmed casualty coordinates and clear, debris-free medic transit routes are packaged and transmitted back to ground teams.

---

## 3. Demonstration

### 3.1 Demo Video

**Prototype Demonstration:** [Watch the demo video](https://youtu.be/OGH36LjND9g)

### 3.2 Prototype Images

<details open>
<summary><b>Ground Control Unit ("Sentinel")</b></summary>
<br>

**Cesium 3D map view**

<img width="900" alt="Sentinel GCU Cesium 3D map view" src="https://github.com/user-attachments/assets/0abc4bb9-c872-4a9a-838c-befb765e8bf4">

**Relayed telemetry display**

<img width="900" alt="Sentinel GCU relayed telemetry display" src="https://github.com/user-attachments/assets/58a42e95-9cc0-4eab-a206-fee8c8b47f8e">

</details>

<details open>
<summary><b>MATLAB Simulation</b></summary>
<br>

**Test run in a default Simulink scene**

<img width="600" alt="MATLAB Simulink test run in a default scene" src="https://github.com/user-attachments/assets/baf91c99-01fb-49ca-a138-9a80836098df">

**Data collected by the UAV brain during the test run**

<img width="900" alt="UAV brain telemetry data collected during test run" src="https://github.com/user-attachments/assets/62424133-6132-4fa8-87f7-bc4385ea8b9a">

</details>

---

## 4. Nomenclature & Tactical Directory

| Nomenclature | Full Form / Term | Operational Role within Ecosystem |
|---|---|---|
| **B.A.A.J.** | Broad Spectrum Autonomous Aerial Joint Rescue | The primary umbrella project and architectural standard. |
| **GCU** | Ground Control Unit ("Sentinel") | Tactical operator station running the React/Cesium mission planner and mesh coordinator. |
| **HITL** | Human-In-The-Loop | Mandated safety validation step before autonomous mission plans are dispatched to UAVs. |
| **BAAJ-RSXX** | Seeker (Scout Variant) | Low-altitude quadcopter equipped with 360° 2D LiDAR, optical flow, and thermal YOLO for survivor search and ground routing. |
| **BAAJ-CLXX** | Courier (Logistics Variant) | Autonomous payload hauler carrying emergency relief kits directly to confirmed survivor locations. |
| **BAAJ-C2XX** | Overseer (Command/Relay Variant) | High-altitude airborne node with 3D LiDAR for voxel terrain modelling, edge processing, and mesh signal repetition. |
| **batman-adv** | B.A.T.M.A.N. Advanced | Linux Layer-2 routing protocol establishing a decentralised peer-to-peer Wi-Fi mesh among aerial units. |
| **Zenoh** | Eclipse Zenoh | Zero-overhead pub/sub/query middleware delivering low-latency swarm micro-telemetry. |
| **CoT** | Cursor-on-Target | Standardised XML-based tactical messaging protocol for multi-agency geospatial telemetry exchange. |
| **ESKF** | Error-State Kalman Filter | Sensor-fusion estimator fusing LiDAR, optical flow, and inertial states for drift-free flight without GNSS. |

### Nomenclature Formula

Every UAV designation follows a fixed pattern:

```
B.A.A.J-<ROLE><ID> "<CALLSIGN>"
```

- **ROLE** — a two-character role code identifying the UAV's function:
  - `RS` — Reconnaissance & Scouting (Light / Swarm)
  - `CL` — Cargo & Logistics (Relief Delivery)
  - `C2` — Command & Coordination (Heavy / High-Altitude)
- **ID (`XX`)** — a two-digit identifier for the specific drone unit currently flying, tied to the Ground Control Unit (GCU) it is connected to.

**Deployment example (Ecosystem 1):**

| Designation | Callsign | Role |
|---|---|---|
| `BAAJ-RS01` | "Seeker" | Light Scout / Swarm |
| `BAAJ-CL01` | "Courier" | Relief Delivery |
| `BAAJ-C201` | "Overseer" | High-Altitude Command Relay |

---

## 5. Available Support for Role-Specific UAVs

Each UAV variant is purpose-built for a distinct role in the rescue pipeline based on its airframe, but all variants share a common navigation and communication core.

### BAAJ-RSXX — Seeker (Scout / Swarm)

<img width="480" alt="BAAJ-RSXX Seeker" src="https://github.com/user-attachments/assets/9f9c66df-2add-4119-aaa9-4f63c6e14422">

The Seeker is the primary light unit that searches the disaster site for survivors using thermal imaging and YOLO, then relays survivor coordinates to ground workers. It also scans the terrain it flies over to generate a route for ground workers to reach a survivor's location, and can reroute that path if it becomes blocked. Seeker units can operate individually or network together as a **swarm unit** for wider search coverage.

**Features:**
- 360° 2D rotating LiDAR
- Optical odometry
- GPS-denied navigation
- Survivor detection and coordinate marking
- Flies at lower altitude
- Route planning for ground units

### BAAJ-CLXX — Courier (Logistics)

<img width="480" alt="BAAJ-CLXX Courier" src="https://github.com/user-attachments/assets/9049151e-07fc-47c4-bb62-9759152ca2bc">

The Courier is the relief-delivery unit, supplying relief materials directly to confirmed survivor locations. It shares the Seeker's full sensor and navigation suite, with the added ability to carry and drop payloads.

**Features:**
- All Seeker features (LiDAR, optical odometry, GPS-denied navigation, route planning)
- Payload carry and precision drop capability
- Relief drop-site coordination with ground medical teams

### BAAJ-C2XX — Overseer (Command / Relay)

<img width="480" alt="BAAJ-C2XX Overseer" src="https://github.com/user-attachments/assets/f9be7b38-458b-4028-a314-7dadcfcdafe1">

The Overseer is the high-altitude command and relay node, providing airborne coordination and more advanced LiDAR mapping support for the rest of the fleet.

**Features:**
- Full 3D map creation
- Higher onboard computation power
- 3D LiDAR and voxel terrain modelling
- Higher navigation precision
- Flies at higher altitude for extended coverage and mesh signal relay

---

## 6. CivTAK Integration: Inspiration vs. Custom Implementation

### The Inspiration

The Civilian Team Awareness Kit (CivTAK/ATAK) is a global benchmark for tactical situational awareness, geospatial mapping, and Cursor-on-Target (CoT) communication across civil defence networks. Its ability to maintain common operating pictures across diverse field agents inspired B.A.A.J.'s communication standards.

### Why B.A.A.J. Uses a Custom Tactical Engine Instead of Pure CivTAK

> [!IMPORTANT]
> B.A.A.J. does not replace CivTAK — it complements it, adding autonomous tasking on top of the situational-awareness layer CivTAK already provides.

- **Tailored for Indian Disaster Response Frameworks** — CivTAK requires intricate server provisioning (TAK Server / FreeTAKServer), digital certificate distribution, and complex military-standard workflows. Field personnel across agencies like NDRF, SDRF, state police, and civil defence volunteers require an instant, zero-install, zero-training interface accessible directly through field browsers and smartphones.

- **Autonomous Tasking vs. Situational Awareness** — CivTAK functions primarily as a human tracker and situational awareness tool. It does not natively synthesise meteorological feeds, compute multirotor search matrices, or interface directly with companion brains for autonomous trajectory generation. B.A.A.J. closes this gap by transforming raw GDACS/IMD data into executable flight plans with one click.

- **Full CoT Protocol Compatibility Retained** — Rather than abandoning CivTAK, Sentinel includes a Cursor-on-Target packager. If military or central agencies deployed in the disaster zone require data feeds, B.A.A.J. streams real-time CoT XML packets directly into their existing TAK infrastructure.

---

## 7. Simulation & Modelling: Why MATLAB / Simulink?

The simulation and control validation phases of Project B.A.A.J. leverage MATLAB and Simulink based on proven aerospace and robotics industry practices:

- **Model-Based Design Verification** — Proven across aerospace programmes (NASA, ISRO, Airbus, Boeing) for certifiable model-based development, mitigating the risk of physical airframe loss during edge-autonomy prototyping.

- **Deterministic Sensor Degradation Testing** — High-fidelity simulation of edge-case physical failures — such as optical flow degradation over featureless water, smoke, or collapsing debris fields — enabling robust verification of multi-sensor failovers.

- **Mathematical Estimator Benchmarking** — Simplifies validation of the Error-State Kalman Filter (ESKF) equations against absolute simulation ground truth before compiling mathematical models into embedded C++ binaries.

- **Software-In-The-Loop (SITL) Interoperability** — Interfaces directly with MAVLink channels, ROS, and flight software stacks, enabling multi-agent swarm logic testing under simulated communication delays and signal dropouts.

---

## 8. Future Roadmap

- [ ] **Precision Aerial Winch System** — Implement active-tether payload delivery on the BAAJ-CLXX Courier for safe material lowers in dense tree canopy or urban ruins.
- [ ] **Distributed Collaborative SLAM** — Enable multi-UAV sub-map sharing where Seeker drones upload local 2D scans to an Overseer node to assemble a unified tactical point-cloud map in real time.
- [ ] **Acoustic Localisation Arrays** — Integrate directional microphone arrays on Seeker units to triangulate survivor vocal calls and distress whistles, cross-referencing thermal YOLO bounding boxes.
- [ ] **Hardware Rollout & Procurement Alignment** — Transition retrofitted COTS airframes to field validation exercises alongside regional SDRF and civil defence units under standard Indian HADR operational protocols.

---

<div align="center">
<sub>Built for <b>Smart India Hackathon 2026</b> · Problem Statement <code>SIH26206</code></sub>
</div>
