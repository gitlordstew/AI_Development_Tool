import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const lastRegisteredRef = useRef({ socketId: null, userId: null, username: null });

  useEffect(() => {
    const socketURL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
    const newSocket = io(socketURL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const registerUser = (userData) => {
      if (!newSocket || !newSocket.connected) return;
      const userId = userData?.id || userData?._id;
      const username = userData?.username;
      const avatar = userData?.avatar;

      // Guard: only register once per socket.id per user
      const last = lastRegisteredRef.current;
      if (last.socketId === newSocket.id && (last.userId === userId || last.username === username)) {
        return;
      }

      if (userId || username) {
        newSocket.emit('register', { username, avatar, userId });
        lastRegisteredRef.current = { socketId: newSocket.id, userId: userId || null, username: username || null };
      }
    };

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);

      // Auto-register from saved session (once per connection)
      try {
        const rawSession = localStorage.getItem('hangout_session');
        if (rawSession) {
          const session = JSON.parse(rawSession);
          registerUser(session?.user);
        }
      } catch {
        // ignore
      }
    });

    newSocket.on('serverInfo', (info) => {
      console.log('[serverInfo]', info);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    setSocket(newSocket);

    // Expose a stable register function tied to this socket instance
    newSocket.__registerUser = registerUser;

    return () => {
      newSocket.close();
    };
  }, []);

  const registerUser = (userData) => {
    if (socket && socket.__registerUser) {
      socket.__registerUser(userData);
    } else if (socket && socket.connected) {
      // Fallback
      const userId = userData?.id || userData?._id;
      const username = userData?.username;
      const avatar = userData?.avatar;
      if (userId || username) socket.emit('register', { username, avatar, userId });
    }
  };

  return (
    <SocketContext.Provider value={{ socket, connected, registerUser }}>
      {children}
    </SocketContext.Provider>
  );
};
