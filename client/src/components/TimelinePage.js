import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faComments,
  faClock,
  faCheck,
  faFire,
  faLock,
  faNewspaper,
  faUserPlus,
  faUserGroup,
  faXmark
} from '@fortawesome/free-solid-svg-icons';
import './TimelinePage.css';

function TimelinePage({ currentUser, targetUserId, onBack, onNavigateToUser, backLabel = 'Back' }) {
  const { socket } = useSocket();
  const [loading, setLoading] = useState(true);
  const [canViewTimeline, setCanViewTimeline] = useState(false);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [friends, setFriends] = useState([]);
  const [error, setError] = useState('');
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);
  const [expandedPostIds, setExpandedPostIds] = useState(() => new Set());
  const [commentDrafts, setCommentDrafts] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({}); // key: commentId => text
  const [replyingTo, setReplyingTo] = useState(null); // { postId, commentId, userId, username }
  const commentInputRefs = useRef({}); // postId => input
  const replyInputRefs = useRef({}); // commentId => input
  const [mentionPicker, setMentionPicker] = useState({
    open: false,
    field: null, // 'comment' | 'reply'
    postId: null,
    commentId: null,
    startIndex: 0,
    caret: 0,
    query: '',
    index: 0
  });

  const resolvedTargetUserId = useMemo(() => String(targetUserId || '').trim(), [targetUserId]);
  const myUserId = currentUser?.id || currentUser?._id || currentUser?.token;

  const [friendRequestStatus, setFriendRequestStatus] = useState(null); // null | 'sending' | 'success'
  const [requestSent, setRequestSent] = useState(false);

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

  const isSelf = !!myUserId && String(myUserId) === String(resolvedTargetUserId);
  const isCurrentUserGuest = !!currentUser?.isGuest;
  const targetIsGuest = !!profile?.isGuest || (typeof profile?.username === 'string' && profile.username.startsWith('Guest_'));
  const pendingRequestFromMe = !!myUserId && Array.isArray(profile?.friendRequests) && profile.friendRequests.some(r => normalizeId(r?.from) === String(myUserId));
  const targetBlockedMe = !!myUserId && Array.isArray(profile?.blockedUsers) && profile.blockedUsers.some(b => normalizeId(b) === String(myUserId));

  useEffect(() => {
    if (!profile) return;
    setRequestSent(!!pendingRequestFromMe);
  }, [profile, pendingRequestFromMe]);

  useEffect(() => {
    if (!socket) return;

    const handleSuccess = () => {
      setFriendRequestStatus('success');
      setRequestSent(true);
    };

    const handleError = ({ message }) => {
      setFriendRequestStatus(null);
      alert(message || 'Failed to send friend request');
    };

    socket.on('friendRequestSuccess', handleSuccess);
    socket.on('friendRequestError', handleError);
    return () => {
      socket.off('friendRequestSuccess', handleSuccess);
      socket.off('friendRequestError', handleError);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    if (!resolvedTargetUserId) return;

    setLoading(true);
    setError('');

    socket.emit('getUserTimeline', { userId: resolvedTargetUserId }, (res) => {
      if (!res?.ok) {
        setCanViewTimeline(false);
        setProfile(null);
        setPosts([]);
        setFriends([]);
        setError(res?.message || 'Failed to load timeline');
        setLoading(false);
        return;
      }

      setCanViewTimeline(!!res.canViewTimeline);
      setProfile(res.user || null);
      setPosts(Array.isArray(res.posts) ? res.posts : []);
      setFriends(Array.isArray(res.friends) ? res.friends : []);
      setFriendRequestStatus(null);
      setLoading(false);
    });
  }, [socket, resolvedTargetUserId]);

  const handleSendFriendRequest = () => {
    if (!socket) {
      alert('Not connected to server. Please try again.');
      return;
    }
    if (!socket.connected) {
      alert('Not connected to server. Please refresh and try again.');
      return;
    }
    if (!resolvedTargetUserId || isSelf) return;
    if (isCurrentUserGuest) {
      alert('Guest accounts cannot add friends.');
      return;
    }
    if (targetIsGuest) {
      alert('Guest accounts cannot be added as friends.');
      return;
    }
    if (targetBlockedMe) {
      alert('Cannot send a request to this user.');
      return;
    }
    if (canViewTimeline || requestSent) return;

    setFriendRequestStatus('sending');
    socket.emit('sendFriendRequest', { targetUserId: resolvedTargetUserId });

    setTimeout(() => {
      setFriendRequestStatus((prev) => {
        if (prev === 'sending') {
          alert('Request timed out. Please try again.');
          return null;
        }
        return prev;
      });
    }, 5000);
  };

  useEffect(() => {
    if (!socket) return;

    const handleUpdated = (post) => {
      if (!post?.id) return;
      // Keep timeline in sync for the currently viewed user.
      if (String(post.authorId || '') !== String(resolvedTargetUserId || '')) return;
      setPosts(prev => {
        const idx = prev.findIndex(p => String(p?.id) === String(post.id));
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...post };
        return next;
      });
    };

    const handleNew = (post) => {
      if (!post?.id) return;
      if (String(post.authorId || '') !== String(resolvedTargetUserId || '')) return;
      setPosts(prev => {
        if (prev.some(p => String(p?.id) === String(post.id))) return prev;
        return [post, ...prev];
      });
    };

    socket.on('feedPostUpdated', handleUpdated);
    socket.on('newsFeedPost', handleNew);

    return () => {
      socket.off('feedPostUpdated', handleUpdated);
      socket.off('newsFeedPost', handleNew);
    };
  }, [socket, resolvedTargetUserId]);

  const displayName = profile?.username || 'Timeline';
  const friendCount = typeof profile?.friends?.length === 'number' ? profile.friends.length : friends.length;
  const topFriends = friends.slice(0, 5);

  const showAddFriendButton = !loading && !!profile && !isSelf && !canViewTimeline && !targetBlockedMe;
  const addFriendDisabled = isCurrentUserGuest || targetIsGuest || requestSent || friendRequestStatus === 'sending';
  const addFriendLabel = requestSent
    ? 'Sent'
    : friendRequestStatus === 'sending'
      ? '…'
      : 'Add';

  const togglePostExpanded = (postId) => {
    setExpandedPostIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const handleReactFire = (postId) => {
    if (!socket || !canViewTimeline) return;
    socket.emit('toggleFeedReaction', { postId, type: 'fire' });
  };

  const handleAddComment = (postId, e) => {
    e.preventDefault();
    if (!socket || !canViewTimeline) return;
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
    setTimeout(() => {
      try { replyInputRefs.current?.[commentId]?.focus?.(); } catch { /* ignore */ }
    }, 50);
  };

  const handleSendReply = (postId, e) => {
    e.preventDefault();
    if (!socket || !canViewTimeline || !replyingTo) return;
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

  const findActiveMention = (value, caret) => {
    const text = String(value || '');
    const pos = Math.max(0, Math.min(Number(caret) || 0, text.length));

    let i = pos - 1;
    while (i >= 0 && !/\s/.test(text[i])) i -= 1;
    const tokenStart = i + 1;
    if (text[tokenStart] !== '@') return null;
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

  const renderCommentText = (text) => {
    const raw = String(text || '');
    const parts = raw.split(/(\s+)/);
    return parts.map((p, idx) => {
      const m = /^@([A-Za-z0-9_]{2,30})\b/.exec(p);
      if (!m) return <React.Fragment key={idx}>{p}</React.Fragment>;
      return <span key={idx} className="mention">{p}</span>;
    });
  };

  useEffect(() => {
    const prev = document.title;
    document.title = `Timeline • ${displayName}`;
    return () => {
      document.title = prev;
    };
  }, [displayName]);

  return (
    <div className="timeline-page">
      {friendsModalOpen ? (
        <div className="timeline-modal-overlay" onClick={() => setFriendsModalOpen(false)} role="dialog" aria-modal="true">
          <div className="timeline-modal card" onClick={(e) => e.stopPropagation()}>
            <div className="timeline-modal__header">
              <div className="timeline-modal__title">
                <FontAwesomeIcon icon={faUserGroup} /> {displayName}'s Friends
              </div>
              <button
                type="button"
                className="timeline-modal__close"
                onClick={() => setFriendsModalOpen(false)}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="timeline-modal__body">
              {friends.length === 0 ? (
                <div className="timeline-muted">No friends to show</div>
              ) : (
                <div className="timeline-modal__list">
                  {friends.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="timeline-friend timeline-friend--full"
                      onClick={() => {
                        setFriendsModalOpen(false);
                        if (typeof onNavigateToUser === 'function') onNavigateToUser(f.id);
                      }}
                      title={`View ${f.username}'s timeline`}
                    >
                      {f.profilePicture ? (
                        <img src={f.profilePicture} alt="" className="timeline-friend__avatar" />
                      ) : (
                        <span className="timeline-friend__avatar">{f.avatar || '👤'}</span>
                      )}
                      <span className="timeline-friend__name">{f.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <header className="timeline-header card">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <FontAwesomeIcon icon={faArrowLeft} /> {backLabel}
        </button>

        <div className="timeline-header__title">
          <div className="timeline-title">
            <FontAwesomeIcon icon={faNewspaper} /> {displayName}
          </div>
          <div className="timeline-subtitle">Posts and friends</div>
        </div>

        <div className="timeline-header__me">
          {currentUser?.profilePicture ? (
            <img className="timeline-me-avatar" src={currentUser.profilePicture} alt="" />
          ) : (
            <span className="timeline-me-avatar">{currentUser?.avatar || '👤'}</span>
          )}
        </div>
      </header>

      <div className="timeline-body">
        <aside className="timeline-left">
          <div className="timeline-card card">
            <div className="timeline-profile">
              {profile?.profilePicture ? (
                <img className="timeline-profile__pic" src={profile.profilePicture} alt="" />
              ) : (
                <div className="timeline-profile__avatar">{profile?.avatar || '👤'}</div>
              )}
              <div className="timeline-profile__meta">
                <div className="timeline-profile__nameRow">
                  <div className="timeline-profile__name">{displayName}</div>
                  {showAddFriendButton ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm timeline-add-friend-btn"
                      onClick={handleSendFriendRequest}
                      disabled={addFriendDisabled}
                      title={
                        isCurrentUserGuest
                          ? 'Guests cannot add friends'
                          : targetIsGuest
                            ? 'Cannot add guest accounts'
                            : requestSent
                              ? 'Friend request already sent'
                              : 'Send friend request'
                      }
                    >
                      {requestSent ? (
                        <><FontAwesomeIcon icon={faCheck} /> {addFriendLabel}</>
                      ) : friendRequestStatus === 'sending' ? (
                        <><FontAwesomeIcon icon={faClock} /> {addFriendLabel}</>
                      ) : (
                        <><FontAwesomeIcon icon={faUserPlus} /> {addFriendLabel}</>
                      )}
                    </button>
                  ) : null}
                </div>
                <div className="timeline-profile__stats">
                  <FontAwesomeIcon icon={faUserGroup} /> {friendCount || 0} friends
                </div>
              </div>
            </div>

            {profile?.bio ? <div className="timeline-profile__bio">{profile.bio}</div> : null}
          </div>

          <div className="timeline-card card timeline-card--scroll">
            <div className="timeline-card__header">
              <span><FontAwesomeIcon icon={faUserGroup} /> Friends</span>
              {canViewTimeline && friends.length > 5 ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFriendsModalOpen(true)}>
                  See more
                </button>
              ) : null}
            </div>

            {loading ? (
              <div className="timeline-muted">Loading…</div>
            ) : !canViewTimeline ? (
              <div className="timeline-locked">
                <div className="timeline-locked__icon"><FontAwesomeIcon icon={faLock} /></div>
                <div className="timeline-muted">Friends list is only visible to friends.</div>
              </div>
            ) : friends.length === 0 ? (
              <div className="timeline-muted">No friends to show</div>
            ) : (
              <>
                <div className="timeline-friends">
                {topFriends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="timeline-friend"
                    onClick={() => (typeof onNavigateToUser === 'function' ? onNavigateToUser(f.id) : null)}
                    title={`View ${f.username}'s timeline`}
                  >
                    {f.profilePicture ? (
                      <img src={f.profilePicture} alt="" className="timeline-friend__avatar" />
                    ) : (
                      <span className="timeline-friend__avatar">{f.avatar || '👤'}</span>
                    )}
                    <span className="timeline-friend__name">{f.username}</span>
                  </button>
                ))}
                </div>

                {friends.length > 5 ? (
                  <div className="timeline-friends__footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setFriendsModalOpen(true)}>
                      See all {friends.length}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>

        <main className="timeline-right">
          <div className="timeline-card card timeline-card--scroll">
            <div className="timeline-card__header">
              <span><FontAwesomeIcon icon={faNewspaper} /> Posts</span>
            </div>

            {loading ? (
              <div className="timeline-muted">Loading…</div>
            ) : error ? (
              <div className="timeline-muted">{error}</div>
            ) : !canViewTimeline ? (
              <div className="timeline-locked">
                <div className="timeline-locked__icon"><FontAwesomeIcon icon={faLock} /></div>
                <div className="timeline-muted">Timeline is only visible to friends.</div>
              </div>
            ) : posts.length === 0 ? (
              <div className="timeline-muted">No posts yet</div>
            ) : (
              <div className="timeline-posts">
                {posts.map((p) => (
                  (() => {
                    const fireCount = typeof p.fireCount === 'number'
                      ? p.fireCount
                      : Array.isArray(p.fireUserIds) ? p.fireUserIds.length : 0;
                    const commentCount = Array.isArray(p.comments) ? p.comments.length : 0;
                    const isExpanded = expandedPostIds.has(p.id);
                    const hasReacted = Array.isArray(p.fireUserIds) && myUserId ? p.fireUserIds.includes(String(myUserId)) : false;

                    return (
                  <div key={p.id} className="timeline-post">
                    <div className="timeline-post__meta">
                      <strong>{p.author}</strong>
                      <span>{p.timestamp ? new Date(p.timestamp).toLocaleString() : ''}</span>
                    </div>
                    {p.content ? <div className="timeline-post__content">{p.content}</div> : null}
                    {Array.isArray(p.images) && p.images.length ? (
                      <div className="timeline-post__images">
                        {p.images.slice(0, 4).map((img) => (
                          <img key={img.fileId || img.url} src={img.url} alt="" loading="lazy" />
                        ))}
                      </div>
                    ) : null}

                    <div className="timeline-post__stats" aria-label="Post stats">
                      <div className="timeline-post__stat">
                        <FontAwesomeIcon icon={faFire} />
                        <span>{fireCount}</span>
                      </div>
                      <div className="timeline-post__stat">
                        <FontAwesomeIcon icon={faComments} />
                        <span>{commentCount}</span>
                      </div>
                    </div>

                    <div className="timeline-post__actions">
                      <button
                        type="button"
                        className={`timeline-action ${hasReacted ? 'active' : ''}`}
                        onClick={() => handleReactFire(p.id)}
                        disabled={!canViewTimeline}
                        title={!canViewTimeline ? 'Friends only' : 'React Fire'}
                      >
                        <FontAwesomeIcon icon={faFire} />
                        <span>Fire</span>
                        <span className="timeline-action__count">{fireCount}</span>
                      </button>

                      <button
                        type="button"
                        className="timeline-action"
                        onClick={() => togglePostExpanded(p.id)}
                        disabled={!canViewTimeline}
                        title={!canViewTimeline ? 'Friends only' : 'Comments'}
                      >
                        <FontAwesomeIcon icon={faComments} />
                        <span>Comments</span>
                        <span className="timeline-action__count">{commentCount}</span>
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="timeline-comments">
                        <form className="timeline-comment-form" onSubmit={(e) => handleAddComment(p.id, e)}>
                          <div className="mention-wrap mention-wrap--inline">
                            <input
                              ref={(el) => { if (el) commentInputRefs.current[p.id] = el; }}
                              type="text"
                              placeholder="Write a comment…"
                              value={commentDrafts[p.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCommentDrafts(prev => ({ ...prev, [p.id]: val }));
                                openMentionPickerForField({ field: 'comment', postId: p.id, value: val, caret: e.target.selectionStart });
                              }}
                              onClick={(e) => openMentionPickerForField({ field: 'comment', postId: p.id, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                              onKeyUp={(e) => openMentionPickerForField({ field: 'comment', postId: p.id, value: e.currentTarget.value, caret: e.currentTarget.selectionStart })}
                              onKeyDown={(e) => {
                                if (!mentionPicker.open || mentionPicker.field !== 'comment' || String(mentionPicker.postId) !== String(p.id)) return;
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
                                      setValue: (fn) => setCommentDrafts(prev => ({ ...prev, [p.id]: fn(prev[p.id] || '') })),
                                      getInput: () => commentInputRefs.current[p.id]
                                    });
                                  }
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setMentionPicker(prev => ({ ...prev, open: false }));
                                }
                              }}
                              disabled={!canViewTimeline}
                            />
                            {mentionPicker.open && mentionPicker.field === 'comment' && String(mentionPicker.postId) === String(p.id) ? (
                              <MentionPicker
                                suggestions={getMentionSuggestions(mentionPicker.query)}
                                onSelect={(f) => applyMentionSelection({
                                  username: f.username,
                                  setValue: (fn) => setCommentDrafts(prev => ({ ...prev, [p.id]: fn(prev[p.id] || '') })),
                                  getInput: () => commentInputRefs.current[p.id]
                                })}
                                onClose={() => setMentionPicker(prev => ({ ...prev, open: false }))}
                              />
                            ) : null}
                          </div>

                          <button type="submit" className="btn btn-primary btn-sm" disabled={!canViewTimeline}>Send</button>
                        </form>

                        <div className="timeline-comment-list">
                          {(() => {
                            const all = Array.isArray(p.comments) ? p.comments : [];
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
                              const isActiveReply = replyingTo?.commentId && String(replyingTo.commentId) === String(c._cid) && String(replyingTo.postId) === String(p.id);

                              return (
                                <div key={c._cid || `${c.userId}_${c.timestamp}`} className={`timeline-comment ${depth ? 'timeline-comment--reply' : ''}`}>
                                  <div className="timeline-comment__avatar">
                                    {c.userProfilePicture ? (
                                      <img
                                        src={c.userProfilePicture}
                                        alt=""
                                        onClick={() => onNavigateToUser?.(c.userId)}
                                        className="avatar-click"
                                      />
                                    ) : (
                                      <span onClick={() => onNavigateToUser?.(c.userId)} className="avatar-click">{c.userAvatar || '👤'}</span>
                                    )}
                                  </div>
                                  <div className="timeline-comment__body">
                                    <div className="timeline-comment__meta">
                                      <button type="button" className="comment-author" onClick={() => onNavigateToUser?.(c.userId)}>
                                        {c.username || 'User'}
                                      </button>
                                      <span>{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</span>
                                    </div>
                                    {c.replyToUsername ? (
                                      <div className="timeline-comment__replyto">Replying to <span>@{c.replyToUsername}</span></div>
                                    ) : null}
                                    <div className="timeline-comment__text">{renderCommentText(c.text)}</div>

                                    <div className="timeline-comment__actions">
                                      <button type="button" className="btn-link" onClick={() => handleReplyToComment(p.id, c)} disabled={!canViewTimeline}>
                                        Reply
                                      </button>
                                    </div>

                                    {isActiveReply ? (
                                      <form className="timeline-reply-form" onSubmit={(e) => handleSendReply(p.id, e)}>
                                        <div className="mention-wrap mention-wrap--inline">
                                          <input
                                            ref={(el) => { if (el) replyInputRefs.current[c._cid] = el; }}
                                            type="text"
                                            placeholder={`Reply to @${c.username}…`}
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
                                            disabled={!canViewTimeline}
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

                                        <button type="submit" className="btn btn-primary btn-sm" disabled={!canViewTimeline}>Send</button>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplyingTo(null)}>Cancel</button>
                                      </form>
                                    ) : null}

                                    {replies.length ? (
                                      <div className="timeline-comment__replies">
                                        {replies.map(r => renderComment(r, depth + 1))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            };

                            const limitedRoots = roots.slice(-20);
                            if (limitedRoots.length === 0) return <div className="timeline-muted">No comments yet</div>;
                            return limitedRoots.map(c => renderComment(c, 0));
                          })()}
                        </div>
                      </div>
                    ) : null}
                  </div>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default TimelinePage;
