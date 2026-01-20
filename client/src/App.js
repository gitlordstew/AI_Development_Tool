import React, { useState } from 'react';
import { SocketProvider } from './context/SocketContext';
import Login from './components/Login';
import Lobby from './components/Lobby';
import Room from './components/Room';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('login'); // 'login', 'lobby', 'room'
  const [user, setUser] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);

  return (
    <SocketProvider>
      <div className="App">
        {currentView === 'login' && (
          <Login 
            onLogin={(userData) => {
              setUser(userData);
              setCurrentView('lobby');
            }}
          />
        )}
        
        {currentView === 'lobby' && (
          <Lobby 
            user={user}
            onJoinRoom={(room) => {
              setCurrentRoom(room);
              setCurrentView('room');
            }}
            onLogout={() => {
              setUser(null);
              setCurrentView('login');
            }}
          />
        )}
        
        {currentView === 'room' && (
          <Room 
            user={user}
            room={currentRoom}
            onLeaveRoom={() => {
              setCurrentRoom(null);
              setCurrentView('lobby');
            }}
          />
        )}
      </div>
    </SocketProvider>
  );
}

export default App;
