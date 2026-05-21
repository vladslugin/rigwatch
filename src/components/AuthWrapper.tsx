import * as React from 'react';
import { useAuth } from '../hooks/useAuth';
import LoginModal from './LoginModal';

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-info/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="animate-spin h-8 w-8 text-info" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Loading Application
          </h2>
          <p className="text-muted-foreground">
            Checking authentication status...
          </p>
        </div>
      </div>
    );
  }

  // Show login modal if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <LoginModal isOpen={true} onClose={() => {}} />
      </div>
    );
  }

  // Block pending users
  if (user?.role === 'pending') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card shadow rounded-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-3">Account Under Review</h2>
          <p className="text-muted-foreground mb-6">
            Your account is awaiting approval. You will gain access once an administrator assigns your role.
          </p>
          <p className="text-sm text-muted-foreground">
            If this takes longer than expected, please contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  // Show protected content if authenticated
  return <>{children}</>;
};

export default AuthWrapper;