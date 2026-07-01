# Biometric Attendance Collector

Python + React app for pulling users and in/out punches from TCP/IP biometric attendance devices.

The included device configuration is based on your screenshots:

- `408-Main Door` at `10.1.10.189`
- `209-Main Door` at `10.1.0.201`

The backend assumes the devices are ZKTeco/eSSL-compatible TCP/IP terminals on port `4370`. If your model uses a different vendor protocol, use the vendor SDK or API in `backend/app/zk_client.py`.

## Run The Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Run The Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Check Device Reachability

Your PC must be on the same network/VPN as the devices.

```powershell
Test-NetConnection 10.1.10.189 -Port 4370
Test-NetConnection 10.1.0.201 -Port 4370
```

If `TcpTestSucceeded` is `False`, fix routing/firewall/device port settings before syncing.

## Configuration

Edit `devices.json` at the project root.

- `ip`: biometric device IP address.
- `port`: usually `4370` for ZKTeco/eSSL TCP/IP devices.
- `password`: device communication password, usually `0` when blank.
- `direction_mode`: keep `device` to use punch direction sent by the terminal.
- `default_direction`: fallback when a punch has no direction code.

## Email Reports

The attendance email sender supports both `SMTP_*` and `MAIL_*` environment variables:

```powershell
$env:MAIL_SERVER = "smtp.gmail.com"
$env:MAIL_PORT = "587"
$env:MAIL_USE_TLS = "true"
$env:MAIL_USERNAME = "your-gmail-address@gmail.com"
$env:MAIL_PASSWORD = "your-gmail-app-password"
$env:EMAIL_REPORT_ENABLED = "true"
$env:EMAIL_REPORT_TIME = "23:30"
```

If `MAIL_TO` or `SMTP_TO` is not set, reports are sent to the Gmail account in `MAIL_USERNAME`.
Set `EMAIL_REPORT_TIME` / `MAIL_REPORT_TIME` in `HH:MM` 24-hour format.

## Zoho People Attendance Sync

This app can send existing biometric punches to employees already registered in Zoho People. It does not create Zoho employees. Map each biometric `user_id` to the employee's Zoho People **Employee ID**, then preview before sending.

1. In Zoho API Console, create a Self Client for backend sync.
2. Generate a refresh token with these scopes:

```text
ZOHOPEOPLE.attendance.ALL,ZOHOPEOPLE.forms.READ
```

3. Open Settings -> Zoho People in the app.
4. Select the correct data center. India defaults to:

```text
Accounts URL: https://accounts.zoho.in
People URL:   https://people.zoho.in
```

5. Save `Client ID`, `Client Secret`, and `Refresh Token`, then click `Test OAuth`.
6. Click `Verify IDs` to compare local biometric IDs/mappings with the Zoho People Employee form.
7. Map local biometric users to Zoho Employee IDs. If the biometric user ID exactly equals Zoho Employee ID, enable `Biometric ID Equals Zoho Employee ID`.
8. Use `Preview` with a date range before `Send to Zoho`.

Secrets are stored locally in `backend/data/zoho_people_config.json`, which is ignored by git. Zoho sends use the Attendance Bulk Import API with `empId`, `checkIn` / `checkOut`, and date format `yyyy-MM-dd HH:mm:ss`.

## API

- `GET /api/devices`
- `GET /api/users`
- `GET /api/punches`
- `GET /api/summary`
- `POST /api/sync`
- `GET /api/zoho/config`
- `POST /api/zoho/config`
- `GET /api/zoho/status`
- `POST /api/zoho/test`
- `GET /api/zoho/employees/verify`
- `POST /api/zoho/sync`

Example sync request:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/sync -ContentType application/json -Body "{}"
```
