import React, { useEffect, useRef, useState } from 'react';
import YouTube from 'react-youtube';
import { useSocket } from '../context/SocketContext';
import { useVoice } from '../context/VoiceContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightFromBracket,
  faCheck,
  faComments,
  faEarDeaf,
  faHouse,
  faLink,
  faMusic,
  faMicrophone,
  faMicrophoneSlash,
  faPalette,
  faPaperPlane,
  faUserGroup
} from '@fortawesome/free-solid-svg-icons';
import Notifications from './Notifications';
import Profile from './Profile';
import AccountOptionsModal from './AccountOptionsModal';
import './Room.css';

function Room({ user, room, onLeaveRoom, onViewTimeline, onUserUpdated }) {
  const { socket, connected } = useSocket();
  const {
    joined: voiceJoined,
    channelId: voiceChannelId,
    selfState: voiceSelfState,
    joinVoice,
    leaveVoice,
    toggleMute: toggleVoiceMute,
    toggleDeafen: toggleVoiceDeafen,
    voiceStatesByUserId,
    speakingByUserId: voiceSpeakingByUserId
  } = useVoice();

  const [voiceError, setVoiceError] = useState('');

  const [messages, setMessages] = useState(room.messages || []);
  const [newMessage, setNewMessage] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);

  // Guess Game state
  const [guessGame, setGuessGame] = useState({ active: false, phase: 'IDLE' });
  const [guessGameError, setGuessGameError] = useState('');
  const [guessGameSecondsLeft, setGuessGameSecondsLeft] = useState(null);

  // Members
  const normalizeMemberId = (value) => {
    const raw = (value && typeof value === 'object')
      ? (value.id ?? value._id)
      : value;
    const id = String(raw ?? '').trim();
    return id || null;
  };

  const normalizeAndDedupeMembers = (list) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((m, idx) => {
      const id = normalizeMemberId(m);
      const safeId = id || `__missing_${idx}`;
      if (seen.has(safeId)) return;
      seen.add(safeId);
      out.push({
        ...m,
        id: safeId
      });
    });
    return out;
  };

  const initialMembers = normalizeAndDedupeMembers(
    room.members && room.members.length > 0
      ? room.members
      : [{
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture || ''
        }]
  );

  const [members, setMembers] = useState(initialMembers);
  const isOverlayLayout = () => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia) return window.matchMedia('(max-width: 968px)').matches;
    return window.innerWidth <= 968;
  };

  const [showMembers, setShowMembers] = useState(() => !isOverlayLayout());
  const [showChat, setShowChat] = useState(() => !isOverlayLayout());
  const [activeTab, setActiveTab] = useState('youtube');
  const [viewingProfile, setViewingProfile] = useState(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);

  useEffect(() => {
    // Ensure we leave voice if we leave/switch rooms.
    return () => {
      if (voiceJoined && String(voiceChannelId || '') === String(room?.id || '')) {
        leaveVoice();
      }
    };
  }, [voiceJoined, voiceChannelId, room?.id, leaveVoice]);

  const handleJoinVoice = async () => {
    if (!room?.id) return;
    setVoiceError('');
    try {
      if (!socket) {
        setVoiceError('Socket not initialized yet. Please refresh and try again.');
        return;
      }

      // If the socket is still connecting/reconnecting, wait briefly.
      if (!socket.connected) {
        setIsConnectingVoice(true);
        setVoiceError('Connecting to server…');
        try { socket.connect?.(); } catch { /* ignore */ }

        await new Promise((resolve, reject) => {
          let done = false;
          const t = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error('Still not connected to server.')); 
          }, 6000);

          const cleanup = () => {
            clearTimeout(t);
            try { socket.off('connect', onConnect); } catch { /* ignore */ }
          };

          const onConnect = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
          };

          try { socket.on('connect', onConnect); } catch { /* ignore */ }
        });
      }

      await joinVoice({ channelId: room.id, currentUser: user });
    } catch (e) {
      const msg = e?.message || 'Failed to join voice';
      setVoiceError(`${msg} (Socket: ${connected || socket?.connected ? 'connected' : 'disconnected'})`);
    }
    finally {
      setIsConnectingVoice(false);
    }
  };

  useEffect(() => {
    const myId = user?.id;
    if (!myId) return;
    setMembers(prev => prev.map(m => (
      String(m.id) === String(myId)
        ? { ...m, username: user.username, avatar: user.avatar, profilePicture: user.profilePicture || '' }
        : m
    )));
  }, [user?.id, user?.username, user?.avatar, user?.profilePicture]);

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [currentVideo, setCurrentVideo] = useState(room.youtube || { videoId: null, playing: false, timestamp: 0 });
  const youtubePlayerRef = useRef(null);
  const [isHost, setIsHost] = useState(false);

  // Drawing state
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawWidth, setDrawWidth] = useState(3);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Host status
  useEffect(() => {
    setIsHost(String(user.id) === String(room.host));
  }, [user.id, room.host]);

  // Socket listeners
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const handleNewMessage = (msg) => {
      setMessages(prev => [...prev, msg]);
    };

    const handleUserJoined = ({ userId, username, avatar, profilePicture }) => {
      setMembers(prev => {
        const id = normalizeMemberId(userId);
        if (!id) return prev;

        const exists = prev.some(m => String(m.id) === id);
        if (exists) {
          // Refresh fields in case they changed.
          return prev.map(m => (String(m.id) === id ? { ...m, username, avatar, profilePicture } : m));
        }
        return normalizeAndDedupeMembers([...prev, { id, username, avatar, profilePicture }]);
      });

      setMessages(prev => [
        ...prev,
        { id: Date.now(), system: true, message: `${username} joined the room` }
      ]);
    };

    const handleUserLeft = ({ userId, username }) => {
      const id = normalizeMemberId(userId);
      if (id) setMembers(prev => prev.filter(m => String(m.id) !== id));
      setMessages(prev => [
        ...prev,
        { id: Date.now(), system: true, message: `${username} left the room` }
      ]);
    };

    const handleYoutubeSync = (youtubeState) => {
      setCurrentVideo(youtubeState);
      const player = youtubePlayerRef.current;
      if (!player) return;

      if (youtubeState.playing) {
        player.playVideo();
        player.seekTo(youtubeState.timestamp, true);
      } else {
        player.pauseVideo();
        player.seekTo(youtubeState.timestamp, true);
      }
    };

    const handleDrawing = (drawData) => {
      drawOnCanvas(drawData);
    };

    const handleCanvasCleared = () => {
      clearCanvas(false);
    };

    const handleGuessGameState = (state) => {
      setGuessGame(state || { active: false, phase: 'IDLE' });
    };

    const handleGuessGameError = ({ message }) => {
      setGuessGameError(message || 'Guess game error');
      setTimeout(() => setGuessGameError(''), 3000);
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('userJoined', handleUserJoined);
    socket.on('userLeft', handleUserLeft);
    socket.on('youtubeSync', handleYoutubeSync);
    socket.on('drawing', handleDrawing);
    socket.on('canvasCleared', handleCanvasCleared);
    socket.on('guessGameState', handleGuessGameState);
    socket.on('guessGameError', handleGuessGameError);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('userJoined', handleUserJoined);
      socket.off('userLeft', handleUserLeft);
      socket.off('youtubeSync', handleYoutubeSync);
      socket.off('drawing', handleDrawing);
      socket.off('canvasCleared', handleCanvasCleared);
      socket.off('guessGameState', handleGuessGameState);
      socket.off('guessGameError', handleGuessGameError);
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Guess Game countdown
  useEffect(() => {
    if (!guessGame?.active || !guessGame?.endsAt) {
      setGuessGameSecondsLeft(null);
      return;
    }

    const tick = () => {
      const ms = Math.max(0, guessGame.endsAt - Date.now());
      setGuessGameSecondsLeft(Math.ceil(ms / 1000));
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [guessGame?.active, guessGame?.endsAt]);

  // Initialize canvas size and redraw
  useEffect(() => {
    if (activeTab !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    if (room.drawings) {
      room.drawings.forEach(drawData => drawOnCanvas(drawData));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  const buildRoomInviteLink = () => {
    const base = window.location.origin;
    const roomId = room.id || room._id;
    return `${base}?roomId=${encodeURIComponent(roomId)}`;
  };

  const copyInviteLink = async () => {
    const link = buildRoomInviteLink();
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    }
  };

  const extractVideoId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleLoadVideo = () => {
    if (!isHost) return;

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      alert('Invalid YouTube URL');
      return;
    }

    const next = { videoId, playing: true, timestamp: 0, lastUpdate: Date.now() };
    setCurrentVideo(next);
    socket.emit('youtubePlay', { videoId, timestamp: 0 });
    setYoutubeUrl('');
  };

  const onYoutubeReady = (event) => {
    youtubePlayerRef.current = event.target;
    if (!currentVideo?.videoId) return;

    const player = event.target;
    player.seekTo(currentVideo.timestamp || 0, true);
    if (currentVideo.playing) player.playVideo();
    else player.pauseVideo();
  };

  const onYoutubeStateChange = (event) => {
    if (!isHost) return;

    const player = event.target;
    const currentTime = player.getCurrentTime();

    if (event.data === 1) {
      socket.emit('youtubePlay', { videoId: currentVideo.videoId, timestamp: currentTime });
    } else if (event.data === 2) {
      socket.emit('youtubePause', { timestamp: currentTime });
    }
  };

  // Drawing
  const drawOnCanvas = (drawData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (drawData.type === 'start') {
      ctx.beginPath();
      ctx.moveTo(drawData.x, drawData.y);
      ctx.strokeStyle = drawData.color;
      ctx.lineWidth = drawData.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      return;
    }

    if (drawData.type === 'draw') {
      ctx.strokeStyle = drawData.color;
      ctx.lineWidth = drawData.width;
      ctx.lineTo(drawData.x, drawData.y);
      ctx.stroke();
    }
  };

  const startDrawing = (e) => {
    const isDrawer = guessGame?.active && guessGame?.drawerUserId === user.id;
    const canDraw = !guessGame?.active || (guessGame?.phase === 'DRAW' && isDrawer);
    if (!canDraw) return;

    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    const drawData = { type: 'start', x, y, color: drawColor, width: drawWidth };
    drawOnCanvas(drawData);
    socket.emit('draw', drawData);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const isDrawer = guessGame?.active && guessGame?.drawerUserId === user.id;
    const canDraw = !guessGame?.active || (guessGame?.phase === 'DRAW' && isDrawer);
    if (!canDraw) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    const drawData = { type: 'draw', x, y, color: drawColor, width: drawWidth };
    drawOnCanvas(drawData);
    socket.emit('draw', drawData);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = (emit = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (emit) {
      const isDrawer = guessGame?.active && guessGame?.drawerUserId === user.id;
      const canClear = !guessGame?.active || (guessGame?.phase === 'DRAW' && isDrawer);
      if (!canClear) return;
      socket.emit('clearCanvas');
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Guess Game controls
  const handleGuessGameStart = () => socket.emit('guessGameStart');
  const handleGuessGameStop = () => socket.emit('guessGameStop');
  const handleSelectTheme = (theme) => socket.emit('guessGameSelectTheme', { theme });
  const handleSelectSubject = (subject) => socket.emit('guessGameSelectSubject', { subject });

  // Profiles
  const handleViewProfile = async (member) => {
    if (user.isGuest) {
      setViewingProfile({ _id: member.id, ...member, __isGuest: true });
      return;
    }

    try {
      const base = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
      const response = await fetch(`${base}/api/users/${member.id}`);
      const profileData = await response.json();
      setViewingProfile(profileData);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleProfileUpdate = (updatedProfile) => {
    if (updatedProfile._id === user.id) Object.assign(user, updatedProfile);
    setViewingProfile(updatedProfile);
  };

  const currentDrawer = guessGame?.active && guessGame?.drawerUserId
    ? (members.find(m => m.id === guessGame.drawerUserId)?.username || guessGame.drawerUserId)
    : null;

  const currentDrawerLabel = currentDrawer
    ? (guessGame.drawerUserId === user.id ? 'You' : currentDrawer)
    : null;

  const guessGamePhaseLabel = (() => {
    if (!guessGame?.active) return 'OFF';
    switch (guessGame.phase) {
      case 'THEME_SELECT':
        return 'SELECTING THEME';
      case 'SUBJECT_SELECT':
        return 'SELECTING SUBJECT';
      case 'DRAW':
        return 'DRAW';
      case 'ANSWER':
        return 'ANSWER';
      default:
        return 'ON';
    }
  })();

  return (
    <div className="room-container-rave fade-in">
      <div className="room-header-rave">
        <div className="room-info">
          <h2><FontAwesomeIcon icon={faHouse} /> {room.name}</h2>
          <span className="member-count">
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        <div className="header-controls">
          <Notifications user={user} />
          <div
            className="user-profile"
            role="button"
            tabIndex={0}
            title="Account options"
            onClick={() => setAccountModalOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setAccountModalOpen(true);
            }}
          >
            {user.profilePicture ? (
              <img src={user.profilePicture} alt="" className="user-avatar-small" />
            ) : (
              <span className="user-avatar-small">{user.avatar}</span>
            )}
            <span className="user-name">{user.username}</span>
          </div>
          <button
            className="btn-icon"
            onClick={() => {
              setShowMembers((prev) => {
                const next = !prev;
                if (next && isOverlayLayout()) setShowChat(false);
                return next;
              });
            }}
            title={showMembers ? 'Hide members' : 'Show members'}
          >
            <FontAwesomeIcon icon={faUserGroup} />
          </button>
          <button
            className="btn-icon"
            onClick={() => {
              setShowChat((prev) => {
                const next = !prev;
                if (next && isOverlayLayout()) setShowMembers(false);
                return next;
              });
            }}
            title={showChat ? 'Hide chat' : 'Show chat'}
          >
            <FontAwesomeIcon icon={faComments} />
          </button>
          <button
            className="btn-icon"
            onClick={copyInviteLink}
            title={inviteCopied ? 'Copied!' : 'Copy room link'}
          >
            {inviteCopied ? <FontAwesomeIcon icon={faCheck} /> : <FontAwesomeIcon icon={faLink} />}
          </button>
          <button className="btn-icon" onClick={handleLeave} title="Leave room">
            <FontAwesomeIcon icon={faArrowRightFromBracket} />
          </button>
        </div>
      </div>

      <div className="room-body-rave">
        {showMembers && (
          <div className={`sidebar-left ${showMembers ? 'show' : ''}`.trim()}>
            <div className="sidebar-header">
              <div className="members-header-row">
                <h3><FontAwesomeIcon icon={faUserGroup} /> Members</h3>

                <div className="voice-controls">
                  {!voiceJoined || String(voiceChannelId || '') !== String(room?.id || '') ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleJoinVoice}
                      disabled={!socket}
                      title={!socket ? 'Socket not initialized' : (socket?.connected ? 'Join voice' : 'Connect and join voice')}
                    >
                      {isConnectingVoice ? 'Connecting…' : 'Join Voice'}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => leaveVoice()}>
                        Leave
                      </button>
                      <button
                        type="button"
                        className={`btn btn-secondary btn-sm ${voiceSelfState?.muted ? 'is-active' : ''}`}
                        onClick={toggleVoiceMute}
                        title={voiceSelfState?.muted ? 'Unmute mic' : 'Mute mic'}
                      >
                        <FontAwesomeIcon icon={voiceSelfState?.muted ? faMicrophoneSlash : faMicrophone} />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-secondary btn-sm ${voiceSelfState?.deafened ? 'is-active' : ''}`}
                        onClick={toggleVoiceDeafen}
                        title={voiceSelfState?.deafened ? 'Undeafen' : 'Deafen'}
                      >
                        <FontAwesomeIcon icon={faEarDeaf} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {voiceError ? <div className="voice-error">{voiceError}</div> : null}
            </div>
            <div className="members-list">
              {members.map(member => (
                <div
                  key={String(member.id)}
                  className="member-item"
                  onClick={() => handleViewProfile(member)}
                >
                  {member.profilePicture ? (
                    <img
                      className="member-avatar-image"
                      src={member.profilePicture}
                      alt={member.username}
                    />
                  ) : (
                    <span className="member-avatar-large">{member.avatar || '🙂'}</span>
                  )}

                  <div className="member-info">
                    <span className="member-name">{member.username}</span>
                    {String(member.id) === String(room.host) && <span className="host-badge">HOST</span>}
                  </div>

                  {voiceStatesByUserId?.[String(member.id)] ? (
                    <div className="member-voice">
                      {voiceSpeakingByUserId?.[String(member.id)] ? (
                        <span className="member-voice__speakingDot" title="Talking" />
                      ) : null}
                      {voiceStatesByUserId[String(member.id)]?.muted ? (
                        <span className="member-voice__icon" title="Muted">
                          <FontAwesomeIcon icon={faMicrophoneSlash} />
                        </span>
                      ) : (
                        <span className="member-voice__icon member-voice__icon--on" title="Speaking enabled">
                          <FontAwesomeIcon icon={faMicrophone} />
                        </span>
                      )}
                      {voiceStatesByUserId[String(member.id)]?.deafened ? (
                        <span className="member-voice__icon" title="Deafened">
                          <FontAwesomeIcon icon={faEarDeaf} />
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="content-center">
          <div className="content-tabs">
            <button
              className={`content-tab ${activeTab === 'youtube' ? 'active' : ''}`}
              onClick={() => setActiveTab('youtube')}
            >
              <FontAwesomeIcon icon={faMusic} /> Watch
            </button>
            <button
              className={`content-tab ${activeTab === 'draw' ? 'active' : ''}`}
              onClick={() => setActiveTab('draw')}
            >
              <FontAwesomeIcon icon={faPalette} /> Draw
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
                    title={!isHost ? 'Only the host can load videos' : 'Load video'}
                  >
                    Load Video
                  </button>
                </div>

                {!isHost && <p className="host-notice">Only the host can control playback</p>}

                {currentVideo?.videoId ? (
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
                    <div className="empty-icon" aria-hidden="true"><FontAwesomeIcon icon={faMusic} /></div>
                    <h3>No video playing</h3>
                    <p>Paste a YouTube URL above to start watching together!</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'draw' && (
              <div className="draw-container-rave">
                <div className="guessgame-panel">
                  <div className="guessgame-row">
                    <div className="guessgame-status">
                      <strong>Guess Game:</strong>{' '}
                      <span>{guessGamePhaseLabel}</span>
                      {guessGame?.active && currentDrawerLabel && (
                        <span className="guessgame-drawer">✏️ Drawer: {currentDrawerLabel}</span>
                      )}
                      {guessGameSecondsLeft != null && (
                        <span className="guessgame-timer">⏱️ {guessGameSecondsLeft}s</span>
                      )}
                    </div>

                    <div className="guessgame-actions">
                      {isHost && !guessGame?.active && (
                        <button className="btn btn-primary" onClick={handleGuessGameStart}>
                          Start
                        </button>
                      )}
                      {isHost && guessGame?.active && (
                        <button className="btn btn-danger" onClick={handleGuessGameStop}>
                          Stop
                        </button>
                      )}
                    </div>
                  </div>

                  {guessGameError && <div className="guessgame-error">{guessGameError}</div>}

                  {guessGame?.active && (
                    <div className="guessgame-row guessgame-word">
                      {guessGame?.drawerUserId === user.id ? (
                        <span>
                          <strong>Your word:</strong> {guessGame.subject || '…'}
                        </span>
                      ) : (
                        <span>
                          <strong>Guess:</strong> {guessGame.subjectMasked || '…'}
                        </span>
                      )}
                    </div>
                  )}

                  {guessGame?.active && guessGame?.phase === 'THEME_SELECT' && guessGame?.drawerUserId === user.id && (
                    <div className="guessgame-row">
                      <div className="guessgame-label">Pick a theme:</div>
                      <div className="guessgame-buttons">
                        {(guessGame.themeOptions || []).map(t => (
                          <button key={t} className="guessgame-chip" onClick={() => handleSelectTheme(t)}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {guessGame?.active && guessGame?.phase === 'SUBJECT_SELECT' && guessGame?.drawerUserId === user.id && (
                    <div className="guessgame-row">
                      <div className="guessgame-label">Pick a subject:</div>
                      <div className="guessgame-buttons">
                        {(guessGame.subjectOptions || []).map(s => (
                          <button key={s} className="guessgame-chip" onClick={() => handleSelectSubject(s)}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {guessGame?.active && (
                    <div className="guessgame-row guessgame-scores">
                      <div className="guessgame-label">Scores:</div>
                      <div className="guessgame-scorelist">
                        {members
                          .map(m => ({ ...m, score: (guessGame.scores || {})[m.id] || 0 }))
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 6)
                          .map(m => (
                            <span key={m.id} className="guessgame-score">
                              {m.username}: {m.score}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="draw-controls">
                  <div className="color-picker">
                    <label>Color:</label>
                    <input
                      type="color"
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                      disabled={guessGame?.active && !(guessGame?.phase === 'DRAW' && guessGame?.drawerUserId === user.id)}
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
                      disabled={guessGame?.active && !(guessGame?.phase === 'DRAW' && guessGame?.drawerUserId === user.id)}
                    />
                    <span>{drawWidth}px</span>
                  </div>
                  <button
                    className="btn btn-danger"
                    onClick={() => clearCanvas(true)}
                    disabled={guessGame?.active && !(guessGame?.phase === 'DRAW' && guessGame?.drawerUserId === user.id)}
                  >
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

        {showChat && (
          <div className={`sidebar-right ${showChat ? 'show' : ''}`.trim()}>
            <div className="sidebar-header">
              <h3><FontAwesomeIcon icon={faComments} /> Chat</h3>
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
                        <span className="message-time">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
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
              <button type="submit" className="btn-send" aria-label="Send message">
                <FontAwesomeIcon icon={faPaperPlane} />
              </button>
            </form>
          </div>
        )}
      </div>

      <AccountOptionsModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        currentUser={user}
        onUserUpdated={(nextUser) => {
          onUserUpdated?.(nextUser);
          setAccountModalOpen(false);
        }}
      />

      {viewingProfile && (
        <Profile
          user={viewingProfile}
          currentUser={user}
          onClose={() => setViewingProfile(null)}
          onUpdate={handleProfileUpdate}
          isOwnProfile={viewingProfile._id === user.id || viewingProfile._id === user._id || viewingProfile.id === user.id}
          onViewTimeline={onViewTimeline}
        />
      )}
    </div>
  );
}

export default Room;
