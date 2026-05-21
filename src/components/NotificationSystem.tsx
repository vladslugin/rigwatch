import React, { useEffect, useState } from 'react';
import { useRigStore } from '../store/useRigStore';
import type { NotificationType } from '../types';
import { useTranslation } from 'react-i18next';
import { soundManager } from '../utils/soundManager';

interface NotificationItemProps {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
  isAlarm?: boolean;
  deviceId?: string;
  parameterName?: string;
  onRemove: (id: string) => void;
  onAlarmClick?: (deviceId: string, parameterName: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  id,
  message,
  type,
  duration = 3500,
  isAlarm = false,
  deviceId,
  parameterName,
  onRemove,
  onAlarmClick,
}) => {
  const { t } = useTranslation();
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    // Play sound for alarm notifications
    if (isAlarm) {
      const soundType = type === 'warning' ? 
        (message.includes('überschritten') || message.includes('exceeded') ? 'high' : 'low') : 
        'normal';
      soundManager.playAlarmSound(soundType);
      
      // Start blinking for alarm notifications
      setIsBlinking(true);
    }
  }, [isAlarm, type, message]);

  useEffect(() => {
    // Use custom duration (10 seconds for alarms, 3.5s for regular)
    const actualDuration = isAlarm ? 10000 : duration;
    const timer = setTimeout(() => {
      onRemove(id);
    }, actualDuration);

    return () => clearTimeout(timer);
  }, [id, onRemove, duration, isAlarm]);

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-success text-success-foreground border-success';
      case 'error':
        return 'bg-destructive text-destructive-foreground border-destructive';
      case 'warning':
        return 'bg-warning text-warning-foreground border-warning';
      case 'info':
      default:
        return 'bg-info text-info-foreground border-info';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.667-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const handleClick = () => {
    if (isAlarm && deviceId && parameterName && onAlarmClick) {
      onAlarmClick(deviceId, parameterName);
    }
  };

  return (
    <div
      className={`
        flex items-center p-4 mb-3 rounded-lg shadow-lg border-l-4
        transform transition-all duration-300 ease-out
        animate-slide-in-right
        ${getTypeStyles()}
        ${isBlinking && isAlarm ? 'animate-pulse' : ''}
        ${isAlarm && deviceId && parameterName ? 'cursor-pointer hover:scale-105' : ''}
      `}
      style={{
        minWidth: '300px',
        maxWidth: '450px',
        ...(isBlinking && isAlarm ? {
          animation: 'pulse 1s ease-in-out infinite alternate, slide-in-right 0.4s ease-out'
        } : {})
      }}
      onClick={handleClick}
    >
      <div className="flex-shrink-0 mr-3">
        {getIcon()}
      </div>
      
      <div className="flex-1">
        <p className="text-sm font-medium leading-tight">{message}</p>
        {isAlarm && deviceId && parameterName && (
          <p className="text-xs opacity-75 mt-1">
            {deviceId} • {parameterName}
          </p>
        )}
      </div>
      
      <button
        onClick={(e) => {
          e.stopPropagation(); // Prevent triggering the alarm click
          onRemove(id);
        }}
        className="ml-3 flex-shrink-0 opacity-80 hover:opacity-100 transition-opacity"
        title={t('notifications.close') as string}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
};

interface NotificationSystemProps {
  onAlarmClick?: (deviceId: string, parameterName: string) => void;
}

const NotificationSystem: React.FC<NotificationSystemProps> = ({ onAlarmClick }) => {
  const notifications = useRigStore(state => state.notifications);
  const removeNotification = useRigStore(state => state.removeNotification);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <>
      {/* Add custom animations using a style tag without JSX props */}
      <style>{`
        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes slide-out-right {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }
        
        .animate-slide-in-right {
          animation: slide-in-right 0.4s ease-out;
        }
        
        .animate-slide-out-right {
          animation: slide-out-right 0.4s ease-out;
        }
      `}</style>

      {/* Notification Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end space-y-2">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            id={notification.id}
            message={notification.message}
            type={notification.type}
            duration={notification.duration}
            isAlarm={notification.isAlarm}
            deviceId={notification.deviceId}
            parameterName={notification.parameterName}
            onRemove={removeNotification}
            onAlarmClick={onAlarmClick}
          />
        ))}
      </div>
    </>
  );
};

export default NotificationSystem;
