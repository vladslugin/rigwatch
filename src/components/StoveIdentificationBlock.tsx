import React, { useState, useCallback, useEffect } from 'react';
import { useStoveStore } from '../store/useStoveStore';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

const StoveIdentificationBlock: React.FC = () => {
  const deviceId = useStoveStore(state => state.deviceId);
  
  const [selectedOfentyp, setSelectedOfentyp] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  
  // Input states for creating new stove
  const [inputStoveSerial, setInputStoveSerial] = useState<string>('');
  const [inputControllerSerial, setInputControllerSerial] = useState<string>('');
  const [nextFepaUID, setNextFepaUID] = useState<string>('—');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingOfentyp, setIsSavingOfentyp] = useState(false);
  const [isCreatingStove, setIsCreatingStove] = useState(false);


  // Find maximum FEPA UID globally from all stoves in fepaliste
  const findMaxFepaUID = useCallback(async (): Promise<number> => {
    if (!realtimeDB) return 91000000;

    try {
      const fepalisteRef = ref(realtimeDB, 'controllertausch/fepaliste');
      const snapshot = await get(fepalisteRef);

      if (!snapshot.exists()) {
        return 91000000;
      }

      let maxUID = 91000000;

      snapshot.forEach((child) => {
        const data = child.val();
        if (data && typeof data.uid === 'number') {
          if (data.uid > maxUID) {
            maxUID = data.uid;
          }
        }
      });

      return maxUID;

    } catch (error) {
      console.error('[StoveIdentificationBlock] Error finding max FEPA UID:', error);
      return 91000000;
    }
  }, []);

  // Load stove identification data
  const loadStoveData = useCallback(async () => {
    if (!realtimeDB) return;

    setIsLoading(true);
    try {
      // Find maximum FEPA UID globally and calculate next one
      const maxUID = await findMaxFepaUID();
      const nextUID = maxUID + 1;
      setNextFepaUID(String(nextUID).padStart(8, '0'));

    } catch (error) {
      console.error('[StoveIdentificationBlock] Error loading stove data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [findMaxFepaUID]);

  // Load available models from Firestore stove_models collection
  const loadAvailableModels = useCallback(async () => {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const { firestoreDB } = await import('../lib/firebase');

      if (!firestoreDB) {
        console.error('[StoveIdentificationBlock] Firestore not initialized');
        setAvailableModels([]);
        return;
      }

      const stoveModelsRef = collection(firestoreDB, 'stove_models');
      const querySnapshot = await getDocs(stoveModelsRef);

      if (!querySnapshot.empty) {
        const models: string[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data && data.name) {
            models.push(data.name);
          }
        });
        models.sort();
        setAvailableModels(models);
      } else {
        setAvailableModels([]);
      }
    } catch (error) {
      console.error('[StoveIdentificationBlock] Error loading models from Firestore:', error);
      setAvailableModels([]);
    }
  }, []);

  // Update FEPA UID when input fields change
  useEffect(() => {
    const updateFepaUID = async () => {
      if (inputStoveSerial.trim() && inputControllerSerial.trim()) {
        const maxUID = await findMaxFepaUID();
        const nextUID = maxUID + 1;
        setNextFepaUID(String(nextUID).padStart(8, '0'));
      } else {
        setNextFepaUID('—');
      }
    };

    updateFepaUID();
  }, [inputStoveSerial, inputControllerSerial, findMaxFepaUID]);

  // Load data on mount and when deviceId changes
  useEffect(() => {
    loadStoveData();
    loadAvailableModels();
  }, [loadStoveData, loadAvailableModels]);

  // Handle Ofentyp change
  const handleOfentypChange = useCallback(async (newValue: string) => {
    if (!realtimeDB) return;

    setIsSavingOfentyp(true);
    try {
      // Only save to device-specific path if deviceId exists
      if (deviceId) {
        const verzRef = ref(realtimeDB, `konstant/${deviceId}/verz`);
        await set(verzRef, newValue);
      }

      setSelectedOfentyp(newValue);
    } catch (error) {
      console.error('[StoveIdentificationBlock] Error saving Ofentyp:', error);
    } finally {
      setIsSavingOfentyp(false);
    }
  }, []);

  // Get stove model data from Firestore
  const getStoveModelData = useCallback(async (modelName: string): Promise<{ articleNumber: number; softwareId: number } | null> => {
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { firestoreDB } = await import('../lib/firebase');

      if (!firestoreDB) throw new Error('Firestore not initialized');

      // Query stove_models collection where name field matches the selected model
      const stoveModelsRef = collection(firestoreDB, 'stove_models');
      const q = query(stoveModelsRef, where('name', '==', modelName));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        console.error('[StoveIdentificationBlock] Model not found in Firestore:', modelName);
        return null;
      }

      const modelData = querySnapshot.docs[0].data();
      const articleNumber = parseInt(modelData.article_number, 10) || 0;
      const softwareId = parseInt(modelData.software_id, 10) || 0;

      return { articleNumber, softwareId };
    } catch (error) {
      console.error('[StoveIdentificationBlock] Error fetching model data:', error);
      return null;
    }
  }, []);

  // Handle "Ofen anlegen" button
  const handleCreateNewStove = useCallback(async () => {
    if (!realtimeDB || !selectedOfentyp) {
      alert('Bitte wählen Sie zuerst einen Ofentyp aus!');
      return;
    }

    // Validate inputs
    if (!inputStoveSerial.trim() || !inputControllerSerial.trim()) {
      alert('Bitte füllen Sie Seriennummer des Ofens und des Controllers aus!');
      return;
    }

    // Validate that serial numbers are valid numbers
    const stoveSerialNum = parseInt(inputStoveSerial.trim(), 10);
    const controllerSerialNum = parseInt(inputControllerSerial.trim(), 10);

    if (isNaN(stoveSerialNum) || isNaN(controllerSerialNum)) {
      alert('Seriennummern müssen gültige Zahlen sein!');
      return;
    }

    if (stoveSerialNum <= 0 || controllerSerialNum <= 0) {
      alert('Seriennummern müssen positive Zahlen sein!');
      return;
    }

    // Get latest FEPA UID before confirmation to avoid race conditions
    const latestMaxUID = await findMaxFepaUID();
    const actualNextUID = latestMaxUID + 1;
    const actualNextFepaUID = String(actualNextUID).padStart(8, '0');
    const newCompleteId = `${stoveSerialNum}${controllerSerialNum}${actualNextFepaUID}`;

    const confirmed = window.confirm(
      `Möchten Sie wirklich einen neuen Ofen anlegen?\n\n` +
      `Ofen-Seriennummer: ${stoveSerialNum}\n` +
      `Controller-Seriennummer: ${controllerSerialNum}\n` +
      `Ofentyp: ${selectedOfentyp}\n` +
      `Neue ID: ${newCompleteId}\n` +
      `FEPA UID: ${actualNextFepaUID}\n\n` +
      `Dies erstellt neue Einträge in der Datenbank.`
    );

    if (!confirmed) return;

    setIsCreatingStove(true);

    try {
      // 1. Get model data from Firestore
      const modelData = await getStoveModelData(selectedOfentyp);
      if (!modelData) {
        alert('Fehler: Modelldaten nicht in Firestore gefunden!');
        return;
      }

      const { articleNumber, softwareId } = modelData;

      // 2. Use validated input values
      const stoveSerialNumber = String(stoveSerialNum);

      // 3. Use the FEPA UID that was already calculated and confirmed in the popup
      const uid = actualNextUID;

      // 4. Create entry in controllertausch/fepaliste/<Ofen-Seriennummer>
      const fepalisteData = {
        a: articleNumber,
        csnr_akt: controllerSerialNum,
        csnr: controllerSerialNum,
        discard: false,
        ofen: softwareId,
        uid: uid
      };

      const fepalisteRef = ref(realtimeDB, `controllertausch/fepaliste/${stoveSerialNumber}`);
      await set(fepalisteRef, fepalisteData);


      // 5. Create entry in konstant_app/<ID> for the NEW stove
      const konstantAppData = {
        a: articleNumber,
        c: false,
        ecode: 0,
        n: false,
        shareData: false,
        v: false
      };

      const konstantAppRef = ref(realtimeDB, `konstant_app/${newCompleteId}`);
      await set(konstantAppRef, konstantAppData);

      // 6. Create entry in konstant/<ID> for the NEW stove
      const konstantData = {
        d: false,
        k: 0,
        l: 100,
        p: 0,
        s: 100,
        u: false
      };

      const konstantRef = ref(realtimeDB, `konstant/${newCompleteId}`);
      await set(konstantRef, konstantData);

      alert(
        `Neuer Ofen erfolgreich angelegt!\n\n` +
        `Neue ID: ${newCompleteId}\n` +
        `UID: ${uid}\n` +
        `Artikelnummer: ${articleNumber}\n` +
        `Software ID: ${softwareId}`
      );

      // Clear input fields after successful creation
      setInputStoveSerial('');
      setInputControllerSerial('');
      setNextFepaUID('—');

      // Reload data to reflect changes
      await loadStoveData();

    } catch (error) {
      console.error('[StoveIdentificationBlock] Error creating new stove:', error);
      alert('Fehler beim Anlegen des neuen Ofens! Siehe Console für Details.');
    } finally {
      setIsCreatingStove(false);
    }
  }, [selectedOfentyp, inputStoveSerial, inputControllerSerial, getStoveModelData, loadStoveData, findMaxFepaUID]);

  return (
    <div className="bg-muted rounded border-2 border-border flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-section-header text-section-header-foreground px-3 py-2">
        <h2 className="text-sm font-semibold flex items-center">
          <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 text-info"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <span>
            Neuen Ofen anlegen
          </span>
        </h2>
      </div>

      {/* Content */}
      <div className="p-3 transition-colors flex-1 text-foreground">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-info border-t-transparent rounded-full animate-spin"></div>
            <span className="ml-2 text-sm text-muted-foreground">Lädt...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Row 1: Seriennummer des Ofens, Seriennummer des Controllers, FEPA-Nummer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* Seriennummer des Ofens (Editable) */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Seriennummer des Ofens
                </div>
                <input
                  type="text"
                  value={inputStoveSerial}
                  onChange={(e) => setInputStoveSerial(e.target.value)}
                  className="w-full px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:ring-1 focus:ring-ring text-foreground"
                  placeholder="z.B. 1000021"
                />
              </div>

              {/* Seriennummer des Controllers (Editable) */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Seriennummer des Controllers
                </div>
                <input
                  type="text"
                  value={inputControllerSerial}
                  onChange={(e) => setInputControllerSerial(e.target.value)}
                  className="w-full px-2 py-1 text-xs font-mono bg-muted border border-border rounded focus:ring-1 focus:ring-ring text-foreground"
                  placeholder="z.B. 3000565"
                />
              </div>

              {/* Neue ID (Display only - shows the new complete ID) */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Neue ID
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-success">Neu:</span>
                  <span className="font-mono font-semibold text-success">
                    {inputStoveSerial && inputControllerSerial && nextFepaUID !== '—'
                      ? `${inputStoveSerial}${inputControllerSerial}${nextFepaUID}`
                      : '—'
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Ofentyp selector and Create button */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* Ofentyp Selector */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Ofentyp
                </div>
                <select
                  value={selectedOfentyp}
                  onChange={(e) => handleOfentypChange(e.target.value)}
                  disabled={isSavingOfentyp || availableModels.length === 0}
                  className="w-full px-2 py-1 text-xs font-semibold bg-card border border-border rounded text-foreground focus:ring-1 focus:ring-ring focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {availableModels.length === 0 ? 'Keine Modelle' : 'Modell wählen...'}
                  </option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              {/* Create New Stove Button */}
              <div className="p-2 bg-card rounded border border-border flex items-end">
                <button
                  onClick={handleCreateNewStove}
                  disabled={isCreatingStove || !selectedOfentyp}
                  className="w-full px-2 py-1 bg-success hover:bg-success/80 disabled:bg-muted text-success-foreground text-xs font-semibold rounded transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {isCreatingStove ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Anlegen...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Ofen anlegen</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoveIdentificationBlock;

