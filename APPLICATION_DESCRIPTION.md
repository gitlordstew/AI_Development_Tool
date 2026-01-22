# Hangout Bar - Application Description

## What it is

Hangout Bar is a real-time “virtual hangout” app where users can create/join rooms, chat, and do shared activities together. It combines social features (profiles, friends, notifications) with real-time collaboration (rooms, synced media/drawing) and voice.

## Key features

- Accounts + guest mode
- Email verification + password reset (SMTP-backed, with console fallback for local dev)
- Public/private rooms
- Room activities: chat, YouTube sync, drawing canvas, guessing game
- Friends system + invites + timeline “Add Friend”
- Direct messages (DMs)
- Feed posts + comments (mobile-friendly deep threads)
- Voice per room (WebRTC mesh): mute/deafen + speaking indicator + local “profile mute”

## Why it stands out

- Real-time depth: Socket.IO powers chat/presence/activity sync; WebRTC adds Discord-like voice
- Persistence: MongoDB (Mongoose) stores users, profiles, friendships, DMs, and feed content
- UX polish: responsive layouts, mobile-first DM navigation, and a collaborative drawing canvas that scales correctly across device sizes

## Tech stack

- Frontend: React (CRA), Socket.IO client
- Backend: Node.js, Express, Socket.IO
- Database: MongoDB + Mongoose
- Email: Nodemailer
- Voice: WebRTC signaling over Socket.IO
