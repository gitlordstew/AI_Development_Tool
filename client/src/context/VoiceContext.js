import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext';

const VoiceContext = createContext(null);

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within a VoiceProvider');
  return ctx;
}

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const SPEAKING_START_THRESHOLD = 0.035;
const SPEAKING_STOP_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 300;
const SPEAKING_POLL_MS = 100;

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    if (value.toString) return value.toString();
  }
  return String(value);
}

function getMutedUserIds(currentUserId) {
  if (!currentUserId) return new Set();
  try {
    const raw = localStorage.getItem(`hangout_muted_users_${currentUserId}`);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(ids) ? ids : []).map(String));
  } catch {
    return new Set();
  }
}

export function VoiceProvider({ children }) {
  const { socket } = useSocket();

  const [joined, setJoined] = useState(false);
  const [channelId, setChannelId] = useState(null);
  const [selfState, setSelfState] = useState({ muted: false, deafened: false });

  const [voiceUsers, setVoiceUsers] = useState({}); // userId -> { user, state }
  const [remoteStreams, setRemoteStreams] = useState({}); // userId -> MediaStream
  const [speakingByUserId, setSpeakingByUserId] = useState({}); // userId -> boolean

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map()); // userId -> RTCPeerConnection
  const myUserIdRef = useRef(null);
  const mutedUsersRef = useRef(new Set());
  const channelIdRef = useRef(null);
  const selfStateRef = useRef(selfState);
  const voiceUsersRef = useRef(voiceUsers);

  const audioRefs = useRef({}); // userId -> HTMLAudioElement

  const audioContextRef = useRef(null);
  const analyserByUserIdRef = useRef(new Map()); // userId -> { source, analyser, data, streamId }
  const lastSpokeAtRef = useRef({}); // userId -> timestamp

  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  useEffect(() => {
    selfStateRef.current = selfState;
  }, [selfState]);

  useEffect(() => {
    voiceUsersRef.current = voiceUsers;
  }, [voiceUsers]);

  const ensureAudioContext = useCallback(async () => {
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      } catch {
        // ignore
      }
      return audioContextRef.current;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    try {
      const ctx = new Ctx();
      audioContextRef.current = ctx;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        // ignore
      }
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const cleanupAudioAnalysis = useCallback(async () => {
    analyserByUserIdRef.current.forEach((node) => {
      try { node?.source?.disconnect?.(); } catch {}
      try { node?.analyser?.disconnect?.(); } catch {}
    });
    analyserByUserIdRef.current.clear();
    lastSpokeAtRef.current = {};

    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }

    setSpeakingByUserId({});
  }, []);

  const ensureAnalyserForStream = useCallback(async (userId, stream) => {
    const uid = String(userId || '').trim();
    if (!uid || !stream) return;
    const ctx = await ensureAudioContext();
    if (!ctx) return;

    const streamId = String(stream?.id || '');
    const existing = analyserByUserIdRef.current.get(uid);
    if (existing && existing.streamId === streamId) return;

    if (existing) {
      try { existing?.source?.disconnect?.(); } catch {}
      try { existing?.analyser?.disconnect?.(); } catch {}
      analyserByUserIdRef.current.delete(uid);
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      analyserByUserIdRef.current.set(uid, { source, analyser, data, streamId });
    } catch {
      // ignore
    }
  }, [ensureAudioContext]);

  const applyRemoteAudioRouting = useCallback((override = {}) => {
    const myId = myUserIdRef.current;
    const mutedUsers = getMutedUserIds(myId);
    mutedUsersRef.current = mutedUsers;

    const deafened = override.deafened ?? selfStateRef.current?.deafened;

    Object.entries(audioRefs.current).forEach(([uid, el]) => {
      if (!el) return;
      // Deafen mutes all remote audio for this client.
      const shouldMuteAll = !!deafened;
      const shouldMuteUser = mutedUsers.has(String(uid));
      el.muted = shouldMuteAll || shouldMuteUser;
      el.volume = 1;
    });
  }, []);

  const setLocalTrackEnabled = useCallback((enabled) => {
    try {
      const stream = localStreamRef.current;
      const tracks = stream?.getAudioTracks?.() || [];
      tracks.forEach(t => { t.enabled = !!enabled; });
    } catch {
      // ignore
    }
  }, []);

  const closePeer = useCallback((userId) => {
    const pc = peersRef.current.get(userId);
    if (pc) {
      try { pc.onicecandidate = null; } catch {}
      try { pc.ontrack = null; } catch {}
      try { pc.onconnectionstatechange = null; } catch {}
      try { pc.close(); } catch {}
    }
    peersRef.current.delete(userId);

    const uid = String(userId || '').trim();
    if (uid) {
      const node = analyserByUserIdRef.current.get(uid);
      if (node) {
        try { node?.source?.disconnect?.(); } catch {}
        try { node?.analyser?.disconnect?.(); } catch {}
        analyserByUserIdRef.current.delete(uid);
      }
      try { delete lastSpokeAtRef.current[uid]; } catch {}
      setSpeakingByUserId(prev => {
        if (!prev?.[uid]) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }

    setRemoteStreams(prev => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });

    setVoiceUsers(prev => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const ensurePeer = useCallback(async (remoteUserId, { shouldCreateOffer } = {}) => {
    if (!socket) return null;
    if (!remoteUserId) return null;
    if (peersRef.current.has(remoteUserId)) return peersRef.current.get(remoteUserId);

    const pc = new RTCPeerConnection(DEFAULT_RTC_CONFIG);
    peersRef.current.set(remoteUserId, pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('voice:signal', {
        channelId: channelIdRef.current,
        toUserId: remoteUserId,
        candidate: event.candidate
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      setRemoteStreams(prev => ({ ...prev, [remoteUserId]: stream }));
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        closePeer(remoteUserId);
      }
    };

    // Add local tracks.
    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) {
        try { pc.addTrack(track, localStream); } catch { /* ignore */ }
      }
    }

    if (shouldCreateOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:signal', {
          channelId: channelIdRef.current,
          toUserId: remoteUserId,
          description: pc.localDescription
        });
      } catch {
        // ignore
      }
    }

    return pc;
  }, [socket, closePeer]);

  const startLocalAudio = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;

    // Apply current mute state to the track.
    setLocalTrackEnabled(!selfStateRef.current?.muted);
    return stream;
  }, [setLocalTrackEnabled]);

  const stopLocalAudio = useCallback(() => {
    try {
      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach(t => {
          try { t.stop(); } catch {}
        });
      }
    } catch {
      // ignore
    }
    localStreamRef.current = null;
  }, []);

  const joinVoice = useCallback(async ({ channelId: nextChannelId, currentUser }) => {
    if (!socket || !socket.connected) throw new Error('Not connected to server');
    const id = String(nextChannelId || '').trim();
    if (!id) throw new Error('Missing channel');

    const myId = normalizeId(currentUser?.id || currentUser?._id || currentUser?.token);
    if (!myId) throw new Error('Missing user');
    myUserIdRef.current = myId;

    await startLocalAudio();
    // Start speaking detection for self as soon as mic permission is granted.
    try {
      const local = localStreamRef.current;
      if (local) await ensureAnalyserForStream(myId, local);
    } catch {
      // ignore
    }

    return new Promise((resolve, reject) => {
      let didFinish = false;
      const timeout = setTimeout(() => {
        if (didFinish) return;
        didFinish = true;
        reject(new Error('Voice join timed out. Please try again.'));
      }, 6000);

      socket.emit('voice:join', {
        channelId: id,
        state: { muted: !!selfStateRef.current?.muted, deafened: !!selfStateRef.current?.deafened }
      }, async (res) => {
        if (didFinish) return;
        didFinish = true;
        clearTimeout(timeout);
        if (!res?.ok) {
          reject(new Error(res?.message || 'Failed to join voice'));
          return;
        }

        setChannelId(id);
        channelIdRef.current = id;
        setJoined(true);

        const nextUsers = {};
        (Array.isArray(res.peers) ? res.peers : []).forEach(p => {
          if (!p?.userId) return;
          nextUsers[String(p.userId)] = { user: p.user || null, state: p.state || { muted: false, deafened: false } };
        });
        nextUsers[String(myId)] = { user: res.selfUser || currentUser || null, state: res.selfState || selfStateRef.current };
        setVoiceUsers(nextUsers);

        // Deterministic offer creation to avoid collisions.
        for (const peer of (Array.isArray(res.peers) ? res.peers : [])) {
          const remoteId = String(peer.userId);
          if (!remoteId || remoteId === String(myId)) continue;
          const shouldOffer = String(myId) < String(remoteId);
          await ensurePeer(remoteId, { shouldCreateOffer: shouldOffer });
        }

        applyRemoteAudioRouting();
        resolve(res);
      });
    });
  }, [socket, ensurePeer, applyRemoteAudioRouting, startLocalAudio, ensureAnalyserForStream]);

  const leaveVoice = useCallback(() => {
    if (!socket) return;

    try {
      socket.emit('voice:leave', { channelId: channelIdRef.current });
    } catch { /* ignore */ }

    peersRef.current.forEach((_, uid) => closePeer(uid));
    peersRef.current.clear();
    stopLocalAudio();

    setRemoteStreams({});
    setVoiceUsers({});
    setJoined(false);
    setChannelId(null);
    channelIdRef.current = null;

    cleanupAudioAnalysis();
  }, [socket, closePeer, stopLocalAudio, cleanupAudioAnalysis]);

  const toggleMute = useCallback(() => {
    setSelfState(prev => {
      const next = { ...prev, muted: !prev.muted };
      setLocalTrackEnabled(!next.muted);
      try { socket?.emit('voice:state', { channelId: channelIdRef.current, muted: next.muted, deafened: next.deafened }); } catch {}
      return next;
    });
  }, [socket, setLocalTrackEnabled]);

  const toggleDeafen = useCallback(() => {
    setSelfState(prev => {
      const next = { ...prev, deafened: !prev.deafened };
      applyRemoteAudioRouting({ deafened: next.deafened });
      try { socket?.emit('voice:state', { channelId: channelIdRef.current, muted: next.muted, deafened: next.deafened }); } catch {}
      return next;
    });
  }, [socket, applyRemoteAudioRouting]);

  useEffect(() => {
    if (!socket) return;

    const onPeerJoined = async ({ userId, user, state }) => {
      if (!userId) return;
      setVoiceUsers(prev => ({ ...prev, [String(userId)]: { user: user || null, state: state || { muted: false, deafened: false } } }));

      const myId = myUserIdRef.current;
      const shouldOffer = myId && String(myId) < String(userId);
      await ensurePeer(String(userId), { shouldCreateOffer: !!shouldOffer });
    };

    const onPeerLeft = ({ userId }) => {
      if (!userId) return;
      closePeer(String(userId));
    };

    const onSignal = async ({ fromUserId, description, candidate }) => {
      const remoteId = String(fromUserId || '').trim();
      if (!remoteId) return;
      const pc = await ensurePeer(remoteId, { shouldCreateOffer: false });
      if (!pc) return;

      try {
        if (description) {
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice:signal', {
              channelId: channelIdRef.current,
              toUserId: remoteId,
              description: pc.localDescription
            });
          }
        } else if (candidate) {
          await pc.addIceCandidate(candidate);
        }
      } catch {
        // ignore
      }
    };

    const onState = ({ userId, muted, deafened }) => {
      if (!userId) return;
      setVoiceUsers(prev => {
        const existing = prev[String(userId)] || { user: null, state: {} };
        return {
          ...prev,
          [String(userId)]: {
            ...existing,
            state: { ...existing.state, muted: !!muted, deafened: !!deafened }
          }
        };
      });
    };

    socket.on('voice:peer-joined', onPeerJoined);
    socket.on('voice:peer-left', onPeerLeft);
    socket.on('voice:signal', onSignal);
    socket.on('voice:state', onState);

    return () => {
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('voice:peer-left', onPeerLeft);
      socket.off('voice:signal', onSignal);
      socket.off('voice:state', onState);
    };
  }, [socket, ensurePeer, closePeer]);

  useEffect(() => {
    const handler = () => applyRemoteAudioRouting();
    window.addEventListener('storage', handler);
    window.addEventListener('hangout:mutedUsersChanged', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('hangout:mutedUsersChanged', handler);
    };
  }, [applyRemoteAudioRouting]);

  useEffect(() => {
    applyRemoteAudioRouting();
  }, [applyRemoteAudioRouting, remoteStreams]);

  useEffect(() => {
    if (!joined) return;

    // Ensure analysers exist for all active streams.
    const entries = Object.entries(remoteStreams);
    entries.forEach(([uid, stream]) => {
      ensureAnalyserForStream(uid, stream);
    });

    // Also ensure self is tracked.
    const myId = myUserIdRef.current;
    const local = localStreamRef.current;
    if (myId && local) ensureAnalyserForStream(myId, local);
  }, [joined, remoteStreams, ensureAnalyserForStream]);

  useEffect(() => {
    if (!joined) return;

    let stopped = false;
    const interval = setInterval(() => {
      if (stopped) return;
      const now = Date.now();
      const active = new Set();

      setSpeakingByUserId((prev) => {
        let changed = false;
        const next = { ...prev };

        analyserByUserIdRef.current.forEach((node, uid) => {
          active.add(uid);

          const isSelf = String(uid) === String(myUserIdRef.current);
          const userState = voiceUsersRef.current?.[uid]?.state || {};
          const muted = isSelf ? !!selfStateRef.current?.muted : !!userState?.muted;

          const prevSpeaking = !!prev?.[uid];
          if (muted) {
            if (prevSpeaking) {
              delete next[uid];
              changed = true;
            }
            return;
          }

          try {
            node.analyser.getByteTimeDomainData(node.data);
            let sum = 0;
            for (let i = 0; i < node.data.length; i++) {
              const v = (node.data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / node.data.length);

            let speaking = false;
            const last = lastSpokeAtRef.current[uid] || 0;

            if (!prevSpeaking) {
              if (rms > SPEAKING_START_THRESHOLD) {
                speaking = true;
                lastSpokeAtRef.current[uid] = now;
              }
            } else {
              if (rms > SPEAKING_STOP_THRESHOLD) {
                speaking = true;
                lastSpokeAtRef.current[uid] = now;
              } else {
                speaking = (now - last) < SPEAKING_HOLD_MS;
              }
            }

            if (speaking !== prevSpeaking) {
              if (speaking) next[uid] = true;
              else delete next[uid];
              changed = true;
            }
          } catch {
            // ignore
          }
        });

        // Remove stale keys for users no longer tracked.
        Object.keys(next).forEach((uid) => {
          if (!active.has(uid)) {
            delete next[uid];
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, SPEAKING_POLL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [joined]);

  useEffect(() => {
    // Cleanup analysis on unmount.
    return () => {
      cleanupAudioAnalysis();
    };
  }, [cleanupAudioAnalysis]);

  const voiceStatesByUserId = useMemo(() => {
    const out = {};
    Object.entries(voiceUsers).forEach(([uid, v]) => {
      out[uid] = v?.state || { muted: false, deafened: false };
    });
    return out;
  }, [voiceUsers]);

  const ctxValue = useMemo(() => ({
    joined,
    channelId,
    selfState,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    voiceUsers,
    voiceStatesByUserId,
    speakingByUserId
  }), [joined, channelId, selfState, joinVoice, leaveVoice, toggleMute, toggleDeafen, voiceUsers, voiceStatesByUserId, speakingByUserId]);

  return (
    <VoiceContext.Provider value={ctxValue}>
      {children}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        {Object.entries(remoteStreams).map(([uid, stream]) => (
          <audio
            key={uid}
            ref={(el) => {
              audioRefs.current[uid] = el;
              if (el && stream) {
                try { el.srcObject = stream; } catch { /* ignore */ }
              }
            }}
            autoPlay
            playsInline
            // muted is controlled by applyRemoteAudioRouting
          />
        ))}
      </div>
    </VoiceContext.Provider>
  );
}
