# Sorim CRM - Biometric Attendance & Zoho People Integration
## Complete Application Documentation

---

# Table of Contents

1. [Project Overview](#1-project-overview)
2. [Phase 1: Biometric Device Integration](#2-phase-1-biometric-device-integration)
3. [Phase 2: Zoho People Attendance Sync](#3-phase-2-zoho-people-attendance-sync)
4. [All Application Pages Screenshots & Descriptions](#4-all-application-pages)
5. [Environment Variables Complete Reference](#5-environment-variables)
6. [API Complete Reference](#6-api-complete-reference)
7. [Zoho Integration - Mandatory Requirements Checklist](#7-zoho-integration-requirements)
8. [System Architecture & Data Flow](#8-system-architecture)
9. [Deployment Guide](#9-deployment-guide)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Project Overview

This application is a full-stack **Biometric Attendance Collector and Zoho People Sync** system. It connects to ZKTeco/eSSL TCP/IP biometric attendance devices, retrieves user records and punch logs, stores them in a local SQLite database, and provides a web dashboard for viewing attendance data. Additionally, it can synchronize biometric punch data to **Zoho People** for automated attendance management.

### Core Capabilities
- **Biometric Device Management**: Connect to multiple ZKTeco/eSSL devices via TCP/IP
- **User & Punch Collection**: Fetch users and attendance punches from devices
- **Auto-Sync**: Automatically sync devices on a configurable interval
- **Zoho People Integration**: Push attendance punches to Zoho People via API
- **Email Reports**: Send daily attendance summary via SMTP
- **HR Management**: Employee profiles, leave requests, asset tracking, documents, performance records
- **REST API**: Full CRUD API for all data
- **Web Dashboard**: React-based frontend for visualization and management

### Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend Framework | FastAPI (Python) | 0.115+ |
| ASGI Server | Uvicorn | 0.34+ |
| Database | SQLite | Built-in |
| Device Protocol | ZKTeco/eSSL via pyzk | 0.9 |
| Zoho API | REST API with OAuth2 | - |
| Frontend | React.js (Vite build) | Latest |
| Styling | Custom CSS with theme support | - |
| Data Validation | Pydantic | 2.12+ |
| Deployment | Render, Docker-ready | - |

---

## 2. Phase 1: Biometric Device Integration

### 2.1 Device Configuration

Devices are configured in `devices.json` at the project root. This is the **only configuration file** for biometric devices.

**Current Configured Devices:**

| Device Name | Short Name | IP Address | Port | Serial Number | Location | Default Direction | Enabled |
|-------------|-----------|------------|------|---------------|----------|------------------|---------|
| 408-Main Door | 408-Main Door | 10.1.10.189 | 4370 | JJA1251900136 | NSIC Park | IN | Yes |
| 209-Main Door | 209-Main Door | 10.1.0.201 | 4370 | JJA1253800447 | NSIC Park | OUT | Yes |
| 209-Back Door | 209-Back Door | 10.1.0.202 | 4370 | JJA1253800406 | NSIC Park | IN | Yes |

**Full Field Descriptions:**

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `name` | string | Yes | Display name for the device in UI and database | - |
| `short_name` | string | No | Abbreviated label | Falls back to `name` |
| `serial` | string | No | Device serial number (used as `id` primary key in DB) | Falls back to IP |
| `ip` | string | Yes | Device IP address for TCP connection | - |
| `port` | number | No | TCP port for ZK protocol | `4370` |
| `location` | string | No | Physical location description | `""` |
| `direction_mode` | string | No | How punch direction is determined (`device` or `config`) | `device` |
| `default_direction` | string | No | Fallback direction (`IN`/`OUT`) when punch code is null/unknown | `IN` |
| `password` | number | No | Device communication password | `0` |
| `timeout_seconds` | number | No | Connection timeout in seconds | `30` |
| `enabled` | boolean | No | Whether to include this device during sync | `true` |

### 2.2 Device Connection Protocol

The connection uses the **pyzk** library which implements the ZKTeco/eSSL proprietary protocol over TCP/IP on port **4370**.

**Connection Flow (from `backend/app/zk_client.py`):**

```
1. ZK = ZK(ip, port=4370, timeout=30, password=0, force_udp=False, ommit_ping=False)
2. conn = zk.connect()                    # Open TCP connection to device
3. conn.disable_device()                  # Stop real-time operations on terminal
4. serial = conn.get_serialnumber()       # Get device serial number
5. users = conn.get_users()               # Get all registered users
6. records = conn.get_attendance()        # Get all attendance records
7. conn.enable_device()                   # Re-enable device operations
8. conn.disconnect()                      # Close TCP connection
```

**Punch Direction Mapping (from `zk_client.py`):**

| Punch Code | Label | Direction | Description |
|-----------|-------|-----------|-------------|
| 0 | Check In | **IN** | Regular check-in |
| 1 | Check Out | **OUT** | Regular check-out |
| 2 | Break Out | **OUT** | Break time leaving |
| 3 | Break In | **IN** | Break time returning |
| 4 | Overtime In | **IN** | Overtime starting |
| 5 | Overtime Out | **OUT** | Overtime ending |
| 255 | Unknown | **Default Direction** | Unknown punch code |

**User Management Functions on Device:**
- `push_user_to_device(device, user_id, name, privilege, password, card)` - Create or update a user on the physical device. If user already exists by user_id, it updates their details; if not, creates new user with auto-assigned UID.
- `delete_user_from_device(device, user_id)` - Delete a user from the physical device.

### 2.3 Database Schema (Complete)

The application uses SQLite database at `backend/data/attendance.db` (configurable via `BIOMETRIC_DB_FILE` env var).

#### Table: `devices`
Stores device configuration and runtime status.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Device serial number (or IP fallback) |
| `name` | TEXT NOT NULL | Display name |
| `short_name` | TEXT NOT NULL | Abbreviated label |
| `serial` | TEXT | Configured serial number |
| `actual_serial` | TEXT | Serial number read from device at runtime |
| `ip` | TEXT NOT NULL | IP address |
| `port` | INTEGER NOT NULL | TCP port |
| `location` | TEXT | Physical location |
| `direction_mode` | TEXT NOT NULL | `device` or `config` |
| `default_direction` | TEXT NOT NULL | `IN` or `OUT` |
| `enabled` | INTEGER NOT NULL | Boolean flag |
| `status` | TEXT NOT NULL | `configured`, `online`, `error` |
| `error` | TEXT | Last error message |
| `last_seen_at` | TEXT | Timestamp of last successful connection |
| `last_sync_at` | TEXT | Timestamp of last sync |
| `updated_at` | TEXT NOT NULL | Record update timestamp |

#### Table: `users`
Biometric users fetched from devices.

| Column | Type | Description |
|--------|------|-------------|
| `device_id` | TEXT NOT NULL | FK to devices.id |
| `user_id` | TEXT NOT NULL | User identifier from device |
| `uid` | INTEGER | Internal device UID |
| `name` | TEXT | User display name |
| `privilege` | INTEGER | 0=Normal, 1=Admin, 2=Enroller |
| `password` | TEXT | Device-level password |
| `group_id` | TEXT | User group |
| `card` | TEXT | RFID card number |
| `synced_at` | TEXT NOT NULL | Sync timestamp |
| PRIMARY KEY | (device_id, user_id) | Composite primary key |

#### Table: `punches`
All attendance punch records from all devices.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment ID |
| `device_id` | TEXT NOT NULL | FK to devices.id |
| `device_name` | TEXT NOT NULL | Device display name |
| `device_ip` | TEXT NOT NULL | Device IP |
| `device_serial` | TEXT | Device serial at time of punch |
| `user_id` | TEXT NOT NULL | User who punched |
| `user_name` | TEXT | User name at time of punch |
| `uid` | INTEGER | Device UID |
| `punch_time` | TEXT NOT NULL | ISO 8601 with timezone (e.g. `2026-06-19T09:15:00+05:30`) |
| `punch_code` | INTEGER | 0-5 or 255 |
| `punch_label` | TEXT NOT NULL | `Check In`, `Check Out`, etc. |
| `direction` | TEXT NOT NULL | `IN` or `OUT` |
| `verify_code` | INTEGER | Verification method |
| `raw_status` | TEXT | Raw status from device |
| `synced_at` | TEXT NOT NULL | Sync timestamp |
| UNIQUE | (device_id, user_id, punch_time, punch_code, verify_code) | Prevents duplicates |

#### Table: `sync_runs`
History of device sync operations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `started_at` | TEXT NOT NULL | Sync start time |
| `completed_at` | TEXT | Sync completion time |
| `status` | TEXT NOT NULL | `running`, `ok`, `partial` |
| `message` | TEXT | Status message |
| `device_count` | INTEGER | Device count |
| `user_count` | INTEGER | Users synced |
| `punch_count` | INTEGER | New punches added |

#### Table: `zoho_sync_runs`
History of Zoho People sync operations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `started_at` | TEXT NOT NULL | Sync start time |
| `completed_at` | TEXT | Completion time |
| `status` | TEXT NOT NULL | `running`, `ok`, `partial`, `error` |
| `message` | TEXT | Status message |
| `requested_count` | INTEGER | Punches requested |
| `sent_count` | INTEGER | Successfully sent |
| `skipped_count` | INTEGER | Skipped (unmapped) |
| `failed_count` | INTEGER | Failed |
| `dry_run` | INTEGER | 1 if preview only |

#### Table: `zoho_punch_sync`
Tracks status of each punch sent to Zoho.

| Column | Type | Description |
|--------|------|-------------|
| `punch_id` | INTEGER PRIMARY KEY | FK to punches.id |
| `zoho_employee_id` | TEXT | Zoho Employee ID |
| `status` | TEXT NOT NULL | `sent`, `failed`, `skipped` |
| `attempts` | INTEGER | Retry count |
| `request_payload` | TEXT | JSON payload sent |
| `response_text` | TEXT | API response |
| `error` | TEXT | Error message |
| `sent_at` | TEXT | When successfully sent |
| `updated_at` | TEXT NOT NULL | Last update |

### 2.4 Auto-Sync System

The backend runs a **background daemon thread** that periodically syncs all enabled devices.

**Configuration:**
- `AUTO_SYNC_INTERVAL` environment variable (default: 60 seconds)
- Minimum interval: 15 seconds
- Maximum interval: 86400 seconds (24 hours)
- Controlled via API: `GET/POST /api/auto-sync`

**Auto-Sync Flow (from `main.py` - `_run_sync` function):**
```
1. Load device config from devices.json via _refresh_config()
2. Filter to only enabled devices
3. Start sync run record in database (start_sync_run)
4. For each enabled device:
   a. conn = fetch_device_payload(device)  -- TCP connection
   b. Save users via INSERT OR REPLACE
   c. Save punches via INSERT OR IGNORE (deduplicated)
   d. Record device status (online) or catch error
5. Finish sync run (ok or partial)
6. If new punches were found:
   a. Load Zoho config
   b. If enabled + auto_push + employee_verified:
      - Call sync_pending_punches() to auto-push to Zoho
```

### 2.5 Manual Sync

**Endpoint:** `POST /api/sync`

Allows syncing specific devices and time ranges:

```json
{
  "device_ips": ["10.1.10.189", "10.1.0.201"],  // Optional: limit to specific devices
  "from_time": "2026-06-19T00:00:00+05:30",      // Optional: filter punches after
  "to_time": "2026-06-19T23:59:59+05:30"          // Optional: filter punches before
}
```

Response:
```json
{
  "run_id": 42,
  "status": "ok",
  "devices": [
    {"device": "408-Main Door", "ip": "10.1.10.189", "status": "ok", "users": 50, "new_punches": 120, "fetched_punches": 150}
  ],
  "users_synced": 50,
  "new_punches": 120
}
```

### 2.6 Email Reports

The system sends daily attendance summary emails via SMTP. Supports scheduled daily reports and manual on-demand reports.

**Email Report Content:**
- HTML table with columns: Employee Code, Employee Name, IN Time, OUT Time, Duration
- Color-coded duration: **Red** (< 5 hours), **Yellow** (5-8 hours), **Blue** (> 8 hours)
- Subject: `{DD/MM/YYYY} - Attendance Report for {Device Names}`
- Footer includes device label

**How Email Reports Work (from `email_report.py`):**
1. Query punches for the target date from SQLite
2. Group by employee, find first IN and last OUT per employee
3. Calculate work duration
4. Generate HTML email
5. Send via SMTP with STARTTLS

**Scheduler (from `main.py` - `_run_report_scheduler`):**
- Runs a background thread that checks every 30 seconds
- At the configured time (default: 23:30), sends the daily report
- Ensures only one report per day (tracks `last_sent_day`)
- Supports environment variables and config file

---

## 3. Phase 2: Zoho People Attendance Sync

### 3.1 Architecture Overview

The Zoho integration connects to **Zoho People REST API** to synchronize biometric attendance data from the local SQLite database to the cloud HRMS platform.

**Key Design Decisions:**
- This application does **NOT** create employees in Zoho People. Employees must already exist.
- Uses **Zoho Attendance Bulk Import API** (`/people/api/attendance/bulkImport`)
- Requires **OAuth2 authentication** with refresh token flow
- Supports **6 data centers** (us, in, eu, au, jp, cn)
- Provides **dry-run preview** before actual sync
- Supports **auto-push** after device sync cycles
- Tracks each punch's sync status (sent/failed/skipped) in database

### 3.2 OAuth2 Authentication - Setup Steps

**Step 1: Create Self Client in Zoho API Console**
1. Go to [Zoho API Console](https://api-console.zoho.com)
2. Click "Add Client" → "Self Client"
3. Note the **Client ID** and **Client Secret**

**Step 2: Generate Refresh Token**
With the Client ID and Secret, generate a refresh token with the following scopes:
```
ZOHOPEOPLE.attendance.ALL
ZOHOPEOPLE.forms.READ
```

**Step 3: Select Data Center**
Choose where your Zoho People account is hosted:

| Code | Region | Accounts URL | People URL |
|------|--------|-------------|------------|
| `us` | United States | `https://accounts.zoho.com` | `https://people.zoho.com` |
| `in` | India | `https://accounts.zoho.in` | `https://people.zoho.in` |
| `eu` | Europe | `https://accounts.zoho.eu` | `https://people.zoho.eu` |
| `au` | Australia | `https://accounts.zoho.com.au` | `https://people.zoho.com.au` |
| `jp` | Japan | `https://accounts.zoho.jp` | `https://people.zoho.jp` |
| `cn` | China | `https://accounts.zoho.com.cn` | `https://people.zoho.com.cn` |

**Step 4: Configure in the App**
In Settings → Zoho People page:
- Save Client ID, Client Secret, Refresh Token
- Select Data Center
- Click **Test OAuth** to validate connection

### 3.3 Token Refresh Flow (from `zoho_people.py`)

```
1. Check in-memory token cache (_TOKEN_CACHE)
2. If cached token exists and expires > 2 minutes from now → use cached
3. Check persisted token in config file
4. If persisted token exists and expires > 2 minutes → load into cache, use it
5. If expired → POST to {accounts_url}/oauth/v2/token
   Parameters: refresh_token, client_id, client_secret, grant_type=refresh_token
6. Response contains new access_token and expires_in (default 3600s)
7. Store in _TOKEN_CACHE and persist to config file
8. All API calls use header: Authorization: Zoho-oauthtoken {access_token}
```

### 3.4 Configuration Fields (Complete Reference)

All fields stored in `backend/data/zoho_people_config.json` (git-ignored):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Enable Zoho sync functionality |
| `auto_push` | boolean | No | Auto-push after device sync (requires employee_verified_at) |
| `data_center` | string | Yes | `in`, `us`, `eu`, `au`, `jp`, `cn` |
| `accounts_url` | string | Yes | Auto-populated from data_center, can override |
| `people_url` | string | Yes | Auto-populated from data_center, can override |
| `client_id` | string | **Yes** | Zoho Self Client ID (MANDATORY) |
| `client_secret` | string | **Yes** | Zoho Self Client Secret (MANDATORY) |
| `refresh_token` | string | **Yes** | Zoho Refresh Token (MANDATORY) |
| `access_token` | string | Auto | Cached access token |
| `access_token_expires_at` | number | Auto | Expiry timestamp |
| `default_location` | string | No | Default location name for punched records |
| `default_building` | string | No | Default building name for punched records |
| `min_punch_date` | string | No | Earliest punch date to sync (format: `YYYY-MM-DD`, default: `2020-01-01`) |
| `use_biometric_user_id_as_emp_id` | boolean | No | If true, biometric user_id is used directly as Zoho Employee ID |
| `send_only_mapped_users` | boolean | No | If true (default), only send punches for mapped users |
| `batch_size` | number | No | Items per API call (1-200, default: 100) |
| `mappings` | object | No | Map of biometric_user_id → Zoho Employee ID config |
| `employee_verified_at` | string | Auto | Timestamp when employee verification was last successful |
| `employee_verify_matched_count` | number | Auto | Count of matched employees |
| `employee_verify_missing_count` | number | Auto | Count of missing employees |
| `employee_verify_unmapped_count` | number | Auto | Count of unmapped employees |

### 3.5 Employee ID Mapping Methods

**Method 1: Explicit Mappings (Recommended)**

In the frontend Settings → Zoho People → Employee Mapping section:
- Each biometric user is listed with their user_id and devices
- Enter the Zoho Employee ID for each user
- Toggle active/inactive

Config file structure:
```json
{
  "mappings": {
    "1001": {
      "biometric_user_id": "1001",
      "zoho_employee_id": "EMP001",
      "active": true,
      "name": "John Doe",
      "notes": ""
    }
  }
}
```

**Method 2: Biometric ID Equals Zoho Employee ID**

When `use_biometric_user_id_as_emp_id` is enabled and no explicit mapping is found:
- The biometric `user_id` (e.g., "ST-26-001") is used directly as the Zoho Employee ID
- Checked only when explicit mapping does not exist

**Priority:**
1. Explicit mapping (if active and has zoho_employee_id)
2. Biometric ID = Zoho ID (if enabled)
3. Unmapped (skipped)

### 3.6 Employee Verification Process

**Endpoint:** `GET /api/zoho/employees/verify`

**Purpose:** Verify that local biometric user mappings match actual Zoho People employee records.

**Flow:**
1. Fetch all employee records from Zoho People using Forms API
2. For each unique biometric user:
   - Resolve expected Zoho Employee ID (via mapping or direct ID)
   - Search for that Employee ID in Zoho's records
3. Categorize result:
   - **Matched**: Local user has mapping AND Employee ID exists in Zoho
   - **Missing**: Local user has mapping BUT Employee ID NOT found in Zoho
   - **Unmapped**: Local user has no mapping configured
4. If ALL users are matched (no missing): Save `employee_verified_at` timestamp
5. **Auto-push requires successful verification** before it will run

### 3.7 Sync to Zoho Process (Complete)

**Endpoint:** `POST /api/zoho/sync`

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from_time` | string | No | ISO 8601 datetime filter start |
| `to_time` | string | No | ISO 8601 datetime filter end |
| `user_ids` | array | No | Limit to specific user IDs |
| `limit` | number | No | Max punches (1-1000, default: 200) |
| `dry_run` | boolean | No | Preview mode (default: false) |

**Complete Sync Flow:**

```
1. LOAD Zoho config from zoho_people_config.json
2. VALIDATE: enabled=true (unless dry_run), client_id/secret/refresh_token present
3. GET active mapped user IDs (or use provided user_ids)
4. QUERY unsent punches from SQLite:
   SELECT p.* FROM punches p
   LEFT JOIN zoho_punch_sync z ON z.punch_id = p.id
   WHERE COALESCE(z.status, '') != 'sent'
     AND (from_time filter)
     AND (to_time filter)
     AND (user_id filter)
   ORDER BY p.punch_time ASC
   LIMIT ?
5. FOR EACH punch:
   a. If punch date < min_punch_date → SKIP
   b. Resolve Zoho Employee ID → if no mapping → SKIP
   c. Build bulk import item:
      {
        "empId": "EMP001",
        "checkIn": "2026-06-19 09:15:00",   // if direction = IN
        "checkOut": "2026-06-19 18:30:00",  // if direction = OUT
        "location": "Office",                // if default_location configured
        "building": "Building A"             // if default_building configured
      }
6. CHUNK items:
   - Group by date windows (max 31 days per batch)
   - Split by batch_size (default: 100, max: 200)
7. FOR EACH batch:
   a. POST to {people_url}/people/api/attendance/bulkImport
      Parameters: dateFormat=yyyy-MM-dd HH:mm:ss, data=[...]
      Headers: Authorization: Zoho-oauthtoken {token}
   b. Parse response for skippedEmpInfo
   c. Mark each punch in zoho_punch_sync:
      - "sent" → if successful
      - "failed" → if in skippedEmpInfo or API error
      - "skipped" → if date too old or no mapping
8. RECORD sync run with counts
9. RETURN { run_id, status, message, sent_count, skipped_count, failed_count }
```

### 3.8 Chunking Strategy

The `_chunk_prepared_by_date_window` function implements intelligent chunking:
- **Date Window**: Maximum 31 days span per API batch (Zoho limitation)
- **Batch Size**: Configurable (1-200, default: 100)
- Items are sorted by date, then grouped into batches that respect both limits
- This prevents Zoho API errors from oversized date ranges

---

## 4. All Application Pages

### 4.1 Dashboard (`/dashboard`)
**File:** `frontend/src/pages/Dashboard.jsx`

**Purpose:** Main landing page showing real-time overview of the entire attendance system.

**Why This Page:** Provides at-a-glance status of all system components so users can quickly identify issues.

**UI Components:**
- **Stat Cards**: Total Punches, People Today, Check Ins, Check Outs (4 cards with icons)
- **Pulse Cards**: Attendance Coverage %, Exceptions count, Device Health (online/total), Report Automation status
- **Attention Queue**: Lists attendance exceptions detected from today's data:
  - Missing IN punches (employee has punches but no check-in)
  - Missing OUT punches (employee has punches but no check-out)
  - Short Hours (< 5 hours)
  - Long Shift (> 12 hours)
- **Operations Shortcuts**: Links to Daily Report, Punch Audit, Device Health, Automation Settings
- **Device Status**: All devices listed with name, IP, and status badge (online/error/configured)
- **Recent Activity**: Latest 10 punches with direction badge, user name, device, and time
- **Punches by Device**: Breakdown of punch counts per device

**APIs Used:**
- `GET /api/devices` - Get device list
- `GET /api/summary?from_time=...&to_time=...` - Today's summary stats
- `GET /api/punches?from_time=...&to_time=...&limit=10` - Recent 10 punches
- `GET /api/users` - All users for employee count
- `GET /api/attendance/daily?from_date=...&to_date=...` - Today's daily attendance
- `GET /api/auto-sync` - Auto-sync settings
- `GET /api/email/config` - Email config (for report automation status)
- `POST /api/sync` - Manual sync button

**Auto-Refresh:** Every 30 seconds via `setInterval(load, 30000)`

---

### 4.2 Attendance Summary (`/attendance`)
**File:** `frontend/src/pages/AttendancePage.jsx`

**Purpose:** Daily attendance report showing First IN and Last OUT per employee per day.

**Why This Page:** Essential for HR to verify employee attendance, identify missing punches, and monitor working hours.

**UI Components:**
- **Date Range Filter**: From date and To date pickers
- **Search Bar**: Filter employees by name or user ID
- **Stat Cards**: Total Days, People, Average Work Hours, Records count
- **Day Group List**: Each day is expandable:
  - Day header with date, present count, total count
  - Expanded table: Employee Name, User ID, First IN time, Last OUT time, Work Hours (color-coded), Total Punches
  - Email button per day to send report for that date
- **Attendance Email Dialog**: Modal to generate and send email report for selected date

**APIs Used:**
- `GET /api/attendance/daily?from_date=...&to_date=...` - Main data
- `POST /api/email/send` - Send email report

**Color Coding for Work Hours:**
- **Green** (≥ 8 hours): Full day
- **Yellow** (4-8 hours): Half day
- **Red** (< 4 hours): Short hours

---

### 4.3 All Punches (`/punches`)
**File:** `frontend/src/pages/Attendance.jsx`

**Purpose:** Raw punch log viewer with advanced filtering and export capabilities.

**Why This Page:** For auditing individual punch events, investigating discrepancies, and exporting raw data.

**UI Components:**
- **Filter Bar**: From datetime, To datetime, Device dropdown, Direction (All/IN/OUT), User ID search
- **Stat Cards**: Total Punches, People, In count, Out count
- **Recent 10 Punches Card**: Latest 10 punches in card layout
- **Punches By User**: View modes:
  - **Card View**: User cards with avatar, IN/OUT counts, device count, and timeline of punches
  - **List View**: Compact list per user with punch events
- **CSV Export**: Opens `/api/punches.csv` in new tab

**APIs Used:**
- `GET /api/devices` - For device filter dropdown
- `GET /api/punches?from_time=...&to_time=...&device_ip=...&direction=...&user_id=...&limit=...`
- `GET /api/summary?from_time=...&to_time=...`
- `POST /api/sync` - Manual sync
- `GET /api/punches.csv?limit=100000` - CSV export

**Auto-Refresh:** Every 30 seconds with current filters

---

### 4.4 Devices (`/devices`)
**File:** `frontend/src/pages/Devices.jsx`

**Purpose:** Monitor, manage, and sync biometric attendance devices.

**Why This Page:** Central device management for checking device health, viewing details, and initiating syncs.

**UI Components:**
- **Stat Cards**: Total Devices, Online, Errors, Configured
- **Sort Controls**: Sort by Name, Status, IP, or Location (ascending/descending)
- **Device Cards**: Each device displayed as a card with:
  - Device name, short name, status badge with icon (WiFi for online, Alert for error, WiFi-off for configured)
  - Location and Last Sync time
  - **Expandable panel** showing: IP:Port, Serial, Location, Direction Mode, Default Direction, Enabled, Last Sync, Error message
  - **Sync Now button** to sync single device

**APIs Used:**
- `GET /api/devices` - Get all devices
- `POST /api/sync` - Sync all or single device (with `device_ips` filter)

**Auto-Refresh:** Every 30 seconds

---

### 4.5 Users (`/users`)
**File:** `frontend/src/pages/Users.jsx`

**Purpose:** Manage biometric users across all devices with CRUD operations.

**Why This Page:** For viewing, creating, editing, deleting, and pushing users to biometric devices.

**UI Components:**
- **Stat Cards**: Total Users, Admins, Users with Card, Users per device
- **Search Bar**: Search by name, user ID, or device name
- **View Toggle**: Table view (columns: User, User ID, Serial#, Devices, Card, Group, Password, Privilege, Actions) | Grid/Card view
- **Add User Form**: Device dropdown, User ID (required), Full Name, Privilege (Normal/Admin/Enroller), Device Password, Card Number, Group ID
- **Edit User**: Same fields as create, updates user on all devices they belong to
- **Push to Device**: Modal showing all devices, user is pushed to selected device
- **Delete User**: Confirmation dialog, deletes from database

**User Privileges:**
- **0**: Normal User
- **1**: Admin (full device admin rights)
- **2**: Enroller (can enroll fingerprints)

**APIs Used:**
- `GET /api/users` - List all users
- `GET /api/devices` - Device list for dropdowns
- `POST /api/users` - Create/update user
- `PUT /api/users/{device_id}/{user_id}` - Edit user details
- `DELETE /api/users/{device_id}/{user_id}` - Delete user
- `POST /api/users/push` - Push user to physical device

---

### 4.6 Settings (`/settings`)
**File:** `frontend/src/pages/Settings.jsx` (1601 lines)

**Purpose:** Central configuration hub for the entire application.

**Why This Page:** All system configuration in one place - devices, sync, email, Zoho, HR, preferences.

**Sections:**

#### Overview Section
- Status cards: System health, Auto-Sync status, Email status, Device health, HRM stats, Zoho status
- Quick checks checklist: SMTP, scheduler, devices, auto-sync, profiles, documents

#### HRM Section
- Module cards: Employees (profiles), Leave (pending requests), Assets (assigned), Documents (pending), Performance (reviews), Payroll
- Work defaults: Shift Start, Shift End, Full Day Hours, Half Day Hours, Overtime After, Late Grace Minutes, Annual Leave Quota, Currency, Document Reminder Days, Asset Audit Cycle
- HR Queue: Pending leave requests, document items, open reviews, profile coverage

#### Auto-Sync Section
- Enable/disable toggle
- Interval selector: 15s, 30s, 1m, 2m, 5m, 10m, 30m, 1h

#### Zoho People Section
- Enable/disable toggle
- Auto-push toggle (requires employee verification)
- Biometric ID = Zoho ID toggle
- Only send saved mappings toggle
- Data center selector (India/US/Europe/Australia/Japan/China)
- URL fields (auto-populated)
- Batch Size (1-200)
- OAuth credentials: Client ID, Client Secret, Refresh Token (password fields, masks saved values)
- Default Location, Default Building
- Inline status: OAuth status, verification status
- **Employee Mapping**: Shows all unique biometric users with Zoho Employee ID input fields and active toggle per user
- **Verify IDs button**: Compares local mappings against Zoho employee records
- **Preview button**: Shows how many punches would be sent (dry run)
- **Send to Zoho button**: Actual sync with confirmation dialog

#### Email Section
- Enable/disable daily schedule toggle
- SMTP fields: Server (default smtp.gmail.com), Port, Username, Password, From Email, To Email, Report Time
- TLS toggle
- Send Test button

#### System Section
- Application info: Name, Version, Database path, Status, Total Devices, Employees, HR Records, Auto-Sync

#### Devices Section
- Device list with name, IP, port, status badge, location

#### Preferences Section
- Appearance: Theme (Light/Dark/Auto), Accent Color (Green/Blue/Purple/Red/Orange), Compact Sidebar
- Localization: Language (English/Hindi/Spanish/French), Timezone, Time Format (12h/24h), Date Format
- Data & Notifications: Default Page, Rows Per Page, Default Date Range, Notification toggles

#### Security Section
- Clear Local Cache button

#### API Section
- Complete API reference listing all endpoints with methods and descriptions

**APIs Used:**
- All APIs: auto-sync, health, devices, email, HR, users, Zoho config, Zoho status

---

### 4.7 Other Pages

#### Employees (`/employees`)
**File:** `frontend/src/pages/HRProfiles.jsx`  
**Purpose:** Create and manage employee HR profiles (name, department, designation, contact info, etc.).  
**Why:** HR records are separate from biometric user records - allows attaching HR metadata to employees.

#### Leave (`/leave`)
**File:** `frontend/src/pages/Leave.jsx`  
**Purpose:** Manage employee leave requests (apply, approve, reject).  
**Why:** Complete HR leave management without leaving the system.

#### Assets (`/assets`)
**File:** `frontend/src/pages/Assets.jsx`  
**Purpose:** Track company assets assigned to employees (laptops, phones, etc.).  
**Why:** Asset lifecycle management integrated with employee records.

#### Documents (`/documents`)
**File:** `frontend/src/pages/Documents.jsx`  
**Purpose:** Document management (contracts, ID proofs, certificates).  
**Why:** Central document repository linked to employees.

#### Performance (`/performance`)
**File:** `frontend/src/pages/Performance.jsx`  
**Purpose:** Performance review records.  
**Why:** Track employee performance evaluations.

#### Reports (`/reports`)
**File:** `frontend/src/pages/Reports.jsx`  
**Purpose:** Attendance reports and analytics export.  
**Why:** Generate and download attendance data for external processing.

#### Exceptions (`/exceptions`)
**File:** `frontend/src/pages/Exceptions.jsx`  
**Purpose:** View sync errors, device errors, and attendance exceptions.  
**Why:** Identify and resolve system issues.

#### Payroll (`/payroll`)
**File:** `frontend/src/pages/Payroll.jsx`  
**Purpose:** Payroll placeholder/integration.  
**Why:** Future payroll processing integration point.

#### Analytics (`/analytics`)
**File:** `frontend/src/pages/Analytics.jsx`  
**Purpose:** Analytics dashboard placeholder.  
**Why:** Future data visualization and trends analysis.

---

## 5. Environment Variables - Complete Reference

### 5.1 Device Configuration

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `DEVICE_CONFIG_FILE` | Path to device JSON config file | `devices.json` (project root) | `config.py` - `load_devices()` |

### 5.2 Database

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `BIOMETRIC_DB_FILE` | Path to SQLite database file | `backend/data/attendance.db` | `db.py` - `DB_PATH` |
| `ZOHO_PEOPLE_CONFIG_FILE` | Path to Zoho config JSON | `backend/data/zoho_people_config.json` | `zoho_people.py` - `CONFIG_FILE` |

### 5.3 Auto-Sync

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `AUTO_SYNC_INTERVAL` | Auto-sync interval in seconds | `60` | `main.py` - `_auto_sync_state` |

### 5.4 Static Files

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `STATIC_DIR` | Frontend static files directory (production) | `backend/static/` | `main.py` - StaticFiles mount |

### 5.5 Email SMTP Configuration

| Variable | Aliases | Description | Default |
|----------|---------|-------------|---------|
| `SMTP_HOST` | `MAIL_SERVER`, `MAIL_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | `MAIL_PORT` | SMTP server port | `587` |
| `SMTP_USER` | `MAIL_USERNAME` | SMTP username (Gmail address) | (empty) |
| `SMTP_PASSWORD` | `MAIL_PASSWORD` | SMTP password (Google App Password for Gmail) | (empty) |
| `SMTP_FROM` | `MAIL_FROM`, `MAIL_DEFAULT_SENDER` | Sender email address | Same as username |
| `SMTP_TO` | `MAIL_TO`, `EMAIL_REPORT_TO` | Recipient email(s), comma-separated | Same as username |
| `SMTP_TLS` | `MAIL_USE_TLS` | Enable STARTTLS | `true` |
| `EMAIL_REPORT_ENABLED` | `MAIL_ENABLED` | Enable scheduled daily email | `false` |
| `EMAIL_REPORT_TIME` | `MAIL_REPORT_TIME` | Daily send time (24h HH:MM format) | `23:30` |

### 5.6 Zoho People Configuration

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `ZOHO_PEOPLE_ENABLED` | Enable Zoho sync | (from config file) | `zoho_people.py` - `_apply_env()` |
| `ZOHO_PEOPLE_AUTO_PUSH` | Auto-push after device sync | (from config file) | Same |
| `ZOHO_DATA_CENTER` | Data center code (`in`/`us`/`eu`/`au`/`jp`/`cn`) | (from config file) | Same |
| `ZOHO_ACCOUNTS_URL` | Zoho Accounts URL override | (from data_center) | Same |
| `ZOHO_PEOPLE_URL` | Zoho People URL override | (from data_center) | Same |
| `ZOHO_CLIENT_ID` | OAuth2 Client ID | (from config file) | Same |
| `ZOHO_CLIENT_SECRET` | OAuth2 Client Secret | (from config file) | Same |
| `ZOHO_REFRESH_TOKEN` | OAuth2 Refresh Token | (from config file) | Same |
| `ZOHO_ACCESS_TOKEN` | OAuth2 Access Token (set automatically) | (auto) | Same |
| `ZOHO_ACCESS_TOKEN_EXPIRES_AT` | Access token expiry timestamp | (auto) | Same |
| `ZOHO_DEFAULT_LOCATION` | Default attendance location | (from config file) | Same |
| `ZOHO_DEFAULT_BUILDING` | Default building name | (from config file) | Same |
| `ZOHO_MIN_PUNCH_DATE` | Minimum punch date for sync | (from config file) | Same |
| `ZOHO_USE_BIOMETRIC_ID_AS_EMP_ID` | Use biometric ID as Zoho Employee ID | (from config file) | Same |
| `ZOHO_BATCH_SIZE` | API batch size (1-200) | (from config file) | Same |

### 5.7 Frontend

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `VITE_API_BASE` | Backend API base URL (dev mode) | `http://localhost:8002` | `api.js`, `App.jsx` |

---

## 6. API Complete Reference

### 6.1 Health & System

| Method | Endpoint | Description | Query Params | Request Body |
|--------|----------|-------------|-------------|--------------|
| GET | `/api/health` | System health check | - | - |

**Response:** `{"ok": true, "database": "path/to/attendance.db"}`

### 6.2 Device Management

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|-------------|
| GET | `/api/devices` | List all devices | - |

**Response:** Array of device objects with id, name, ip, port, serial, status, last_sync_at, etc.

### 6.3 User Management

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|-------------|
| GET | `/api/users` | List all users | `device_ip` (optional filter) |
| POST | `/api/users` | Create user | - |
| PUT | `/api/users/{device_id}/{user_id}` | Edit user | - |
| DELETE | `/api/users/{device_id}/{user_id}` | Delete user | - |
| POST | `/api/users/push` | Push user to physical device | - |

**POST `/api/users` Body:**
```json
{
  "device_id": "JJA1251900136",
  "user_id": "ST-26-001",
  "name": "John Doe",
  "privilege": 0,
  "password": "",
  "group_id": "",
  "card": ""
}
```

**POST `/api/users/push` Body:**
```json
{
  "device_ip": "10.1.10.189",
  "user_id": "ST-26-001",
  "name": "John Doe",
  "privilege": 0,
  "password": "",
  "card": ""
}
```

### 6.4 Attendance Punches

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|-------------|
| GET | `/api/punches` | List punches | `from_time`, `to_time`, `device_ip`, `user_id`, `direction`, `limit` |
| GET | `/api/punches.csv` | Export punches as CSV | Same as above (limit max 100000) |
| GET | `/api/summary` | Punch statistics | `from_time`, `to_time` |
| GET | `/api/attendance/daily` | Daily attendance (first IN / last OUT) | `from_date`, `to_date` |

**GET `/api/punches` Query Parameters:**

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `from_time` | ISO 8601 | - | - | Filter punches after this time |
| `to_time` | ISO 8601 | - | - | Filter punches before this time |
| `device_ip` | string | - | - | Filter by device IP |
| `user_id` | string | - | - | Filter by user ID |
| `direction` | string | - | - | Filter by direction (IN/OUT) |
| `limit` | int | 500 | 5000 | Max results |

### 6.5 Sync

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|-------------|
| GET | `/api/auto-sync` | Get auto-sync settings | - |
| POST | `/api/auto-sync` | Update auto-sync settings | `{"enabled": true, "interval_seconds": 60}` |
| POST | `/api/sync` | Manual device sync | `{"device_ips": [...], "from_time": "...", "to_time": "..."}` |

### 6.6 Email

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/email/config` | Get email configuration (password masked) |
| POST | `/api/email/config` | Update email configuration |
| POST | `/api/email/test` | Send test email |
| POST | `/api/email/send` | Send report for specific date |

**POST `/api/email/send` Body:** `{"date": "2026-06-19"}`

### 6.7 Zoho People

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/zoho/config` | Get Zoho configuration (secrets masked) |
| POST | `/api/zoho/config` | Save Zoho configuration |
| GET | `/api/zoho/status` | Zoho sync status summary + recent runs |
| POST | `/api/zoho/test` | Test OAuth2 connection (validates scope) |
| GET | `/api/zoho/employees/verify` | Verify biometric to Zoho employee mappings |
| POST | `/api/zoho/sync` | Preview or send punches to Zoho |

**POST `/api/zoho/sync` Body:**
```json
{
  "from_time": "2026-06-01T00:00:00+05:30",
  "to_time": "2026-06-19T23:59:59+05:30",
  "user_ids": ["1001", "1002"],
  "limit": 200,
  "dry_run": true
}
```

**POST `/api/zoho/sync` Response (dry_run = true):**
```json
{
  "dry_run": true,
  "configured": true,
  "requested_count": 150,
  "ready_count": 120,
  "skipped_count": 30,
  "items": [
    {"punch_id": 1, "user_id": "1001", "user_name": "John", "punch_time": "...", "direction": "IN", "zoho_employee_id": "EMP001", "payload": {...}}
  ],
  "skipped": [
    {"punch_id": 2, "user_id": "1002", "reason": "No Zoho employee mapping"}
  ]
}
```

**POST `/api/zoho/sync` Response (dry_run = false):**
```json
{
  "run_id": 42,
  "status": "ok",
  "message": "120 sent, 30 skipped, 0 failed",
  "requested_count": 150,
  "sent_count": 120,
  "skipped_count": 30,
  "failed_count": 0
}
```

### 6.8 HR Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hr` | Get all HR data (profiles + all collections) |
| GET | `/api/hr/profiles` | Get all employee profiles |
| PUT | `/api/hr/profiles/{user_id}` | Save/update employee profile |
| GET | `/api/hr/{collection}` | List collection records |
| POST | `/api/hr/{collection}` | Create record in collection |
| PUT | `/api/hr/{collection}/{id}` | Update record |
| DELETE | `/api/hr/{collection}/{id}` | Delete record |

**Collections:** `leave_requests`, `assets`, `documents`, `performance`

---

## 7. Zoho Integration - Mandatory Requirements Checklist

### 7.1 Prerequisites

- [ ] **Zoho People Account** with active employees already registered
- [ ] **Zoho API Console** access (https://api-console.zoho.com)
- [ ] Create a **Self Client** application
- [ ] Generate **Refresh Token** with exact scopes:
  - `ZOHOPEOPLE.attendance.ALL` (attendance sync)
  - `ZOHOPEOPLE.forms.READ` (employee verification)
- [ ] Know your **Data Center** (in/us/eu/au/jp/cn)

### 7.2 Mandatory Configuration Fields

These fields are **required** for Zoho integration to work:

| # | Field | Where to Get | Why |
|---|-------|-------------|-----|
| 1 | `client_id` | Zoho API Console → Self Client details | OAuth2 client identification |
| 2 | `client_secret` | Zoho API Console → Self Client details | OAuth2 client authentication |
| 3 | `refresh_token` | Generated from OAuth2 flow | Long-lived token for refreshing access tokens |
| 4 | `data_center` | Your Zoho account region | Routes API calls to correct Zoho server |

### 7.3 Configuration Steps in App

**Step 1: Configure OAuth2**
1. Navigate to Settings → Zoho People
2. Select Data Center (e.g., "India" for accounts.zoho.in)
3. Enter Client ID, Client Secret, Refresh Token
4. Click **Save** then **Test OAuth**
5. Verify "Zoho attendance scope validated" message

**Step 2: Employee ID Mapping**
1. Click **Verify IDs** to compare biometric users with Zoho employees
2. Review results: Matched/Missing/Unmapped
3. For each unmapped user, enter their Zoho Employee ID in the mapping field
4. Toggle the mapping active
5. Click **Save Mappings**
6. Re-run **Verify IDs** until all users show as "matched"

**Step 3: Configure Sync Settings**
- Enable **Zoho Sync** toggle
- Optionally enable **Auto-Push After Device Sync**
- Set **Default Location** and **Building** (optional but recommended)
- Set **Min Punch Date** to avoid sending old data

**Step 4: Preview and Send**
1. Set date range in "Send Punches" section
2. Click **Preview** to see what would be sent
3. Review the preview items and skipped items
4. Click **Send to Zoho** to push punches (requires confirmation)

### 7.4 Validating Integration

- [ ] **Test OAuth**: Returns success → credentials are valid
- [ ] **Verify IDs**: All employees matched with zero missing
- [ ] **Preview**: Shows expected punch count with correct Employee IDs
- [ ] **Send to Zoho**: Returns "X sent, Y skipped, 0 failed"

---

## 8. System Architecture & Data Flow

### 8.1 Application Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          sorim CRM Application                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     React Frontend (Vite)                            │    │
│  │  ┌───────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────────┐  │    │
│  │  │ Dashboard │ │ Attendance │ │ Devices   │ │ Settings          │  │    │
│  │  │ /dashboard│ │ /attendance│ │ /devices  │ │ /settings         │  │    │
│  │  └───────────┘ └────────────┘ └───────────┘ └───────────────────┘  │    │
│  │  ┌───────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────────┐  │    │
│  │  │ Punches   │ │ Users      │ │ Employees │ │ Leave/Assets/Docs │  │    │
│  │  │ /punches  │ │ /users     │ │ /employees│ │ /leave, /assets.. │  │    │
│  │  └───────────┘ └────────────┘ └───────────┘ └───────────────────┘  │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │ REST API over HTTP                          │
│  ┌──────────────────────────────▼──────────────────────────────────────┐    │
│  │                     FastAPI Backend (Python)                         │    │
│  │                                                                      │    │
│  │  ┌────────────┐  ┌──────────┐  ┌─────────────────┐  ┌──────────┐   │    │
│  │  │ main.py    │  │ db.py    │  │ zk_client.py    │  │config.py │   │    │
│  │  │ API Routes │  │ SQLite   │  │ ZKTeco Protocol │  │DeviceCfg │   │    │
│  │  │ Background │  │ CRUD     │  │ TCP/IP Port 4370│  │Loader    │   │    │
│  │  │ Threads    │  │          │  │                 │  │          │   │    │
│  │  └────────────┘  └──────────┘  └─────────────────┘  └──────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐    │    │
│  │  │ zoho_people  │  │ email_report  │  │ SQLite Database        │    │    │
│  │  │ .py          │  │ .py           │  │ backend/data/          │    │    │
│  │  │ OAuth2 + API │  │ SMTP Email    │  │ attendance.db          │    │    │
│  │  └──────────────┘  └───────────────┘  └────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 External Connections

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            External Connections                          │
│                                                                          │
│     TCP/IP Port 4370                        HTTPS REST API              │
│  ┌────────────────────────┐        ┌──────────────────────────┐         │
│  │ ZKTeco/eSSL Device 1   │        │ Zoho People Cloud        │         │
│  │ 408-Main Door          │        │ OAuth2 + Attendance API  │         │
│  │ 10.1.10.189:4370       │        │ people.zoho.in           │         │
│  └────────────────────────┘        └──────────────────────────┘         │
│                                                                          │
│  ┌────────────────────────┐        ┌──────────────────────────┐         │
│  │ ZKTeco/eSSL Device 2   │        │ SMTP Email Server        │         │
│  │ 209-Main Door          │        │ smtp.gmail.com:587       │         │
│  │ 10.1.0.201:4370        │        │ (STARTTLS)               │         │
│  └────────────────────────┘        └──────────────────────────┘         │
│                                                                          │
│  ┌────────────────────────┐                                              │
│  │ ZKTeco/eSSL Device 3   │                                              │
│  │ 209-Back Door          │                                              │
│  │ 10.1.0.202:4370        │                                              │
│  └────────────────────────┘                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Background Threads

**1. Auto-Sync Thread (`_run_sync`)**
- Interval: Configurable (default 60 seconds)
- What it does:
  - Connects to all enabled devices via TCP/IP
  - Fetches users and punches
  - Stores in SQLite database
  - If Zoho auto-push is enabled, triggers Zoho sync
- Runs on: `_auto_sync_thread` (daemon thread)

**2. Email Report Scheduler (`_run_report_scheduler`)**
- Checks: Every 30 seconds
- What it does:
  - Checks configured report time (default 23:30)
  - If current time matches and report not sent today:
  - Generates HTML attendance report
  - Sends via SMTP
- Runs on: `_report_thread` (daemon thread)

### 8.4 Frontend API Integration

**Development Mode:**
- Frontend runs on `localhost:5173` (Vite dev server)
- Backend runs on `localhost:8000` to `8002` (FastAPI)
- Frontend API base: `http://localhost:8002` (configurable via `VITE_API_BASE`)
- CORS enabled: allow_origins=["*"]

**Production Mode:**
- Frontend built to static files (`frontend/dist/`)
- Copied to `backend/static/`
- FastAPI serves both API and frontend from same origin
- No CORS needed
- URL: Same as backend URL (no separate port)

---

## 9. Deployment Guide

### 9.1 Local Development

**Backend:**
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**
```powershell
cd frontend
npm install
npm run dev
```

**Verify Device Connectivity:**
```powershell
Test-NetConnection 10.1.10.189 -Port 4370
Test-NetConnection 10.1.0.201 -Port 4370
```

### 9.2 Production Build

```powershell
cd frontend
npm run build
# Copy frontend/dist/* to backend/static/
```

### 9.3 Render Deployment

The `render.yaml` file provides infrastructure-as-code deployment configuration for Render.com.

---

## 10. Troubleshooting

### 10.1 Device Connectivity

| Symptom | Cause | Solution |
|---------|-------|----------|
| `TcpTestSucceeded: False` | Firewall, routing, or device port | Verify network path, check device network settings |
| `DeviceLibraryMissing` | pyzk not installed | `pip install -r backend/requirements.txt` |
| Connection timeout | Device unreachable or slow | Increase `timeout_seconds` in devices.json |
| `get_attendance()` returns empty | No records on device | Check if device has recorded punches |
| Sync partial for some devices | Network or device error | Check device status in Devices page |

### 10.2 Zoho Integration

| Symptom | Cause | Solution |
|---------|-------|----------|
| "Invalid OAuth Scope" | Refresh token missing required scopes | Regenerate with `ZOHOPEOPLE.attendance.ALL,ZOHOPEOPLE.forms.READ` |
| "Token refresh failed" | Invalid refresh token | Generate new refresh token from Zoho API Console |
| "Invalid Client ID/Secret" | Credentials mismatch | Verify in Zoho API Console → Self Client |
| "Zoho skipped this employee" | Employee ID doesn't match | Use Verify IDs to check, fix mappings |
| Auto-push not working | Employee not verified | Run Verify IDs, ensure all are matched |
| "502 Bad Gateway" on sync | Zoho API error | Check Zoho People service status |

### 10.3 Email

| Symptom | Cause | Solution |
|---------|-------|----------|
| SMTP authentication rejected | Wrong password or App Password | Generate new Google App Password (enable 2FA first) |
| No report received | Scheduling or config issue | Check SMTP settings, test with Send Test button |
| "SMTP not configured" | Missing to/from email | Set both From and To email addresses |

### 10.4 Database

| Symptom | Cause | Solution |
|---------|-------|----------|
| Database locked | Multiple processes | Only run one backend instance |
| Missing data | Deleted attendance.db | Database is auto-created on startup, resync devices |
| Duplicate punches | Multiple syncs | Deduplication via UNIQUE constraint on (device_id, user_id, punch_time, punch_code, verify_code) |

---

*Document generated on June 19, 2026 | Application version 1.0.0*
*Backend: FastAPI (Python) | Frontend: React (Vite)*
*Device Protocol: ZKTeco/eSSL TCP/IP (pyzk v0.9)*