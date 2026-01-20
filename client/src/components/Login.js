import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import './Login.css';

const AVATARS = ['😊', '😎', '🤖', '👻', '🦄', '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸'];

// Pre-made profile picture URLs (free stock images)
const PROFILE_TEMPLATES = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Max',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Sophie',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot2',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Alex',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Sam'
];

function Login({ onLogin }) {
  const { socket, connected } = useSocket();
  const [mode, setMode] = useState('choose'); // 'choose', 'guest', 'login', 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [profilePicture, setProfilePicture] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [step, setStep] = useState(1); // For signup: 1: basic info, 2: profile picture
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.size < 5000000) { // 5MB limit
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        setProfilePicture(base64);
        setImagePreview(base64);
      };
      reader.readAsDataURL(file);
    } else {
      alert('Image must be less than 5MB');
    }
  };

  const handleImageUrlChange = (e) => {
    const url = e.target.value;
    setProfilePicture(url);
    setImagePreview(url);
    setSelectedTemplate(null);
  };

  const handleTemplateSelect = (templateUrl) => {
    setSelectedTemplate(templateUrl);
    setProfilePicture(templateUrl);
    setImagePreview(templateUrl);
  };

  const handleNext = (e) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setError('');
    setStep(2);
  };

  const handleBackToModeSelection = () => {
    setMode('choose');
    setError('');
    setUsername('');
    setPassword('');
    setStep(1);
  };

  const handleBackToStep1 = () => {
    setStep(1);
    setError('');
  };

  const handleGuestLogin = async (e) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!connected) {
      setError('Not connected to server. Please wait...');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), avatar: selectedAvatar })
      });

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('hangout_token', data.token);
        localStorage.setItem('hangout_user', JSON.stringify({ ...data.user, isGuest: true }));
        
        socket.emit('register', { 
          username: data.user.username, 
          avatar: data.user.avatar,
          userId: data.user._id
        });
        
        socket.once('registered', () => {
          onLogin({ ...data.user, id: data.user._id, isGuest: true });
        });
      } else {
        setError(data.error || 'Failed to join as guest');
      }
    } catch (error) {
      console.error('Error joining as guest:', error);
      setError('Failed to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountLogin = async (e) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }

    if (!connected) {
      setError('Not connected to server. Please wait...');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('hangout_token', data.token);
        localStorage.setItem('hangout_user', JSON.stringify({ ...data.user, isGuest: false }));
        
        socket.emit('register', { 
          username: data.user.username, 
          avatar: data.user.avatar,
          userId: data.user.id
        });
        
        socket.once('registered', () => {
          onLogin({ ...data.user, isGuest: false });
        });
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Error logging in:', error);
      setError('Failed to login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!connected) {
      setError('Not connected to server. Please wait...');
      return;
    }

    setLoading(true);
    try {
      // Register user in database (signup)
      const response = await fetch(`${process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000'}/api/users/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password,
          avatar: selectedAvatar,
          profilePicture: profilePicture
        })
      });

      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('hangout_token', data.token);
        localStorage.setItem('hangout_user', JSON.stringify({ ...data.user, isGuest: false }));

        // Register with socket
        socket.emit('register', { 
          username: data.user.username, 
          avatar: data.user.avatar,
          userId: data.user.id
        });
        
        socket.once('registered', () => {
          onLogin({ 
            ...data.user, 
            isGuest: false,
            profilePicture: data.user.profilePicture 
          });
        });
      } else {
        setError(data.error || 'Signup failed');
        setStep(1); // Go back to step 1 on error
      }
    } catch (error) {
      console.error('Error registering:', error);
      setError('Failed to register. Please try again.');
      setStep(1); // Go back to step 1 on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container fade-in">
      <div className="login-card card">
        <h1 className="login-title">🎉 Hangout Bar</h1>
        <p className="login-subtitle">Connect, Chat, and Vibe Together</p>
        
        {mode === 'choose' && (
          <div className="mode-selection">
            <button className="mode-btn btn btn-primary" onClick={() => setMode('guest')}>
              <span className="mode-icon">👤</span>
              <div className="mode-info">
                <h3>Join as Guest</h3>
                <p>Quick access, limited features</p>
              </div>
            </button>
            
            <button className="mode-btn btn btn-secondary" onClick={() => setMode('login')}>
              <span className="mode-icon">🔑</span>
              <div className="mode-info">
                <h3>Login</h3>
                <p>Access your existing account</p>
              </div>
            </button>
            
            <button className="mode-btn btn btn-success" onClick={() => setMode('signup')}>
              <span className="mode-icon">✨</span>
              <div className="mode-info">
                <h3>Create Account</h3>
                <p>Full features, save your profile</p>
              </div>
            </button>
          </div>
        )}

        {mode === 'guest' && (
          <form onSubmit={handleGuestLogin} className="login-form">
            <div className="form-group">
              <label>Choose Your Avatar</label>
              <div className="avatar-grid">
                {AVATARS.map(avatar => (
                  <button
                    key={avatar}
                    type="button"
                    className={`avatar-option ${selectedAvatar === avatar ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(avatar)}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <p className="helper-text">⚠️ Guest accounts can't add friends or view profiles</p>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                ← Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={!connected || loading}>
                {loading ? 'Joining...' : 'Join as Guest 🚀'}
              </button>
            </div>
          </form>
        )}

        {mode === 'login' && (
          <form onSubmit={handleAccountLogin} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={25}
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                ← Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={!connected || loading}>
                {loading ? 'Logging in...' : 'Login 🔑'}
              </button>
            </div>

            <p className="switch-mode">
              Don't have an account? <button type="button" onClick={() => setMode('signup')}>Create one</button>
            </p>
          </form>
        )}

        {mode === 'signup' && step === 1 && (
          <form onSubmit={handleNext} className="login-form">
            <div className="form-group">
              <label>Choose Your Avatar</label>
              <div className="avatar-grid">
                {AVATARS.map(avatar => (
                  <button
                    key={avatar}
                    type="button"
                    className={`avatar-option ${selectedAvatar === avatar ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(avatar)}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={30}
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                ← Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={!connected}>
                {connected ? 'Next: Profile Picture →' : 'Connecting...'}
              </button>
            </div>

            <p className="switch-mode">
              Already have an account? <button type="button" onClick={() => setMode('login')}>Login</button>
            </p>
          </form>
        )}
        
        {mode === 'signup' && step === 2 && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Profile Picture (Optional)</label>
              <p className="helper-text">Choose a template, upload your own, or skip</p>
              
              <div className="profile-preview">
                {imagePreview ? (
                  <img src={imagePreview} alt="Profile Preview" className="preview-image" onError={() => setImagePreview('')} />
                ) : (
                  <div className="preview-avatar">{selectedAvatar}</div>
                )}
              </div>

              <div className="template-section">
                <label>Choose Template</label>
                <div className="template-grid">
                  {PROFILE_TEMPLATES.map((templateUrl, index) => (
                    <div
                      key={index}
                      className={`template-option ${selectedTemplate === templateUrl ? 'selected' : ''}`}
                      onClick={() => handleTemplateSelect(templateUrl)}
                    >
                      <img src={templateUrl} alt={`Template ${index + 1}`} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="divider">
                <span>OR</span>
              </div>

              <div className="upload-options">
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
                  value={profilePicture}
                  onChange={handleImageUrlChange}
                  className="url-input"
                />
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToStep1}>
                ← Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={!connected || loading}>
                {loading ? 'Creating Account...' : 'Create Account ✨'}
              </button>
            </div>
          </form>
        )}

        <div className="login-features">
          <div className="feature">💬 Real-time Chat</div>
          <div className="feature">🎵 YouTube Sync</div>
          <div className="feature">🎨 Collaborative Drawing</div>
        </div>
      </div>
    </div>
  );
}

export default Login;
