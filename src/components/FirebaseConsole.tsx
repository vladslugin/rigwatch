import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ref, set, get, remove } from 'firebase/database';
import { collection, getDocs } from 'firebase/firestore';
import { realtimeDB, firestoreDB } from '../lib/firebase';
import { useRigStore } from '../store/useRigStore';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface FirebaseConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DatabaseNode {
  key: string;
  value: any;
  path: string;
  type: 'object' | 'string' | 'number' | 'boolean' | 'null';
  isExpanded?: boolean;
  children?: DatabaseNode[];
  isLoaded?: boolean; // Track if children are loaded
}

interface EditingNode {
  path: string;
  key: string;
  value: any;
  type: 'object' | 'string' | 'number' | 'boolean' | 'null';
}

// Cache for faster switching
const dataCache = {
  realtime: null as DatabaseNode[] | null,
  firestore: null as DatabaseNode[] | null,
  lastUpdate: {
    realtime: 0,
    firestore: 0
  }
};

// Request limiting to prevent Firebase overload
const requestLimiter = {
  lastRequest: 0,
  minInterval: 200, // Minimum 200ms between requests
  maxConcurrent: 3, // Maximum 3 concurrent requests
  currentRequests: 0
};

const canMakeRequest = (): boolean => {
  const now = Date.now();
  if (requestLimiter.currentRequests >= requestLimiter.maxConcurrent) {
    return false;
  }
  if (now - requestLimiter.lastRequest < requestLimiter.minInterval) {
    return false;
  }
  return true;
};

