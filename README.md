# Monitoring App

A self-hosted web dashboard for running shell/Ansible scripts on remote machines over SSH, with real-time log streaming, per-environment isolation, and WireGuard VPN management.

## Features

- **Script runner** — run `.sh`, `.py`, `.yml`/`.yaml` scripts on remote machines; auto-detects `read -p` parameters and prompts for them in the UI
- **Real-time output** — logs stream via WebSocket as the script runs; stop a running job at any time
- **Multiple auth methods** — SSH key, SSH password, Kerberos/WinRM (no credentials), WinRM NTLM
- **Jump / bastion host** — optional SSH jump host per machine
- **Environments** — isolate scripts, logs, inventories and history into named environments; switch with the env pill in the header
- **Ansible inventory import** — paste a hostname list with bulk auth assignment; parse INI/YAML inventory files
- **Log browser** — browse and view saved log files, filtered by script or environment
- **Run history** — searchable history with re-run support
- **WireGuard VPN tab** — create, edit and connect WireGuard configs; live connection status (handshake, transfer, peer IP); copy-ready `.conf` file; step-by-step Linux and Windows commands

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, asyncssh, uvicorn |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 3 |
| Proxy (Docker) | nginx |

---

## Running locally (development)

```bash
# 1. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 2. Start both services
./start.sh
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:8000

---

## Running with Docker

### Quick start

```bash
docker compose up -d --build
```

App is available at **http://localhost:3000**.

### Configuration via `.env`

Copy `.env.example` to `.env` and adjust:

```env
# Port exposed on the host for the frontend
FRONTEND_PORT=3000

# Optional: mount your own directories for scripts and environments
# SCRIPTS_DIR=/home/youruser/monitoring-scripts
# ENVS_DIR=/home/youruser/monitoring-envs
```

Then:

```bash
docker compose up -d --build
```

### Persistent data

| What | Where |
|---|---|
| Scripts | `monitoring_scripts` volume (or `$SCRIPTS_DIR`) |
| Environments (scripts/logs per env) | `monitoring_envs` volume (or `$ENVS_DIR`) |
| Machines, configs, history, WireGuard | `monitoring_data` named volume |

---

## WireGuard in Docker

The backend container requires `NET_ADMIN` capability and `/dev/net/tun` to run `wg-quick`. Make sure the WireGuard kernel module is loaded on the host:

```bash
sudo modprobe wireguard
```

If you don't need WireGuard inside Docker (e.g. you manage VPN on the host), remove the `cap_add`, `sysctls` and `devices` sections from `docker-compose.yml`.
