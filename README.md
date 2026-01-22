# Hangout Bar

A real-time social hangout space built for the SmartFlowLabs assessment challenge.

## Features

- Rooms: real-time chat, YouTube sync, drawing canvas, and a lightweight â€œguessâ€ game
- Social: profiles, timelines, friend requests, notifications
- Messaging: direct messages (DMs)
- Feed: posts + comments
- Voice: Discord-like voice per room (mute/deafen + speaking indicator)
- Auth: accounts + guest mode, email verification, password reset

## Tech

- Client: React (CRA), Socket.IO client
- Server: Node.js, Express, Socket.IO, MongoDB (Mongoose), Nodemailer
- Voice: WebRTC mesh signaling over Socket.IO

## Project structure

```
server/     # Express + Socket.IO API/signaling + Mongo models
client/     # React app
```

## Email verification / password reset

1) Backend env
- Copy `.env.example` to `.env` and fill values.
- Important: never commit `.env` (it contains secrets).

2) Frontend env
- Copy `client/.env.example` to `client/.env.local` and adjust if needed.

3) Install + run

```bash
npm run install-all
npm run dev
```

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:3000`

Health check:
- `http://localhost:5000/api/health`

## Email verification / password reset

- If SMTP isnâ€™t configured, the server logs verification/reset links to the console.
- For real emails, set the SMTP variables in `.env`.
- Set `SERVER_PUBLIC_URL` and `CLIENT_URL` to public URLs in production so links work.

