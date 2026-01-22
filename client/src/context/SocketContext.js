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
  const [connectionError, setConnectionError] = useState('');
  const lastRegisteredRef = useRef({ socketId: null, userId: null, username: null });

  useEffect(() => {
    const envURL = process.env.REACT_APP_SOCKET_URL;
    const socketURL = envURL
      ? envURL
      : (typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : 'http://localhost:5000');

    const newSocket = io(socketURL, {
      // Start with polling for maximum compatibility; upgrade to websocket when possible.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
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
      setConnectionError('');

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

    newSocket.on('connect_error', (err) => {
      const msg = String(err?.message || 'Unable to connect to server');
      console.warn('[socket] connect_error', err);
      setConnected(false);
      setConnectionError(msg);
    });

    newSocket.io?.on?.('reconnect_failed', () => {
      setConnectionError('Reconnection failed. Please refresh or try again later.');
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
    <SocketContext.Provider value={{ socket, connected, connectionError, registerUser }}>
      {children}
    </SocketContext.Provider>
  );
};
