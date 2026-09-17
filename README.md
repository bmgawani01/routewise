# Routewise — Driver Onboarding Portal

Driver onboarding web app: sign up, verify phone via OTP, complete a 4-step onboarding
form, upload documents, submit an application, and track approval status.

**Live:** https://routewise-ccot.onrender.com

## Stack
- Frontend: HTML/CSS/JS (single `index.html`)
- Backend: Node.js + Express (`server.js`)
- Database: MySQL

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill in your database details
3. Import `schema.sql` into MySQL
4. `npm start` → http://localhost:5000

## Deploy
- Hosting: Render free web service, auto-deploys on every push to `main`
- Database: Aiven free MySQL (`schema.cloud.sql`)
- Health check: `/health`

## Environment variables
`NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `ALLOWED_ORIGIN`

## Notes
- In development the OTP code is shown on screen (no SMS provider integrated).
- Free hosting sleeps when idle, so the first load can take ~30–50s.
- Uploaded files are not persisted across redeploys on the free tier.
