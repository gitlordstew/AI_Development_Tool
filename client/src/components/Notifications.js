import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBell,
  faCheckCircle,
  faEnvelopeOpenText,
  faImage,
  faPaperPlane,
  faUserPlus,
  faXmark
} from '@fortawesome/free-solid-svg-icons';
import './Notifications.css';

function Notifications({ user }) {
  const { socket } = useSocket();
  const apiBase = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [friendRequests, setFriendRequests] = useState([]);

  const [feedUnreadCount, setFeedUnreadCount] = useState(0);
  const [feedLast, setFeedLast] = useState([]); // newest-first, limited

  const [dmUnreadByUserId, setDmUnreadByUserId] = useState({});
  const [dmLastByUserId, setDmLastByUserId] = useState({});
  const [replyTo, setReplyTo] = useState(null); // { userId, username, avatar, profilePicture }
  const [replyText, setReplyText] = useState('');
  const [replyImageFile, setReplyImageFile] = useState(null);
  const [replyImagePreviewUrl, setReplyImagePreviewUrl] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  useEffect(() => {
    if (!socket) return;

    // Friend request notification
    socket.on('friendRequest', ({ fromId, fromUsername, fromAvatar, fromProfilePicture }) => {
      console.log('Friend request received:', { fromId, fromUsername, fromAvatar, fromProfilePicture });
      const newRequest = { fromId, fromUsername, fromAvatar, fromProfilePicture, timestamp: Date.now() };
      setFriendRequests(prev => {
        // De-dupe by sender
        if (prev.some(r => r.fromId === fromId)) return prev;
        return [...prev, newRequest];
      });
      
      // Add to notifications
      addNotification({
        id: Date.now(),
        type: 'friendRequest',
        message: `${fromUsername} sent you a friend request`,
        fromId,
        fromUsername,
        fromAvatar
      });
    });

    // Friend added notification
    socket.on('friendAdded', (friend) => {
      addNotification({
        id: Date.now(),
        type: 'friendAdded',
        message: `You are now friends with ${friend.username}`,
        ...friend
      });
      
      // Remove from friend requests
      setFriendRequests(prev => prev.filter(req => req.fromId !== friend.id));
    });

    // Room invite notification
    socket.on('roomInvite', ({ fromUsername, roomId, roomName }) => {
      addNotification({
        id: Date.now(),
        type: 'roomInvite',
        message: `${fromUsername} invited you to ${roomName}`,
        roomId,
        roomName,
        fromUsername
      });
    });

    // Direct message notification
    socket.on('directMessage', ({ id, from, fromId, fromAvatar, fromProfilePicture, message, image, timestamp }) => {
      if (!fromId) return;

      setDmUnreadByUserId(prev => ({
        ...prev,
        [fromId]: (prev[fromId] || 0) + 1
      }));

      setDmLastByUserId(prev => ({
        ...prev,
        [fromId]: {
          id,
          from,
          fromId,
          fromAvatar,
          fromProfilePicture,
          message: message || '',
          image: image || null,
          timestamp: timestamp || Date.now()
        }
      }));

      const snippet = (message || '').trim();
      addNotification({
        id: Date.now(),
        type: 'directMessage',
        message: snippet ? `${from}: ${snippet}` : `${from} sent a photo`,
        fromId,
        fromUsername: from,
        fromAvatar,
        fromProfilePicture,
        dm: { id, message: message || '', image: image || null, timestamp: timestamp || Date.now() }
      });
    });

    // Feed notifications (mentions, replies, activity)
    socket.on('feedNotification', (payload) => {
      const safe = payload && typeof payload === 'object' ? payload : {};
      const type = String(safe.type || 'feed');
      const fromUsername = safe.fromUsername ? String(safe.fromUsername) : '';
      const fromAvatar = safe.fromAvatar ? String(safe.fromAvatar) : '🔔';
      const fromProfilePicture = safe.fromProfilePicture ? String(safe.fromProfilePicture) : '';
      const message = safe.message ? String(safe.message) : 'Feed activity';

      setFeedUnreadCount(c => c + 1);
      setFeedLast(prev => {
        const next = [
          {
            id: safe.id || Date.now(),
            type,
            postId: safe.postId || null,
            fromUsername,
            fromAvatar,
            fromProfilePicture,
            message,
            timestamp: safe.timestamp || Date.now()
          },
          ...prev
        ];
        return next.slice(0, 10);
      });

      addNotification({
        id: Date.now(),
        type: `feed:${type}`,
        message: fromUsername ? `${fromUsername}: ${message}` : message,
        fromUsername,
        fromAvatar,
        fromProfilePicture,
        postId: safe.postId || null
      });
    });

    return () => {
      socket.off('friendRequest');
      socket.off('friendAdded');
      socket.off('roomInvite');
      socket.off('directMessage');
      socket.off('feedNotification');
    };
  }, [socket]);

  useEffect(() => {
    if (!replyImageFile) {
      setReplyImagePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(replyImageFile);
    setReplyImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [replyImageFile]);

  const addNotification = (notification) => {
    setNotifications(prev => [notification, ...prev]);
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  const uploadImageFile = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${apiBase}/api/uploads`, { method: 'POST', body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Upload failed');
    return { fileId: data.fileId, url: data.url, contentType: data.contentType, name: data.name };
  };

  const openReply = ({ userId, username, avatar, profilePicture }) => {
    setReplyTo({ userId, username, avatar, profilePicture });
    setReplyText('');
    setReplyImageFile(null);
    setIsSendingReply(false);

    setDmUnreadByUserId(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  const closeReply = () => {
    setReplyTo(null);
    setReplyText('');
    setReplyImageFile(null);
    setIsSendingReply(false);
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!socket || !replyTo?.userId) return;

    const trimmed = String(replyText || '').trim();
    const hasImage = !!replyImageFile;
    if (!trimmed && !hasImage) return;

    setIsSendingReply(true);
    try {
      let uploaded = null;
      if (replyImageFile) {
        uploaded = await uploadImageFile(replyImageFile);
      }

      socket.emit('sendDirectMessage', {
        toUserId: replyTo.userId,
        message: trimmed,
        image: uploaded
      }, (res) => {
        if (res?.ok === false) {
          addNotification({ id: Date.now(), type: 'directMessageError', message: res.message || 'Message failed' });
          setIsSendingReply(false);
          return;
        }
        closeReply();
      });
    } catch (err) {
      addNotification({ id: Date.now(), type: 'directMessageError', message: err?.message || 'Message failed' });
      setIsSendingReply(false);
    }
  };

  const handleAcceptFriend = (request) => {
    if (socket) {
      socket.emit('acceptFriendRequest', { fromUserId: request.fromId });
      setFriendRequests(prev => prev.filter(req => req.fromId !== request.fromId));
    }
  };

  const handleRejectFriend = (request) => {
    if (socket) {
      socket.emit('rejectFriendRequest', { fromUserId: request.fromId }, () => {
        // ignore ack
      });
    }
    setFriendRequests(prev => prev.filter(req => req.fromId !== request.fromId));
  };

  const dmUnreadCount = Object.values(dmUnreadByUserId).reduce((a, b) => a + (Number(b) || 0), 0);
  const unreadCount = friendRequests.length + dmUnreadCount + feedUnreadCount;

  return (
    <>
      {/* Notification Bell */}
      <div className="notification-bell" onClick={() => setShowNotifications(!showNotifications)}>
        <span className="bell-icon" aria-hidden="true"><FontAwesomeIcon icon={faBell} /></span>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </div>

      {/* Notification Dropdown */}
      {showNotifications && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3>Notifications</h3>
            <button onClick={() => setShowNotifications(false)} aria-label="Close notifications">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          
          {friendRequests.length > 0 && (
            <div className="notification-section">
              <h4>Friend Requests</h4>
              {friendRequests.map((request, index) => (
                <div key={index} className="notification-item friend-request-item">
                  <div className="notification-content">
                    {request.fromProfilePicture ? (
                      <img src={request.fromProfilePicture} alt="" className="notification-avatar" />
                    ) : (
                      <span className="notification-avatar">{request.fromAvatar}</span>
                    )}
                    <div className="notification-text">
                      <strong>{request.fromUsername}</strong> wants to be your friend
                    </div>
                  </div>
                  <div className="notification-actions">
                    <button 
                      className="btn btn-primary btn-sm" 
                      onClick={() => handleAcceptFriend(request)}
                    >
                      Accept
                    </button>
                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={() => handleRejectFriend(request)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {feedLast.length > 0 && (
            <div className="notification-section">
              <h4>
                Feed
                {feedUnreadCount > 0 ? <span className="notification-pill">{feedUnreadCount}</span> : null}
              </h4>
              {feedLast
                .slice(0, 8)
                .map((n, idx) => (
                  <button
                    key={n?.id || `${n?.type || 'feed'}_${idx}`}
                    type="button"
                    className="notification-item notification-item--clickable"
                    onClick={() => {
                      setFeedUnreadCount(0);
                      setShowNotifications(false);
                    }}
                  >
                    <div className="notification-content">
                      {n?.fromProfilePicture ? (
                        <img src={n.fromProfilePicture} alt="" className="notification-avatar" />
                      ) : (
                        <span className="notification-avatar">{n?.fromAvatar || '🔔'}</span>
                      )}
                      <div className="notification-text">
                        <strong>{n?.fromUsername || 'Feed'}</strong>
                        <div className="dm-item__meta">{n?.message || 'activity'}</div>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}

          {Object.keys(dmLastByUserId).length > 0 && (
            <div className="notification-section">
              <h4>Messages</h4>
              {Object.values(dmLastByUserId)
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 8)
                .map((dm) => (
                  <div key={dm.fromId} className="notification-item dm-item">
                    <div className="notification-content">
                      {dm.fromProfilePicture ? (
                        <img src={dm.fromProfilePicture} alt="" className="notification-avatar" />
                      ) : (
                        <span className="notification-avatar">{dm.fromAvatar || '👤'}</span>
                      )}
                      <div className="notification-text">
                        <strong>{dm.from}</strong>
                        <div className="dm-item__meta">
                          {(dm.message || '').trim() ? (dm.message || '').slice(0, 90) : 'Photo'}
                        </div>
                      </div>
                      {dmUnreadByUserId[dm.fromId] ? (
                        <span className="dm-unread">{dmUnreadByUserId[dm.fromId]}</span>
                      ) : null}
                    </div>
                    <div className="notification-actions dm-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => openReply({
                        userId: dm.fromId,
                        username: dm.from,
                        avatar: dm.fromAvatar,
                        profilePicture: dm.fromProfilePicture
                      })}>
                        Reply
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {friendRequests.length === 0 && feedLast.length === 0 && Object.keys(dmLastByUserId).length === 0 && (
            <div className="no-notifications">
              <p>No new notifications</p>
            </div>
          )}
        </div>
      )}

      {/* Toast Notifications */}
      <div className="notification-toasts">
        {notifications.map(notification => (
          <div key={notification.id} className={`notification-toast ${notification.type}`}>
            <span className="toast-icon">
              {notification.type === 'friendRequest' && <FontAwesomeIcon icon={faUserPlus} />}
              {notification.type === 'friendAdded' && <FontAwesomeIcon icon={faCheckCircle} />}
              {notification.type === 'roomInvite' && <FontAwesomeIcon icon={faEnvelopeOpenText} />}
              {notification.type === 'directMessage' && <FontAwesomeIcon icon={faPaperPlane} />}
              {String(notification.type || '').startsWith('feed:') && <FontAwesomeIcon icon={faBell} />}
            </span>
            <span className="toast-message">{notification.message}</span>
            {notification.type === 'directMessage' ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => openReply({
                  userId: notification.fromId,
                  username: notification.fromUsername,
                  avatar: notification.fromAvatar,
                  profilePicture: notification.fromProfilePicture
                })}
              >
                Reply
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {replyTo ? (
        <div className="dm-reply-overlay" role="dialog" aria-modal="true" onMouseDown={closeReply}>
          <div className="dm-reply-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dm-reply-header">
              <div className="dm-reply-title">
                <span className="dm-reply-to">Reply to</span>
                <strong>@{replyTo.username}</strong>
              </div>
              <button type="button" className="btn-icon" onClick={closeReply} aria-label="Close">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <form className="dm-reply-body" onSubmit={handleSendReply}>
              <textarea
                rows={3}
                placeholder="Type a message..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />

              {replyImagePreviewUrl ? (
                <div className="dm-reply-preview">
                  <img src={replyImagePreviewUrl} alt="" />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplyImageFile(null)}>Remove</button>
                </div>
              ) : null}

              <div className="dm-reply-actions">
                <label className="btn btn-secondary" title="Attach photo">
                  <FontAwesomeIcon icon={faImage} /> Photo
                  <input type="file" accept="image/*" onChange={(e) => setReplyImageFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                </label>
                <button type="submit" className="btn btn-primary" disabled={isSendingReply}>
                  <FontAwesomeIcon icon={faPaperPlane} /> {isSendingReply ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Notifications;
