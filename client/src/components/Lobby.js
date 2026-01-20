import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import './Lobby.css';

function Lobby({ user, onJoinRoom, onLogout }) {
  const { socket } = useSocket();
  const [rooms, setRooms] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [friends, setFriends] = useState([]);

  useEffect(() => {
    // Fetch initial room list
    fetch(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000' + '/api/rooms')
      .then(res => res.json())
      .then(data => setRooms(data))
      .catch(err => console.error('Error fetching rooms:', err));

    // Listen for room updates
    socket.on('roomList', (updatedRooms) => {
      setRooms(updatedRooms);
    });

    socket.on('roomCreated', ({ roomId, room }) => {
      onJoinRoom(room);
    });

    socket.on('joinedRoom', ({ room }) => {
      onJoinRoom(room);
    });

    socket.on('friendRequest', ({ fromId, fromUsername, fromAvatar }) => {
      if (window.confirm(`${fromUsername} ${fromAvatar} wants to be your friend!`)) {
        socket.emit('acceptFriendRequest', { fromUserId: fromId });
      }
    });

    socket.on('friendAdded', (friend) => {
      setFriends(prev => [...prev, friend]);
    });

    socket.on('friendsList', (friendsList) => {
      setFriends(friendsList);
    });

    socket.on('roomInvite', ({ fromUsername, roomId, roomName }) => {
      if (window.confirm(`${fromUsername} invited you to join "${roomName}"`)) {
        socket.emit('joinRoom', { roomId });
      }
    });

    // Request friends list
    socket.emit('getOnlineFriends');

    return () => {
      socket.off('roomList');
      socket.off('roomCreated');
      socket.off('joinedRoom');
      socket.off('friendRequest');
      socket.off('friendAdded');
      socket.off('friendsList');
      socket.off('roomInvite');
    };
  }, [socket, onJoinRoom]);

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    
    socket.emit('createRoom', { name: roomName.trim(), isPrivate });
    setShowCreateModal(false);
    setRoomName('');
    setIsPrivate(false);
  };

  const handleJoinRoom = (roomId) => {
    socket.emit('joinRoom', { roomId });
  };

  return (
    <div className="lobby-container fade-in">
      <div className="lobby-header">
        <div className="lobby-user">
          <span className="user-avatar">{user.avatar}</span>
          <span className="user-name">{user.username}</span>
        </div>
        <button className="btn btn-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>

      <div className="lobby-content">
        <div className="lobby-section">
          <div className="section-header">
            <h2>🏠 Available Rooms</h2>
            <button 
              className="btn btn-primary" 
              onClick={() => setShowCreateModal(true)}
            >
              + Create Room
            </button>
          </div>

          <div className="rooms-grid">
            {rooms.length === 0 ? (
              <div className="empty-state">
                <p>No rooms available. Create one to get started!</p>
              </div>
            ) : (
              rooms.map(room => (
                <div key={room.id} className="room-card card">
                  <div className="room-info">
                    <h3>{room.name}</h3>
                    <div className="room-meta">
                      <span className="badge badge-primary">
                        👥 {room.memberCount}
                      </span>
                      <span className="room-host">Host: {room.host}</span>
                    </div>
                  </div>
                  <button 
                    className="btn btn-success"
                    onClick={() => handleJoinRoom(room.id)}
                  >
                    Join
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {friends.length > 0 && (
          <div className="lobby-section friends-section">
            <h3>👥 Friends Online ({friends.length})</h3>
            <div className="friends-list">
              {friends.map(friend => (
                <div key={friend.id} className="friend-item">
                  <span>{friend.avatar} {friend.username}</span>
                  <span className="badge badge-success">Online</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Room</h2>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input
                  type="text"
                  placeholder="Enter room name"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  maxLength={50}
                  autoFocus
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                  />
                  <span>Make room private (invite only)</span>
                </label>
              </div>

              <div className="modal-buttons">
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Lobby;
