import React, { useState, useEffect } from 'react';
import { SocketProvider } from './context/SocketContext';
import { VoiceProvider } from './context/VoiceContext';
import Login from './components/Login';
import LobbyNew from './components/LobbyNew';
import Room from './components/Room';
import TimelinePage from './components/TimelinePage';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('login'); // 'login', 'lobby', 'room', 'timeline'
  const [user, setUser] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [inviteRoomId, setInviteRoomId] = useState(null);
  const [timelineUserId, setTimelineUserId] = useState(null);
  const [previousView, setPreviousView] = useState('lobby');

  const timelineBackLabel = previousView === 'room'
    ? 'Back to Room'
    : previousView === 'lobby'
      ? 'Back to Lobby'
      : 'Back';

  const openTimeline = (userId, { fromView } = {}) => {
    const id = String(userId || '').trim();
    if (!id) return;
    setTimelineUserId(id);
    setPreviousView(fromView || currentView);
    setCurrentView('timeline');
  };

  // Capture invite link roomId so it can be used after login
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get('roomId');
      if (roomId) {
        setInviteRoomId(roomId);
        localStorage.setItem('hangout_pending_room', roomId);
      } else {
        const pending = localStorage.getItem('hangout_pending_room');
        if (pending) setInviteRoomId(pending);
      }
    } catch {
      // ignore
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = () => {
      const sessionData = localStorage.getItem('hangout_session');
      
      if (sessionData) {
        try {
          const { user: storedUser, timestamp } = JSON.parse(sessionData);
          const now = Date.now();
          const SESSION_DURATION = 60 * 60 * 1000; // 60 minutes
          
          // Check if session is still valid
          if (now - timestamp < SESSION_DURATION) {
            console.log('Valid session found, auto-logging in...');
            setUser(storedUser);
            setCurrentView('lobby');
          } else {
            console.log('Session expired, clearing...');
            localStorage.removeItem('hangout_session');
            localStorage.removeItem('hangout_token');
            localStorage.removeItem('hangout_user');
          }
        } catch (error) {
          console.error('Error parsing session data:', error);
          localStorage.removeItem('hangout_session');
        }
      }
      
      setIsCheckingSession(false);
    };
    
    checkSession();
  }, []);

  // Update session timestamp on user activity
  useEffect(() => {
    if (!user) return;
    
    const updateSessionTimestamp = () => {
      const sessionData = {
        user,
        timestamp: Date.now()
      };
      localStorage.setItem('hangout_session', JSON.stringify(sessionData));
    };
    
    // Update timestamp on any activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, updateSessionTimestamp);
    });
    
    // Initial save
    updateSessionTimestamp();
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, updateSessionTimestamp);
      });
    };
  }, [user]);

  if (isCheckingSession) {
    return (
      <div className="App" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <SocketProvider>
      <VoiceProvider>
        <div className={`App${currentView === 'login' ? ' app-scroll' : ''}`}>
          {currentView === 'login' && (
            <Login 
              inviteRoomId={inviteRoomId}
              onLogin={(userData) => {
                setUser(userData);
                setCurrentView('lobby');
              }}
            />
          )}
          
          {currentView === 'lobby' && (
            <LobbyNew 
              user={user}
              inviteRoomId={inviteRoomId}
              onUserUpdated={(nextUser) => setUser(nextUser)}
              onJoinRoom={(room) => {
                setCurrentRoom(room);
                setCurrentView('room');
                setInviteRoomId(null);
              }}
              onViewTimeline={(userId) => openTimeline(userId, { fromView: 'lobby' })}
              onLogout={() => {
                // Clear session data
                localStorage.removeItem('hangout_session');
                localStorage.removeItem('hangout_token');
                localStorage.removeItem('hangout_user');
                setInviteRoomId(null);
                setUser(null);
                setCurrentView('login');
              }}
            />
          )}
          
          {currentView === 'room' && (
            <Room 
              user={user}
              room={currentRoom}
              onUserUpdated={(nextUser) => setUser(nextUser)}
              onLeaveRoom={() => {
                setCurrentRoom(null);
                setCurrentView('lobby');
              }}
              onViewTimeline={(userId) => openTimeline(userId, { fromView: 'room' })}
            />
          )}

          {currentView === 'timeline' && (
            <TimelinePage
              currentUser={user}
              targetUserId={timelineUserId}
              onNavigateToUser={(userId) => openTimeline(userId, { fromView: previousView })}
              onBack={() => setCurrentView(previousView || 'lobby')}
              backLabel={timelineBackLabel}
            />
          )}
        </div>
      </VoiceProvider>
    </SocketProvider>
  );
}

export default App;
