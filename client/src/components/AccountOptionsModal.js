import React, { useEffect, useMemo, useState } from 'react';
import { cropAndResizeToSquareDataUrl, readFileAsDataUrl } from '../utils/imageUtils';
import './AccountOptionsModal.css';

const RESEND_VERIFY_COOLDOWN_MS = 2 * 60 * 1000;

function AccountOptionsModal({ open, onClose, currentUser, onUserUpdated }) {
  const apiBase = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
  const userId = currentUser?.id || currentUser?._id;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [isProcessingProfilePic, setIsProcessingProfilePic] = useState(false);

  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (!resendAvailableAt) return;
    if (Date.now() >= resendAvailableAt) return;

    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [open, resendAvailableAt]);

  const resendRemainingMs = resendAvailableAt ? Math.max(0, resendAvailableAt - Date.now()) : 0;
  const resendRemainingSec = Math.ceil(resendRemainingMs / 1000);
  const resendRemainingLabel = resendRemainingSec > 0
    ? `${String(Math.floor(resendRemainingSec / 60)).padStart(2, '0')}:${String(resendRemainingSec % 60).padStart(2, '0')}`
    : '';

  const resendVerification = async () => {
    resetMessages();
    if (!userId || isGuest) return;
    if (Date.now() < resendAvailableAt) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(userId)}/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Failed to resend verification email');
        return;
      }
      if (data.sent === false) {
        setSuccess(data.message || 'Email already verified');
        return;
      }
      if (data.mailConfigured === false) {
        setSuccess('SMTP is not configured on the server. Check server logs for the verification link.');
        return;
      }
      setSuccess('Verification email sent');

      setResendAvailableAt(Date.now() + RESEND_VERIFY_COOLDOWN_MS);
    } catch {
      setError('Failed to resend verification email');
    } finally {
      setSaving(false);
    }
  };

  const isGuest = !!currentUser?.isGuest;

  const canSubmit = useMemo(() => !!userId && !saving && !isGuest, [userId, saving, isGuest]);

  if (!open) return null;

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const submitChangeEmail = async () => {
    resetMessages();
    if (!canSubmit) return;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter a new email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email');
      return;
    }
    if (!emailPassword) {
      setError('Enter your password to change email');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(userId)}/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password: emailPassword })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Failed to change email');
        return;
      }

      // The server automatically sends a verification email on update.
      if (data?.mailConfigured === false || data?.mailSkipped) {
        setSuccess('Email updated. SMTP is not configured on the server; check server logs for the verification link.');
      } else if (data?.mailOk === false) {
        setSuccess('Email updated. Verification email failed to send; try resending in 2 minutes.');
      } else {
        setSuccess('Email updated. Verification email sent.');
      }

      setResendAvailableAt(Date.now() + RESEND_VERIFY_COOLDOWN_MS);
      setEmail('');
      setEmailPassword('');
      if (typeof onUserUpdated === 'function') {
        onUserUpdated({ ...currentUser, isEmailVerified: false });
      }
    } catch {
      setError('Failed to change email');
    } finally {
      setSaving(false);
    }
  };

  const submitChangePassword = async () => {
    resetMessages();
    if (!canSubmit) return;
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }
    if (!newPassword || String(newPassword).length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(userId)}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (data?.needsEmailVerification) {
          if (data?.mailConfigured === false) {
            setError('Please verify your email before changing your password. SMTP is not configured; check server logs for the verification link.');
          } else {
            setError('Please verify your email before changing your password.');
          }
        } else {
          setError(data?.error || 'Failed to change password');
        }
        return;
      }
      setSuccess('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const submitProfilePictureUrl = async () => {
    resetMessages();
    if (!canSubmit) return;
    const url = String(profilePictureUrl || '').trim();
    if (!url) {
      setError('Enter an image URL');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar: currentUser?.avatar,
          bio: currentUser?.bio,
          profilePicture: url
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error || 'Failed to update profile picture');
        return;
      }

      setSuccess('Profile picture updated');
      setProfilePictureUrl('');
      onUserUpdated?.({
        ...currentUser,
        profilePicture: data?.profilePicture ?? url
      });
    } catch {
      setError('Failed to update profile picture');
    } finally {
      setSaving(false);
    }
  };

  const onChooseFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    resetMessages();
    if (!canSubmit) return;

    setIsProcessingProfilePic(true);
    setSaving(true);
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

      const res = await fetch(`${apiBase}/api/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar: currentUser?.avatar,
          bio: currentUser?.bio,
          profilePicture: resized
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error || 'Failed to update profile picture');
        return;
      }

      setSuccess('Profile picture updated');
      onUserUpdated?.({
        ...currentUser,
        profilePicture: data?.profilePicture ?? resized
      });
    } catch {
      setError('Failed to process/update profile picture');
    } finally {
      setSaving(false);
      setIsProcessingProfilePic(false);
      try { e.target.value = ''; } catch { /* ignore */ }
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content card account-modal" onClick={(e) => e.stopPropagation()}>
          <div className="account-modal__header">
            <h2>Account options</h2>
            <button className="btn btn-secondary" onClick={onClose} type="button">Close</button>
          </div>

          {isGuest ? (
            <div className="account-modal__notice">
              Guest accounts can’t change email/password. Create a permanent account to use these options.
            </div>
          ) : null}

          {error ? <div className="account-modal__error">{error}</div> : null}
          {success ? <div className="account-modal__success">{success}</div> : null}

          <div className="account-modal__section">
            <h3>Change profile picture</h3>
            <div className="account-modal__row">
              <input
                className="account-modal__input"
                type="url"
                placeholder="Paste image URL"
                value={profilePictureUrl}
                onChange={(e) => setProfilePictureUrl(e.target.value)}
                disabled={!canSubmit}
              />
              <button className="btn btn-primary" type="button" onClick={submitProfilePictureUrl} disabled={!canSubmit}>
                Save URL
              </button>
            </div>

            <div className="account-modal__row">
              <input type="file" accept="image/*" onChange={onChooseFile} disabled={!canSubmit || isProcessingProfilePic} />
              <div className="account-modal__hint">Auto crops/resizes to 512×512.</div>
            </div>
          </div>

          <div className="account-modal__section">
            <h3>Change email</h3>
            <div className="account-modal__row">
              <input
                className="account-modal__input"
                type="email"
                placeholder="New email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!canSubmit}
              />
            </div>
            <div className="account-modal__row">
              <input
                className="account-modal__input"
                type="password"
                placeholder="Current password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                disabled={!canSubmit}
              />
              <button className="btn btn-primary" type="button" onClick={submitChangeEmail} disabled={!canSubmit}>
                Update Email
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={resendVerification}
                disabled={!canSubmit || resendRemainingSec > 0}
                title={resendRemainingSec > 0 ? `You can resend in ${resendRemainingLabel}` : 'Resend verification email'}
              >
                {resendRemainingSec > 0 ? `Resend in ${resendRemainingLabel}` : 'Resend Verify Email'}
              </button>
            </div>
          </div>

          <div className="account-modal__section">
            <h3>Change password</h3>
            <div className="account-modal__row">
              <input
                className="account-modal__input"
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={!canSubmit}
              />
            </div>
            <div className="account-modal__row">
              <input
                className="account-modal__input"
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={!canSubmit}
              />
              <input
                className="account-modal__input"
                type="password"
                placeholder="Confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={!canSubmit}
              />
              <button className="btn btn-primary" type="button" onClick={submitChangePassword} disabled={!canSubmit}>
                Update Password
              </button>
            </div>
          </div>
        </div>
      </div>

    </>
  );
}

export default AccountOptionsModal;
