# Deployment

This app uses long-lived Socket.IO connections (plus WebRTC signaling for voice), so deploy it to a platform that supports a persistent Node process.

## Recommended platforms

### Railway (full-stack)

- Build command: `npm run build`
- Start command: `npm start`

### Render (full-stack)

- Build command: `npm install && npm run build`
- Start command: `npm start`

## Required environment variables (server)

Set these on your host (do not commit secrets):

- `NODE_ENV=production`
- `PORT` (usually provided by the host)
- `CLIENT_URL=https://your-frontend-url`
- `SERVER_PUBLIC_URL=https://your-backend-url`
- `MONGODB_URI=...`

Email (optional, but recommended for verification/reset):

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (optional)
- `SMTP_SECURE` (optional)

See `.env.example` for the full list.

## Frontend environment

For separate frontend hosting, set:

- `REACT_APP_SOCKET_URL=https://your-backend-url`

If you deploy full-stack on the same host (server serves `client/build`), you typically don’t need a separate frontend host.

## Notes

- Voice (WebRTC) requires HTTPS in production for microphone access.
- If you don’t configure SMTP, the server logs verification/reset links to the console.
