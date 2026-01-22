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

Email (recommended for verification/reset):

**Option A: Resend (Recommended)**
- `RESEND_API_KEY=re_...` (Get from resend.com after verifying your domain)
- `SMTP_FROM=noreply@yourdomain.com`

**Option B: SMTP (Gmail, SendGrid, etc.)**
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `SMTP_SECURE` (optional)

See `.env.example` for the full list.

## Frontend environment

For separate frontend hosting, set:

- `REACT_APP_SOCKET_URL=https://your-backend-url`

If you deploy full-stack on the same host (server serves `client/build`), you typically don’t need a separate frontend host.

## Notes

- Voice (WebRTC) requires HTTPS in production for microphone access.
- If you don't configure email (Resend or SMTP), the server logs verification/reset links to the console.

## Custom Domain Setup

### On Render:
1. Go to your service dashboard → **Settings** → **Custom Domain**
2. Click **Add Custom Domain** and enter your domain (e.g., `yourdomain.com`)
3. Render will show DNS records you need to add

### On Your DNS Provider (Hostinger, GoDaddy, etc.):
Add these DNS records:
- **Root domain** (`yourdomain.com`): Add an **A record** with Name: `@` pointing to the IP Render provides
- **WWW subdomain** (`www.yourdomain.com`): Add a **CNAME record** with Name: `www` pointing to `your-app.onrender.com`

### Verify and Wait:
- DNS propagation can take 5 minutes to 48 hours
- Click **Verify** in Render once DNS propagates
- Render will automatically provision SSL certificates

### Update Environment Variables:
After domain verification, update:
```
CLIENT_URL=https://yourdomain.com
SERVER_PUBLIC_URL=https://yourdomain.com
```

### Email Domain Setup (Resend):
1. Sign up at resend.com
2. Add your domain and verify it with the provided DNS records (TXT, MX, CNAME)
3. Get your API key from the Resend dashboard
4. Add to Render environment variables:
```
RESEND_API_KEY=re_your_key_here
SMTP_FROM=noreply@yourdomain.com
```
