import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import YouTube from 'react-youtube';
import Profile from './Profile';
import './Room.css';

function Room({ user, room, onLeaveRoom }) {
  const { socket } = useSocket();
  const [messages, setMessages] = useState(room.messages || []);
  const [newMessage, setNewMessage] = useState('');
  const [members, setMembers] = useState(room.members || []);
  const [activeTab, setActiveTab] = useState('youtube'); // 'youtube', 'draw'
  const [showChat, setShowChat] = useState(true);
  const [showMembers, setShowMembers] = useState(true);
  const [viewingProfile, setViewingProfile] = useState(null);
  
  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [currentVideo, setCurrentVideo] = useState(room.youtube);
  const youtubePlayerRef = useRef(null);
  const [isHost, setIsHost] = useState(false);
  
  // Drawing state
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawWidth, setDrawWidth] = useState(3);
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    const isUserHost = user.id === room.host;
    console.log('Host Check:', { userId: user.id, roomHost: room.host, isHost: isUserHost });
    setIsHost(isUserHost);

    // Chat events
    socket.on('newMessage', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('userJoined', ({ userId, username, avatar }) => {
      setMembers(prev => [...prev, { id: userId, username, avatar }]);
      setMessages(prev => [...prev, {
        id: Date.now(),
        system: true,
        message: `${username} joined the room`
      }]);
    });

    socket.on('userLeft', ({ userId, username }) => {
      setMembers(prev => prev.filter(m => m.id !== userId));
      setMessages(prev => [...prev, {
        id: Date.now(),
        system: true,
        message: `${username} left the room`
      }]);
    });

    // YouTube events
    socket.on('youtubeSync', (youtubeState) => {
      setCurrentVideo(youtubeState);
      if (youtubePlayerRef.current) {
        const player = youtubePlayerRef.current; // player ref IS the YouTube IFrame Player API
        if (youtubeState.playing) {
          player.playVideo();
          player.seekTo(youtubeState.timestamp, true);
        } else {
          player.pauseVideo();
          player.seekTo(youtubeState.timestamp, true);
        }
      }
    });

    // Drawing events
    socket.on('drawing', (drawData) => {
      drawOnCanvas(drawData, false);
    });

    socket.on('canvasCleared', () => {
      clearCanvas(false);
    });

    return () => {
      socket.off('newMessage');
      socket.off('userJoined');
      socket.off('userLeft');
      socket.off('youtubeSync');
      socket.off('drawing');
      socket.off('canvasCleared');
    };
  }, [socket, user.id, room.host]);

  // Initialize canvas
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      
      // Draw existing drawings
      if (room.drawings) {
        room.drawings.forEach(drawData => {
          drawOnCanvas(drawData, false);
        });
      }
    }
  }, [activeTab, room.drawings]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    socket.emit('sendMessage', { message: newMessage.trim() });
    setNewMessage('');
  };

  const handleLeave = () => {
    socket.emit('leaveRoom');
    onLeaveRoom();
  };

  const extractVideoId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleLoadVideo = () => {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      alert('Invalid YouTube URL');
      return;
    }

    setCurrentVideo({ videoId, playing: true, timestamp: 0, lastUpdate: Date.now() });
    socket.emit('youtubePlay', { videoId, timestamp: 0 });
    setYoutubeUrl('');
  };

  const onYoutubeReady = (event) => {
    youtubePlayerRef.current = event.target;
    if (currentVideo.videoId) {
      const player = event.target; // event.target IS the YouTube IFrame Player API
      player.seekTo(currentVideo.timestamp, true);
      if (currentVideo.playing) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    }
  };

  const onYoutubeStateChange = (event) => {
    if (!isHost) return;

    const player = event.target;
    const currentTime = player.getCurrentTime();

    if (event.data === 1) { // Playing
      socket.emit('youtubePlay', { 
        videoId: currentVideo.videoId, 
        timestamp: currentTime 
      });
    } else if (event.data === 2) { // Paused
      socket.emit('youtubePause', { timestamp: currentTime });
    }
  };

  // Drawing functions
  const startDrawing = (e) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    
    const drawData = {
      type: 'start',
      x,
      y,
      color: drawColor,
      width: drawWidth
    };
    
    drawOnCanvas(drawData, true);
    socket.emit('draw', drawData);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    
    const drawData = {
      type: 'draw',
      x,
      y,
      color: drawColor,
      width: drawWidth
    };
    
    drawOnCanvas(drawData, true);
    socket.emit('draw', drawData);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const drawOnCanvas = (drawData, isLocal) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    if (drawData.type === 'start') {
      ctx.beginPath();
      ctx.moveTo(drawData.x, drawData.y);
      ctx.strokeStyle = drawData.color;
      ctx.lineWidth = drawData.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    } else if (drawData.type === 'draw') {
      ctx.strokeStyle = drawData.color;
      ctx.lineWidth = drawData.width;
      ctx.lineTo(drawData.x, drawData.y);
      ctx.stroke();
    }
  };

  const clearCanvas = (emit = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (emit) {
      socket.emit('clearCanvas');
    }
  };

  const handleViewProfile = async (member) => {
    // Check if current user is guest
    if (user.isGuest) {
      setViewingProfile({ _id: member.id, ...member, __isGuest: true });
      return;
    }
    
    try {
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/${member.id}`);
      const profileData = await response.json();
      setViewingProfile(profileData);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleProfileUpdate = (updatedProfile) => {
    // Update current user if viewing own profile
    if (updatedProfile._id === user.id) {
      Object.assign(user, updatedProfile);
    }
    setViewingProfile(updatedProfile);
  };

  return (
    <div className="room-container-rave fade-in">
      {/* Top Header */}
      <div className="room-header-rave">
        <div className="room-info">
          <h2>🏠 {room.name}</h2>
          <span className="member-count">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="header-controls">
          <button className="btn-icon" onClick={() => setShowMembers(!showMembers)} title="Toggle Members">
            👥
          </button>
          <button className="btn-icon" onClick={() => setShowChat(!showChat)} title="Toggle Chat">
            💬
          </button>
          <button className="btn btn-danger" onClick={handleLeave}>
            Leave
          </button>
        </div>
      </div>

      <div className="room-body-rave">
        {/* Left Sidebar - Members */}
        {showMembers && (
          <div className="sidebar-left">
            <div className="sidebar-header">
              <h3>👥 In Room</h3>
            </div>
            <div className="members-list">
              {members.map(member => (
                <div 
                  key={member.id} 
                  className="member-item" 
                  onClick={() => handleViewProfile(member)}
                  style={{ cursor: 'pointer' }}
                >
                  {member.profilePicture ? (
                    <img src={member.profilePicture} alt={member.username} className="member-avatar-image" />
                  ) : (
                    <span className="member-avatar-large">{member.avatar}</span>
                  )}
                  <div className="member-info">
                    <span className="member-name">{member.username}</span>
                    {member.id === room.host && <span className="host-badge">HOST</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="content-center">
          <div className="content-tabs">
            <button 
              className={`content-tab ${activeTab === 'youtube' ? 'active' : ''}`}
              onClick={() => setActiveTab('youtube')}
            >
              🎵 Watch
            </button>
            <button 
              className={`content-tab ${activeTab === 'draw' ? 'active' : ''}`}
              onClick={() => setActiveTab('draw')}
            >
              🎨 Draw
            </button>
          </div>

          <div className="content-area">
            {activeTab === 'youtube' && (
              <div className="youtube-container-rave">
            <div className="youtube-controls">
              <input
                type="text"
                placeholder="Paste YouTube URL..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
              <button 
                className="btn btn-primary" 
                onClick={handleLoadVideo}
                disabled={!isHost}
              >
                Load Video
              </button>
            </div>
            
            {!isHost && <p className="host-notice">Only the host can control playback</p>}
            
                {currentVideo.videoId ? (
                  <div className="youtube-player-rave">
                    <YouTube
                      videoId={currentVideo.videoId}
                      opts={{
                        width: '100%',
                        height: '100%',
                        playerVars: {
                          autoplay: 1,
                          controls: isHost ? 1 : 0,
                        },
                      }}
                      onReady={onYoutubeReady}
                      onStateChange={onYoutubeStateChange}
                    />
                  </div>
                ) : (
                  <div className="empty-youtube-rave">
                    <div className="empty-icon">🎵</div>
                    <h3>No video playing</h3>
                    <p>Paste a YouTube URL above to start watching together!</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'draw' && (
              <div className="draw-container-rave">
                <div className="draw-controls">
                  <div className="color-picker">
                    <label>Color:</label>
                    <input
                      type="color"
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                    />
                  </div>
                  <div className="width-picker">
                    <label>Size:</label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={drawWidth}
                      onChange={(e) => setDrawWidth(e.target.value)}
                    />
                    <span>{drawWidth}px</span>
                  </div>
                  <button className="btn btn-danger" onClick={() => clearCanvas(true)}>
                    Clear
                  </button>
                </div>
                
                <canvas
                  ref={canvasRef}
                  className="draw-canvas-rave"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Chat */}
        {showChat && (
          <div className="sidebar-right">
            <div className="sidebar-header">
              <h3>💬 Chat</h3>
            </div>
            <div className="chat-messages">
              {messages.map((msg, idx) => (
                <div 
                  key={msg.id || idx} 
                  className={`chat-message ${msg.system ? 'system' : ''} ${msg.userId === user.id ? 'own' : ''}`}
                >
                  {msg.system ? (
                    <span className="system-text">{msg.message}</span>
                  ) : (
                    <>
                      <div className="message-header">
                        <span className="message-author">{msg.username}</span>
                        <span className="message-time">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="message-text">{msg.message}</div>
                    </>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleSendMessage} className="chat-input-form">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="chat-input"
              />
              <button type="submit" className="btn-send">➤</button>
            </form>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      {viewingProfile && (
        <Profile 
          user={viewingProfile}
          currentUser={user}
          onClose={() => setViewingProfile(null)}
          onUpdate={handleProfileUpdate}
          isOwnProfile={viewingProfile._id === user.id}
        />
      )}
    </div>
  );
}

export default Room;