const FirebaseConsole: React.FC<FirebaseConsoleProps> = ({ isOpen, onClose }) => {
  const { user, hasPermission } = useAuth();
  const deviceId = useRigStore(state => state.deviceId);
  const { t } = useTranslation();
  
  const [activeTab, setActiveTab] = useState<'realtime' | 'firestore'>('realtime');
  const [databaseTree, setDatabaseTree] = useState<DatabaseNode[]>([]);
  const [firestoreCollections, setFirestoreCollections] = useState<DatabaseNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [editingNode, setEditingNode] = useState<EditingNode | null>(null);

  const [navigationPath, setNavigationPath] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>('');
  
  // Refs
  const editInputRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const selectedNodeRef = useRef<HTMLDivElement>(null);

  // State for autocomplete
  const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const autocompleteListRef = useRef<HTMLDivElement>(null);
  
  // State for inline suggestion (ghost text)
  const [inlineSuggestion, setInlineSuggestion] = useState<string>('');
  
  // State for loading nodes
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());

  // Scroll to selected element
  const scrollToSelected = useCallback(() => {
    if (selectedNodeRef.current && consoleRef.current) {
      selectedNodeRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }, []);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  // Scroll to selected when path changes
  useEffect(() => {
    if (selectedPath) {
      const timeoutId = setTimeout(scrollToSelected, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [selectedPath, scrollToSelected]);

  // This comment is a placeholder for useEffect that will be added after function declarations

  // Scroll to selected autocomplete item
  const scrollToAutocompleteItem = useCallback((index: number) => {
    if (autocompleteListRef.current) {
      const listElement = autocompleteListRef.current;
      const items = listElement.children;
      if (items[index]) {
        const item = items[index] as HTMLElement;
        const listRect = listElement.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        
        // Check if item is outside visible area
        if (itemRect.top < listRect.top) {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (itemRect.bottom > listRect.bottom) {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }, []);

  // Generate autocomplete suggestions based on current input
  const generateAutocompleteSuggestions = useCallback((input: string) => {
    if (!input || input.length < 1) {
      setAutocompleteOptions([]);
      setShowAutocomplete(false);
      setInlineSuggestion('');
      return;
    }

    const suggestions: string[] = [];
    const normalizedInput = input.toLowerCase().replace(/^\/+/, '');
    
    if (activeTab === 'realtime') {
      // Get all available paths from the tree
      const collectPaths = (nodes: DatabaseNode[], currentDepth: number = 0): void => {
        nodes.forEach(node => {
          const nodePath = node.path.toLowerCase().replace(/^\/+/, '');
          if (nodePath.startsWith(normalizedInput)) {
            suggestions.push(node.path);
          }
          if (node.children && node.isLoaded && currentDepth < 3) {
            collectPaths(node.children, currentDepth + 1);
          }
        });
      };
      collectPaths(databaseTree);
    } else {
      // Firestore suggestions
      const collectFirestorePaths = (nodes: DatabaseNode[], currentDepth: number = 0): void => {
        nodes.forEach(node => {
          const nodePath = node.path.toLowerCase().replace(/^\/+/, '');
          if (nodePath.startsWith(normalizedInput)) {
            suggestions.push(node.path);
          }
          if (node.children && node.isLoaded && currentDepth < 2) {
            collectFirestorePaths(node.children, currentDepth + 1);
          }
        });
      };
      collectFirestorePaths(firestoreCollections);
    }

    // Sort and limit suggestions
    const uniqueSuggestions = Array.from(new Set(suggestions))
      .sort()
      .slice(0, 10);
    
    setAutocompleteOptions(uniqueSuggestions);
    setShowAutocomplete(uniqueSuggestions.length > 0);
    setAutocompleteIndex(0);
    
    // Set inline suggestion (ghost text) - first match
    if (uniqueSuggestions.length > 0 && input.trim()) {
      const firstMatch = uniqueSuggestions[0];
      // Get the part that would be added
      const completion = firstMatch.substring(input.length);
      setInlineSuggestion(completion);
    } else {
      setInlineSuggestion('');
    }
  }, [activeTab, databaseTree, firestoreCollections]);

  // Handle autocomplete selection
  const selectAutocompleteSuggestion = useCallback((suggestion: string, navigateFn: (path: string) => Promise<void>) => {
    setNavigationPath(suggestion);
    setShowAutocomplete(false);
    // Navigation will be triggered by the navigateToPath function
    setTimeout(() => {
      navigateFn(suggestion);
    }, 0);
  }, []);

  // Accept inline suggestion
  const acceptInlineSuggestion = useCallback(() => {
    if (inlineSuggestion && navigationPath) {
      const newPath = navigationPath + inlineSuggestion;
      setNavigationPath(newPath);
      setInlineSuggestion('');
      generateAutocompleteSuggestions(newPath);
    }
  }, [inlineSuggestion, navigationPath, generateAutocompleteSuggestions]);

  // Clear navigation and collapse nodes
  const clearNavigation = useCallback(() => {
    setNavigationPath('');
    setSelectedPath('');
    setExpandedPaths(new Set());
    setShowAutocomplete(false);
    setInlineSuggestion('');
  }, []);

  // Handle navigation path changes
  useEffect(() => {
    if (!navigationPath.trim()) {
      // If navigation path is cleared, collapse nodes and clear selection
      setSelectedPath('');
    }
  }, [navigationPath]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingNode && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingNode]);

  const determineType = (value: any): 'object' | 'string' | 'number' | 'boolean' | 'null' => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    return 'string';
  };

  const loadNodeChildren = useCallback(async (node: DatabaseNode) => {
    if (!realtimeDB || node.type !== 'object' || node.isLoaded) return;
    
    // Check if we can make a request
    if (!canMakeRequest()) {
      return;
    }
    
    // Mark node as loading
    setLoadingNodes(prev => new Set([...prev, node.path]));
    
    requestLimiter.currentRequests++;
    requestLimiter.lastRequest = Date.now();
    
    try {
      const nodeRef = ref(realtimeDB, node.path.substring(1));
      const snapshot = await get(nodeRef);
      
      if (snapshot.exists()) {
        const value = snapshot.val();
        const children: DatabaseNode[] = [];
        
        // Get all entries
        const entries = Object.entries(value || {});
        
        // Add limit for large collections to prevent UI freeze
        const maxChildren = 1000;
        const limitedEntries = entries.length > maxChildren 
          ? entries.slice(0, maxChildren) 
          : entries;
        
        if (entries.length > maxChildren) {
          console.warn(`Node ${node.path} has ${entries.length} children, showing first ${maxChildren}`);
        }
        
        limitedEntries.forEach(([key, childValue]) => {
          const childPath = `${node.path}/${key}`;
          children.push({
            key,
            value: childValue,
            path: childPath,
            type: determineType(childValue),
            isExpanded: expandedPaths.has(childPath),
            isLoaded: false,
            children: determineType(childValue) === 'object' ? [] : undefined
          });
        });
        
        children.sort((a, b) => {
          if (a.type === 'object' && b.type !== 'object') return -1;
          if (a.type !== 'object' && b.type === 'object') return 1;
          return a.key.localeCompare(b.key);
        });
        
        const updateNodeInTree = (nodes: DatabaseNode[]): DatabaseNode[] => {
          return nodes.map(n => {
            if (n.path === node.path) {
              return { ...n, children, isExpanded: true, isLoaded: true };
            }
            if (n.children) {
              return { ...n, children: updateNodeInTree(n.children) };
            }
            return n;
          });
        };
        
        setDatabaseTree(prev => {
          const updated = updateNodeInTree(prev);
          // Update cache
          dataCache.realtime = updated;
          dataCache.lastUpdate.realtime = Date.now();
          return updated;
        });
      }
    } catch (error) {
      console.error(`Failed to load children for ${node.path}:`, error);
    } finally {
      requestLimiter.currentRequests--;
      // Remove from loading
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }
  }, [expandedPaths]);

  const toggleNodeExpansion = useCallback((node: DatabaseNode) => {
    const newExpanded = new Set(expandedPaths);
    
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      if (node.type === 'object' && !node.isLoaded) {
        loadNodeChildren(node);
      }
    }
    
    setExpandedPaths(newExpanded);
  }, [expandedPaths, loadNodeChildren]);

  const startEditing = useCallback((node: DatabaseNode) => {
    if (node.type === 'object') return;
    
    setEditingNode({
      path: node.path,
      key: node.key,
      value: node.value,
      type: node.type
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingNode(null);
  }, []);

  const saveEdit = useCallback(async (newValue: string) => {
    if (!editingNode || !realtimeDB) return;
    
    try {
      let parsedValue: any = newValue;
      
      if (editingNode.type === 'number') {
        parsedValue = parseFloat(newValue);
        if (isNaN(parsedValue)) {
          alert('Invalid number format');
          return;
        }
      } else if (editingNode.type === 'boolean') {
        parsedValue = newValue.toLowerCase() === 'true';
      } else if (editingNode.type === 'null') {
        parsedValue = null;
      }
      
      const dbPath = editingNode.path.substring(1);
      await set(ref(realtimeDB, dbPath), parsedValue);
      
      const updateNodeInTree = (nodes: DatabaseNode[]): DatabaseNode[] => {
        return nodes.map(node => {
          if (node.path === editingNode.path) {
            return { ...node, value: parsedValue };
          }
          if (node.children) {
            return { ...node, children: updateNodeInTree(node.children) };
          }
          return node;
        });
      };
      
      setDatabaseTree(prev => {
        const updated = updateNodeInTree(prev);
        dataCache.realtime = updated; // Update cache
        return updated;
      });
      setEditingNode(null);
      
    } catch (error) {
      console.error('Failed to save edit:', error);
      alert(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [editingNode]);

  const deleteNode = useCallback(async (node: DatabaseNode) => {
    if (!realtimeDB) return;
    
    const confirmed = window.confirm(`Are you sure you want to delete "${node.key}"?\n\nPath: ${node.path}`);
    if (!confirmed) return;
    
    try {
      const dbPath = node.path.substring(1);
      await remove(ref(realtimeDB, dbPath));
      
      // For deletions at root level, reload root data
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/';
      if (parentPath === '/') {
        loadRootData();
      } else {
        const findAndReloadParent = (nodes: DatabaseNode[]): DatabaseNode[] => {
          return nodes.map(n => {
            if (n.path === parentPath) {
              loadNodeChildren(n);
              return n;
            }
            if (n.children) {
              return { ...n, children: findAndReloadParent(n.children) };
            }
            return n;
          });
        };
        setDatabaseTree(prev => findAndReloadParent(prev));
      }
      
    } catch (error) {
      console.error('Failed to delete node:', error);
      alert(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [loadNodeChildren]);

  // Load Firestore collections with caching
  const loadFirestoreCollections = useCallback(async (silent = false) => {
    if (!firestoreDB) return;
    
    // Use cache if available and recent
    const now = Date.now();
    if (dataCache.firestore && (now - dataCache.lastUpdate.firestore) < 60000) {
      setFirestoreCollections(dataCache.firestore);
      return;
    }
    
    if (!silent) setLoading(true);
    try {
      const knownCollections = [
        'admins', 'chat_messages', 'facts', 'images', 'masse_und_gewichte',
        'notifications', 'parameter_values', 'settings', 'rig_models',
        'tickets', 'updates_news', 'users'
      ];
      
      const collectionNodes: DatabaseNode[] = [];
      
      for (const collectionName of knownCollections) {
        try {
          const collectionRef = collection(firestoreDB, collectionName);
          const snapshot = await getDocs(collectionRef);
          
          const documents: any = {};
          snapshot.forEach((doc) => {
            documents[doc.id] = doc.data();
          });
          
          collectionNodes.push({
            key: collectionName,
            value: documents,
            path: `/${collectionName}`,
            type: 'object',
            isExpanded: false,
            isLoaded: false,
            children: []
          });
          
        } catch (error) {
          console.warn(`Failed to load collection ${collectionName}:`, error);
          // For failed collections, mark them as error instead of empty
          collectionNodes.push({
            key: collectionName,
            value: { _error: `Failed to load: ${error instanceof Error ? error.message : 'Unknown error'}` },
            path: `/${collectionName}`,
            type: 'object',
            isExpanded: false,
            isLoaded: false,
            children: []
          });
        }
      }
      
      collectionNodes.sort((a, b) => a.key.localeCompare(b.key));
      
      // Cache the data
      dataCache.firestore = collectionNodes;
      dataCache.lastUpdate.firestore = now;
      
      setFirestoreCollections(collectionNodes);
    } catch (error) {
      console.error('Failed to load Firestore collections:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Load Firestore collection documents
  const loadFirestoreDocuments = useCallback(async (node: DatabaseNode) => {
    if (!firestoreDB || node.type !== 'object' || node.isLoaded) return;
    
    try {
      const collectionName = node.key;
      const collectionRef = collection(firestoreDB, collectionName);
      const snapshot = await getDocs(collectionRef);
      
      const children: DatabaseNode[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        children.push({
          key: doc.id,
          value: data,
          path: `${node.path}/${doc.id}`,
          type: determineType(data),
          isExpanded: false,
          isLoaded: false,
          children: determineType(data) === 'object' ? [] : undefined
        });
      });
      
      children.sort((a, b) => a.key.localeCompare(b.key));
      
      const updateNodeInTree = (nodes: DatabaseNode[]): DatabaseNode[] => {
        return nodes.map(n => {
          if (n.path === node.path) {
            return { ...n, children, isExpanded: true, isLoaded: true };
          }
          if (n.children) {
            return { ...n, children: updateNodeInTree(n.children) };
          }
          return n;
        });
      };
      
      setFirestoreCollections(prev => {
        const updated = updateNodeInTree(prev);
        dataCache.firestore = updated; // Update cache
        return updated;
      });
    } catch (error) {
      console.error(`Failed to load documents for ${node.key}:`, error);
    }
  }, []);

  // Load Firestore node children (for documents and nested objects)
  const loadFirestoreNodeChildren = useCallback((node: DatabaseNode) => {
    if (node.type !== 'object' || node.isLoaded) return;
    
    try {
      const children: DatabaseNode[] = [];
      const value = node.value || {};
      
      // Skip error objects
      if (value._error) return;
      
      Object.entries(value).forEach(([key, childValue]) => {
        const childPath = `${node.path}/${key}`;
        children.push({
          key,
          value: childValue,
          path: childPath,
          type: determineType(childValue),
          isExpanded: false,
          isLoaded: false,
          children: determineType(childValue) === 'object' ? [] : undefined
        });
      });
      
      children.sort((a, b) => {
        if (a.type === 'object' && b.type !== 'object') return -1;
        if (a.type !== 'object' && b.type === 'object') return 1;
        return a.key.localeCompare(b.key);
      });
      
      const updateNodeInTree = (nodes: DatabaseNode[]): DatabaseNode[] => {
        return nodes.map(n => {
          if (n.path === node.path) {
            return { ...n, children, isExpanded: true, isLoaded: true };
          }
          if (n.children) {
            return { ...n, children: updateNodeInTree(n.children) };
          }
          return n;
        });
      };
      
      setFirestoreCollections(prev => {
        const updated = updateNodeInTree(prev);
        dataCache.firestore = updated; // Update cache
        return updated;
      });
    } catch (error) {
      console.error(`Failed to load children for ${node.path}:`, error);
    }
  }, []);

  // Toggle Firestore node expansion
  const toggleFirestoreNode = useCallback((node: DatabaseNode) => {
    const newExpanded = new Set(expandedPaths);
    
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      if (node.type === 'object' && !node.isLoaded) {
        // Determine if this is a collection (level 1) or document/nested object (level 2+)
        const pathParts = node.path.split('/').filter(part => part);
        
        if (pathParts.length === 1) {
          // This is a collection - load documents from Firestore
          loadFirestoreDocuments(node);
        } else {
          // This is a document or nested object - expand from existing data
          loadFirestoreNodeChildren(node);
        }
      }
    }
    
    setExpandedPaths(newExpanded);
  }, [expandedPaths, loadFirestoreDocuments, loadFirestoreNodeChildren]);

  // Navigate to specific path with auto-scroll and sequential loading
  const navigateToPath = useCallback(async (path: string) => {
    if (!path.trim()) return;
    
    let cleanPath = path.trim();
    if (!cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
    }
    
    if (activeTab === 'realtime') {
      if (!realtimeDB) return;
      
      try {
        const pathParts = cleanPath.split('/').filter(part => part);
        
        // Load each level sequentially
        for (let i = 0; i < pathParts.length; i++) {
          const currentPath = '/' + pathParts.slice(0, i + 1).join('/');
          
          // Find the node in current tree
          const findNode = (nodes: DatabaseNode[], targetPath: string): DatabaseNode | null => {
            for (const node of nodes) {
              if (node.path === targetPath) return node;
              if (node.children && node.isLoaded) {
                const found = findNode(node.children, targetPath);
                if (found) return found;
              }
            }
            return null;
          };
          
          // Get current tree snapshot to find node
          const currentTreeSnapshot = await new Promise<DatabaseNode[]>(resolve => {
            setDatabaseTree(prev => {
              resolve(prev);
              return prev;
            });
          });
          
          const currentNode = findNode(currentTreeSnapshot, currentPath);
          
          // Load and expand node if it's an object and not yet loaded
          if (currentNode && currentNode.type === 'object') {
            if (!currentNode.isLoaded) {
              
              // Load children and wait for completion
              const nodeRef = ref(realtimeDB, currentPath.substring(1));
              const snapshot = await get(nodeRef);
              
              if (snapshot.exists()) {
                const value = snapshot.val();
                const children: DatabaseNode[] = [];
                
                const entries = Object.entries(value || {});
                const maxChildren = 1000;
                const limitedEntries = entries.length > maxChildren 
                  ? entries.slice(0, maxChildren) 
                  : entries;
                
                limitedEntries.forEach(([key, childValue]) => {
                  const childPath = `${currentPath}/${key}`;
                  children.push({
                    key,
                    value: childValue,
                    path: childPath,
                    type: determineType(childValue),
                    isExpanded: false,
                    isLoaded: false,
                    children: determineType(childValue) === 'object' ? [] : undefined
                  });
                });
                
                children.sort((a, b) => {
                  if (a.type === 'object' && b.type !== 'object') return -1;
                  if (a.type !== 'object' && b.type === 'object') return 1;
                  return a.key.localeCompare(b.key);
                });
                
                // Update tree with loaded children
                const updateNodeInTree = (nodes: DatabaseNode[]): DatabaseNode[] => {
                  return nodes.map(n => {
                    if (n.path === currentPath) {
                      return { ...n, children, isExpanded: true, isLoaded: true };
                    }
                    if (n.children) {
                      return { ...n, children: updateNodeInTree(n.children) };
                    }
                    return n;
                  });
                };
                
                setDatabaseTree(prev => updateNodeInTree(prev));
                setExpandedPaths(prev => new Set([...prev, currentPath]));
                
                // Wait a bit for UI to update
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            } else {
              // Node exists and is already loaded, just expand it
              setExpandedPaths(prev => new Set([...prev, currentPath]));
            }
          }
        }
        
        // Set final selected path and scroll
        setSelectedPath(cleanPath);
        
        // Force scroll after state updates - wait for React to update DOM
        await new Promise(resolve => setTimeout(resolve, 200));
        scrollToSelected();
        
      } catch (error) {
        console.error('Navigation error:', error);
        alert(`Failed to navigate to path: ${error instanceof Error ? error.message : 'Path not found'}`);
      }
    } else if (activeTab === 'firestore') {
      // Firestore navigation
      try {
        const pathParts = cleanPath.split('/').filter(part => part);
        
        if (pathParts.length === 1) {
          // Navigate to collection
          const collectionName = pathParts[0];
          const collectionPath = `/${collectionName}`;
          
          setExpandedPaths(prev => new Set([...prev, collectionPath]));
          
          const findAndLoadCollection = (nodes: DatabaseNode[]): DatabaseNode[] => {
            return nodes.map(n => {
              if (n.path === collectionPath && !n.isLoaded) {
                loadFirestoreDocuments(n);
                return { ...n, isExpanded: true };
              }
              return n;
            });
          };
          
          setFirestoreCollections(prev => findAndLoadCollection(prev));
          setSelectedPath(collectionPath);
          
        } else if (pathParts.length === 2) {
          // Navigate to document within collection
          const collectionName = pathParts[0];
          const documentId = pathParts[1];
          const collectionPath = `/${collectionName}`;
          const documentPath = `/${collectionName}/${documentId}`;
          
          // First expand collection
          setExpandedPaths(prev => new Set([...prev, collectionPath, documentPath]));
          
          const findAndLoadCollection = (nodes: DatabaseNode[]): DatabaseNode[] => {
            return nodes.map(n => {
              if (n.path === collectionPath && !n.isLoaded) {
                loadFirestoreDocuments(n);
                return { ...n, isExpanded: true };
              }
              return n;
            });
          };
          
          setFirestoreCollections(prev => findAndLoadCollection(prev));
          setSelectedPath(documentPath);
        }
        
      } catch (error) {
        console.error('Firestore navigation error:', error);
        alert(`Failed to navigate to path: ${error instanceof Error ? error.message : 'Path not found'}`);
      }
    }
  }, [realtimeDB, activeTab, loadNodeChildren, loadFirestoreDocuments, scrollToSelected]);

  const addNode = useCallback(async (parentNode: DatabaseNode) => {
    if (!realtimeDB) return;
    
    const key = prompt('Enter new key name:');
    if (!key) return;
    
    const valueStr = prompt('Enter value:');
    if (valueStr === null) return;
    
    try {
      let value: any = valueStr;
      
      if (valueStr === 'true' || valueStr === 'false') {
        value = valueStr === 'true';
      } else if (valueStr === 'null') {
        value = null;
      } else if (!isNaN(parseFloat(valueStr)) && isFinite(parseFloat(valueStr))) {
        value = parseFloat(valueStr);
      }
      
      const newPath = `${parentNode.path}/${key}`;
      const dbPath = newPath.substring(1);
      await set(ref(realtimeDB, dbPath), value);
      
      loadNodeChildren(parentNode);
      
    } catch (error) {
      console.error('Failed to add node:', error);
      alert(`Failed to add node: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [loadNodeChildren]);

  // Load all root nodes dynamically - simple approach with loading indicator
  const loadRootData = useCallback(async (silent = false) => {
    if (!realtimeDB) return;
    
    // Use cache if available and recent
    const now = Date.now();
    if (dataCache.realtime && (now - dataCache.lastUpdate.realtime) < 60000) { // 1 minute cache
      setDatabaseTree(dataCache.realtime);
      return;
    }
    
    if (!silent) setLoading(true);
    try {
      console.log('Loading all root nodes...');
      
      // Load root level with all data
      const rootRef = ref(realtimeDB, '/');
      const snapshot = await get(rootRef);
      
      if (!snapshot.exists()) {
        setDatabaseTree([]);
        return;
      }
      
      const rootData = snapshot.val();
      const rootKeys = Object.keys(rootData || {});
      
      const treeNodes: DatabaseNode[] = [];
      
      // Create nodes with actual data
      for (const nodeName of rootKeys) {
        try {
          const value = rootData[nodeName];
          treeNodes.push({
            key: nodeName,
            value,
            path: `/${nodeName}`,
            type: determineType(value),
            isExpanded: false,
            isLoaded: false,
            children: determineType(value) === 'object' ? [] : undefined
          });
        } catch (error) {
          console.warn(`Failed to process ${nodeName}:`, error);
        }
      }
      
      // Sort alphabetically
      treeNodes.sort((a, b) => a.key.localeCompare(b.key));
      
      // Cache the data
      dataCache.realtime = treeNodes;
      dataCache.lastUpdate.realtime = now;
      
      setDatabaseTree(treeNodes);
      console.log('Root nodes loaded successfully!');
    } catch (error) {
      console.error('Failed to load root data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Clear cache when device changes
  useEffect(() => {
    // Clear cache only when deviceId changes
    dataCache.realtime = null;
    dataCache.firestore = null;
  }, [deviceId]);

  // Initial data load - moved here after all function declarations
  useEffect(() => {
    if (isOpen && (hasPermission('manage_users') || user?.role === 'developer' || user?.role === 'super_admin')) {
      setTimeout(() => {
        if (activeTab === 'realtime') {
          loadRootData();
        } else if (activeTab === 'firestore') {
          loadFirestoreCollections();
        }
      }, 0);
    }
    // No cleanup - keep cache for the session
  }, [isOpen, activeTab, hasPermission, user?.role, loadRootData, loadFirestoreCollections]);

  const renderValue = (node: DatabaseNode) => {
    if (editingNode && editingNode.path === node.path) {
      return (
        <div className="flex items-center space-x-2">
          <input
            ref={editInputRef}
            type="text"
            defaultValue={String(editingNode.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveEdit((e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                cancelEditing();
              }
            }}
            className="px-2 py-1 text-xs border border-primary rounded bg-card text-card-foreground"
          />
          <button
            onClick={() => saveEdit((editInputRef.current as HTMLInputElement).value)}
            className="text-success hover:opacity-80 text-xs"
            title={t('firebaseConsole.save') as string}
          >
            ✓
          </button>
          <button
            onClick={cancelEditing}
            className="text-destructive hover:opacity-80 text-xs"
            title={t('firebaseConsole.cancel') as string}
          >
            ✕
          </button>
        </div>
      );
    }

    const typeColor = {
      string: 'text-success',
      number: 'text-info',
      boolean: 'text-accent-foreground',
      null: 'text-muted-foreground',
      object: 'text-foreground'
    }[node.type];

    let displayValue;
    if (node.type === 'object') {
      const count = Object.keys(node.value || {}).length;
      displayValue = `{${count} ${count === 1 ? 'item' : 'items'}}`;
    } else if (node.type === 'string') {
      displayValue = `"${node.value}"`;
    } else {
      displayValue = String(node.value);
    }

    return (
      <span
        className={`${typeColor} cursor-pointer hover:bg-muted px-1`}
        onClick={() => node.type !== 'object' && startEditing(node)}
        title={node.type !== 'object' ? (t('firebaseConsole.clickToEdit') as string) : ''}
      >
        {displayValue}
      </span>
    );
  };

  const renderTreeLines = (depth: number, isLast: boolean, hasChildren: boolean, isExpanded: boolean) => {
    const lines = [];
    
    // Vertical lines for parent levels
    for (let i = 0; i < depth; i++) {
      lines.push(
        <span key={i} className="text-muted-foreground mr-1">
          │
        </span>
      );
    }

    // Current level connector
    if (depth > 0) {
      lines.push(
        <span key="connector" className="text-muted-foreground mr-1">
          {isLast ? '└' : '├'}─
        </span>
      );
    }

    // Expand/collapse indicator
    if (hasChildren) {
      lines.push(
        <span key="expander" className="text-muted-foreground mr-1">
          {isExpanded ? '─' : '+'}
        </span>
      );
    } else if (depth > 0) {
      lines.push(<span key="spacer" className="mr-2"></span>);
    }
    
    return lines;
  };

  const renderNode = (node: DatabaseNode, depth: number = 0, isLast: boolean = false, useFirestoreLogic: boolean = false): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.type === 'object';
    const isSelected = selectedPath === node.path;
    const isLoading = loadingNodes.has(node.path);
    
    return (
      <div key={node.path} className="select-text">
        <div
          ref={isSelected ? selectedNodeRef : undefined}
          className={`flex items-center py-1 px-2 hover:bg-muted rounded group font-mono text-sm ${
            isSelected
              ? 'bg-info/10 border-l-2 border-info'
              : ''
          }`}
          onClick={() => setSelectedPath(node.path)}
        >
          {/* Tree lines */}
          <div className="flex items-center">
            {renderTreeLines(depth, isLast, hasChildren, isExpanded)}
          </div>

          {/* Expand/Collapse button with loading indicator */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (useFirestoreLogic) {
                  toggleFirestoreNode(node);
                } else {
                  toggleNodeExpansion(node);
                }
              }}
              className="text-muted-foreground hover:text-foreground mr-2 w-4 h-4 flex items-center justify-center"
              disabled={isLoading}
            >
              {isLoading ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : isExpanded ? '▼' : '▶'}
            </button>
          )}
          
          {!hasChildren && <span className="w-6"></span>}

          {/* Type icon */}
          <span className="text-muted-foreground mr-2 text-xs">
            {node.type === 'object' ? '[D]' :
             node.type === 'string' ? '[S]' :
             node.type === 'number' ? '[N]' :
             node.type === 'boolean' ? '[B]' : '[∅]'}
          </span>

          {/* Key */}
          <span className="font-medium text-foreground mr-2">
            {node.key}:
          </span>

          {/* Value */}
          <div className="flex-1 flex items-center space-x-2">
            {renderValue(node)}
          </div>

          {/* Actions */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 ml-2">
            {node.type === 'object' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addNode(node);
                }}
                className="text-success hover:opacity-80 text-xs p-1"
                title={t('firebaseConsole.addChild') as string}
              >
                +
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteNode(node);
              }}
              className="text-destructive hover:opacity-80 text-xs p-1"
              title={t('firebaseConsole.delete') as string}
            >
              ×
            </button>
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && node.children && (
          <div>
            {node.children.map((child, index) => 
              renderNode(child, depth + 1, index === node.children!.length - 1, useFirestoreLogic)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  // Check permissions
  if (!hasPermission('manage_users') && user?.role !== 'developer' && user?.role !== 'super_admin') {
    return (
      <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
        <div className="bg-card text-card-foreground rounded p-6 max-w-md w-full mx-4 border-2 border-border">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Access Denied
          </h3>
          <p className="text-muted-foreground mb-4">
            Firebase Console access is restricted to super_admin and developer roles only.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 border-b-2 border-primary"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
      <div className="bg-card text-card-foreground rounded w-full max-w-7xl h-full max-h-[90vh] flex flex-col border-2 border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-section-header text-section-header-foreground rounded-t">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <svg className="w-6 h-6 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s8-1.79 8-4" />
              </svg>
              <h2 className="text-xl font-bold text-section-header-foreground">
                {t('firebaseConsole.title')}
              </h2>
            </div>

            {/* Tabs */}
            <div className="flex bg-card rounded p-1 border-2 border-border">
              <button
                onClick={() => setActiveTab('realtime')}
                className={`px-3 py-1 rounded text-sm font-medium ${
                  activeTab === 'realtime'
                    ? 'bg-warning/15 text-warning'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('firebaseConsole.tabRealtime')}
              </button>
              <button
                onClick={() => setActiveTab('firestore')}
                className={`px-3 py-1 rounded text-sm font-medium ${
                  activeTab === 'firestore'
                    ? 'bg-warning/15 text-warning'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('firebaseConsole.tabFirestore')}
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-destructive text-2xl font-bold"
            title={t('firebaseConsole.closeTitle') as string}
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between p-3 border-b border-border bg-background">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => activeTab === 'realtime' ? loadRootData() : loadFirestoreCollections()}
              disabled={loading}
              className="flex items-center space-x-2 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm border-b-2 border-primary"
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              <span>{t('firebaseConsole.refresh')}</span>
            </button>

            <div className="text-sm text-muted-foreground">
              {t('firebaseConsole.device')} <span className="font-mono">{deviceId || t('firebaseConsole.none')}</span>
            </div>

            {/* Cache and performance status */}
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <span>{t('firebaseConsole.cache')} {activeTab === 'realtime' && dataCache.realtime ? '✓' : activeTab === 'firestore' && dataCache.firestore ? '✓' : '○'}</span>
              <span>•</span>
              <span className={loading ? 'text-warning' : 'text-success'}>
                {loading ? t('firebaseConsole.loading') : t('firebaseConsole.ready')}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Navigation Path Input with Autocomplete */}
            <div className="flex items-center space-x-2 relative">
              <div className="relative">
                {/* Main input */}
                <input
                  type="text"
                  placeholder={activeTab === 'realtime' ? (t('firebaseConsole.pathPlaceholderRealtime') as string) : (t('firebaseConsole.pathPlaceholderFirestore') as string)}
                  value={navigationPath}
                  onChange={(e) => {
                    setNavigationPath(e.target.value);
                    generateAutocompleteSuggestions(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (showAutocomplete && autocompleteOptions.length > 0) {
                        selectAutocompleteSuggestion(autocompleteOptions[autocompleteIndex], navigateToPath);
                      } else {
                        navigateToPath(navigationPath);
                      }
                    } else if (e.key === 'ArrowRight') {
                      // Accept inline suggestion with arrow right
                      if (inlineSuggestion) {
                        e.preventDefault();
                        acceptInlineSuggestion();
                      }
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (showAutocomplete && autocompleteOptions.length > 0) {
                        const newIndex = autocompleteIndex < autocompleteOptions.length - 1 
                          ? autocompleteIndex + 1 
                          : autocompleteIndex;
                        setAutocompleteIndex(newIndex);
                        scrollToAutocompleteItem(newIndex);
                        // Update inline suggestion to match selected item
                        const selectedPath = autocompleteOptions[newIndex];
                        setInlineSuggestion(selectedPath.substring(navigationPath.length));
                      }
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (showAutocomplete && autocompleteOptions.length > 0) {
                        const newIndex = autocompleteIndex > 0 ? autocompleteIndex - 1 : 0;
                        setAutocompleteIndex(newIndex);
                        scrollToAutocompleteItem(newIndex);
                        // Update inline suggestion to match selected item
                        const selectedPath = autocompleteOptions[newIndex];
                        setInlineSuggestion(selectedPath.substring(navigationPath.length));
                      }
                    } else if (e.key === 'Tab') {
                      e.preventDefault();
                      // Tab accepts inline suggestion
                      if (inlineSuggestion) {
                        acceptInlineSuggestion();
                      } else if (showAutocomplete && autocompleteOptions.length > 0) {
                        // If no inline suggestion, cycle through dropdown
                        const newIndex = (autocompleteIndex + 1) % autocompleteOptions.length;
                        setAutocompleteIndex(newIndex);
                        scrollToAutocompleteItem(newIndex);
                        const selectedPath = autocompleteOptions[newIndex];
                        setInlineSuggestion(selectedPath.substring(navigationPath.length));
                      }
                    } else if (e.key === 'Escape') {
                      setShowAutocomplete(false);
                      setInlineSuggestion('');
                    }
                  }}
                  onFocus={() => {
                    if (navigationPath) {
                      generateAutocompleteSuggestions(navigationPath);
                    }
                  }}
                  onBlur={() => {
                    // Delay hiding to allow clicking on suggestions
                    setTimeout(() => {
                      setShowAutocomplete(false);
                      setInlineSuggestion('');
                    }, 200);
                  }}
                  className="px-3 py-1.5 border border-border rounded text-sm bg-card text-card-foreground w-96 font-mono focus:ring-1 focus:ring-success"
                  style={{ position: 'relative', zIndex: 2, background: 'transparent' }}
                />
                
                {/* Ghost text overlay for inline suggestion */}
                {inlineSuggestion && navigationPath && (
                  <div 
                    className="absolute left-0 top-0 px-3 py-1.5 text-sm font-mono pointer-events-none"
                    style={{ 
                      color: 'transparent',
                      zIndex: 1
                    }}
                  >
                    <span style={{ visibility: 'hidden' }}>{navigationPath}</span>
                    <span className="text-muted-foreground">
                      {inlineSuggestion}
                    </span>
                  </div>
                )}
                
                {/* Autocomplete Dropdown */}
                {showAutocomplete && autocompleteOptions.length > 0 && (
                  <div
                    ref={autocompleteListRef}
                    className="absolute top-full left-0 right-0 mt-1 bg-popover text-popover-foreground border border-border rounded shadow-lg max-h-60 overflow-y-auto z-50 scroll-smooth"
                  >
                    {autocompleteOptions.map((option, index) => (
                      <div
                        key={option}
                        className={`px-3 py-2 cursor-pointer font-mono text-sm transition-colors ${
                          index === autocompleteIndex
                            ? 'bg-success/15 text-success font-semibold'
                            : 'text-foreground hover:bg-muted'
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectAutocompleteSuggestion(option, navigateToPath);
                        }}
                        onMouseEnter={() => setAutocompleteIndex(index)}
                      >
                        {option}
                        {index === autocompleteIndex && (
                          <span className="ml-2 text-xs text-success">
                            ← Tab/Enter
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <button
                onClick={() => navigateToPath(navigationPath)}
                className="px-3 py-1.5 bg-success text-success-foreground rounded hover:opacity-90 text-sm border-b-2 border-success"
                title={t('firebaseConsole.navigateTitle') as string}
              >
                {t('firebaseConsole.go')}
              </button>
              <button
                onClick={clearNavigation}
                className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
                title={t('firebaseConsole.clearNavigationTitle') as string}
              >
                ✕
              </button>
            </div>

          </div>
        </div>

        {/* Database Tree */}
        <div
          ref={consoleRef}
          className="flex-1 overflow-auto p-4 bg-card"
        >
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-muted-foreground">
                {activeTab === 'realtime' ? t('firebaseConsole.loadingDatabase') : t('firebaseConsole.loadingCollections')}
              </div>
            </div>
          ) : activeTab === 'realtime' ? (
            databaseTree.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <div className="text-4xl mb-4">⚠️</div>
                <p>{t('firebaseConsole.noData')}</p>
                <button
                  onClick={() => loadRootData()}
                  className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 border-b-2 border-primary"
                >
                  {t('firebaseConsole.tryAgain')}
                </button>
              </div>
            ) : (
              <div className="space-y-0">
                {databaseTree.map((node, index) => 
                  renderNode(node, 0, index === databaseTree.length - 1, false)
                )}
              </div>
            )
          ) : (
            firestoreCollections.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <div className="text-4xl mb-4">⚠️</div>
                <p>{t('firebaseConsole.noCollections')}</p>
                <button
                  onClick={() => loadFirestoreCollections()}
                  className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 border-b-2 border-primary"
                >
                  {t('firebaseConsole.tryAgain')}
                </button>
              </div>
            ) : (
              <div className="space-y-0">
                {firestoreCollections.map(node => (
                  <div key={node.path} className="select-text">
                    <div
                      className={`flex items-center py-1 px-2 hover:bg-muted rounded group font-mono text-sm ${
                        selectedPath === node.path ? 'bg-info/10 border-l-2 border-info' : ''
                      }`}
                      onClick={() => setSelectedPath(node.path)}
                    >
                      {/* Expand/Collapse Icon */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFirestoreNode(node);
                        }}
                        className="text-muted-foreground hover:text-foreground mr-2 w-4 h-4 flex items-center justify-center"
                      >
                        {expandedPaths.has(node.path) ? '▼' : '▶'}
                      </button>

                      {/* Collection Icon */}
                      <span className="text-muted-foreground mr-2 text-xs">[C]</span>

                      {/* Collection Name */}
                      <span className="font-medium text-foreground mr-2">
                        {node.key}
                      </span>

                      {/* Document Count */}
                      <div className="flex-1 text-muted-foreground">
                        {node.value && (node.value as any)._error ? (
                          <span className="text-destructive">
                            {t('firebaseConsole.errorLoadingCollection')}
                          </span>
                        ) : (
                          t('firebaseConsole.documentsCount_other', { count: Object.keys(node.value || {}).filter((key: string) => key !== '_error').length })
                        )}
                      </div>
                    </div>

                    {/* Documents */}
                    {expandedPaths.has(node.path) && node.children && (
                      <div className="ml-6">
                        {node.children.map((doc, index) => 
                          renderNode(doc, 1, index === node.children!.length - 1, true)
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border bg-background">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-4">
              <span>{t('firebaseConsole.footerHint')}</span>
              {selectedPath && (
                <span className="font-mono bg-muted px-2 py-1">
                  Selected: {selectedPath}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <span>{t('firebaseConsole.typesLegend')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FirebaseConsole; 