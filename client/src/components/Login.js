import React, { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faArrowRight,
  faCheckCircle,
  faComments,
  faImage,
  faKey,
  faMusic,
  faPalette,
  faRocket,
  faTriangleExclamation,
  faUserAstronaut,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { cropAndResizeToSquareDataUrl, readFileAsDataUrl } from '../utils/imageUtils';
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

function Login({ onLogin, inviteRoomId }) {
  const { socket, connected, registerUser } = useSocket();
  const [mode, setMode] = useState('choose'); // 'choose', 'guest', 'login', 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [toast, setToast] = useState(null);
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [profilePicture, setProfilePicture] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [step, setStep] = useState(1); // For signup: 1: basic info, 2: profile picture
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const apiBase = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

  useEffect(() => {
    // Handle email verification + password reset links
    try {
      const params = new URLSearchParams(window.location.search);
      const vt = params.get('verifyToken');
      const rt = params.get('resetToken');
      const verified = params.get('verified');

      if (vt) {
        setVerifyToken(vt);
        setMode('verify');
      } else if (rt) {
        setResetToken(rt);
        setMode('reset');
      } else if (verified === '1') {
        setToast({ type: 'success', message: 'Email verified! You can now log in.' });
        // Clean URL so refresh doesn't show the toast again
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    async function runVerify() {
      if (mode !== 'verify' || !verifyToken) return;
      setError('');
      setInfo('Verifying your email…');
      setLoading(true);

      try {
        const res = await fetch(`${apiBase}/api/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: verifyToken })
        });
        const data = await res.json();
        if (data.success) {
          setInfo('✅ Email verified. You can now log in.');
          // Clean URL
          window.history.replaceState({}, document.title, window.location.pathname);
          setMode('login');
          setVerifyToken('');
        } else {
          setInfo('');
          setError(data.error || 'Verification failed');
        }
      } catch (e) {
        setInfo('');
        setError('Verification failed. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    runVerify();
  }, [mode, verifyToken, apiBase]);

  // Helper to save session and call onLogin
  const saveSessionAndLogin = (userData) => {
    const sessionData = {
      user: userData,
      timestamp: Date.now()
    };
    localStorage.setItem('hangout_session', JSON.stringify(sessionData));
    // Ensure server maps this socket to the logged-in user (no duplicates)
    registerUser?.(userData);
    onLogin(userData);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size >= 5000000) {
      alert('Image must be less than 5MB');
      return;
    }

    setError('');
    setInfo('Processing profile picture…');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const resized = await cropAndResizeToSquareDataUrl({
        dataUrl,
        maxSize: 512,
        zoom: 1,
        panX: 0,
        panY: 0,
        outputType: 'image/jpeg',
        quality: 0.86
      });
      setProfilePicture(resized);
      setImagePreview(resized);
      setSelectedTemplate(null);
      setInfo('');
    } catch {
      setInfo('');
      setError('Failed to process image. Try a different file.');
    } finally {
      try { e.target.value = ''; } catch { /* ignore */ }
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

  // Signup profile picture is auto-cropped/resized on file select.

  const handleNext = (e) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email');
      return;
    }

    setSelectedAvatar('👤'); // Set default avatar
    setError('');
    setInfo('');
    setStep(2);
  };

  const handleBackToModeSelection = () => {
    setMode('choose');
    setError('');
    setInfo('');
    setUsername('');
    setPassword('');
    setEmail('');
    setStep(1);
  };

  const handleBackToStep1 = () => {
    setStep(1);
    setError('');
    setInfo('');
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
      const response = await fetch(`${apiBase}/api/users/guest`, {
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
          const userData = { ...data.user, id: data.user._id, isGuest: true };
          saveSessionAndLogin(userData);
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
      const response = await fetch(`${apiBase}/api/users/login`, {
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
        
        socket.once('registered', (socketData) => {
          console.log('Socket registered with data (login):', socketData);
          const userData = { 
            ...data.user, 
            isGuest: false,
            profilePicture: socketData?.user?.profilePicture || data.user.profilePicture 
          };
          saveSessionAndLogin(userData);
        });
      } else {
        if (data.needsEmailVerification && data.email) {
          setInfo('Please verify your email to log in. You can resend the verification email below.');
          setEmail(data.email);
        }
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
      const response = await fetch(`${apiBase}/api/users/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password,
          avatar: selectedAvatar,
          profilePicture: profilePicture,
          email: String(email || '').trim().toLowerCase()
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setInfo('✅ Account created! Please check your email for a verification link before logging in.');
        setError('');
        setMode('login');
        setStep(1);
        setPassword('');
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

  const handleResendVerification = async () => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter your email to resend verification');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('Sending verification email…');
    try {
      const res = await fetch(`${apiBase}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = await res.json();
      if (data.success) {
        setInfo('✅ If an account exists for that email, a verification link was sent.');
      } else {
        setInfo('');
        setError(data.error || 'Failed to send verification email');
      }
    } catch (e) {
      setInfo('');
      setError('Failed to send verification email');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('Sending reset email…');
    try {
      const res = await fetch(`${apiBase}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const data = await res.json();
      if (data.success) {
        const baseMsg = '✅ If an account exists, a password reset email was sent.';
        if (data.mailConfigured === false) {
          setInfo(`${baseMsg} (SMTP is not configured on the server; check server logs for the reset link.)`);
        } else {
          setInfo(baseMsg);
        }
      } else {
        setInfo('');
        setError(data.error || 'Failed to request password reset');
      }
    } catch (e2) {
      setInfo('');
      setError('Failed to request password reset');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetToken) {
      setError('Reset token missing');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('Resetting password…');
    try {
      const res = await fetch(`${apiBase}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password })
      });
      const data = await res.json();
      if (data.success) {
        setInfo('✅ Password updated. You can now log in.');
        setError('');
        window.history.replaceState({}, document.title, window.location.pathname);
        setMode('login');
        setResetToken('');
        setPassword('');
      } else {
        setInfo('');
        setError(data.error || 'Reset failed');
      }
    } catch (e3) {
      setInfo('');
      setError('Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell fade-in">
      <div className="login-shell__bg" aria-hidden="true" />

      {toast && (
        <div className={`login-toast ${toast.type === 'success' ? 'is-success' : ''}`} role="status" aria-live="polite">
          <div className="login-toast__icon" aria-hidden="true">
            <FontAwesomeIcon icon={faCheckCircle} />
          </div>
          <div className="login-toast__content">
            <div className="login-toast__title">Success</div>
            <div className="login-toast__message">{toast.message}</div>
          </div>
          <button type="button" className="login-toast__close" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="login-layout" role="main">
        <aside className="login-hero" aria-label="Hangout Bar overview">
          <div className="login-brand">
            <div className="login-brand__mark" aria-hidden="true">
              <span className="login-brand__dot" />
            </div>
            <div className="login-brand__text">
              <div className="login-brand__row">
                <h1 className="login-brand__title">Hangout Bar</h1>
                <span className="login-pill login-pill--accent">Live</span>
              </div>
              <p className="login-brand__subtitle">Chat, watch, draw — all in one room.</p>
            </div>
          </div>

          <div className="login-status" aria-live="polite">
            <span className={`login-status__dot ${connected ? 'is-on' : 'is-off'}`} aria-hidden="true" />
            <span className="login-status__text">{connected ? 'Server online' : 'Connecting to server…'}</span>
            <span className="login-status__sep" aria-hidden="true">•</span>
            <span className="login-status__meta">Secure sign-in + guest mode</span>
          </div>

          <ul className="login-points">
            <li className="login-point">
              <span className="login-point__icon" aria-hidden="true"><FontAwesomeIcon icon={faComments} /></span>
              <div>
                <div className="login-point__title">Real-time chat</div>
                <div className="login-point__desc">Fast messages, reactions, and room updates.</div>
              </div>
            </li>
            <li className="login-point">
              <span className="login-point__icon" aria-hidden="true"><FontAwesomeIcon icon={faMusic} /></span>
              <div>
                <div className="login-point__title">YouTube sync</div>
                <div className="login-point__desc">Watch together with shared controls.</div>
              </div>
            </li>
            <li className="login-point">
              <span className="login-point__icon" aria-hidden="true"><FontAwesomeIcon icon={faPalette} /></span>
              <div>
                <div className="login-point__title">Collaborative drawing</div>
                <div className="login-point__desc">Sketch, doodle, and play mini-games.</div>
              </div>
            </li>
          </ul>

          <div className="login-glass">
            <div className="login-glass__row">
              <div className="login-glass__chip">Rooms</div>
              <div className="login-glass__chip">Friends</div>
              <div className="login-glass__chip">Profiles</div>
              <div className="login-glass__chip">Private</div>
            </div>
            <div className="login-glass__hint">Tip: invite friends with a room link and jump in instantly.</div>
          </div>
        </aside>

        <section className="login-panel" aria-label="Sign in panel">
          <div className="login-card">
            <div className="login-card__header">
              <div className="login-card__eyebrow">Welcome back</div>
              <div className="login-card__title">Choose how you want to enter</div>
              <div className="login-card__subtitle">Guest for quick access, or login to keep your profile.</div>
            </div>

        {inviteRoomId && (
              <div className="invite-notice">
                You were invited to a room. Log in or join as a guest to continue.
              </div>
        )}

        {mode === 'verify' && (
          <div className="login-form">
            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}
            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection} disabled={loading}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setMode('login')} disabled={loading}>
                Go to Login
              </button>
            </div>
          </div>
        )}
        
        {mode === 'choose' && (
          <div className="mode-selection">
            <button className="mode-btn mode-btn--primary" onClick={() => setMode('guest')}>
              <span className="mode-icon" aria-hidden="true"><FontAwesomeIcon icon={faUserAstronaut} /></span>
              <div className="mode-info">
                <h3>Join as Guest</h3>
                <p>Quick access, limited features</p>
              </div>
              <span className="mode-cta" aria-hidden="true"><FontAwesomeIcon icon={faArrowRight} /></span>
            </button>
            
            <button className="mode-btn mode-btn--secondary" onClick={() => setMode('login')}>
              <span className="mode-icon" aria-hidden="true"><FontAwesomeIcon icon={faKey} /></span>
              <div className="mode-info">
                <h3>Login</h3>
                <p>Access your existing account</p>
              </div>
              <span className="mode-cta" aria-hidden="true"><FontAwesomeIcon icon={faArrowRight} /></span>
            </button>
            
            <button className="mode-btn mode-btn--success" onClick={() => setMode('signup')}>
              <span className="mode-icon" aria-hidden="true"><FontAwesomeIcon icon={faWandMagicSparkles} /></span>
              <div className="mode-info">
                <h3>Create Account</h3>
                <p>Full features, save your profile</p>
              </div>
              <span className="mode-cta" aria-hidden="true"><FontAwesomeIcon icon={faArrowRight} /></span>
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
              <p className="helper-text"><FontAwesomeIcon icon={faTriangleExclamation} /> Guest accounts can't add friends or view profiles</p>
            </div>

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Joining...' : (<><FontAwesomeIcon icon={faRocket} /> Join as Guest</>)}
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

            <div className="login-row">
              <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>
                Forgot password?
              </button>
            </div>

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Logging in...' : (<><FontAwesomeIcon icon={faKey} /> Login</>)}
              </button>
            </div>

            {!!email && error && error.toLowerCase().includes('verify') && (
              <div className="button-group">
                <button type="button" className="btn btn-secondary" onClick={handleResendVerification} disabled={loading}>
                  Resend verification email
                </button>
              </div>
            )}

            <p className="switch-mode">
              Don't have an account? <button type="button" onClick={() => setMode('signup')}>Create one</button>
            </p>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="helper-text">We’ll email you a reset link if an account exists.</p>
            </div>

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={() => setMode('login')} disabled={loading}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} className="login-form">
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
              />
            </div>

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={() => setMode('login')} disabled={loading}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </form>
        )}

        {mode === 'signup' && step === 1 && (
          <form onSubmit={handleNext} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <p className="helper-text">You’ll verify this email before logging in.</p>
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

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToModeSelection}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <>Next: Profile Picture <FontAwesomeIcon icon={faArrowRight} /></>
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
                  <FontAwesomeIcon icon={faImage} /> Upload Image
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

            {info && <div className="info-message">{info}</div>}
            {error && <div className="error-message">{error}</div>}

            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={handleBackToStep1}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Creating Account...' : (<><FontAwesomeIcon icon={faWandMagicSparkles} /> Create Account</>)}
              </button>
            </div>
          </form>
        )}

            <div className="login-footer">
              <div className="login-footer__item"><FontAwesomeIcon icon={faComments} /> Real-time Chat</div>
              <div className="login-footer__item"><FontAwesomeIcon icon={faMusic} /> YouTube Sync</div>
              <div className="login-footer__item"><FontAwesomeIcon icon={faPalette} /> Collaborative Drawing</div>
            </div>
          </div>
        </section>
      </div>

    </div>
  );
}

export default Login;
