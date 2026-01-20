import React, { useState, useEffect } from 'react';
import './Profile.css';

function Profile({ user, onClose, onUpdate, isOwnProfile, currentUser }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    avatar: user.avatar || '👤',
    profilePicture: user.profilePicture || '',
    bio: user.bio || ''
  });
  const [imagePreview, setImagePreview] = useState(user.profilePicture || '');
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const AVATARS = ['😊', '😎', '🤖', '👻', '🦄', '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸'];

  // Check if current user is a guest trying to view profile
  useEffect(() => {
    if (!isOwnProfile && currentUser?.isGuest) {
      setShowAuthPrompt(true);
    }
  }, [isOwnProfile, currentUser]);

  const handleImageUrlChange = (e) => {
    const url = e.target.value;
    setEditData({ ...editData, profilePicture: url });
    setImagePreview(url);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.size < 5000000) { // 5MB limit
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        setEditData({ ...editData, profilePicture: base64 });
        setImagePreview(base64);
      };
      reader.readAsDataURL(file);
    } else {
      alert('Image must be less than 5MB');
    }
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      });
      const updated = await response.json();
      onUpdate(updated);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal card" onClick={(e) => e.stopPropagation()}>
        {showAuthPrompt ? (
          <>
            <div className="profile-header">
              <h2>🔒 Feature Locked</h2>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>
            <div className="auth-prompt">
              <div className="auth-prompt-icon">🎫</div>
              <h3>Guest Account Limitation</h3>
              <p>Viewing profiles and adding friends is only available for registered users.</p>
              <div className="auth-prompt-benefits">
                <div className="benefit">✨ Create and customize your profile</div>
                <div className="benefit">👥 View other users' profiles</div>
                <div className="benefit">❤️ Add friends and build connections</div>
                <div className="benefit">💾 Save your data permanently</div>
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
              <h2>👤 Profile</h2>
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

          {/* Friends Count */}
          <div className="profile-stats">
            <div className="stat">
              <span className="stat-number">{user.friends?.length || 0}</span>
              <span className="stat-label">Friends</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="profile-actions">
          {isOwnProfile ? (
            isEditing ? (
              <>
                <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSave}>
                  Save Changes
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
                Edit Profile
              </button>
            )
          ) : (
            <button className="btn btn-primary">
              ❤️ Add Friend
            </button>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

export default Profile;
