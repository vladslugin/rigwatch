import { useEffect, useState } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { useRigStore } from '../store/useRigStore';

export const useRigComment = () => {
  const deviceId = useRigStore(state => state.deviceId);
  const [comment, setComment] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!deviceId || !realtimeDB) {
      setComment('');
      return;
    }

    setLoading(true);
    const commentRef = ref(realtimeDB!, `konstant_app/${deviceId}/comment`);

    const handleCommentUpdate = onValue(commentRef, (snapshot) => {
      const commentValue = snapshot.exists() ? snapshot.val() : '';
      setComment(commentValue || '');
      setLoading(false);
    }, (error) => {
      console.error('[useRigComment] Error loading comment:', error);
      setComment('');
      setLoading(false);
    });

    return () => {
      off(commentRef, 'value', handleCommentUpdate);
    };
  }, [deviceId]);

  return {
    comment,
    loading,
    hasComment: comment.trim().length > 0
  };
};