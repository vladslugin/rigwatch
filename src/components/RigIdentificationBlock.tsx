import React, { useState, useCallback, useEffect } from 'react';
import { useRigStore } from '../store/useRigStore';
import { ref, get, set } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

const RigIdentificationBlock: React.FC = () => {
  const deviceId = useRigStore(state => state.deviceId);
  
  const [selectedRigtyp, setSelectedRigtyp] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  
  // Input states for creating new rig
  const [inputRigSerial, setInputRigSerial] = useState<string>('');
  const [inputControllerSerial, setInputControllerSerial] = useState<string>('');
  const [nextFepaUID, setNextFepaUID] = useState<string>('—');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingRigtyp, setIsSavingRigtyp] = useState(false);
  const [isCreatingRig, setIsCreatingRig] = useState(false);


  // Find maximum FEPA UID globally from all rigs in fepaliste
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
      console.error('[RigIdentificationBlock] Error finding max FEPA UID:', error);
      return 91000000;
    }
  }, []);

  // Load rig identification data
  const loadRigData = useCallback(async () => {
    if (!realtimeDB) return;

    setIsLoading(true);
    try {
      // Find maximum FEPA UID globally and calculate next one
      const maxUID = await findMaxFepaUID();
      const nextUID = maxUID + 1;
      setNextFepaUID(String(nextUID).padStart(8, '0'));

    } catch (error) {
      console.error('[RigIdentificationBlock] Error loading rig data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [findMaxFepaUID]);

  // Load available models from Firestore rig_models collection
  const loadAvailableModels = useCallback(async () => {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const { firestoreDB } = await import('../lib/firebase');

      if (!firestoreDB) {
        console.error('[RigIdentificationBlock] Firestore not initialized');
        setAvailableModels([]);
        return;
      }

      const rigModelsRef = collection(firestoreDB, 'rig_models');
      const querySnapshot = await getDocs(rigModelsRef);

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
      console.error('[RigIdentificationBlock] Error loading models from Firestore:', error);
      setAvailableModels([]);
    }
  }, []);

  // Update FEPA UID when input fields change
  useEffect(() => {
    const updateFepaUID = async () => {
      if (inputRigSerial.trim() && inputControllerSerial.trim()) {
        const maxUID = await findMaxFepaUID();
        const nextUID = maxUID + 1;
        setNextFepaUID(String(nextUID).padStart(8, '0'));
      } else {
        setNextFepaUID('—');
      }
    };

    updateFepaUID();
  }, [inputRigSerial, inputControllerSerial, findMaxFepaUID]);

  // Load data on mount and when deviceId changes
  useEffect(() => {
    loadRigData();
    loadAvailableModels();
  }, [loadRigData, loadAvailableModels]);

  // Handle Rigtyp change
  const handleRigtypChange = useCallback(async (newValue: string) => {
    if (!realtimeDB) return;

    setIsSavingRigtyp(true);
    try {
      // Only save to device-specific path if deviceId exists
      if (deviceId) {
        const verzRef = ref(realtimeDB, `konstant/${deviceId}/verz`);
        await set(verzRef, newValue);
      }

      setSelectedRigtyp(newValue);
    } catch (error) {
      console.error('[RigIdentificationBlock] Error saving Rigtyp:', error);
    } finally {
      setIsSavingRigtyp(false);
    }
  }, []);

  // Get rig model data from Firestore
  const getRigModelData = useCallback(async (modelName: string): Promise<{ articleNumber: number; softwareId: number } | null> => {
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { firestoreDB } = await import('../lib/firebase');

      if (!firestoreDB) throw new Error('Firestore not initialized');

      // Query rig_models collection where name field matches the selected model
      const rigModelsRef = collection(firestoreDB, 'rig_models');
      const q = query(rigModelsRef, where('name', '==', modelName));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        console.error('[RigIdentificationBlock] Model not found in Firestore:', modelName);
        return null;
      }

      const modelData = querySnapshot.docs[0].data();
      const articleNumber = parseInt(modelData.article_number, 10) || 0;
      const softwareId = parseInt(modelData.software_id, 10) || 0;

      return { articleNumber, softwareId };
    } catch (error) {
      console.error('[RigIdentificationBlock] Error fetching model data:', error);
      return null;
    }
  }, []);

  // Handle "Rig anlegen" button
  const handleCreateNewRig = useCallback(async () => {
    if (!realtimeDB || !selectedRigtyp) {
      alert('Please select Sie zuerst einen Rigtyp aus!');
      return;
    }

    // Validate inputs
    if (!inputRigSerial.trim() || !inputControllerSerial.trim()) {
      alert('Bitte füllen Sie Seriennummer des Rigs und des Controllers aus!');
      return;
    }

    // Validate that serial numbers are valid numbers
    const rigSerialNum = parseInt(inputRigSerial.trim(), 10);
    const controllerSerialNum = parseInt(inputControllerSerial.trim(), 10);

    if (isNaN(rigSerialNum) || isNaN(controllerSerialNum)) {
      alert('Seriennummern müssen gültige Zahlen sein!');
      return;
    }

    if (rigSerialNum <= 0 || controllerSerialNum <= 0) {
      alert('Seriennummern müssen positive Zahlen sein!');
      return;
    }

    // Get latest FEPA UID before confirmation to avoid race conditions
    const latestMaxUID = await findMaxFepaUID();
    const actualNextUID = latestMaxUID + 1;
    const actualNextFepaUID = String(actualNextUID).padStart(8, '0');
    const newCompleteId = `${rigSerialNum}${controllerSerialNum}${actualNextFepaUID}`;

    const confirmed = window.confirm(
      `Möchten Sie wirklich einen neuen Rig anlegen?\n\n` +
      `Rig-Seriennummer: ${rigSerialNum}\n` +
      `Controller-Seriennummer: ${controllerSerialNum}\n` +
      `Rigtyp: ${selectedRigtyp}\n` +
      `Neue ID: ${newCompleteId}\n` +
      `FEPA UID: ${actualNextFepaUID}\n\n` +
      `Dies erstellt neue Einträge in der Datenbank.`
    );

    if (!confirmed) return;

    setIsCreatingRig(true);

    try {
      // 1. Get model data from Firestore
      const modelData = await getRigModelData(selectedRigtyp);
      if (!modelData) {
        alert('Fehler: Modelldaten nicht in Firestore gefunden!');
        return;
      }

      const { articleNumber, softwareId } = modelData;

      // 2. Use validated input values
      const rigSerialNumber = String(rigSerialNum);

      // 3. Use the FEPA UID that was already calculated and confirmed in the popup
      const uid = actualNextUID;

      // 4. Create entry in controllertausch/fepaliste/<Rig-Seriennummer>
      const fepalisteData = {
        a: articleNumber,
        csnr_akt: controllerSerialNum,
        csnr: controllerSerialNum,
        discard: false,
        rig: softwareId,
        uid: uid
      };

      const fepalisteRef = ref(realtimeDB, `controllertausch/fepaliste/${rigSerialNumber}`);
      await set(fepalisteRef, fepalisteData);


      // 5. Create entry in konstant_app/<ID> for the NEW rig
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

      // 6. Create entry in konstant/<ID> for the NEW rig
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
        `Neuer Rig erfolgreich angelegt!\n\n` +
        `Neue ID: ${newCompleteId}\n` +
        `UID: ${uid}\n` +
        `Artikelnummer: ${articleNumber}\n` +
        `Software ID: ${softwareId}`
      );

      // Clear input fields after successful creation
      setInputRigSerial('');
      setInputControllerSerial('');
      setNextFepaUID('—');

      // Reload data to reflect changes
      await loadRigData();

    } catch (error) {
      console.error('[RigIdentificationBlock] Error creating new rig:', error);
      alert('Fehler beim Anlegen des neuen Rigs! Siehe Console für Details.');
    } finally {
      setIsCreatingRig(false);
    }
  }, [selectedRigtyp, inputRigSerial, inputControllerSerial, getRigModelData, loadRigData, findMaxFepaUID]);

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
            Neuen Rig anlegen
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
            {/* Row 1: Seriennummer des Rigs, Seriennummer des Controllers, FEPA-Nummer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* Seriennummer des Rigs (Editable) */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Seriennummer des Rigs
                </div>
                <input
                  type="text"
                  value={inputRigSerial}
                  onChange={(e) => setInputRigSerial(e.target.value)}
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
                    {inputRigSerial && inputControllerSerial && nextFepaUID !== '—'
                      ? `${inputRigSerial}${inputControllerSerial}${nextFepaUID}`
                      : '—'
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Row 2: Rigtyp selector and Create button */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* Rigtyp Selector */}
              <div className="p-2 bg-card rounded border border-border">
                <div className="text-xs text-muted-foreground mb-0.5">
                  Rigtyp
                </div>
                <select
                  value={selectedRigtyp}
                  onChange={(e) => handleRigtypChange(e.target.value)}
                  disabled={isSavingRigtyp || availableModels.length === 0}
                  className="w-full px-2 py-1 text-xs font-semibold bg-card border border-border rounded text-foreground focus:ring-1 focus:ring-ring focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {availableModels.length === 0 ? 'No models' : 'Select model...'}
                  </option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              {/* Create New Rig Button */}
              <div className="p-2 bg-card rounded border border-border flex items-end">
                <button
                  onClick={handleCreateNewRig}
                  disabled={isCreatingRig || !selectedRigtyp}
                  className="w-full px-2 py-1 bg-success hover:bg-success/80 disabled:bg-muted text-success-foreground text-xs font-semibold rounded transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {isCreatingRig ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Anlegen...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Rig anlegen</span>
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

export default RigIdentificationBlock;

