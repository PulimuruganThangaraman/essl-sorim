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

## API

- `GET /api/devices`
- `GET /api/users`
- `GET /api/punches`
- `GET /api/summary`
- `POST /api/sync`

Example sync request:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/sync -ContentType application/json -Body "{}"
```
