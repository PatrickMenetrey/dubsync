# DubSync

Monorepo for the DubSync app.

## Structure

```text
dubsync/
  client/   Vite + React + Tailwind CSS
  server/   Node.js + Express
```

## Prerequisites

- Node.js 18+
- npm

## Setup

Install dependencies in each workspace:

```bash
cd dubsync/client
npm install

cd ../server
npm install
```

Create the server environment file:

```bash
cd server
cp .env.example .env
```

Fill in the API keys in `server/.env`.

Create the client environment file:

```bash
cd ../client
cp .env.example .env
```

Fill in `VITE_CLERK_PUBLISHABLE_KEY` in `client/.env`.

## Run

Start the client:

```bash
cd dubsync/client
npm run dev
```

The client runs at `http://localhost:5173`.

Start the server in another terminal:

```bash
cd dubsync/server
npm run dev
```

The server runs at `http://localhost:3001`.

## Health Check

```bash
curl http://localhost:3001/health
```
