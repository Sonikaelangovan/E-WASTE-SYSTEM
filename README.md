# EcoTrace — E-Waste Collection, Recycling & Traceability Management System

A standalone full-stack project in `C:\Users\thira\Flight_Management\E-Waste-System`. It does not share code, ports, containers or data with AeroCadet or Online Sneakers Shop.

## Features

- Public collection categories, demonstration center directory and privacy-safe tracking by code
- Customer registration, sign-in, pickup scheduling, history and cancellation before assignment
- Administrator dashboard, collector assignment, team account creation and audit log
- Collector acceptance and collection handoff
- Recycler receipt at a center, actual weight and method recording, and a digital recycling record number
- Timestamped traceability events across the full lifecycle
- Password hashing with scrypt, HTTP-only session cookies, role checks, input validation and SQLite persistence
- Docker image/container/volume, Jenkins CI pipeline, Ansible deployment and PowerShell restart helpers

This is a demonstration system. The digital recycling record is not a government or regulatory certificate, and center addresses are fictional.

## Start after a laptop restart

1. Open Docker Desktop and wait for the Linux engine.
2. Open PowerShell in `C:\Users\thira\Flight_Management\E-Waste-System`.
3. Run `./scripts/start-ecotrace.ps1` (or `./scripts/start-ecotrace.ps1 -Build` after changing code).
4. Run `./scripts/status-ecotrace.ps1` and open <http://localhost:8092>.
5. When finished, run `./scripts/stop-ecotrace.ps1`. The named database volume is retained.

The private `.env` is already present on this laptop and is excluded from Git and the Docker image. On another machine, copy `.env.example` to `.env` and replace all three example passwords before starting. The role account emails are in `.env`; do not publish or share the passwords. Customer accounts are created in the UI.

## Verify locally

```powershell
npm run check
npm test
docker compose ps
```

The app uses Node.js 24 built-in HTTP, SQLite and test modules; `npm install` is not required. To run without Docker, set `PORT`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COLLECTOR_EMAIL`, `COLLECTOR_PASSWORD`, `RECYCLER_EMAIL`, and `RECYCLER_PASSWORD` in the process environment, then run `npm start`.

## Ansible (Ubuntu / WSL)

```bash
cd /mnt/c/Users/thira/Flight_Management/E-Waste-System
ansible-playbook -i ansible/inventory ansible/playbook.yml
ansible-playbook -i ansible/inventory ansible/playbook.yml
```

The second run should report `changed=0`. Pass `-e force_build=true` to rebuild an existing image. Docker Desktop WSL integration must be enabled.

## Jenkins

Create a Pipeline job using `https://github.com/Sonikaelangovan/E-WASTE-SYSTEM.git`, branch `main`, script path `Jenkinsfile`. The default `DEPLOY=false` runs checkout, syntax checks and all tests. `DEPLOY=true` additionally builds and starts Docker using the private `ENV_FILE` on the Jenkins agent and checks port 8092. The private file is not committed or copied into the build context.

## Operational notes

- The Compose image is `e-waste-system-app:latest`, container is `e-waste-system-app-1`, and volume is `e-waste-system_ewaste-data`.
- Public tracking deliberately omits customer names, addresses and staff notes.
- Use TLS, backups, rate limiting, verified recycling partners and formal certification controls before a real deployment.
