# SafeSpace Workforce: Employee Management and Face Recognition Configuration

SafeSpace Workforce is the SafeSpace application for managing employees, their face registrations, shifts, and entry/exit cameras, and for turning face recognition results into IN/OUT attendance.

It does not contain its own face recognition. Every face check and every recognition runs through the existing SafeSpace recognition pipeline (from the Triton project), the `restaurant_vision` package in the existing `triton-2-backend/compute` directory. That pipeline and its models are called unchanged, as subprocesses of their own Python environment. This application adds the management, configuration, event-processing and attendance layer around it.

```
Camera configuration (IN/OUT, global) → Employee registration → Face registration → Shift
        → existing Triton pipeline (detection, tracking, face recognition)
        → employee identity → IN/OUT event rules → attendance sessions
```

## Contents

- [Project overview](#project-overview)
- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Installation](#installation)
- [Development](#development)
- [Production build](#production-build)
- [Running the application](#running-the-application)
- [Face registration flow](#face-registration-flow)
- [Camera configuration](#camera-configuration)
- [Employee IN/OUT flow](#employee-inout-flow)
- [Existing pipeline integration](#existing-pipeline-integration)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Security considerations](#security-considerations)

## Project overview

| Area | What it does |
| --- | --- |
| **Dashboard** | Shows headcount, face registration coverage, who is currently in or out, today's entry and exit events, and camera health. It also lists recent events, employees inside, registration status and a shift summary. |
| **Employees** | Register, edit, activate and deactivate employees. Deactivation keeps all history. The list supports search, filters (status, face status, shift, department), sorting and pagination. |
| **Face Registration** | A three-step flow: pick the employee, capture from a webcam or upload a JPEG/PNG, then register through the pipeline. The flow shows validation messages, lets you replace a face with confirmation, request re-registration, or remove the face data. |
| **Shifts** | Create, edit, activate and deactivate shifts. A shift has a start and end time (night shifts can cross midnight), a grace period and working days. You can assign employees to a shift here. |
| **Camera Configuration** | Manage cameras: Camera ID, name, location, type, stream address and direction (Entry, Exit, or Entry & Exit). You can enable or disable a camera and check its connection with ffprobe. The direction is the single, global IN/OUT setting: it applies to every employee, and the page shows which enabled cameras record IN and which record OUT. |
| **Footage Analysis** | Import a recording exported from a camera, with the date and time of its first frame. The worker analyses it with the existing pipeline and records IN/OUT events. |
| **Recognition Activity** | Lists every event with employee, event type, time, camera, location, confidence, recognition status and source. Uncertain events can be reviewed. |
| **Attendance** | Pairs confirmed IN and OUT events into sessions, flags late arrivals, and shows "Entry/Exit event not recorded" instead of making up a time. |
| **Settings** | Attendance rules, face registration rules, the site time zone, read-only recognition pipeline status, and user accounts. |

Sample data is never shown to make a screen look populated. Every list shows a proper empty state until real records exist.

## Architecture

```
 Browser (React SPA)
   │  same-origin /api/v1 (session cookie + CSRF header)
   ▼
 FastAPI backend (employee_api)  ──────────────►  PostgreSQL
   │  enqueues jobs (face.register, footage.analyse)     ▲
   ▼                                                     │
 Recognition worker (python -m employee_api.worker) ─────┘
   │  subprocess, own interpreter + CUDA library path
   ▼
 Existing Triton pipeline: restaurant_vision
   • pipeline.face_sample_cli   (InsightFace buffalo_l det_10g + w600k_r50)
   • observe                    (RF-DETR Medium + ByteTrack + InsightFace + identity resolution)
```

### Frontend (`frontend/`)
- React 18, TypeScript (strict), Vite 5, React Router 6, TanStack Query 5 and lucide-react.
- The design system (tokens, navy sidebar, Plus Jakarta Sans, cards, tables, badges, pill tabs, modals) follows the existing Triton application's `safespace-theme.css` and `product.css`. It uses the same SafeSpace brand asset.
- All API calls go through `src/api/client.ts`, which is same-origin, adds the CSRF header and returns typed `ApiError`s. Data hooks are in `src/api/queries.ts`.
- Times are always shown in the site time zone from Settings.

### Backend (`backend/employee_api/`)
- FastAPI, SQLAlchemy 2, Alembic, Pydantic 2, psycopg 3 and Argon2 for passwords, running on Python 3.11 or later.
- It never imports the pipeline or any GPU library; it only launches the pipeline as a subprocess. This is the same boundary the existing backend's `compute_bridge.py` keeps.
- JSON uses camelCase, and every error has the shape `{"error": {"code", "message", "fields"?}}` with administrator-readable messages.

### Database
PostgreSQL. The schema is in `backend/migrations/versions/0001_initial_schema.py`.

| Table | Purpose |
| --- | --- |
| `employees` | Employee record, shift, face status, current registration |
| `face_registrations` | Every registration attempt; the current one holds the image path and the 512-d embedding (never serialised) |
| `shifts` | Name, type, start/end, grace period, ISO working days, status |
| `cameras` | Camera ID, name, location, type, direction, stream address, enabled, last connection check |
| `footage_recordings` | Imported recordings, capture start, analysis status and counts |
| `recognition_events` | IN/OUT events with confidence, status and pipeline decision reference |
| `jobs` | Queue for pipeline work (lease-based, `FOR UPDATE SKIP LOCKED`) |
| `audit_log` | Every administrative change |
| `users`, `user_sessions` | Accounts (Argon2id) and server-side sessions |
| `system_settings` | Attendance, registration and time zone rules (one validated JSON document) |

### Existing recognition pipeline
The existing pipeline is reused unchanged; see [Existing pipeline integration](#existing-pipeline-integration).

### Camera layer
- A camera is a configuration record: identity, location, direction, and an optional RTSP/HTTP stream address.
- **Connection check:** "Check connection" runs `ffprobe` once against the stream and records Online or Offline.
- **Recognition input:** the existing pipeline processes recorded video, and live stream ingestion is not part of it. So recognition input is footage exported from the camera or NVR and imported under Footage Analysis.

### Employee management layer
Employees, shifts, cameras, face registrations, users and settings, each with validation on both the backend and the frontend, and each change written to the audit log.

### Attendance and event processing
- `services/events.py` turns each identity decision from the pipeline into an IN or OUT event and classifies it.
- `services/attendance.py` pairs confirmed events into sessions.

See [Employee IN/OUT flow](#employee-inout-flow).

## Folder structure

```text
employee-management/
├── README.md
├── .gitignore
├── backend/
│   ├── pyproject.toml              Python package and dependencies
│   ├── .env.example                Every environment variable, documented
│   ├── alembic.ini
│   ├── migrations/                 Alembic environment and the initial schema
│   ├── employee_api/
│   │   ├── main.py                 App factory, routers, security headers, optional SPA serving
│   │   ├── config.py               Central settings (EMS_* environment variables)
│   │   ├── db.py, models.py        SQLAlchemy engine/session and entities
│   │   ├── schemas.py              Validated request bodies
│   │   ├── serializers.py          Response shapes (no embeddings, masked stream credentials)
│   │   ├── security.py, deps.py    Argon2, sessions, roles/permissions, CSRF and Origin checks
│   │   ├── audit.py                Audit trail (redacts secrets)
│   │   ├── storage.py              Face image / footage storage and image header validation
│   │   ├── jobs.py, worker.py      PostgreSQL job queue and the recognition worker
│   │   ├── cli.py                  create-admin, pipeline-status
│   │   ├── api/                    Routers: auth, users, employees (incl. faces), shifts,
│   │   │                           cameras, footage, activity (events, attendance, dashboard), settings
│   │   ├── pipeline/               Integration with the existing pipeline
│   │   │   ├── bridge.py           Subprocess runner (interpreter, cwd, CUDA library path)
│   │   │   ├── face_registration.py  face_sample_cli → registration rules → stored embedding
│   │   │   ├── footage_analysis.py   gallery build → observe → identity decisions → events
│   │   │   └── status.py           Model presence, fingerprint and threshold profile
│   │   └── services/
│   │       ├── rules.py            Editable attendance/registration/time zone rules
│   │       ├── events.py           Detection → IN/OUT event classification
│   │       └── attendance.py       Session pairing, late arrival, presence
│   └── tests/                      Pytest suite (real PostgreSQL, real HTTP)
│       └── pipeline_double/        Test-only stand-in for the pipeline CLIs (see Tests)
└── frontend/
    ├── package.json, vite.config.ts, tsconfig.json, index.html
    ├── public/brand/               SafeSpace logo (from the existing application)
    └── src/
        ├── main.tsx, router.tsx
        ├── api/                    client.ts (fetch/CSRF/errors), types.ts, queries.ts
        ├── auth/session.tsx        Session context, login/logout, permission checks
        ├── components/             App shell, UI kit, badges, toasts, face capture,
        │                           camera/shift forms, footage list, filters
        ├── pages/                  One file per screen
        ├── styles/theme.css        SafeSpace design tokens and components
        └── utils/                  Formatting (site time zone), hooks
```

## Prerequisites

| Requirement | Version | Used for |
| --- | --- | --- |
| Python | 3.11 or later | Backend API and worker |
| Node.js and npm | Node 20 or later | Building and developing the frontend |
| PostgreSQL | 14 or later (verified on 18) | Application database |
| FFmpeg (`ffprobe`) | any recent | Camera connection check |
| Existing Triton compute environment | as installed on the GPU host | Face registration and footage analysis |

The existing Triton compute environment on the worker host must provide:
- the `triton-2-backend/compute` directory (the `restaurant_vision` package, with `contract/` beside it);
- its `.venv-compute` interpreter, with torch, onnxruntime-gpu, insightface, rfdetr and trackers as described in `compute/pyproject.toml` and `compute/env.sh`;
- the InsightFace `buffalo_l` model files `det_10g.onnx` and `w600k_r50.onnx`;
- an NVIDIA GPU. The pipeline requires CUDA unless CPU inference is explicitly allowed.

The API itself does not need a GPU. Only the worker runs the pipeline.

## Environment variables

Copy `backend/.env.example` to `backend/.env`. Every variable is read by `employee_api/config.py`.

```text
EMS_DATABASE_URL=                  # required: postgresql+psycopg://USER:PASSWORD@HOST:5432/DB
EMS_STORAGE_DIR=                   # face images, imported footage, pipeline run output (default backend/storage)
EMS_ALLOWED_ORIGINS=               # comma-separated origins allowed to change data (default http://localhost:5180)
EMS_COOKIE_SECURE=                 # true behind HTTPS (default false)
EMS_SESSION_TTL_HOURS=             # session lifetime (default 12)
EMS_FRONTEND_DIST_DIR=             # production: path to frontend/dist to serve the UI from the API
EMS_COMPUTE_ROOT=                  # existing triton-2-backend/compute directory
EMS_COMPUTE_PYTHON=                # existing .venv-compute/bin/python3
EMS_COMPUTE_LIBRARY_PATH=          # LD_LIBRARY_PATH for the pipeline (CUDA 13 / cuDNN order from compute/env.sh)
EMS_INSIGHTFACE_HOME=              # directory containing models/buffalo_l/
EMS_ALLOW_CPU_INFERENCE=           # true lets the pipeline fall back to CPU (default false)
EMS_FACE_REGISTRATION_TIMEOUT_S=   # default 180
EMS_FOOTAGE_ANALYSIS_TIMEOUT_S=    # default 14400
EMS_MAX_FACE_IMAGE_BYTES=          # default 10485760 (10 MB)
EMS_MAX_FOOTAGE_BYTES=             # default 8589934592 (8 GB)
EMS_FFPROBE_PATH=                  # default ffprobe
EMS_WORKER_POLL_SECONDS=           # default 2
EMS_JOB_LEASE_SECONDS=             # default 600
```

`frontend/.env.example` has one optional development variable, `EMS_API_PROXY_TARGET`, used when the API is not on `http://127.0.0.1:8030`.

There are no default credentials and no secrets in the repository. The first administrator is created with the CLI; see [Installation](#installation).

## Installation

```bash
cd employee-management

# 1. Database (as a PostgreSQL superuser)
createuser --pwprompt ems_app
createdb --owner ems_app workforce

# 2. Backend
cd backend
python3 -m venv .venv
. .venv/bin/activate                 # Windows: .venv\Scripts\activate
pip install -e .
cp .env.example .env                 # then edit EMS_DATABASE_URL and the pipeline paths
alembic upgrade head
python -m employee_api.cli create-admin --email you@safespaceglobal.ai --name "Your Name"
python -m employee_api.cli pipeline-status   # confirms the pipeline paths and model files

# 3. Frontend
cd ../frontend
npm ci
```

## Development

### One command

For local testing without an existing PostgreSQL server, `./dev-db.sh start` creates and starts a private cluster in `.devdata/` on `127.0.0.1:55432` (database `workforce`, local connections only); set `EMS_DATABASE_URL=postgresql+psycopg://ems@127.0.0.1:55432/workforce`. `./dev-db.sh stop` stops it.

```bash
./start.sh              # migrations + API (:8030) + recognition worker + frontend dev server (:5180)
./start.sh prod         # builds the frontend and serves it from the API on :8030, plus the worker
./start.sh --no-worker  # without the recognition worker (machine without the pipeline)
```

The script creates the backend virtual environment and installs frontend dependencies on first run, checks the database connection, applies migrations, reports whether the recognition pipeline is available, and prefixes each service's log lines (`[api]`, `[worker]`, `[web]`). Ctrl+C stops everything. PostgreSQL itself must already be running. On Windows, run it from Git Bash.

### Starting each part separately

Start each part in its own terminal, in this order.

1. **Database.** PostgreSQL must be running and migrated (`alembic upgrade head`).
2. **Backend API:**
   ```bash
   cd backend && . .venv/bin/activate
   uvicorn employee_api.main:app --host 127.0.0.1 --port 8030 --reload
   ```
   API documentation is served at `http://127.0.0.1:8030/api/v1/docs`.
3. **Existing recognition pipeline, through the worker.** Run this on the GPU host where the existing compute environment is installed:
   ```bash
   cd backend && . .venv/bin/activate
   python -m employee_api.worker
   ```
   The pipeline is not a separate server. The worker launches it per job, so the pipeline is running whenever the worker is. Run one worker per GPU host; the existing pipeline expects one GPU job at a time.
4. **Frontend:**
   ```bash
   cd frontend && npm run dev
   ```
   Open `http://localhost:5180`. Vite proxies `/api` to the backend, so the cookie and CSRF protection work as in production.

## Production build

```bash
cd frontend
npm ci
npm run build                        # type-checks, then writes frontend/dist

cd ../backend
pip install .
alembic upgrade head
```

Set `EMS_FRONTEND_DIST_DIR=/path/to/frontend/dist`, `EMS_COOKIE_SECURE=true` and `EMS_ALLOWED_ORIGINS=https://your-host`. Then run the API behind an HTTPS reverse proxy:

```bash
uvicorn employee_api.main:app --host 127.0.0.1 --port 8030 --workers 2 --proxy-headers
```

The UI and API then share one origin. Run `python -m employee_api.worker` as a separate service, for example under systemd, on the GPU host.

## Running the application

1. PostgreSQL is up and migrated.
2. The API is running (`/api/v1/health` returns `{"status": "ok"}`).
3. The worker is running on the GPU host with the pipeline variables set. **Settings → Recognition Pipeline** should report "The recognition pipeline is configured".
4. Sign in with the administrator account.
5. Recommended setup order:
   1. **Settings:** set the site time zone.
   2. **Shifts:** create shifts.
   3. **Camera Configuration:** add the cameras and set each one's direction (Entry = IN, Exit = OUT, Entry & Exit = both). This applies to all employees.
   4. **Employees:** add employees.
   5. **Face Registration:** register each employee's face.
   6. **Footage Analysis:** import recordings.
   8. **Recognition Activity / Attendance:** review the results.

## Face registration flow

Each employee has up to three reference images:
- **Front**: required. It decides the employee's face status and must be registered first.
- **Left** and **Right**: optional, added after the front image. They improve recognition when the employee passes a camera at an angle. All registered images of active employees go into the gallery given to the pipeline.

Side images must pass three extra checks:
- The pipeline must see the face as turned, not frontal.
- The two side images must face opposite ways.
- Each side image must match the employee's own front image at or above the *Side image match to front* setting (default 0.25), so a different person cannot be added.

The pipeline's `left`/`right` labels describe where the nose sits in the image, so they depend on camera mirroring. That is why the check is "opposite directions" rather than matching the label to the slot. A single side image can be removed without affecting the rest. *Remove all face data* deletes all three.

The steps below apply to each image:

1. **Select the employee.** Only active employees can be registered.
2. **Capture or upload the image.**
   - **Webcam capture** uses the browser camera API and needs HTTPS or localhost.
   - **Browser checks** before upload: JPEG or PNG only, size within `EMS_MAX_FACE_IMAGE_BYTES`, and readable dimensions of at least 40 px.
   - **Backend checks** repeat all of these from the file header, whatever the declared content type.
3. **Submit.**
   - If the employee already has a face, the request must explicitly confirm replacement. Otherwise the API answers *"A face is already registered for this employee. Re-registering will replace the existing registration."*
   - The image is stored under `EMS_STORAGE_DIR/faces/`.
   - A `face_registrations` row is created with status **Processing**, and a `face.register` job is queued.
4. **The worker runs the existing pipeline:**
   ```
   <EMS_COMPUTE_PYTHON> -m restaurant_vision.pipeline.face_sample_cli --image <file> --out <tmp>
   ```
   This is the pipeline's own enrolment check: InsightFace buffalo_l detection, with rejection for `no_face`, `multiple_faces`, and `low_detection_score` below the profile's `minFaceDetScore`. It then produces the 512-d ArcFace embedding.
5. **Workforce rules are applied on top** (configurable under Settings → Face Registration):
   - minimum face size;
   - frontal pose required;
   - no duplicate faces: the embedding must not be as similar as the configured threshold (default 0.55) to another employee's registered face.
6. **On success:**
   - The registration becomes **Registered** and the embedding is stored in the database.
   - The model fingerprint (sha256 of the detector and embedder files) is recorded.
   - The previous registration's image and embedding are deleted.
7. **On failure:**
   - The registration becomes **Failed** with a specific message. For example: *"No face was detected in the uploaded image. Upload a clear image showing one employee face."*
   - The rejected image is deleted.
   - An existing registration stays in force.

**Registration states:**
- **Not Registered**
- **Processing**
- **Registered**
- **Failed**
- **Requires Re-registration**: an administrator requested it, or the model files changed after registration so the fingerprint no longer matches.

## Camera configuration

| Field | Notes |
| --- | --- |
| Camera ID | Your site/NVR identifier, unique |
| Camera name, Location | Shown on every event |
| Camera type | Dome, Bullet, Turret, PTZ, Box, Other |
| Direction | **Entry**: detections become IN. **Exit**: detections become OUT. **Entry & Exit**: decided from the employee's last confirmed event. |
| Stream / source | Optional RTSP/HTTP address, used by *Check connection*. Only administrators see it in full; everyone else sees it with credentials masked. |
| Status | **Disabled** (turned off), **Configuration Required** (no stream address), **Online** / **Offline** (last connection check), **Not Verified** (never checked). |

**IN/OUT is global.** There is no per-employee camera setup. Every enabled camera recognises every active employee with a registered face, and the camera's direction alone decides whether the sighting is an IN or an OUT. Only administrators can change a camera's direction or enable/disable it. Disabled cameras record nothing. (Migration `0003` removed the earlier per-employee assignments and moved any events held as "Camera Not Assigned" to Needs Review.)

## Employee IN/OUT flow

1. **Import footage.** An administrator imports a recording from a camera and enters the date and time of its first frame, in the site time zone. A `footage.analyse` job is queued.
2. **Build the gallery.** The worker builds a gallery exactly as the existing backend does: `<tmp>/emp_<uuid7>/sample.<ext>` plus `labels.json`, from the registered face images of **active** employees.
3. **Run the pipeline.** The worker runs:
   ```
   <EMS_COMPUTE_PYTHON> -m restaurant_vision.observe --video <file> --camera-id cam_<uuid7>
       --recording-id rec_<uuid7> --run-id run_<uuid7> --out <storage>/runs/<id>
       --gallery <tmp> --gallery-version-id gal_<uuid7> --resume
   ```
   The pipeline detects people (RF-DETR), tracks them (ByteTrack), embeds faces (InsightFace), and resolves identities per track segment with its inherited threshold profile. It writes `identity_decisions.json` and `track_summaries.json`.
4. **Turn decisions into events.** Each decision with status `auto` becomes a detection: the employee, when they were first and last seen (capture start + segment offsets), and the similarity. Decisions with status `review` are also recorded unless Settings says to ignore them. `services/events.py` then:
   - **decides the event type:**
     - Entry camera: **IN** at first seen.
     - Exit camera: **OUT** at last seen.
     - Entry & Exit camera: OUT if the employee's latest confirmed event is an IN within the maximum session length, otherwise IN.
   - **classifies the event**, in this order:
     - **Needs Review**: the pipeline was uncertain.
     - **Duplicate**: a confirmed event of the same type exists within the minimum event interval.
     - **Confirmed**: everything else.
5. **Review.** HR Managers and Administrators can confirm or reject Needs Review events on Recognition Activity.
6. **Pair into attendance.** Confirmed events per employee are walked in time order:
   - An IN opens a session.
   - The next OUT within the maximum session length closes it.
   - Otherwise the missing side is shown as **Entry event not recorded** or **Exit event not recorded**. A time is never made up.
   - A session belongs to the local date of its IN, so night shifts stay one row.
   - An IN later than shift start + grace period is a **late arrival**.

## Existing pipeline integration

**Reused unchanged** (from `triton-2-backend/compute`, invoked as subprocesses):

| Pipeline module | Used for |
| --- | --- |
| `restaurant_vision.pipeline.face_sample_cli` | Face detection, quality rejection and embedding for registration |
| `restaurant_vision.observe` | Person detection, tracking, face embedding and identity resolution on footage |
| InsightFace `buffalo_l` (`det_10g`, `w600k_r50`) | Face detector and embedder |
| RF-DETR Medium + ByteTrack | Person detection and tracking |
| Threshold profile `sc-triton-inherited-2026-09` | Identity match bands; read-only display in Settings |

**Added by this application:**
- employee, shift and camera management;
- storage of face registrations;
- the gallery built from registered faces;
- registration rules (face size, frontal pose, duplicate faces);
- the IN/OUT rules;
- review of uncertain events;
- attendance pairing;
- audit history;
- users and roles.

**Not added:**
- no separate AI pipeline;
- no other face model;
- no external AI or image-generation service;
- no generated faces.

The worker environment is prepared exactly as `compute/env.sh` describes: the interpreter is `EMS_COMPUTE_PYTHON`, the working directory is `EMS_COMPUTE_ROOT`, `LD_LIBRARY_PATH` is set from `EMS_COMPUTE_LIBRARY_PATH` before the process starts, and `INSIGHTFACE_HOME` is set from `EMS_INSIGHTFACE_HOME`.

### Local development without the GPU host (Windows)

Face registration can run on a developer machine with the same pipeline code and models, on CPU:

1. Copy the pipeline, unmodified, into the git-ignored `.devdata/pipeline`. The pipeline reads `../contract` for its threshold profile, so copy both folders:
   ```bash
   cd ../triton-2/triton-2-backend
   git ls-files -z compute contract | xargs -0 git checkout-index --prefix=../../employee-management/.devdata/pipeline/ --
   ```
2. Create its environment. InsightFace 1.0.1, the version the pipeline uses, installs as a prebuilt wheel, so no C++ compiler is needed:
   ```bash
   cd ../../employee-management/.devdata/pipeline
   python -m venv .venv
   .venv/Scripts/python.exe -m pip install --only-binary=:all: insightface==1.0.1 onnxruntime numpy opencv-python-headless scipy jsonschema referencing
   ```
3. Put the `buffalo_l` models in `~/.insightface/models/buffalo_l/`, then add to `backend/.env`:
   ```
   EMS_COMPUTE_ROOT=<repo>/.devdata/pipeline/compute
   EMS_COMPUTE_PYTHON=<repo>/.devdata/pipeline/.venv/Scripts/python.exe
   EMS_INSIGHTFACE_HOME=C:/Users/<you>/.insightface
   EMS_ALLOW_CPU_INFERENCE=true
   ```
4. Confirm with `python -m employee_api.cli pipeline-status`, which should report `"available": true`.

Each face image takes about 5 seconds on CPU. Footage analysis also needs the pipeline's torch, RF-DETR and ByteTrack stack, which this minimal environment does not include.

## Tests

The backend suite runs against a real, empty PostgreSQL database over real HTTP. It covers:
- sign-in, lockout, CSRF, Origin checks and roles;
- employees, shifts and cameras;
- face registration outcomes;
- IN/OUT, duplicate and review rules;
- attendance and the dashboard;
- settings.

```bash
cd backend
pip install -e ".[test]"
EMS_TEST_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/workforce_test pytest
```

The GPU pipeline can't run in CI, so `tests/pipeline_double/` contains a **test-only** stand-in with the same module names, arguments, exit codes and output files as the two pipeline CLIs. The test harness points `EMS_COMPUTE_ROOT` at it, and it is never used outside the tests.

The frontend is type-checked in strict mode by `npm run build` (or `npm run typecheck`).

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| **Backend unavailable**: the UI shows *"The server could not be reached"* | `curl http://127.0.0.1:8030/api/v1/health`. Check that uvicorn is running and look at its log. In development, check that Vite proxies to the right port (`EMS_API_PROXY_TARGET`). |
| **Database unavailable**: API errors at start-up or on every request | Check that PostgreSQL is running and that `EMS_DATABASE_URL` (user, password, host, database) is correct. Run `alembic upgrade head`. |
| **Frontend cannot communicate with backend**: requests return 403 *"came from an origin that is not allowed"* | Add the exact browser origin (scheme, host and port) to `EMS_ALLOWED_ORIGINS`. |
| **Frontend cannot communicate with backend**: signed out after every action | Behind plain HTTP, `EMS_COOKIE_SECURE` must be `false`. Behind HTTPS it must be `true`. |
| **Face registration failure** | Registrations stuck in *Processing* mean the worker is not running. *"The recognition pipeline is unavailable"* means you should run `python -m employee_api.cli pipeline-status` and fix the reported path or model file. For a rejection, the message says what is wrong with the image (no face, several faces, too small, turned away, low quality, duplicate of another employee). |
| **Camera unavailable**: *Offline* after *Check connection* | Verify the stream address, credentials and network route from the API host to the camera or NVR. *"ffprobe is not installed"* means you should install FFmpeg or set `EMS_FFPROBE_PATH`. |
| **Recognition events not appearing** | Check under Footage Analysis that the import is *Completed*, not *Queued* or *Failed*. *"No active employee has a registered face"* means you should register faces first. Check that the first-frame time is correct, because events are dated from it, and filter Recognition Activity to that date. |
| **IN/OUT not being generated** | Check the camera's direction and that it is enabled (Camera Configuration → Attendance timing). Check that the employee is active and has a registered face. Check the *Needs Review* tab. A second sighting within the minimum event interval is a *Duplicate* by design. |
| **Everyone shows "Requires Re-registration"** | The face model files changed. Re-register faces with the new model, or restore the previous files. |
| **The pipeline falls back to CPU / reports a cuDNN mismatch** | Set `EMS_COMPUTE_LIBRARY_PATH` to the CUDA library order from `compute/env.sh`. |

## Security considerations

- **Authentication:**
  - Server-side sessions in an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`, set `Secure` in production.
  - Passwords are hashed with Argon2id and must be at least 12 characters with a letter and a number.
  - After 5 failed sign-ins the account locks for 15 minutes.
  - Deactivating a user or resetting their password ends all of that user's sessions.
- **CSRF and Origin:**
  - Every state-changing request needs the session's CSRF token in `X-CSRF-Token`.
  - Every state-changing request must come from an allowed origin.
- **Roles:**

  | Role | Access |
  | --- | --- |
  | Administrator | Everything, including cameras, stream addresses, footage, settings and users |
  | HR Manager | Employees, face registration, shifts, event review, configuration history |
  | Attendance Viewer | Read-only; cannot see face images or stream credentials |

  Permissions are enforced by the API; the UI only hides what the role cannot use.
- **Biometric data:**
  - Face embeddings live only in the `face_registrations.embedding` column. That column is deferred and no API response includes it.
  - Face images are served only to roles with `faces.view`, with `Cache-Control: no-store`.
  - Rejected images are deleted immediately.
  - When a face is replaced or removed, its image and embedding are deleted, so only one face per employee is kept.
  - Deactivated employees are excluded from recognition, but their data is retained until an administrator removes the face.
- **Logs and audit:**
  - Every administrative change is written to the audit log with the actor, the time and the changed fields.
  - Passwords, embeddings and stream credentials are redacted from the audit log.
  - Worker logs never print embeddings.
- **Transport:** run behind HTTPS in production. Security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `no-store` on the API) are set by the backend.
- **Consent and retention:** registering an employee's face is processing biometric data. Obtain and record consent under your organisation's policy, and remove face data through *Remove face data* when an employee leaves.
