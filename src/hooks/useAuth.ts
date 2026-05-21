import { useState, useEffect, useCallback } from 'react';
import i18n from '../i18n';
import { 
  signInWithPopup, 
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User as FirebaseUser,
  type AuthProvider
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, googleProvider, microsoftProvider, firestoreDB } from '../lib/firebase';
import type { User, UserRole, AuthState, CreateUserRequest } from '../types/auth';
import { USER_ROLE_CONFIGS } from '../types/auth';
import { getRoleConfig, subscribeRoleConfigs } from './useRoleConfigs';

const USERS_COLLECTION = 'users';

// Development mode detection.
// Use ONLY `import.meta.env.DEV` — Vite replaces it with a boolean literal at build
// time, which lets the bundler tree-shake all dev-only branches out of the prod bundle.
// We previously also checked `MODE === 'development'`, which a) is not tree-shakeable
// and b) would activate the local dev user (with role `developer`) in any prod build
// accidentally produced with `--mode development`. Keeping just `DEV` makes the
// privileged dev fallback impossible to reach in a real prod build.
const isDevelopment = import.meta.env.DEV;

const sanitizeEmailForDocId = (email: string) => email.replace(/[.#$[\]@]/g, '_');

// Local development users for testing different roles
const getLocalDevUser = (role: UserRole = 'developer'): User => ({
  uid: `local-dev-${role}`,
  email: `local-${role}@dev.local`,
  displayName: `Local ${USER_ROLE_CONFIGS[role].name} (Dev)`,
  photoURL: null,
  role,
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
  isActive: true,
  createdBy: 'system'
});

// Default dev user is developer (can write updates)
const LOCAL_DEV_USER = getLocalDevUser('developer');

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    hasPermission: () => false,
    rolePermissions: []
  });

  // Helper function to get user data from Firestore (with auto-creation)
  const getUserData = async (firebaseUser: FirebaseUser): Promise<User | null> => {
    if (!firestoreDB) return null;
    
    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, firebaseUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        return {
          uid: firebaseUser.uid,
          email: firebaseUser.email!,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          role: userData.role || 'viewer',
          createdAt: userData.createdAt,
          lastLoginAt: new Date().toISOString(),
          isActive: userData.isActive !== false,
          forceSimpleMode: userData.forceSimpleMode === true,
          isDealer: userData.isDealer === true,
          createdBy: userData.createdBy,
          language: userData.language
        };
      } else {
        // Auto-create new user with pending role
        const newUserData: User = {
          uid: firebaseUser.uid,
          email: firebaseUser.email!,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          role: 'pending' as UserRole,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          isActive: true,
          createdBy: 'auto-registration',
          language: (i18n.resolvedLanguage === 'de' ? 'de' : 'en')
        };
        
        // Save to Firestore
        await setDoc(userDocRef, {
          ...newUserData,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp()
        });
        
        return newUserData;
      }
    } catch (error) {
      console.error('[Auth] Error getting user data:', error);
      return null;
    }
  };

  // Update last login time
  const updateLastLogin = async (uid: string) => {
    if (!firestoreDB) return;
    
    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, uid);
      await updateDoc(userDocRef, {
        lastLoginAt: serverTimestamp()
      });
    } catch (error) {
      console.error('[Auth] Error updating last login:', error);
    }
  };

  // Check if user has permission
  const hasPermission = useCallback((permission: string): boolean => {
    if (!authState.user) return false;
    const dynamic = authState.rolePermissions && authState.rolePermissions.length > 0
      ? authState.rolePermissions
      : USER_ROLE_CONFIGS[authState.user.role]?.permissions || [];
    return dynamic.includes(permission);
  }, [authState.user, authState.rolePermissions]);

  // Update user profile language in Firestore
  const updateUserLanguage = async (lng: 'en' | 'de'): Promise<{ success: boolean; error?: string }> => {
    try {
      // Always change locally and rely on LanguageDetector to persist to localStorage
      await i18n.changeLanguage(lng);

      if (isDevelopment) {
        return { success: true };
      }
      if (!firestoreDB || !authState.user) {
        return { success: true };
      }
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, authState.user.uid);
      await updateDoc(userDocRef, { language: lng, updatedAt: serverTimestamp() });
      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Failed to update user language:', error);
      return { success: false, error: error.message || 'Failed to update language' };
    }
  };

  const signInWithProvider = async (provider: AuthProvider): Promise<{ success: boolean; error?: string }> => {
    if (isDevelopment) {
      return { success: true };
    }

    if (!auth) return { success: false, error: 'Auth not initialized' };

    try {
      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;
      
      // Auto-create or get user data
      const userData = await getUserData(firebaseUser);
      
      if (!userData) {
        await firebaseSignOut(auth);
        return { 
          success: false, 
          error: 'Failed to create user account.' 
        };
      }

      if (!userData.isActive) {
        await firebaseSignOut(auth);
        return { 
          success: false, 
          error: 'Account is deactivated. Contact administrator.' 
        };
      }

      // Update last login
      await updateLastLogin(firebaseUser.uid);
      
      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Sign in error:', provider.providerId, error);
      return { 
        success: false, 
        error: error.message || 'Sign in failed' 
      };
    }
  };

  // Sign in with Google
  const signInWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    return signInWithProvider(googleProvider);
  };

  // Sign in with Microsoft
  const signInWithMicrosoft = async (): Promise<{ success: boolean; error?: string }> => {
    return signInWithProvider(microsoftProvider);
  };

  // Sign out
  const signOut = async (): Promise<void> => {
    if (isDevelopment) {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasPermission: () => false
      });
      window.location.reload();
      return;
    }

    if (!auth) return;
    
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('[Auth] Sign out error:', error);
    }
  };

  // Create new user (admin only)
  const createUser = async (request: CreateUserRequest, createdBy: string): Promise<{ success: boolean; error?: string }> => {
    if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };

    try {
      // Check if user already exists
      const usersRef = collection(firestoreDB, USERS_COLLECTION);
      const q = query(usersRef, where('email', '==', request.email));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        return { success: false, error: 'User with this email already exists' };
      }

      // Create user document directly in users collection
      const newUserData = {
        uid: `pending-${Date.now()}`, // Temporary UID until they sign in
        email: request.email,
        displayName: null,
        photoURL: null,
        role: request.role,
        createdAt: serverTimestamp(),
        lastLoginAt: null,
        isActive: true,
        createdBy,
        isPending: true // Mark as pending until first login
      };

      // Use email as document ID for easier lookup
      const emailDocId = sanitizeEmailForDocId(request.email);
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, emailDocId);
      await setDoc(userDocRef, newUserData);

      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Create user error:', error);
      return { success: false, error: error.message || 'Failed to create user' };
    }
  };

  // Get all users (admin only)
  const getAllUsers = useCallback(async (): Promise<User[]> => {
    if (isDevelopment) {
      return [
        LOCAL_DEV_USER,
        {
          uid: 'dev-user-2',
          email: 'admin@dev.local',
          displayName: 'Dev Admin',
          photoURL: null,
          role: 'admin',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          isActive: true,
          createdBy: 'system'
        },
        {
          uid: 'dev-user-3',
          email: 'super-admin@dev.local',
          displayName: 'Dev Super Admin',
          photoURL: null,
          role: 'super_admin',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          isActive: true,
          createdBy: 'system'
        },
        {
          uid: 'dev-user-4',
          email: 'viewer@dev.local',
          displayName: 'Dev Viewer',
          photoURL: null,
          role: 'viewer',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          isActive: true,
          createdBy: 'system'
        }
      ];
    }

    if (!firestoreDB) {
      return [];
    }

    try {
      const usersRef = collection(firestoreDB, USERS_COLLECTION);
      const querySnapshot = await getDocs(usersRef);
      
      return querySnapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      } as User));
    } catch (error) {
      console.error('[Auth] Get users error:', error);
      return [];
    }
  }, [isDevelopment, firestoreDB]);

  // Update user role (super admin only)
  const updateUserRole = async (uid: string, newRole: UserRole): Promise<{ success: boolean; error?: string }> => {
    if (isDevelopment) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    }

    if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };

    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, uid);
      await updateDoc(userDocRef, {
        role: newRole,
        updatedAt: serverTimestamp()
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Update user role error:', error);
      return { success: false, error: error.message || 'Failed to update user role' };
    }
  };

  // Toggle user active status (super admin only)
  const toggleUserActive = async (uid: string, isActive: boolean): Promise<{ success: boolean; error?: string }> => {
    if (isDevelopment) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    }

    if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };

    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, uid);
      await updateDoc(userDocRef, {
        isActive,
        updatedAt: serverTimestamp()
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Toggle user active error:', error);
      return { success: false, error: error.message || 'Failed to update user status' };
    }
  };

  // Toggle force simple mode for user (admin only)
  const toggleUserForceSimpleMode = async (uid: string, forceSimpleMode: boolean): Promise<{ success: boolean; error?: string }> => {
    if (isDevelopment) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    }

    if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };

    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, uid);
      await updateDoc(userDocRef, {
        forceSimpleMode,
        updatedAt: serverTimestamp()
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Toggle force simple mode error:', error);
      return { success: false, error: error.message || 'Failed to update force simple mode' };
    }
  };

  // Toggle dealer mode route lock for user (admin only)
  const toggleUserDealerMode = async (uid: string, isDealer: boolean): Promise<{ success: boolean; error?: string }> => {
    if (isDevelopment) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    }

    if (!firestoreDB) return { success: false, error: 'Firestore not initialized' };

    try {
      const userDocRef = doc(firestoreDB, USERS_COLLECTION, uid);
      await updateDoc(userDocRef, {
        isDealer,
        updatedAt: serverTimestamp()
      });

      return { success: true };
    } catch (error: any) {
      console.error('[Auth] Toggle dealer mode error:', error);
      return { success: false, error: error.message || 'Failed to update dealer mode' };
    }
  };

  // Development mode auto-login
  useEffect(() => {
    if (isDevelopment) {
      setAuthState({
        user: LOCAL_DEV_USER,
        isLoading: false,
        isAuthenticated: true,
        hasPermission: (permission: string) => {
          const roleConfig = USER_ROLE_CONFIGS[LOCAL_DEV_USER.role];
          return roleConfig.permissions.includes(permission);
        },
        rolePermissions: USER_ROLE_CONFIGS[LOCAL_DEV_USER.role]?.permissions || []
      });
    }
  }, [isDevelopment]);

  const forceSimpleModeEnabled = authState.user?.forceSimpleMode === true;

  // Sync forceSimpleMode with per-tab UI preferences (session)
  useEffect(() => {
    try {
      if (forceSimpleModeEnabled) {
        sessionStorage.setItem('rigwatch-session-simplification-mode', 'true');
        window.dispatchEvent(new CustomEvent('userPreferencesChanged', { detail: { simplificationMode: true } }));
      } else {
        // Keep the user's local preference intact—only remove the tab-scoped overlay.
        sessionStorage.removeItem('rigwatch-session-simplification-mode');
      }
    } catch {}
  }, [forceSimpleModeEnabled]);

  // Auth state listener (production only)
  useEffect(() => {
    if (isDevelopment) return;
    
    if (!auth) {
      console.error('[Auth] Firebase auth not initialized');
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasPermission: () => false
      });
      return;
    }
    
    // Timeout for loading state (prevent infinite loading)
    const loadingTimeout = setTimeout(() => {
      console.warn('[Auth] Loading timeout reached, setting loading to false');
      setAuthState(prev => ({
        ...prev,
        isLoading: false
      }));
    }, 10000); // 10 seconds timeout
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(loadingTimeout);

      if (firebaseUser) {
        setAuthState(prev => ({ ...prev, isLoading: true }));
        const userData = await getUserData(firebaseUser);
        
        if (userData) {
          setAuthState(prev => ({
            ...prev,
            user: userData,
            isLoading: false,
            isAuthenticated: true,
            hasPermission: (permission: string) => {
              const roleConfig = USER_ROLE_CONFIGS[userData.role];
              return roleConfig.permissions.includes(permission);
            },
            rolePermissions: USER_ROLE_CONFIGS[userData.role]?.permissions || []
          }));

          // Hydrate dynamic permissions from roleConfigs
          try {
            const cfg = await getRoleConfig(userData.role);
            setAuthState(prev => ({ ...prev, rolePermissions: cfg.permissions || [] }));
          } catch {}

          // Subscribe to roleConfigs changes
          const unsubscribeRoleCfg = subscribeRoleConfigs((all) => {
            const role = userData.role;
            const cfg = all[role] || USER_ROLE_CONFIGS[role];
            setAuthState(prev => ({ ...prev, rolePermissions: cfg.permissions || [] }));
          });

          // Attach cleanup
          (window as any).__authRoleCfgUnsub?.();
          (window as any).__authRoleCfgUnsub = unsubscribeRoleCfg;
          // Apply user's preferred language over detector
          if (userData.language && (userData.language === 'en' || userData.language === 'de')) {
            try { await i18n.changeLanguage(userData.language); } catch {}
          }
        } else {
          console.warn('[Auth] User not authorized, signing out');
          if (auth) {
            await firebaseSignOut(auth);
          }
          setAuthState({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            hasPermission: () => false
          });
        }
      } else {
        setAuthState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          hasPermission: () => false
        });
      }
    });

    return () => {
      clearTimeout(loadingTimeout);
      unsubscribe();
    };
  }, [isDevelopment]);

  // Subscribe to dynamic role config updates for current user (both DEV and PROD)
  useEffect(() => {
    const role = authState.user?.role;
    if (!role) return;

    let isMounted = true;
    // Initial hydrate
    getRoleConfig(role).then(cfg => {
      if (!isMounted) return;
      setAuthState(prev => ({ 
        ...prev, 
        rolePermissions: cfg.permissions || [], 
        parameterViewScope: cfg.parameterViewScope || USER_ROLE_CONFIGS[role]?.parameterViewScope,
        categoryVisibility: cfg.categoryVisibility || USER_ROLE_CONFIGS[role]?.categoryVisibility
      }));
    }).catch(() => {});

    const unsubscribe = subscribeRoleConfigs((all) => {
      const cfg = all[role] || USER_ROLE_CONFIGS[role];
      setAuthState(prev => ({ 
        ...prev, 
        rolePermissions: cfg.permissions || [], 
        parameterViewScope: cfg.parameterViewScope || USER_ROLE_CONFIGS[role]?.parameterViewScope,
        categoryVisibility: cfg.categoryVisibility || USER_ROLE_CONFIGS[role]?.categoryVisibility
      }));
    });

    return () => {
      isMounted = false;
      try { unsubscribe(); } catch {}
    };
  }, [authState.user?.role]);

  return {
    ...authState,
    signInWithGoogle,
    signInWithMicrosoft,
    signOut,
    createUser,
    getAllUsers,
    updateUserRole,
    toggleUserActive,
    toggleUserForceSimpleMode,
    toggleUserDealerMode,
    hasPermission,
    updateUserLanguage
  };
}; 