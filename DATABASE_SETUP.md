# MongoDB Setup Guide

## Current Status
Hangout Bar uses MongoDB (Mongoose) for persistence:
- ✅ User accounts (username, password, profiles)
- ✅ Guest accounts
- ✅ Profile pictures
- ✅ Friend lists
- ✅ Messages (optional)
- ✅ Room data (optional)

## Setup Options

### Option 1: Local MongoDB (Recommended for Development)

**Install MongoDB:**
1. Download: https://www.mongodb.com/try/download/community
2. Install with default settings
3. MongoDB will run on `mongodb://localhost:27017`

**Verify Installation:**
```powershell
# Check if MongoDB is running
mongosh
# If it connects, you're good!
```

**Configure App:**
Your `.env` file is already set to:
```
MONGODB_URI=mongodb://localhost:27017/hangout-bar
```

### Option 2: MongoDB Atlas (Free Cloud Database)

**Setup Steps:**
1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for free account
3. Create a cluster (Free M0 tier)
4. Click "Connect" → "Connect your application"
5. Copy the connection string

**Update .env:**
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/hangout-bar
```
Replace `username` and `password` with your credentials.

## Option 3: In-Memory Mode (Not Recommended)

If `MONGODB_URI` is missing or the connection fails, the server can optionally run in memory-only mode.

- Set `ALLOW_IN_MEMORY=true` to allow it.
- Expect no persistence (server restart wipes everything).
- Some features (accounts/auth/feed/DMs) require MongoDB to behave correctly.

## How to Start

### With Local MongoDB:
```powershell
# Make sure MongoDB is running, then:
cd d:\git\AI_Development_Tool
node server/index.js
```

You should see:
```
✅ MongoDB connected successfully
Server running on port 5000
```

### With MongoDB Atlas:
```powershell
# Update .env with Atlas connection string, then:
cd d:\git\AI_Development_Tool
node server/index.js
```

### Check Database Connection

When server starts, look for these messages:

**✅ SUCCESS:**
```
✅ MongoDB connected successfully
Server running on port 5000
```

**⚠️ WARNING (No Database):**
```
⚠️ No MongoDB URI found. Running in memory-only mode.
   Add MONGODB_URI to .env for database persistence.
Server running on port 5000
```

**❌ ERROR (Wrong Config):**
```
❌ MongoDB connection error: [error message]
⚠️ Falling back to in-memory mode
Server running on port 5000
```

## What's Stored in Database

### Users Collection
```javascript
{
  _id: ObjectId,
  socketId: "socket123",
  username: "JohnDoe",
  password: "$2b$10$hashed...",  // Encrypted
  isGuest: false,
  avatar: "😊",
  profilePicture: "https://...",
  bio: "Hello world!",
  friends: [ObjectId1, ObjectId2],
  friendRequests: [{ from: ObjectId, timestamp: Date }],
  createdAt: Date,
  lastActive: Date
}
```

### Messages Collection (Optional)
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  username: "JohnDoe",
  message: "Hello!",
  roomId: "room123",
  system: false,
  timestamp: Date
}
```

### Rooms Collection (Optional)
```javascript
{
  _id: ObjectId,
  name: "Chill Room",
  isPrivate: false,
  host: ObjectId,
  members: [ObjectId1, ObjectId2],
  youtube: {
    videoId: "abc123",
    isPlaying: true,
    currentTime: 45
  }
}
```

## Testing Database

Once connected, test with:

### Create Account
1. Go to http://localhost:3000
2. Click "Create Account"
3. Fill in username, password, avatar
4. Click "Create Account ✨"

### Check Database
```powershell
# Connect to MongoDB
mongosh

# Use your database
use hangout-bar

# See all users
db.users.find().pretty()

# See specific user
db.users.findOne({ username: "JohnDoe" })
```

## Troubleshooting

### "MongoDB connection error"
- Install MongoDB or use Atlas
- Check MONGODB_URI format
- Ensure MongoDB service is running
- Check firewall/network settings

### "useDatabase is false"
- Check .env file exists in root directory
- Verify MONGODB_URI is set
- Restart server after changing .env

### "Authentication not working"
- Database must be connected
- Check server logs for connection status
- Guest mode works without database
- Signup/Login requires database

## Current Configuration

Your `.env` file is set to:
```
MONGODB_URI=mongodb://localhost:27017/hangout-bar
```

This expects **local MongoDB** installed on your computer.

To use it:
1. Install MongoDB from https://www.mongodb.com/try/download/community
2. Start MongoDB service (usually auto-starts)
3. Restart your server: `node server/index.js`
4. Look for "✅ MongoDB connected successfully"

## Quick Start Commands

```powershell
# Install MongoDB (Windows with Chocolatey)
choco install mongodb

# Or download installer from:
# https://www.mongodb.com/try/download/community

# Start server (it will auto-connect to MongoDB)
cd d:\git\AI_Development_Tool
node server/index.js

# In another terminal, start React
cd d:\git\AI_Development_Tool\client
npm start
```

## Need Help?

- MongoDB Installation: https://docs.mongodb.com/manual/installation/
- MongoDB Atlas Setup: https://docs.atlas.mongodb.com/getting-started/
- Connection String Format: https://docs.mongodb.com/manual/reference/connection-string/
