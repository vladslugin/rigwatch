import { useCallback, useMemo } from 'react';
import { useRigStore, useNotificationHelpers } from '../store/useRigStore';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { firestoreDB } from '../lib/firebase';

export const useCategoryManager = (temporaryCategories: string[] = []) => {
  const { showSuccess, showError } = useNotificationHelpers();
  const parameters = useRigStore(state => state.discoveredParameters);
  const updateParameterMetadata = useRigStore(state => state.updateParameterMetadata);

  // Get all existing categories from parameters + temporary categories
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    
    // Add real categories from Firebase
    parameters.forEach(param => {
      // Use any type to bypass linter error for now
      const kategorie = (param as any).kategorie;
      if (kategorie && kategorie.trim()) {
        categories.add(kategorie);
      }
    });
    
    // Add temporary categories
    temporaryCategories.forEach(category => {
      if (category && category.trim()) {
        categories.add(category);
      }
    });
    
    return Array.from(categories).sort();
  }, [parameters, temporaryCategories]);

  // Create a new category (just a placeholder for now)
  const createCategory = useCallback(async (categoryName: string): Promise<void> => {
    if (!categoryName.trim()) {
      showError('Category name cannot be empty');
      return;
    }

    if (availableCategories.includes(categoryName.trim())) {
      showError('Category already exists');
      return;
    }

    showSuccess(`Category "${categoryName}" will be created when you assign parameters to it.`);
  }, [availableCategories, showSuccess, showError]);

  // Rename category by updating all parameters that use it
  const renameCategory = useCallback(async (oldName: string, newName: string): Promise<void> => {
    if (!oldName || !newName.trim()) {
      showError('Invalid category names');
      return;
    }

    if (oldName === newName.trim()) {
      return;
    }

    if (availableCategories.includes(newName.trim()) && newName.trim() !== oldName) {
      showError('Category with that name already exists');
      return;
    }

    try {
      if (!firestoreDB) {
        showError('Firebase not initialized');
        return;
      }

      // Get all parameters with this category
      const parametersToUpdate = parameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return kategorie === oldName;
      });

      if (parametersToUpdate.length === 0) {
        showSuccess('No parameters to update');
        return;
      }

      // Create a batch update
      const batch = writeBatch(firestoreDB);

      // Update each parameter in Firebase
      parametersToUpdate.forEach(param => {
        const paramRef = doc(firestoreDB!, 'masse_und_gewichte', param.originalName);
        batch.set(paramRef, { kategorie: newName.trim() }, { merge: true });
      });

      await batch.commit();

      // Update local state
      parametersToUpdate.forEach(param => {
        updateParameterMetadata(param.originalName, { 
          kategorie: newName.trim() 
        } as any);
      });

      showSuccess(`Category renamed from "${oldName}" to "${newName}". Updated ${parametersToUpdate.length} parameters.`);
      console.log(`[CategoryManager] Successfully renamed category "${oldName}" to "${newName}" for ${parametersToUpdate.length} parameters`);
    } catch (error) {
      console.error('Failed to rename category:', error);
      showError('Failed to rename category');
    }
  }, [availableCategories, parameters, updateParameterMetadata, showSuccess, showError]);

  // Delete category and move all its parameters to uncategorized
  const deleteCategory = useCallback(async (categoryName: string): Promise<void> => {
    if (!categoryName) {
      showError('Invalid category name');
      return;
    }

    try {
      if (!firestoreDB) {
        showError('Firebase not initialized');
        return;
      }

      // Get all parameters with this category
      const parametersToUpdate = parameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return kategorie === categoryName;
      });

      if (parametersToUpdate.length === 0) {
        showSuccess('Category is empty - nothing to update');
        return;
      }

      // Create a batch update to set all parameters to uncategorized
      const batch = writeBatch(firestoreDB);

      // Update each parameter in Firebase (set kategorie to empty string)
      parametersToUpdate.forEach(param => {
        const paramRef = doc(firestoreDB!, 'masse_und_gewichte', param.originalName);
        batch.set(paramRef, { kategorie: '' }, { merge: true });
      });

      await batch.commit();

      // Update local state
      parametersToUpdate.forEach(param => {
        updateParameterMetadata(param.originalName, { 
          kategorie: '' 
        } as any);
      });

      showSuccess(`Category "${categoryName}" deleted. ${parametersToUpdate.length} parameters moved to uncategorized.`);
      console.log(`[CategoryManager] Successfully deleted category "${categoryName}" and moved ${parametersToUpdate.length} parameters to uncategorized`);
    } catch (error) {
      console.error('Failed to delete category:', error);
      showError('Failed to delete category');
    }
  }, [parameters, updateParameterMetadata, showSuccess, showError]);

  // Update a parameter's category
  const updateParameterCategory = useCallback(async (paramId: string, category: string | null): Promise<void> => {
    try {
      if (!firestoreDB) {
        showError('Firebase not initialized');
        return;
      }

      const paramRef = doc(firestoreDB, 'masse_und_gewichte', paramId);
      
      // Update in Firebase - use proper field name and handle null/empty values
      const updateData: any = {};
      if (category && category.trim()) {
        updateData.kategorie = category.trim();
        
        // If this is a temporary category (first parameter being added to it), 
        // it becomes a real category automatically when we save to Firebase
        if (temporaryCategories.includes(category.trim())) {
          console.log(`[CategoryManager] Temporary category "${category}" is now becoming permanent with first parameter`);
        }
      } else {
        // To remove field from Firebase, we need to use deleteField() or set to null
        updateData.kategorie = '';
      }
      
      console.log(`[CategoryManager] Updating Firebase for ${paramId} with category: "${category}"`);
      await setDoc(paramRef, updateData, { merge: true });

      // Update local state - make sure to use the same value we saved to Firebase
      updateParameterMetadata(paramId, { 
        kategorie: updateData.kategorie 
      } as any);

      const parameter = parameters.find(p => p.originalName === paramId);
      const paramName = parameter?.displayName || paramId;

      if (category && category.trim()) {
        showSuccess(`${paramName} moved to category "${category}"`);
        console.log(`[CategoryManager] Successfully updated ${paramId} to category "${category}"`);
      } else {
        showSuccess(`${paramName} moved to uncategorized`);
        console.log(`[CategoryManager] Successfully removed category from ${paramId}`);
      }
    } catch (error) {
      console.error('Failed to update parameter category:', error);
      showError('Failed to update parameter category');
    }
  }, [parameters, updateParameterMetadata, showSuccess, showError, temporaryCategories]);

  return {
    availableCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    updateParameterCategory,
  };
}; 