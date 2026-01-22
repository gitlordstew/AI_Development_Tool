# Testing Guide

This is a quick, practical checklist to verify the current feature set before pushing/deploying.

## Local smoke test

1) Install + run

```bash
npm run install-all
npm run dev
```

2) Health check

- Open `http://localhost:5000/api/health`

## Auth / email

- Create an account (email + password)
- Verify that a verification email is sent (or link is printed when SMTP is not configured)
- Verify the account can’t login until email is verified
- Test resend verification (cooldown applies)
- Test forgot password flow

## Social

- Send a friend request from User A to User B
- Accept/reject and confirm friend list updates
- On a user timeline, confirm “Add Friend” appears when not friends

## Rooms

- Create public/private rooms
- Join/leave room and confirm member list updates
- Chat: send messages, verify scroll + system join/leave messages
- YouTube tab: load a video URL and confirm sync across two browsers
- Draw tab: draw/clear and confirm sync across two devices (desktop + phone)
	- On mobile, toggle **Draw mode** ON to draw; OFF to scroll
	- Drawings use normalized coordinates so the same board maps correctly across different screen sizes

## Voice

- Join voice in a room (two browsers)
- Verify mute/deafen toggles (deafen also auto-mutes)
- Verify speaking indicator appears when talking
- Verify “profile mute” locally mutes that user’s audio only

## Feed + DMs

- Create a post, comment/reply (including deep threads)
- DM another user and verify mobile layout (list vs chat view)
