import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBan,
  faCheck,
  faChevronDown,
  faClock,
  faFloppyDisk,
  faHeart,
  faHeartCrack,
  faLock,
  faNewspaper,
  faTicket,
  faUser,
  faUserPlus,
  faUsers,
  faUserSlash,
  faVolumeHigh,
  faVolumeXmark,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import ImageResizeModal from './ImageResizeModal';
import './Profile.css';

function Profile({ user, onClose, onUpdate, isOwnProfile, currentUser, onViewTimeline }) {
  const { socket } = useSocket();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    avatar: user.avatar || '👤',
    profilePicture: user.profilePicture || '',
    bio: user.bio || ''
  });
  const [imagePreview, setImagePreview] = useState(user.profilePicture || '');
  const [pendingProfileFile, setPendingProfileFile] = useState(null);
  const [resizeModalOpen, setResizeModalOpen] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [friendRequestStatus, setFriendRequestStatus] = useState(null);
  const [showFriendMenu, setShowFriendMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const AVATARS = ['😊', '😎', '🤖', '👻', '🦄', '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸'];

  const currentUserId = currentUser?.id || currentUser?._id;
  const targetUserId = user?.id || user?._id;
  const normalizeId = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (value._id) return String(value._id);
      if (value.id) return String(value.id);
      if (value.from) return normalizeId(value.from);
      if (value.toString) return value.toString();
    }
    return String(value);
  };

  const isFriend = !!currentUserId && Array.isArray(user?.friends) && user.friends.some(f => normalizeId(f) === String(currentUserId));
  const pendingRequestFromMe = !!currentUserId && Array.isArray(user?.friendRequests) && user.friendRequests.some(r => normalizeId(r?.from) === String(currentUserId));
  const targetIsGuest = !!user?.isGuest || (typeof user?.username === 'string' && user.username.startsWith('Guest_'));
  const isCurrentUserGuest = !!currentUser?.isGuest;

  const isLockedByFriendship = !isOwnProfile && !isFriend;

  const handleViewTimeline = () => {
    const id = String(targetUserId || '').trim();
    if (!id) return;
    if (typeof onViewTimeline === 'function') onViewTimeline(id);
    onClose();
  };

  // Check if current user is a guest trying to view profile
  useEffect(() => {
    if (!isOwnProfile && currentUser?.isGuest) {
      setShowAuthPrompt(true);
    }
  }, [isOwnProfile, currentUser]);

  // Load mute state for this target user
  useEffect(() => {
    if (!currentUserId || !targetUserId) return;
    try {
      const raw = localStorage.getItem(`hangout_muted_users_${currentUserId}`);
      const ids = raw ? JSON.parse(raw) : [];
      setIsMuted(Array.isArray(ids) && ids.includes(String(targetUserId)));
    } catch {
      setIsMuted(false);
    }
  }, [currentUserId, targetUserId]);
  
  // Listen for friend request response
  useEffect(() => {
    if (!socket) return;
    
    const handleSuccess = ({ message }) => {
      console.log('Friend request success:', message);
      setFriendRequestStatus('success');
      setTimeout(() => {
        onClose();
      }, 1500);
    };
    
    const handleError = ({ message }) => {
      console.log('Friend request error:', message);
      setFriendRequestStatus('error');
      alert(message || 'Failed to send friend request');
    };
    
    socket.on('friendRequestSuccess', handleSuccess);
    socket.on('friendRequestError', handleError);
    
    return () => {
      socket.off('friendRequestSuccess', handleSuccess);
      socket.off('friendRequestError', handleError);
    };
  }, [socket, onClose]);

  const handleImageUrlChange = (e) => {
    const url = e.target.value;
    setEditData({ ...editData, profilePicture: url });
    setImagePreview(url);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size >= 5000000) {
      alert('Image must be less than 5MB');
      return;
    }
    setPendingProfileFile(file);
    setResizeModalOpen(true);
  };

  const applyResizedProfilePicture = (dataUrl) => {
    setEditData(prev => ({ ...prev, profilePicture: dataUrl }));
    setImagePreview(dataUrl);
    setResizeModalOpen(false);
    setPendingProfileFile(null);
  };

  const handleSave = async () => {
    try {
      // Get user ID - handle both id and _id properties
      const userId = user.id || user._id;
      console.log('Saving profile for user:', { userId, user });
      
      if (!userId) {
        throw new Error('User ID is missing');
      }
      
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Server error:', errorData);
        throw new Error(errorData.error || 'Failed to update profile');
      }
      
      const updated = await response.json();
      console.log('Profile updated:', updated);
      
      // Update local user data
      if (onUpdate) {
        onUpdate(updated);
      }
      
      // Update session storage
      const sessionData = localStorage.getItem('hangout_session');
      if (sessionData) {
        const session = JSON.parse(sessionData);
        session.user = { ...session.user, ...editData, id: userId };
        localStorage.setItem('hangout_session', JSON.stringify(session));
      }
      
      setIsEditing(false);
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile. Please try again.');
    }
  };

  const handleAddFriend = () => {
    const targetUserId = user.id || user._id;
    console.log('=== FRIEND REQUEST DEBUG ===');
    console.log('Target User ID:', targetUserId);
    console.log('Target User:', user);
    console.log('Current User:', currentUser);
    console.log('Socket exists:', !!socket);
    console.log('Socket connected:', socket?.connected);
    console.log('Socket ID:', socket?.id);
    
    if (!socket) {
      alert('Not connected to server. Please try again.');
      return;
    }
    
    if (!socket.connected) {
      alert('Socket not connected. Please refresh and try again.');
      return;
    }
    
    if (!targetUserId) {
      alert('Cannot identify user. Please try again.');
      return;
    }
    
    // Check if trying to add self
    const currentUserId = currentUser.id || currentUser._id;
    if (targetUserId === currentUserId) {
      alert('You cannot add yourself as a friend!');
      return;
    }
    
    setFriendRequestStatus('sending');
    console.log('Emitting sendFriendRequest event with:', { targetUserId });
    socket.emit('sendFriendRequest', { targetUserId });
    console.log('Event emitted!');
    
    // Reset status after 5 seconds if no response
    setTimeout(() => {
      setFriendRequestStatus(prev => {
        if (prev === 'sending') {
          console.log('Request timed out - no response from server');
          alert('Request timed out. Please check your connection and try again.');
          return null;
        }
        return prev;
      });
    }, 5000);
  };

  const toggleMute = () => {
    if (!currentUserId || !targetUserId) return;
    try {
      const key = `hangout_muted_users_${currentUserId}`;
      const raw = localStorage.getItem(key);
      const ids = raw ? JSON.parse(raw) : [];
      const next = new Set(Array.isArray(ids) ? ids.map(String) : []);
      if (next.has(String(targetUserId))) {
        next.delete(String(targetUserId));
        setIsMuted(false);
      } else {
        next.add(String(targetUserId));
        setIsMuted(true);
      }
      localStorage.setItem(key, JSON.stringify(Array.from(next)));
      try {
        window.dispatchEvent(new Event('hangout:mutedUsersChanged'));
      } catch {
        // ignore
      }
    } catch (e) {
      console.error('Mute toggle error:', e);
    }
  };

  const handleUnfriend = () => {
    if (!socket || !targetUserId) return;
    socket.emit('unfriendUser', { targetUserId });
    setShowFriendMenu(false);
    onClose();
  };

  const handleBlock = () => {
    if (!socket || !targetUserId) return;
    socket.emit('blockUser', { targetUserId });
    setShowFriendMenu(false);
    onClose();
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal card" onClick={(e) => e.stopPropagation()}>
        {showAuthPrompt ? (
          <>
            <div className="profile-header">
              <h2><FontAwesomeIcon icon={faLock} /> Feature Locked</h2>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>
            <div className="auth-prompt">
              <div className="auth-prompt-icon" aria-hidden="true"><FontAwesomeIcon icon={faTicket} /></div>
              <h3>Guest Account Limitation</h3>
              <p>Viewing profiles and adding friends is only available for registered users.</p>
              <div className="auth-prompt-benefits">
                <div className="benefit"><FontAwesomeIcon icon={faWandMagicSparkles} /> Create and customize your profile</div>
                <div className="benefit"><FontAwesomeIcon icon={faUsers} /> View other users' profiles</div>
                <div className="benefit"><FontAwesomeIcon icon={faHeart} /> Add friends and build connections</div>
                <div className="benefit"><FontAwesomeIcon icon={faFloppyDisk} /> Save your data permanently</div>
              </div>
              <div className="auth-prompt-actions">
                <button className="btn btn-primary" onClick={() => window.location.reload()}>
                  Create Account
                </button>
                <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                  Login
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="profile-header">
              <h2><FontAwesomeIcon icon={faUser} /> Profile</h2>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

        <div className="profile-content">
          {/* Profile Picture */}
          <div className="profile-picture-section">
            {imagePreview ? (
              <img src={imagePreview} alt="Profile" className="profile-picture" onError={() => setImagePreview('')} />
            ) : (
              <div className="profile-avatar-large">{editData.avatar}</div>
            )}
            
            {isEditing && (
              <div className="image-upload-options">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  id="file-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="file-upload" className="btn btn-secondary">
                  📷 Upload Image
                </label>
                <input
                  type="text"
                  placeholder="Or paste image URL"
                  value={editData.profilePicture}
                  onChange={handleImageUrlChange}
                  className="url-input"
                />
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="profile-info">
            <h3>{user.username}</h3>
            <p className="join-date">
              Joined {new Date(user.createdAt || Date.now()).toLocaleDateString()}
            </p>
          </div>

          {isLockedByFriendship ? (
            <div className="profile-locked card" style={{ marginTop: 12 }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                This profile is private. Add as a friend to view their full profile and timeline.
              </p>
            </div>
          ) : null}

          {/* Avatar Selection */}
          {isEditing && (
            <div className="form-group">
              <label>Emoji Avatar (shown when no profile picture)</label>
              <div className="avatar-grid-small">
                {AVATARS.map(avatar => (
                  <button
                    key={avatar}
                    type="button"
                    className={`avatar-option-small ${editData.avatar === avatar ? 'selected' : ''}`}
                    onClick={() => setEditData({ ...editData, avatar })}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bio */}
          {!isLockedByFriendship ? (
            <div className="form-group">
              <label>Bio</label>
              {isEditing ? (
                <textarea
                  placeholder="Tell us about yourself..."
                  value={editData.bio}
                  onChange={(e) => setEditData({ ...editData, bio: e.target.value })}
                  maxLength={200}
                  rows={4}
                />
              ) : (
                <p className="bio-text">{user.bio || 'No bio yet'}</p>
              )}
            </div>
          ) : null}

          {/* Friends Count */}
          {!isLockedByFriendship ? (
            <div className="profile-stats">
              <div className="stat">
                <span className="stat-number">{user.friends?.length || 0}</span>
                <span className="stat-label">Friends</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="profile-actions">
          {isOwnProfile ? (
            isCurrentUserGuest ? (
              <button className="btn btn-secondary" disabled type="button" title="Guest accounts cannot update profiles">
                <FontAwesomeIcon icon={faLock} /> Guest profiles are read-only
              </button>
            ) : isEditing ? (
              <>
                <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSave}>
                  Save Changes
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
                  Edit Profile
                </button>
                <button className="btn btn-secondary" type="button" onClick={handleViewTimeline}>
                  <FontAwesomeIcon icon={faNewspaper} /> View Timeline
                </button>
              </>
            )
          ) : (
            <>
              <div className="friend-action-wrapper">
                {isFriend ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowFriendMenu(s => !s)}
                      type="button"
                    >
                      <FontAwesomeIcon icon={faCheck} /> Friends <FontAwesomeIcon icon={faChevronDown} />
                    </button>
                    {showFriendMenu && (
                      <div className="friend-menu">
                        <button type="button" className="friend-menu-item" onClick={toggleMute}>
                          {isMuted ? (<><FontAwesomeIcon icon={faVolumeHigh} /> Unmute</>) : (<><FontAwesomeIcon icon={faVolumeXmark} /> Mute</>)}
                        </button>
                        <button type="button" className="friend-menu-item danger" onClick={handleUnfriend}>
                          <FontAwesomeIcon icon={faHeartCrack} /> Unfriend
                        </button>
                        <button type="button" className="friend-menu-item danger" onClick={handleBlock}>
                          <FontAwesomeIcon icon={faBan} /> Block
                        </button>
                      </div>
                    )}
                  </>
                ) : pendingRequestFromMe ? (
                  <button className="btn btn-secondary" disabled type="button">
                    <FontAwesomeIcon icon={faClock} /> Requested
                  </button>
                ) : targetIsGuest ? (
                  <button className="btn btn-secondary" disabled type="button" title="Guest accounts cannot be added as friends">
                    <FontAwesomeIcon icon={faUserSlash} /> Guest account
                  </button>
                ) : (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleAddFriend}
                    disabled={friendRequestStatus === 'sending' || friendRequestStatus === 'success'}
                    type="button"
                  >
                    {friendRequestStatus === 'sending' && (<><FontAwesomeIcon icon={faClock} /> Sending...</>)}
                    {friendRequestStatus === 'success' && (<><FontAwesomeIcon icon={faCheck} /> Request Sent!</>)}
                    {!friendRequestStatus && (<><FontAwesomeIcon icon={faUserPlus} /> Add Friend</>)}
                  </button>
                )}
              </div>

              <button
                className="btn btn-secondary"
                type="button"
                onClick={handleViewTimeline}
                disabled={!isOwnProfile && isLockedByFriendship}
                title={!isOwnProfile && isLockedByFriendship ? 'Add as a friend to view timeline' : 'View timeline'}
              >
                <FontAwesomeIcon icon={faNewspaper} /> View Timeline
              </button>
            </>
          )}
        </div>
        </>
        )}
      </div>
    </div>
    <ImageResizeModal
      open={resizeModalOpen}
      file={pendingProfileFile}
      onCancel={() => {
        setResizeModalOpen(false);
        setPendingProfileFile(null);
      }}
      onApply={applyResizedProfilePicture}
      maxSize={512}
    />
    </>
  );
}

export default Profile;
