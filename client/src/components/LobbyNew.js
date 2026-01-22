import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faComments,
  faFire,
  faChevronLeft,
  faImage,
  faLayerGroup,
  faLink,
  faNewspaper,
  faPaperPlane,
  faPlus,
  faRightToBracket,
  faArrowUp,
  faXmark,
  faUserGroup
} from '@fortawesome/free-solid-svg-icons';
import Notifications from './Notifications';
import Profile from './Profile';
import AccountOptionsModal from './AccountOptionsModal';
import './LobbyNew.css';

function LobbyNew({ user, inviteRoomId, onJoinRoom, onLogout, onViewTimeline, onUserUpdated }) {
  const { socket, registerUser } = useSocket();
  const apiBase = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
  const [activeTab, setActiveTab] = useState('friends'); // friends, rooms, dms, feed
  const [rooms, setRooms] = useState([]);
  const [friends, setFriends] = useState([]);
  const [onlineFriends, setOnlineFriends] = useState(new Set());
  const [friendRooms, setFriendRooms] = useState({}); // friendId => { roomId, roomName }
  const [friendSearch, setFriendSearch] = useState('');
  const [friendRequests, setFriendRequests] = useState([]); // { fromId, fromUsername, fromAvatar, fromProfilePicture, timestamp }
  const [friendRequestsOpen, setFriendRequestsOpen] = useState(false);
  const [friendRequestsSearch, setFriendRequestsSearch] = useState('');
  const [directMessagesByUserId, setDirectMessagesByUserId] = useState({});
  const [selectedDM, setSelectedDM] = useState(null);
  const [dmMessage, setDmMessage] = useState('');
  const [dmImageFile, setDmImageFile] = useState(null);
  const [dmImagePreviewUrl, setDmImagePreviewUrl] = useState('');

  const [isDmNarrow, setIsDmNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.matchMedia('(max-width: 560px)').matches;
    } catch {
      return window.innerWidth <= 560;
    }
  });
  // On narrow screens we show either the list OR the chat.
  const [dmMobilePanel, setDmMobilePanel] = useState(() => (selectedDM ? 'chat' : 'list'));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(max-width: 560px)');

    const onChange = (e) => setIsDmNarrow(!!e.matches);
    try {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    } catch {
      // Safari fallback
      media.addListener(onChange);
      return () => media.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    if (!isDmNarrow) return;
    setDmMobilePanel(selectedDM ? 'chat' : 'list');
  }, [isDmNarrow, selectedDM]);
  const [newsFeed, setNewsFeed] = useState([]);
  const [feedVisibleCount, setFeedVisibleCount] = useState(25);
  const [newPost, setNewPost] = useState('');
  const [feedImageFile, setFeedImageFile] = useState(null);
  const [feedImagePreviewUrl, setFeedImagePreviewUrl] = useState('');
  const [expandedPostIds, setExpandedPostIds] = useState(() => new Set());
  const [commentDrafts, setCommentDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({}); // key: commentId => text
  const [replyingTo, setReplyingTo] = useState(null); // { postId, commentId, userId, username }
  const [lightbox, setLightbox] = useState(null); // { src, alt }
  const [viewingProfile, setViewingProfile] = useState(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const pendingJoinRoomIdRef = useRef(null);
  const joinRetryTimerRef = useRef(null);
  const joinAttemptsRef = useRef(0);
  const friendsSyncTimerRef = useRef(null);
  const selectedDMIdRef = useRef(null);
  const postTextareaRef = useRef(null);
  const lobbyBodyRef = useRef(null);
  const commentInputRefs = useRef({}); // postId => input
  const replyInputRefs = useRef({}); // commentId => input
  const [showFeedBackToTop, setShowFeedBackToTop] = useState(false);
  const [mentionPicker, setMentionPicker] = useState({
    open: false,
    field: null, // 'post' | 'comment' | 'reply'
    postId: null,
    commentId: null,
    startIndex: 0,
    caret: 0,
    query: '',
    index: 0
  });

  useEffect(() => {
    selectedDMIdRef.current = selectedDM?.id || null;
  }, [selectedDM?.id]);

  const myUserId = user?.id || user?._id || user?.token;

  useEffect(() => {
    // Reset feed paging when switching into feed tab.
    if (activeTab === 'feed') setFeedVisibleCount(25);
    setShowFeedBackToTop(false);
  }, [activeTab]);

  const filteredFriends = (() => {
    const q = String(friendSearch || '').trim().toLowerCase();
    if (!q) return friends;
    return (Array.isArray(friends) ? friends : []).filter(f => String(f?.username || '').toLowerCase().includes(q));
  })();

  const filteredFriendRequests = (() => {
    const q = String(friendRequestsSearch || '').trim().toLowerCase();
    if (!q) return friendRequests;
    return (Array.isArray(friendRequests) ? friendRequests : []).filter(r => String(r?.fromUsername || '').toLowerCase().includes(q));
  })();

  const handleAcceptFriendRequest = (req) => {
    if (!socket || !req?.fromId) return;
    socket.emit('acceptFriendRequest', { fromUserId: req.fromId });
    setFriendRequests(prev => prev.filter(r => r.fromId !== req.fromId));
  };

  const handleDeclineFriendRequest = (req) => {
    if (!req?.fromId) return;
    if (socket) {
      socket.emit('rejectFriendRequest', { fromUserId: req.fromId }, () => {
        // ignore ack
      });
    }
    setFriendRequests(prev => prev.filter(r => r.fromId !== req.fromId));
  };

  const handleLobbyBodyScroll = (e) => {
    if (activeTab !== 'feed') return;
    const top = e?.currentTarget?.scrollTop || 0;
    setShowFeedBackToTop(top > 320);
  };

  const scrollFeedToTop = () => {
    try {
      lobbyBodyRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch {
      if (lobbyBodyRef.current) lobbyBodyRef.current.scrollTop = 0;
    }
    setTimeout(() => {
      try { postTextareaRef.current?.focus?.(); } catch { /* ignore */ }
    }, 150);
  };

  const openProfileByUserId = async (userId) => {
    const id = String(userId || '').trim();
    if (!id) return;
    try {
      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data?.error) {
        alert(data?.error || 'Failed to load profile');
        return;
      }
      setViewingProfile(data);
    } catch {
      alert('Failed to load profile');
    }
  };

  const findActiveMention = (value, caret) => {
    const text = String(value || '');
    const pos = Math.max(0, Math.min(Number(caret) || 0, text.length));

    // Find the start of the current token (scan left until whitespace)
    let i = pos - 1;
    while (i >= 0 && !/\s/.test(text[i])) i -= 1;
    const tokenStart = i + 1;
    if (text[tokenStart] !== '@') return null;
    // Must be start or preceded by whitespace
    if (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) return null;

    const query = text.slice(tokenStart + 1, pos);
    if (!/^[A-Za-z0-9_]{0,30}$/.test(query)) return null;
    return { startIndex: tokenStart, query, caret: pos };
  };

  const getMentionSuggestions = (query) => {
    const q = String(query || '').toLowerCase();
    const list = Array.isArray(friends) ? friends : [];
    const filtered = q
      ? list.filter(f => String(f?.username || '').toLowerCase().includes(q))
      : list;
    return filtered.slice(0, 8);
  };

  const openMentionPickerForField = ({ field, postId = null, commentId = null, value, caret }) => {
    const active = findActiveMention(value, caret);
    if (!active) {
      setMentionPicker(prev => (prev.open && prev.field === field ? { ...prev, open: false } : prev));
      return;
    }
    setMentionPicker(prev => ({
      ...prev,
      open: true,
      field,
      postId,
      commentId,
      startIndex: active.startIndex,
      caret: active.caret,
      query: active.query,
      index: 0
    }));
  };

  const applyMentionSelection = ({ username, setValue, getInput }) => {
    const u = String(username || '').trim();
    if (!u) return;
    setValue(prevValue => {
      const text = String(prevValue || '');
      const start = mentionPicker.startIndex;
      const caret = mentionPicker.caret;
      const next = `${text.slice(0, start)}@${u} ${text.slice(caret)}`;
      // Put caret after inserted mention
      setTimeout(() => {
        const input = getInput?.();
        if (!input) return;
        const nextCaret = start + u.length + 2;
        try {
          input.focus();
          input.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // ignore
        }
      }, 0);
      return next;
    });
    setMentionPicker(prev => ({ ...prev, open: false }));
  };

  const MentionPicker = ({ suggestions, onSelect, onClose }) => {
    if (!suggestions || suggestions.length === 0) {
      return (
        <div className="mention-picker" onMouseDown={(e) => e.preventDefault()}>
          <div className="mention-empty">No matches</div>
          <button type="button" className="mention-close" onClick={onClose}>×</button>
        </div>
      );
    }
    return (
      <div className="mention-picker" onMouseDown={(e) => e.preventDefault()}>
        <div className="mention-header">
          <span>Mention</span>
          <button type="button" className="mention-close" onClick={onClose} aria-label="Close mention picker">×</button>
        </div>
        <div className="mention-list" role="listbox">
          {suggestions.map((f, idx) => (
            <button
              key={f.id}
              type="button"
              className={`mention-item ${idx === mentionPicker.index ? 'active' : ''}`}
              onClick={() => onSelect(f)}
              role="option"
              aria-selected={idx === mentionPicker.index}
            >
              {f.profilePicture ? (
                <img src={f.profilePicture} alt="" className="mention-avatar" />
              ) : (
                <span className="mention-avatar">{f.avatar || '👤'}</span>
              )}
              <span className="mention-name">{f.username}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!feedImageFile) {
      setFeedImagePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(feedImageFile);
    setFeedImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [feedImageFile]);

  useEffect(() => {
    if (!dmImageFile) {
      setDmImagePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(dmImageFile);
    setDmImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [dmImageFile]);

  const uploadImageFile = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${apiBase}/api/uploads`, {
      method: 'POST',
      body: form
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Upload failed');
    }
    return {
      fileId: data.fileId,
      url: data.url,
      contentType: data.contentType,
      name: data.name
    };
  };

  const mergeDMThread = (existing = [], incoming = []) => {
    const byKey = new Map();
    const keyFor = (m) => m?.id || `${m?.fromId}|${m?.toUserId}|${m?.timestamp}|${m?.message}`;
    for (const m of existing) byKey.set(keyFor(m), m);
    for (const m of incoming) byKey.set(keyFor(m), m);
    return Array.from(byKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  };

  const buildRoomInviteLink = (roomId) => {
    const base = window.location.origin;
    return `${base}?roomId=${encodeURIComponent(roomId)}`;
  };

  const clearRoomIdFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('roomId');
      window.history.replaceState({}, document.title, url.toString());
    } catch {
      // ignore
    }

    try {
      localStorage.removeItem('hangout_pending_room');
    } catch {
      // ignore
    }
  };

  const stopJoinRetries = () => {
    if (joinRetryTimerRef.current) {
      clearTimeout(joinRetryTimerRef.current);
      joinRetryTimerRef.current = null;
    }
    pendingJoinRoomIdRef.current = null;
    joinAttemptsRef.current = 0;
  };

  const copyRoomInviteLink = async (roomId) => {
    const link = buildRoomInviteLink(roomId);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  useEffect(() => {
    // Fetch rooms
    fetch(apiBase + '/api/rooms')
      .then(res => res.json())
      .then(data => setRooms(data))
      .catch(err => console.error('Error fetching rooms:', err));

    if (socket) {
      // Ensure we are registered, then immediately pull a fresh friends list.
      // This avoids needing a manual refresh when getOnlineFriends fires before registration.
      registerUser?.(user);

      socket.on('roomList', (updatedRooms) => setRooms(updatedRooms));
      socket.on('roomCreated', ({ roomId, room }) => {
        clearRoomIdFromUrl();
        stopJoinRetries();
        onJoinRoom(room);
      });
      socket.on('joinedRoom', ({ room }) => {
        clearRoomIdFromUrl();
        stopJoinRetries();
        onJoinRoom(room);
      });
      socket.on('registered', () => {
        socket.emit('getOnlineFriends');
        socket.emit('getNewsFeed');
      });

      socket.on('connect', () => {
        registerUser?.(user);
        socket.emit('getOnlineFriends');
        socket.emit('getNewsFeed');
      });
      socket.on('error', ({ message }) => {
        // If we are auto-joining from a link and the room doesn't exist, stop retrying.
        if (pendingJoinRoomIdRef.current && String(message || '').toLowerCase().includes('room not found')) {
          stopJoinRetries();
          alert('That room link is invalid or the room no longer exists.');
        }

        // If join attempts race registration, keep trying after re-registering.
        if (pendingJoinRoomIdRef.current && String(message || '').toLowerCase().includes('not registered')) {
          registerUser?.(user);
        }
      });
      socket.on('friendsList', (friendsList) => {
        const list = Array.isArray(friendsList) ? friendsList : [];
        setFriends(list);
        setOnlineFriends(new Set(list.filter(f => f?.online).map(f => f.id)));
        const nextFriendRooms = {};
        for (const f of list) {
          if (f?.roomId) nextFriendRooms[f.id] = { roomId: f.roomId, roomName: f.roomName || 'Room' };
        }
        setFriendRooms(nextFriendRooms);
      });

      socket.on('friendRequest', ({ fromId, fromUsername, fromAvatar, fromProfilePicture }) => {
        if (!fromId) return;
        const newReq = {
          fromId,
          fromUsername,
          fromAvatar,
          fromProfilePicture,
          timestamp: Date.now()
        };
        setFriendRequests(prev => {
          if (prev.some(r => r.fromId === fromId)) return prev;
          return [...prev, newReq];
        });
      });

      socket.on('friendAdded', (friend) => {
        // Dedupe + keep latest friend data
        setFriends(prev => {
          const next = prev.filter(f => f.id !== friend.id);
          return [...next, friend];
        });

        // Remove pending request from that user (if any)
        if (friend?.id) {
          setFriendRequests(prev => prev.filter(r => r.fromId !== friend.id));
        }

        // Refresh list from server (includes offline/online + roomName)
        socket.emit('getOnlineFriends');
      });
      socket.on('friendOnline', ({ friendId }) => {
        if (!friendId) return;
        setOnlineFriends(prev => new Set([...prev, friendId]));
        setFriends(prev => prev.map(f => (f.id === friendId ? { ...f, online: true } : f)));
      });
      socket.on('friendOffline', ({ friendId }) => {
        if (!friendId) return;
        setOnlineFriends(prev => {
          const next = new Set(prev);
          next.delete(friendId);
          return next;
        });
        setFriends(prev => prev.map(f => (f.id === friendId ? { ...f, online: false, inRoom: false, roomId: null, roomName: null } : f)));
        setFriendRooms(prev => {
          const next = { ...prev };
          delete next[friendId];
          return next;
        });
      });
      socket.on('friendRoomUpdate', ({ friendId, roomId, roomName }) => {
        if (!friendId) return;
        setFriends(prev => prev.map(f => (
          f.id === friendId
            ? { ...f, inRoom: !!roomId, roomId: roomId || null, roomName: roomName || null }
            : f
        )));
        setFriendRooms(prev => {
          const next = { ...prev };
          if (roomId) next[friendId] = { roomId, roomName: roomName || 'Room' };
          else delete next[friendId];
          return next;
        });
      });
      socket.on('directMessage', ({ id, from, fromId, message, image, timestamp }) => {
        if (!fromId) return;
        setDirectMessagesByUserId(prev => {
          const existing = prev[fromId] || [];
          const nextMsg = {
            id,
            from,
            fromId,
            message,
            image: image || null,
            timestamp,
            direction: 'received'
          };
          return { ...prev, [fromId]: mergeDMThread(existing, [nextMsg]) };
        });
      });
      socket.on('directMessageSent', ({ id, from, fromId, toUserId, message, image, timestamp }) => {
        if (!toUserId) return;
        const threadId = String(toUserId);
        setDirectMessagesByUserId(prev => {
          const existing = prev[threadId] || [];
          const nextMsg = {
            id,
            from,
            fromId,
            toUserId,
            message,
            image: image || null,
            timestamp,
            direction: 'sent'
          };
          return { ...prev, [threadId]: mergeDMThread(existing, [nextMsg]) };
        });
      });
      socket.on('directMessageError', ({ message }) => {
        alert(message || 'Message failed');
      });
      socket.on('friendRemoved', ({ friendId }) => {
        setFriends(prev => prev.filter(f => f.id !== friendId));
        setOnlineFriends(prev => {
          const next = new Set(prev);
          next.delete(friendId);
          return next;
        });
        setFriendRooms(prev => {
          const next = { ...prev };
          delete next[friendId];
          return next;
        });
        setDirectMessagesByUserId(prev => {
          const next = { ...prev };
          delete next[friendId];
          return next;
        });
        if (selectedDMIdRef.current === friendId) setSelectedDM(null);
      });
      socket.on('newsFeedPost', (post) => {
        setNewsFeed(prev => {
          const existingIndex = prev.findIndex(p => p.id === post?.id);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...post };
            return next;
          }
          return [post, ...prev];
        });
      });
      socket.on('newsFeedUpdate', (posts) => setNewsFeed(posts));
      socket.on('feedPostUpdated', (post) => {
        if (!post?.id) return;
        setNewsFeed(prev => prev.map(p => (p.id === post.id ? { ...p, ...post } : p)));
      });

      socket.emit('getOnlineFriends');
      socket.emit('getNewsFeed');

      // Periodic sync to keep presence/room indicators correct even if events are missed.
      if (!friendsSyncTimerRef.current) {
        friendsSyncTimerRef.current = setInterval(() => {
          socket.emit('getOnlineFriends');
        }, 15000);
      }

      // Auto-join from invite link (?roomId=...) or prop (covers already-logged-in users reliably)
      const params = new URLSearchParams(window.location.search);
      const roomIdFromUrl = params.get('roomId');
      const pendingFromStorage = (() => {
        try {
          return localStorage.getItem('hangout_pending_room');
        } catch {
          return null;
        }
      })();

      const roomIdToJoin = inviteRoomId || roomIdFromUrl || pendingFromStorage;
      const alreadyTryingSameRoom =
        pendingJoinRoomIdRef.current === roomIdToJoin && joinAttemptsRef.current > 0;

      if (roomIdToJoin && !alreadyTryingSameRoom) {

        // Persist so login->lobby transitions keep the invite
        if (roomIdFromUrl) {
          try {
            localStorage.setItem('hangout_pending_room', roomIdFromUrl);
          } catch {
            // ignore
          }
        }

        setActiveTab('rooms');
        pendingJoinRoomIdRef.current = roomIdToJoin;
        joinAttemptsRef.current = 0;

        const attemptJoin = () => {
          const pending = pendingJoinRoomIdRef.current;
          if (!pending) return;

          if (!socket || !socket.connected) {
            joinRetryTimerRef.current = setTimeout(attemptJoin, 250);
            return;
          }

          // Re-register each attempt to avoid race conditions (harmless if already registered)
          registerUser?.(user);

          joinAttemptsRef.current += 1;
          socket.emit('joinRoom', { roomId: pending });

          if (joinAttemptsRef.current < 20) {
            joinRetryTimerRef.current = setTimeout(attemptJoin, 300);
          } else {
            // Give up quietly; user can still join manually from the rooms list.
            stopJoinRetries();
          }
        };

        attemptJoin();
      }
    }

    return () => {
      // If the effect re-runs (e.g., inviteRoomId state updates), ensure we don't
      // accidentally cancel the join loop and then block a restart.
      stopJoinRetries();
      if (socket) {
        socket.off('roomList');
        socket.off('roomCreated');
        socket.off('joinedRoom');
        socket.off('registered');
        socket.off('connect');
        socket.off('error');
        socket.off('friendsList');
        socket.off('friendRequest');
        socket.off('friendAdded');
        socket.off('friendOnline');
        socket.off('friendOffline');
        socket.off('friendRoomUpdate');
        socket.off('directMessage');
        socket.off('directMessageError');
        socket.off('friendRemoved');
        socket.off('newsFeedPost');
        socket.off('newsFeedUpdate');
      }

      if (friendsSyncTimerRef.current) {
        clearInterval(friendsSyncTimerRef.current);
        friendsSyncTimerRef.current = null;
      }

    };
  }, [socket, registerUser, onJoinRoom, user, inviteRoomId, apiBase]);

  useEffect(() => {
    if (!socket || !selectedDM?.id) return;
    if (!myUserId) return;

    const requestedUserId = selectedDM.id;
    const requestedUsername = selectedDM.username;

    socket.emit('getDirectMessages', { withUserId: requestedUserId, limit: 200 }, (res) => {
      if (selectedDMIdRef.current !== requestedUserId) return;
      if (!res?.ok || !Array.isArray(res.messages)) return;

      const incoming = res.messages.map(m => {
        const direction = m.fromUserId === myUserId ? 'sent' : 'received';
        return {
          id: m.id,
          fromId: m.fromUserId,
          toUserId: m.toUserId,
          from: direction === 'sent' ? user.username : requestedUsername,
          to: direction === 'sent' ? requestedUsername : user.username,
          message: m.message,
          image: m.image || null,
          timestamp: m.timestamp,
          direction
        };
      });

      setDirectMessagesByUserId(prev => {
        const existing = prev[requestedUserId] || [];
        return { ...prev, [requestedUserId]: mergeDMThread(existing, incoming) };
      });
    });
  }, [socket, selectedDM?.id, selectedDM?.username, myUserId, user.username]);

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!roomName.trim() || !socket) return;
    socket.emit('createRoom', { name: roomName.trim(), isPrivate });
    setShowCreateModal(false);
    setRoomName('');
    setIsPrivate(false);
  };

  const handleJoinRoom = (roomId) => {
    if (!socket) return;
    socket.emit('joinRoom', { roomId }, (res) => {
      if (res?.ok === false) {
        alert(res.message || 'Join failed');
      }
    });
  };

  const handleSendDM = async (e) => {
    e.preventDefault();
    if (!selectedDM || !socket) return;

    const trimmed = dmMessage.trim();
    const hasImage = !!dmImageFile;
    if (!trimmed && !hasImage) return;

    let uploadedImage = null;
    if (dmImageFile) {
      try {
        uploadedImage = await uploadImageFile(dmImageFile);
      } catch (err) {
        alert(err?.message || 'Image upload failed');
        return;
      }
    }
    
    socket.emit('sendDirectMessage', { 
      toUserId: selectedDM.id, 
      message: trimmed,
      image: uploadedImage
    });
    
    setDmMessage('');
    setDmImageFile(null);
  };

  const handlePostToFeed = async (e) => {
    e.preventDefault();

    if (!socket) return;

    const trimmed = newPost.trim();
    const hasImage = !!feedImageFile;
    if (!trimmed && !hasImage) return;

    let uploadedImage = null;
    if (feedImageFile) {
      try {
        uploadedImage = await uploadImageFile(feedImageFile);
      } catch (err) {
        alert(err?.message || 'Image upload failed');
        return;
      }
    }
    
    socket.emit('postToNewsFeed', { content: trimmed, images: uploadedImage ? [uploadedImage] : [] });
    setNewPost('');
    setFeedImageFile(null);
  };

  const togglePostExpanded = (postId) => {
    setExpandedPostIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const handleReactFire = (postId) => {
    if (!socket) return;
    socket.emit('toggleFeedReaction', { postId, type: 'fire' });
  };

  const handleAddComment = (postId, e) => {
    e.preventDefault();
    if (!socket) return;
    const text = String(commentDrafts[postId] || '').trim();
    if (!text) return;

    socket.emit('addFeedComment', { postId, text }, (res) => {
      if (res?.ok === false) alert(res.message || 'Comment failed');
    });

    setCommentDrafts(prev => ({ ...prev, [postId]: '' }));
    setExpandedPostIds(prev => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  const handleReplyToComment = (postId, parentComment) => {
    const commentId = String(parentComment?._id || parentComment?.id || '').trim();
    if (!commentId) return;
    setReplyingTo({
      postId,
      commentId,
      userId: String(parentComment?.userId || ''),
      username: String(parentComment?.username || '')
    });
    setExpandedPostIds(prev => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  const handleSendReply = (postId, e) => {
    e.preventDefault();
    if (!socket || !replyingTo) return;
    if (String(replyingTo.postId) !== String(postId)) return;

    const draft = String(replyDrafts[replyingTo.commentId] || '').trim();
    if (!draft) return;

    socket.emit('replyToFeedComment', {
      postId,
      parentCommentId: replyingTo.commentId,
      text: draft
    }, (res) => {
      if (res?.ok === false) alert(res.message || 'Reply failed');
    });

    setReplyDrafts(prev => ({ ...prev, [replyingTo.commentId]: '' }));
    setReplyingTo(null);
  };

  const renderCommentText = (text) => {
    const raw = String(text || '');
    const parts = raw.split(/(\s+)/);
    return parts.map((p, idx) => {
      const m = /^@([A-Za-z0-9_]{2,30})\b/.exec(p);
      if (!m) return <React.Fragment key={idx}>{p}</React.Fragment>;
      return (
        <span key={idx} className="mention">{p}</span>
      );
    });
  };

  const ImageLightbox = ({ src, alt, onClose }) => {
    const [zoom, setZoom] = useState(1);
    const clamp = (n) => Math.max(1, Math.min(n, 4));

    useEffect(() => {
      const onKey = (ev) => {
        if (ev.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
      <div className="image-lightbox" role="dialog" aria-modal="true" onMouseDown={onClose}>
        <div className="image-lightbox__panel" onMouseDown={(e) => e.stopPropagation()}>
          <div className="image-lightbox__toolbar">
            <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <div className="image-lightbox__zoom">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setZoom(z => clamp(z - 0.25))}>-</button>
              <span className="image-lightbox__zoom-label">{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setZoom(z => clamp(z + 0.25))}>+</button>
            </div>
          </div>
          <div className="image-lightbox__stage">
            <img
              src={src}
              alt={alt || ''}
              style={{ transform: `scale(${zoom})` }}
              className="image-lightbox__img"
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.15 : 0.15;
                setZoom(z => clamp(z + delta));
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderFriendsTab = () => (
    <div className="tab-content">
      <div className="section-header">
        <h3>
          <FontAwesomeIcon icon={faUserGroup} /> Friends
          <span className="count-badge count-badge--inline" title="Total friends">
            {friends.length}
          </span>
        </h3>
        <div className="friends-header-right">
          <div className="requests-button-wrap">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFriendRequestsOpen(true)}>
              Requests
            </button>
            {friendRequests.length > 0 ? (
              <span className="count-badge count-badge--floating" aria-label={`${friendRequests.length} friend requests`}>
                {friendRequests.length}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="friends-toolbar">
        <input
          type="text"
          className="friends-search"
          placeholder="Search friends…"
          value={friendSearch}
          onChange={(e) => setFriendSearch(e.target.value)}
        />
      </div>

      {friendRequestsOpen ? (
        <div className="modal-overlay" onClick={() => setFriendRequestsOpen(false)}>
          <div className="modal-content card friend-requests-modal" onClick={(e) => e.stopPropagation()}>
            <div className="friend-requests-modal__header">
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <FontAwesomeIcon icon={faUserGroup} /> Friend Requests
              </h2>
              <button type="button" className="btn-close" onClick={() => setFriendRequestsOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <input
              type="text"
              className="friends-search"
              placeholder="Search requests…"
              value={friendRequestsSearch}
              onChange={(e) => setFriendRequestsSearch(e.target.value)}
              style={{ marginTop: 12 }}
            />

            <div className="friend-requests-list">
              {filteredFriendRequests.length === 0 ? (
                <div className="empty-state" style={{ padding: 22 }}>
                  <p style={{ margin: 0 }}>No friend requests</p>
                </div>
              ) : (
                filteredFriendRequests.map((req) => (
                  <div key={req.fromId} className="friend-request-item">
                    <div className="friend-request-left">
                      {req.fromProfilePicture ? (
                        <img src={req.fromProfilePicture} alt="" className="friend-request-avatar" />
                      ) : (
                        <span className="friend-request-avatar">{req.fromAvatar || '👤'}</span>
                      )}
                      <div className="friend-request-meta">
                        <div className="friend-request-name">{req.fromUsername}</div>
                        <div className="friend-request-sub">wants to be your friend</div>
                      </div>
                    </div>
                    <div className="friend-request-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAcceptFriendRequest(req)}>
                        Accept
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDeclineFriendRequest(req)}>
                        Decline
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      
      <div className="friends-list">
        {filteredFriends.length === 0 ? (
          <div className="empty-state">
            <p>{friends.length === 0 ? 'No friends yet. Add friends from rooms!' : 'No matches. Try another search.'}</p>
          </div>
        ) : (
          filteredFriends.map(friend => (
            <div key={friend.id} className="friend-item">
              <div className="friend-avatar-container">
                {friend.profilePicture ? (
                  <img
                    src={friend.profilePicture}
                    alt=""
                    className="friend-avatar friend-avatar--clickable"
                    onClick={() => openProfileByUserId(friend.id)}
                  />
                ) : (
                  <span className="friend-avatar friend-avatar--clickable" onClick={() => openProfileByUserId(friend.id)}>{friend.avatar}</span>
                )}
                <span className={`status-indicator ${onlineFriends.has(friend.id) ? 'online' : 'offline'}`}></span>
              </div>
              <div className="friend-info">
                <button type="button" className="friend-name friend-name--link" onClick={() => openProfileByUserId(friend.id)}>
                  {friend.username}
                </button>
                {(friend.inRoom || friend.roomId || friendRooms[friend.id]?.roomId) && (
                  <div className="friend-status">In: {friend.roomName || friendRooms[friend.id]?.roomName || 'Room'}</div>
                )}
              </div>
              <div className="friend-actions">
                <button 
                  className="btn-icon btn-icon--dm" 
                  title="Send Message"
                  aria-label={`Send message to ${friend.username}`}
                  onClick={() => {
                    setSelectedDM(friend);
                    setActiveTab('dms');
                  }}
                >
                  <FontAwesomeIcon icon={faPaperPlane} />
                </button>
                {(friend.inRoom || friend.roomId || friendRooms[friend.id]?.roomId) && (
                  <button
                    className="btn-icon btn-icon--join"
                    title="Join their room"
                    aria-label={`Join ${friend.username}'s room`}
                    type="button"
                    onClick={() => {
                      const rid = friend.roomId || friendRooms[friend.id]?.roomId;
                      console.log('[friends] join click', { friendId: friend.id, rid, connected: !!socket?.connected });
                      if (rid) return handleJoinRoom(rid);
                      socket?.emit('joinFriendRoom', { friendId: friend.id }, (res) => {
                        console.log('[friends] joinFriendRoom ack', res);
                        if (res?.ok === false) alert(res.message || 'Join failed');
                      });
                    }}
                  >
                    <FontAwesomeIcon icon={faRightToBracket} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderRoomsTab = () => (
    <div className="tab-content">
      <div className="section-header">
        <h3><FontAwesomeIcon icon={faLayerGroup} /> Rooms</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
          <FontAwesomeIcon icon={faPlus} /> Create Room
        </button>
      </div>
      
      <div className="rooms-grid">
        {rooms.map(room => (
          <div key={room.id} className="room-card">
            <div className="room-header">
              <h4>{room.name}</h4>
              <span className="member-count">{room.memberCount}</span>
            </div>
            <div className="room-host">Host: {room.host}</div>
            <div className="room-card__actions">
              <button className="btn btn-primary btn-sm" onClick={() => handleJoinRoom(room.id)}>
                <FontAwesomeIcon icon={faRightToBracket} /> Join
              </button>
              <button className="btn-icon" title="Copy room link" onClick={() => copyRoomInviteLink(room.id)}>
                <FontAwesomeIcon icon={faLink} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDMsTab = () => (
    <div
      className={[
        'tab-content',
        'dm-container',
        isDmNarrow ? 'dm-container--narrow' : '',
        isDmNarrow ? (dmMobilePanel === 'chat' ? 'dm-container--chat' : 'dm-container--list') : ''
      ].filter(Boolean).join(' ')}
    >
      <div className="dm-sidebar">
        <h3>Direct Messages</h3>
        {friends.map(friend => (
          <div 
            key={friend.id} 
            className={`dm-friend-item ${selectedDM?.id === friend.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedDM(friend);
              if (isDmNarrow) setDmMobilePanel('chat');
            }}
          >
            {friend.profilePicture ? (
              <img
                src={friend.profilePicture}
                alt=""
                className="dm-avatar dm-avatar--clickable"
                onClick={(e) => {
                  e.stopPropagation();
                  openProfileByUserId(friend.id);
                }}
              />
            ) : (
              <span
                className="dm-avatar dm-avatar--clickable"
                onClick={(e) => {
                  e.stopPropagation();
                  openProfileByUserId(friend.id);
                }}
              >
                {friend.avatar}
              </span>
            )}
            <button
              type="button"
              className="dm-friend-name"
              onClick={(e) => {
                e.stopPropagation();
                openProfileByUserId(friend.id);
              }}
            >
              {friend.username}
            </button>
            {onlineFriends.has(friend.id) && <span className="online-dot"></span>}
          </div>
        ))}
      </div>
      
      <div className="dm-main">
        {selectedDM ? (
          <>
            <div className="dm-header">
              {isDmNarrow ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm dm-back-btn"
                  onClick={() => setDmMobilePanel('list')}
                  aria-label="Back to Direct Messages"
                  title="Back"
                >
                  <FontAwesomeIcon icon={faChevronLeft} /> Back
                </button>
              ) : null}
              <button type="button" className="dm-header__profile" onClick={() => openProfileByUserId(selectedDM.id)}>
                @ {selectedDM.username}
              </button>
            </div>
            <div className="dm-messages">
              {(directMessagesByUserId[selectedDM.id] || []).map((msg, i) => (
                  <div key={i} className={`dm-message ${msg.direction}`}>
                  {msg.message?.trim() ? (
                    <div className="dm-message__text"><strong>{msg.from}:</strong> {msg.message}</div>
                  ) : null}
                  {msg.image?.url ? (
                    <button
                      type="button"
                      className="dm-message__image"
                      onClick={() => setLightbox({ src: msg.image.url, alt: msg.image.name || 'Image' })}
                      aria-label="Open image"
                    >
                      <img src={msg.image.url} alt={msg.image.name || ''} />
                    </button>
                  ) : null}
                  </div>
              ))}
            </div>
            <form className="dm-input" onSubmit={handleSendDM}>
              <input
                type="text"
                placeholder={`Message @${selectedDM.username}`}
                value={dmMessage}
                onChange={(e) => setDmMessage(e.target.value)}
              />
              <label className="btn btn-secondary dm-attach" title="Attach photo">
                <FontAwesomeIcon icon={faImage} />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setDmImageFile(e.target.files?.[0] || null)}
                  style={{ display: 'none' }}
                />
              </label>
              <button type="submit" className="btn btn-primary">Send</button>
            </form>
            {dmImagePreviewUrl ? (
              <div className="dm-preview">
                <button
                  type="button"
                  className="dm-preview__img"
                  onClick={() => setLightbox({ src: dmImagePreviewUrl, alt: 'Preview' })}
                >
                  <img src={dmImagePreviewUrl} alt="" />
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDmImageFile(null)}>Remove</button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="dm-empty">
            <p>Select a friend to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderNewsFeedTab = () => (
    <div className="tab-content tab-content--feed">
      <div className="section-header">
        <h3><FontAwesomeIcon icon={faNewspaper} /> News Feed</h3>
      </div>
      
      <form className="post-form" onSubmit={handlePostToFeed}>
        <div className="mention-wrap">
          <textarea
            ref={postTextareaRef}
            placeholder="What's on your mind?"
            value={newPost}
            onChange={(e) => {
              setNewPost(e.target.value);
              openMentionPickerForField({ field: 'post', value: e.target.value, caret: e.target.selectionStart });
            }}
            onKeyDown={(e) => {
              if (!mentionPicker.open || mentionPicker.field !== 'post') return;
              const suggestions = getMentionSuggestions(mentionPicker.query);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionPicker(prev => ({ ...prev, index: Math.min(prev.index + 1, Math.max(0, suggestions.length - 1)) }));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionPicker(prev => ({ ...prev, index: Math.max(0, prev.index - 1) }));
              } else if (e.key === 'Enter' && !e.shiftKey) {
                // If picker is open, Enter selects; Shift+Enter keeps newline.
                if (suggestions[mentionPicker.index]) {
                  e.preventDefault();
                  applyMentionSelection({
                    username: suggestions[mentionPicker.index].username,
                    setValue: (fn) => setNewPost(fn),
                    getInput: () => postTextareaRef.current
                  });
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setMentionPicker(prev => ({ ...prev, open: false }));
              }
            }}
            onClick={(e) => openMentionPickerForField({ field: 'post', value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
            onKeyUp={(e) => openMentionPickerForField({ field: 'post', value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
            maxLength={500}
            rows={3}
          />
          {mentionPicker.open && mentionPicker.field === 'post' ? (
            <MentionPicker
              suggestions={getMentionSuggestions(mentionPicker.query)}
              onSelect={(f) => applyMentionSelection({
                username: f.username,
                setValue: (fn) => setNewPost(fn),
                getInput: () => postTextareaRef.current
              })}
              onClose={() => setMentionPicker(prev => ({ ...prev, open: false }))}
            />
          ) : null}
        </div>
        {feedImagePreviewUrl ? (
          <div className="feed-compose-preview">
            <button
              type="button"
              className="feed-compose-preview__img"
              onClick={() => setLightbox({ src: feedImagePreviewUrl, alt: 'Preview' })}
              aria-label="Open preview"
            >
              <img src={feedImagePreviewUrl} alt="" />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFeedImageFile(null)}>Remove</button>
          </div>
        ) : null}
        <div className="feed-compose-actions">
          <label className="btn btn-secondary" title="Attach photo">
            <FontAwesomeIcon icon={faImage} /> Photo
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFeedImageFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
          </label>
          <button type="submit" className="btn btn-primary">Post</button>
        </div>
      </form>

      <div className="news-feed">
        {newsFeed.slice(0, feedVisibleCount).map((post, i) => (
          <div key={i} className="feed-post">
            <div className="post-header">
              {post.authorProfilePicture ? (
                <img
                  src={post.authorProfilePicture}
                  alt=""
                  className="post-avatar post-avatar--clickable"
                  onClick={() => openProfileByUserId(post.authorId)}
                />
              ) : (
                <span className="post-avatar post-avatar--clickable" onClick={() => openProfileByUserId(post.authorId)}>{post.authorAvatar}</span>
              )}
              <div>
                <button type="button" className="post-author" onClick={() => openProfileByUserId(post.authorId)}>
                  {post.author}
                </button>
                <span className="post-time">{new Date(post.timestamp).toLocaleString()}</span>
              </div>
            </div>
            {post.content ? <div className="post-content">{post.content}</div> : null}

            {Array.isArray(post.images) && post.images.length > 0 ? (
              <div className="post-images">
                {post.images.map((img) => (
                  <button
                    key={img.fileId || img.url}
                    type="button"
                    className="post-image"
                    onClick={() => setLightbox({ src: img.url, alt: img.name || 'Image' })}
                    aria-label="Open image"
                  >
                    <img src={img.url} alt={img.name || ''} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}

            <div className="post-actions">
              <button
                type="button"
                className={`post-action ${post.fireUserIds?.includes?.(myUserId) ? 'active' : ''}`}
                onClick={() => handleReactFire(post.id)}
              >
                <FontAwesomeIcon icon={faFire} />
                <span className="post-action__count">{post.fireCount || 0}</span>
              </button>

              <button type="button" className="post-action" onClick={() => togglePostExpanded(post.id)}>
                <FontAwesomeIcon icon={faComments} />
                <span>Comments</span>
                <span className="post-action__count">{Array.isArray(post.comments) ? post.comments.length : 0}</span>
              </button>
            </div>

            {expandedPostIds.has(post.id) ? (
              <div className="post-comments">
                <form className="post-comment-form" onSubmit={(e) => handleAddComment(post.id, e)}>
                  <div className="mention-wrap mention-wrap--inline">
                    <input
                      ref={(el) => { if (el) commentInputRefs.current[post.id] = el; }}
                      type="text"
                      placeholder="Write a comment..."
                      value={commentDrafts[post.id] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCommentDrafts(prev => ({ ...prev, [post.id]: val }));
                        openMentionPickerForField({ field: 'comment', postId: post.id, value: val, caret: e.target.selectionStart });
                      }}
                      onClick={(e) => openMentionPickerForField({ field: 'comment', postId: post.id, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                      onKeyUp={(e) => openMentionPickerForField({ field: 'comment', postId: post.id, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                      onKeyDown={(e) => {
                        if (!mentionPicker.open || mentionPicker.field !== 'comment' || String(mentionPicker.postId) !== String(post.id)) return;
                        const suggestions = getMentionSuggestions(mentionPicker.query);
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionPicker(prev => ({ ...prev, index: Math.min(prev.index + 1, Math.max(0, suggestions.length - 1)) }));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionPicker(prev => ({ ...prev, index: Math.max(0, prev.index - 1) }));
                        } else if (e.key === 'Enter') {
                          if (suggestions[mentionPicker.index]) {
                            e.preventDefault();
                            applyMentionSelection({
                              username: suggestions[mentionPicker.index].username,
                              setValue: (fn) => setCommentDrafts(prev => ({ ...prev, [post.id]: fn(prev[post.id] || '') })),
                              getInput: () => commentInputRefs.current[post.id]
                            });
                          }
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setMentionPicker(prev => ({ ...prev, open: false }));
                        }
                      }}
                    />
                    {mentionPicker.open && mentionPicker.field === 'comment' && String(mentionPicker.postId) === String(post.id) ? (
                      <MentionPicker
                        suggestions={getMentionSuggestions(mentionPicker.query)}
                        onSelect={(f) => applyMentionSelection({
                          username: f.username,
                          setValue: (fn) => setCommentDrafts(prev => ({ ...prev, [post.id]: fn(prev[post.id] || '') })),
                          getInput: () => commentInputRefs.current[post.id]
                        })}
                        onClose={() => setMentionPicker(prev => ({ ...prev, open: false }))}
                      />
                    ) : null}
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm">Send</button>
                </form>
                <div className="post-comment-list">
                  {(() => {
                    const all = Array.isArray(post.comments) ? post.comments : [];
                    const byParent = new Map();
                    const roots = [];
                    for (const c of all) {
                      const id = String(c?._id || c?.id || '').trim();
                      const parentId = c?.parentCommentId ? String(c.parentCommentId) : '';
                      const normalized = { ...c, _cid: id, _parent: parentId };
                      if (!parentId) roots.push(normalized);
                      else {
                        const list = byParent.get(parentId) || [];
                        list.push(normalized);
                        byParent.set(parentId, list);
                      }
                    }

                    const renderComment = (c, depth = 0) => {
                      const replies = byParent.get(String(c._cid)) || [];
                      const isActiveReply = replyingTo?.commentId && String(replyingTo.commentId) === String(c._cid);
                      return (
                        <div key={c._cid || `${c.userId}_${c.timestamp}`} className={`post-comment ${depth ? 'post-comment--reply' : ''}`}>
                          <div className="post-comment__avatar">
                            {c.userProfilePicture ? (
                              <img
                                src={c.userProfilePicture}
                                alt=""
                                onClick={() => openProfileByUserId(c.userId)}
                                className="avatar-click"
                              />
                            ) : (
                              <span onClick={() => openProfileByUserId(c.userId)} className="avatar-click">{c.userAvatar || '👤'}</span>
                            )}
                          </div>
                          <div className="post-comment__body">
                            <div className="post-comment__meta">
                              <button type="button" className="comment-author" onClick={() => openProfileByUserId(c.userId)}>
                                {c.username}
                              </button>
                              <span>{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</span>
                            </div>
                            {c.replyToUsername ? (
                              <div className="post-comment__replyto">Replying to <span>@{c.replyToUsername}</span></div>
                            ) : null}
                            <div className="post-comment__text">{renderCommentText(c.text)}</div>
                            <div className="post-comment__actions">
                              <button type="button" className="btn-link" onClick={() => handleReplyToComment(post.id, c)}>
                                Reply
                              </button>
                            </div>

                            {isActiveReply ? (
                              <form className="post-reply-form" onSubmit={(e) => handleSendReply(post.id, e)}>
                                <div className="mention-wrap mention-wrap--inline">
                                  <input
                                    ref={(el) => { if (el) replyInputRefs.current[c._cid] = el; }}
                                    type="text"
                                    placeholder={`Reply to @${c.username}...`}
                                    value={replyDrafts[c._cid] || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setReplyDrafts(prev => ({ ...prev, [c._cid]: val }));
                                      openMentionPickerForField({ field: 'reply', commentId: c._cid, value: val, caret: e.target.selectionStart });
                                    }}
                                    onClick={(e) => openMentionPickerForField({ field: 'reply', commentId: c._cid, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                                    onKeyUp={(e) => openMentionPickerForField({ field: 'reply', commentId: c._cid, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                                    onKeyDown={(e) => {
                                      if (!mentionPicker.open || mentionPicker.field !== 'reply' || String(mentionPicker.commentId) !== String(c._cid)) return;
                                      const suggestions = getMentionSuggestions(mentionPicker.query);
                                      if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setMentionPicker(prev => ({ ...prev, index: Math.min(prev.index + 1, Math.max(0, suggestions.length - 1)) }));
                                      } else if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setMentionPicker(prev => ({ ...prev, index: Math.max(0, prev.index - 1) }));
                                      } else if (e.key === 'Enter') {
                                        if (suggestions[mentionPicker.index]) {
                                          e.preventDefault();
                                          applyMentionSelection({
                                            username: suggestions[mentionPicker.index].username,
                                            setValue: (fn) => setReplyDrafts(prev => ({ ...prev, [c._cid]: fn(prev[c._cid] || '') })),
                                            getInput: () => replyInputRefs.current[c._cid]
                                          });
                                        }
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setMentionPicker(prev => ({ ...prev, open: false }));
                                      }
                                    }}
                                  />
                                  {mentionPicker.open && mentionPicker.field === 'reply' && String(mentionPicker.commentId) === String(c._cid) ? (
                                    <MentionPicker
                                      suggestions={getMentionSuggestions(mentionPicker.query)}
                                      onSelect={(f) => applyMentionSelection({
                                        username: f.username,
                                        setValue: (fn) => setReplyDrafts(prev => ({ ...prev, [c._cid]: fn(prev[c._cid] || '') })),
                                        getInput: () => replyInputRefs.current[c._cid]
                                      })}
                                      onClose={() => setMentionPicker(prev => ({ ...prev, open: false }))}
                                    />
                                  ) : null}
                                </div>
                                <button type="submit" className="btn btn-primary btn-sm">Send</button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplyingTo(null)}>Cancel</button>
                              </form>
                            ) : null}

                            {replies.length ? (
                              <div className="post-comment__replies">
                                {replies.map(r => renderComment(r, depth + 1))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    };

                    // oldest-first roots, keep last 20 total roots+replies in view by slicing on input
                    const limitedRoots = roots.slice(-20);
                    return limitedRoots.map(c => renderComment(c, 0));
                  })()}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {newsFeed.length > feedVisibleCount ? (
          <div className="feed-see-more">
            <button type="button" className="btn btn-secondary" onClick={() => setFeedVisibleCount(c => c + 25)}>
              See more
            </button>
          </div>
        ) : null}

        {showFeedBackToTop ? (
          <button
            type="button"
            className="feed-back-to-top"
            onClick={scrollFeedToTop}
            aria-label="Back to top"
            title="Back to top"
          >
            <FontAwesomeIcon icon={faArrowUp} /> Top
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="lobby-new">
      {lightbox?.src ? (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}
      <aside className="lobby-sidebar" aria-label="Dashboard navigation">
        <div className="lobby-brand" aria-label="Hangout Bar">
          <span className="lobby-brand__mark" aria-hidden="true"><FontAwesomeIcon icon={faBolt} /></span>
          <span className="lobby-brand__text">Hangout Bar</span>
        </div>

        <nav className="lobby-nav">
          <button
            className={`nav-btn ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setActiveTab('friends')}
          >
            <span className="nav-icon" aria-hidden="true"><FontAwesomeIcon icon={faUserGroup} /></span>
            <span className="nav-label">Friends</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'rooms' ? 'active' : ''}`}
            onClick={() => setActiveTab('rooms')}
          >
            <span className="nav-icon" aria-hidden="true"><FontAwesomeIcon icon={faLayerGroup} /></span>
            <span className="nav-label">Rooms</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'dms' ? 'active' : ''}`}
            onClick={() => setActiveTab('dms')}
          >
            <span className="nav-icon" aria-hidden="true"><FontAwesomeIcon icon={faComments} /></span>
            <span className="nav-label">Messages</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'feed' ? 'active' : ''}`}
            onClick={() => setActiveTab('feed')}
          >
            <span className="nav-icon" aria-hidden="true"><FontAwesomeIcon icon={faNewspaper} /></span>
            <span className="nav-label">Feed</span>
          </button>
        </nav>
      </aside>

      <main className="lobby-main" role="main">
        <div className="lobby-header">
          <div className="lobby-header__title">
            <h1 className="lobby-title">
              {activeTab === 'friends' && <>Friends</>}
              {activeTab === 'rooms' && <>Rooms</>}
              {activeTab === 'dms' && <>Messages</>}
              {activeTab === 'feed' && <>Feed</>}
            </h1>
            <div className="lobby-subtitle">Minimal, fast, and live.</div>
          </div>

          <div className="header-actions">
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
            <button className="btn btn-secondary" onClick={onLogout}>Logout</button>
          </div>
        </div>

        <div
          ref={lobbyBodyRef}
          className={`lobby-body ${activeTab === 'feed' ? 'lobby-body--feed' : ''}`}
          onScroll={handleLobbyBodyScroll}
        >
          {activeTab === 'friends' && renderFriendsTab()}
          {activeTab === 'rooms' && renderRoomsTab()}
          {activeTab === 'dms' && renderDMsTab()}
          {activeTab === 'feed' && renderNewsFeedTab()}
        </div>
      </main>

      {viewingProfile ? (
        <Profile
          user={viewingProfile}
          currentUser={user}
          onClose={() => setViewingProfile(null)}
          onUpdate={() => {}}
          isOwnProfile={String(viewingProfile?._id || viewingProfile?.id) === String(user?.id || user?._id)}
          onViewTimeline={onViewTimeline}
        />
      ) : null}

      <AccountOptionsModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        currentUser={user}
        onUserUpdated={(nextUser) => {
          onUserUpdated?.(nextUser);
          setAccountModalOpen(false);
        }}
      />

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Room</h2>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Enter room name"
                  maxLength={50}
                />
              </div>
              <div className="form-group-checkbox">
                <input
                  type="checkbox"
                  id="private"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <label htmlFor="private">Private Room</label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
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

export default LobbyNew;
