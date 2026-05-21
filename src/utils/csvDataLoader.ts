import type { CO2TrainingData } from '../types';

export interface CSVFileInfo {
  fileName: string;
  rowCount: number;
  columns: string[];
  encoding: string;
  hasRealCO2: boolean;
  sampleCount: number;
}

export interface CSVLoadResult {
  success: boolean;
  info: CSVFileInfo;
  data: CO2TrainingData[];
  error?: string;
}

export class CSVDataLoader {
  private loadedFiles: Map<string, CO2TrainingData[]> = new Map();
  
  /**
   * Auto-detect and load all available CSV files
   */
  async autoLoadAvailableFiles(): Promise<CSVLoadResult[]> {
    const results: CSVLoadResult[] = [];
    
    // List of common CSV file locations
    const locations = [
      'src/data/',
      'public/data/',
      'data/'
    ];
    
    for (const location of locations) {
      try {
        const files = await this.scanDirectory(location);
        
        for (const file of files) {
          const result = await this.loadCSVFile(file);
          if (result.success) {
            results.push(result);
          }
        }
      } catch (error) {
        // ignore missing location
      }
    }
    
    return results;
  }
  
  /**
   * Load a specific CSV file with German format support
   */
  async loadCSVFile(filePath: string): Promise<CSVLoadResult> {
    try {
      // Try to fetch the file
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
      }
      
      const text = await response.text();
      const result = this.parseCSVContent(text, filePath);
      
      // Store in cache and log only successful loads
      if (result.success) {
        this.loadedFiles.set(result.info.fileName, result.data);
      }
      
      return result;
      
    } catch (error) {
      return {
        success: false,
        info: {
          fileName: filePath.split('/').pop() || filePath,
          rowCount: 0,
          columns: [],
          encoding: 'unknown',
          hasRealCO2: false,
          sampleCount: 0
        },
        data: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Parse CSV content with new clean data format
   */
  private parseCSVContent(text: string, filePath: string): CSVLoadResult {
    const fileName = filePath.split('/').pop() || filePath;
    
    try {
      // Split into lines and remove empty ones
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      
      if (lines.length < 2) {
        throw new Error('CSV file must have at least header and one data row');
      }
      
      // Parse header (first non-empty line)
      const headerLine = lines[0];
      
      // Detect separator - usually tab-separated or comma-separated
      const separator = headerLine.includes('\t') ? '\t' : (headerLine.includes(',') ? ',' : ';');
      
      // Parse headers
      const headers = headerLine.split(separator).map(h => h.trim().replace(/"/g, ''));
      
      // Map columns for new clean format
      // SMART MAPPING: Handle different CSV formats and detect timestamp pollution
      // Expected: timestamp, T, o2, pl, sl, Tquer, m, co2, TN, rel_t
      let timestampCol = this.findColumn(headers, ['timestamp', 't', 'time']);
      let TCol = this.findColumn(headers, ['T', 'temp', 'temperature']);
      
      // If we can't find proper columns, try alternative mappings
      if (timestampCol === -1 && TCol === -1) {
        console.warn(`[CSV Debug] ${fileName} - Standard mapping failed, trying alternatives...`);
        // Maybe columns are named differently
        timestampCol = 0; // First column might be timestamp
        TCol = headers.findIndex(h => h.toLowerCase().includes('temp')); // Any temperature column
      }
      
      const o2Col = this.findColumn(headers, ['o2', 'O2', 'oxygen']);
      const plCol = this.findColumn(headers, ['pl', 'PL', 'primary_air']);
      const slCol = this.findColumn(headers, ['sl', 'SL', 'secondary_air']);
      const TquerCol = this.findColumn(headers, ['Tquer', 'TQUER', 'temp_avg']);
      const mCol = this.findColumn(headers, ['m', 'M']);
      const co2Col = this.findColumn(headers, ['co2', 'CO2']);
      const TNCol = this.findColumn(headers, ['TN', 'tn', 'temp_start']);
      const relTCol = this.findColumn(headers, ['rel_t', 'rel_time', 'cycle_time']);
      
      // Check if this looks like HTML content
      const firstHeader = headers[0]?.toLowerCase() || '';
      if (firstHeader.includes('<!doctype') || 
          firstHeader.includes('<html') ||
          firstHeader.includes('<body') ||
          firstHeader.includes('error') ||
          firstHeader.includes('404')) {
        throw new Error(`File contains HTML/error content instead of CSV data. Content: ${firstHeader}`);
      }
      
      // Require essential columns for the new format
      if (timestampCol === -1 || co2Col === -1 || TCol === -1) {
        throw new Error(`Required columns not found. Need timestamp, T, co2 columns. Found: ${headers.join(', ')}`);
      }
      
      // Parse data rows
      const trainingData: CO2TrainingData[] = [];
      let realCO2Count = 0;
      let debugSampleCount = 0;
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        
        try {
          const values = line.split(separator).map(v => v.trim().replace(/"/g, ''));
          
          const getNumericValue = (colIndex: number, defaultValue: number = 0): number => {
            if (colIndex === -1 || values[colIndex] === undefined || values[colIndex].trim() === '') return defaultValue;
            // Replace German comma decimal with period
            const numericStr = values[colIndex].replace(',', '.');
            const val = parseFloat(numericStr);
            return isNaN(val) ? defaultValue : val;
          };

          // Extract values from new clean format
          const timestamp = getNumericValue(timestampCol);
          const T = getNumericValue(TCol);
          
          // SMART DETECTION: Check if timestamp/temperature columns are swapped
          // Temperature should be 20-800°C, timestamp should be > 1600000000 (year 2020+)
          let finalTimestamp = timestamp;
          let finalT = T;
          
          if (debugSampleCount === 0) { // Check only on first row for efficiency
            const timestampLooksLikeTemp = timestamp >= 20 && timestamp <= 800;
            const tempLooksLikeTimestamp = T > 1600000000; // Unix timestamp since 2020
            
            if (timestampLooksLikeTemp && tempLooksLikeTimestamp) {
              console.warn(`[CSV Debug] ${fileName} - DETECTED SWAPPED COLUMNS! Swapping timestamp<->T`);
              console.warn(`  timestamp column contains: ${timestamp} (looks like temperature)`);
              console.warn(`  T column contains: ${T} (looks like timestamp)`);
              
              // Swap the values for ALL further processing in this row
              finalTimestamp = T;
              finalT = timestamp;
            }
          }
          
          // ---------------------------------------------
          // EXTRA SAFEGUARD (row-level): if after initial
          // check we still have clearly wrong values, run
          // automatic swap/correction for THIS row only.
          // ---------------------------------------------
          const tempLooksInvalid = finalT > 10000;
          const potentialTempFromTimestamp = finalTimestamp >= 20 && finalTimestamp <= 800;

          if (tempLooksInvalid && potentialTempFromTimestamp) {
            // Swap values **only for this row** to avoid polluting dataset
            console.warn(`[CSV Debug] ${fileName} Row ${i}: Auto-correcting swapped timestamp/temperature (row-level)`);
            const tmp = finalTimestamp;
            finalTimestamp = finalT;
            finalT = tmp;
          }
          
          const o2 = getNumericValue(o2Col, 20.7); // Default to atmospheric
          const pl = getNumericValue(plCol);
          const sl = getNumericValue(slCol);
          const Tquer = getNumericValue(TquerCol, finalT); // Default to corrected T if missing
          const m = getNumericValue(mCol);
          const co2Raw = getNumericValue(co2Col);
          const TN = getNumericValue(TNCol, Tquer); // Default to Tquer if missing
          const rel_t = getNumericValue(relTCol);

          // Log first few samples for debugging
          if (debugSampleCount < 3) {
            // (debug omitted)
          }

          // Convert CO2 from raw value to percentage: co2_percentage = co2_raw / 204.73
          const co2Percentage = co2Raw / 204.73;
          
          if (debugSampleCount < 3) {
            // (debug omitted)
          }
          
          if (co2Percentage > 0) realCO2Count++;
          debugSampleCount++;

          // Calculate additional derived features (FIXED - no more timestamp pollution)
          const airRatio = sl > 0 ? pl / sl : pl;  // Real air ratio, not duplicate
          const estimatedCO = Math.max(0, (20.7 - o2) * 100); // Rough CO estimation from O2 depletion
          
          // Validate temperature range (should be 20-800°C, not timestamp!)
          if (finalT > 10000) {
            console.warn(`[CSV Debug] ${fileName} Row ${i}: Suspicious temperature value: ${finalT} (might be timestamp)`);
          }

          const dataPoint: CO2TrainingData = {
            timestamp: finalTimestamp,
            features: {
              // Raw sensor data (new format) - CLEAN DATA ONLY
              T: finalT,                    // Real temperature in °C
              o2: o2,                  // Oxygen percentage
              pl: pl,                  // Primary air position
              sl: sl,                  // Secondary air position  
              Tquer: Tquer,            // Smoothed temperature
              m: m,                    // Unknown parameter
              TN: TN,                  // Start temperature
              rel_t: rel_t,            // Time since door opening
              
              // Legacy compatibility features (FIXED MAPPING)
              temperature: finalT,          // Map to real T, not timestamp!
              primaryAirPosition: pl,
              airRatio: airRatio,      // Real ratio pl/sl
              currentCO: estimatedCO,
              cycleTime: rel_t
              // REMOVED: tempAirInteraction (was causing huge numbers)
            },
            target: co2Percentage,
            hasRealTarget: co2Percentage > 0
          };
          
          trainingData.push(dataPoint);
          
        } catch (rowError) {
          // Skip invalid rows silently
          continue;
        }
      }
      
      return {
        success: true,
        info: {
          fileName,
          rowCount: lines.length - 1,
          columns: headers,
          encoding: 'auto-detected',
          hasRealCO2: realCO2Count > 0,
          sampleCount: trainingData.length
        },
        data: trainingData
      };
      
    } catch (error) {
      console.error(`[CSV] Failed to parse ${fileName}:`, error);
      return {
        success: false,
        info: {
          fileName,
          rowCount: 0,
          columns: [],
          encoding: 'unknown',
          hasRealCO2: false,
          sampleCount: 0
        },
        data: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Find column index by multiple possible names
   */
  private findColumn(headers: string[], possibleNames: string[]): number {
    const lowerHeaders = headers.map(h => h.toLowerCase());

    // 1) Exact (case-insensitive) match first
    for (const name of possibleNames) {
      const idxExact = lowerHeaders.indexOf(name.toLowerCase());
      if (idxExact !== -1) return idxExact;
    }

    // 2) Fallback: substring match (to cope with exotic headers like "o2[%]")
    for (const name of possibleNames) {
      const idxPartial = lowerHeaders.findIndex(h => h.includes(name.toLowerCase()));
      if (idxPartial !== -1) return idxPartial;
    }

    return -1;
  }
  
  /**
   * Scan directory for ANY CSV files with proper error handling
   */
  private async scanDirectory(directory: string): Promise<string[]> {
    const foundFiles: string[] = [];
    
    // Try to get directory listing by attempting to access common CSV file patterns
    const csvPatterns = [
      // User's files patterns
      'training-data-1.csv', 'training-data-2.csv', 'training-data-3.csv', 'training-data-4.csv', 'training-data-5.csv',
      // Common names
      'training-data.csv', 'rig-data.csv', 'co2-measurements.csv', 'sensor-data.csv', 'example-data.csv',
      'measurement-data.csv', 'rig-data.csv', 'data.csv', 'export.csv', 'samples.csv',
      // Numbered patterns
      'data-1.csv', 'data-2.csv', 'data-3.csv', 'data-4.csv', 'data-5.csv',
      'file-1.csv', 'file-2.csv', 'file-3.csv', 'file-4.csv', 'file-5.csv',
      // Date patterns (common export formats)
      '2024-data.csv', '2025-data.csv', 'export-2024.csv', 'export-2025.csv',
      // German patterns
      'messdaten.csv', 'rig-daten.csv', 'rig-daten.csv', 'temperatur.csv'
    ];
    
    // Check each pattern
    for (const file of csvPatterns) {
      try {
        const fullPath = `${directory}${file}`;
        const response = await fetch(fullPath);
        
        if (response.ok) {
          // Additional validation: check if content is actually CSV
          const text = await response.text();
          const firstLine = text.split('\n')[0]?.trim() || '';
          
          // Skip if it's HTML content (404 error page)
          if (firstLine.toLowerCase().includes('<!doctype') || 
              firstLine.toLowerCase().includes('<html') ||
              firstLine.toLowerCase().includes('<body') ||
              firstLine.toLowerCase().includes('error') ||
              firstLine.toLowerCase().includes('404')) {
            continue;
          }
          
          // Check if it looks like CSV (has separators)
          if (firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('\t')) {
            foundFiles.push(fullPath);
          }
        }
      } catch (error) {
        // Silent fail for missing files
      }
    }
    
    return foundFiles;
  }
  
  /**
   * Get cached loaded data
   */
  getLoadedData(fileName: string): CO2TrainingData[] {
    return this.loadedFiles.get(fileName) || [];
  }
  
  /**
   * Combine data from multiple files
   */
  combineFiles(fileNames: string[]): CO2TrainingData[] {
    const combined: CO2TrainingData[] = [];
    
    for (const fileName of fileNames) {
      const data = this.getLoadedData(fileName);
      combined.push(...data);
    }
    
    // Add timestamps to avoid conflicts
    return combined.map((item, index) => ({
      ...item,
      timestamp: Date.now() + index * 1000
    }));
  }
  
  /**
   * Try to load a custom CSV file by exact path/name
   */
  async tryLoadCustomFile(fileName: string): Promise<CSVLoadResult | null> {
    const locations = [
      'src/data/',
      'public/data/', 
      'data/',
      '' // Try direct path
    ];
    
    for (const location of locations) {
      try {
        const fullPath = `${location}${fileName}`;
        
        const result = await this.loadCSVFile(fullPath);
        if (result.success) {
          return result;
        }
      } catch (error) {
        // Continue to next location
      }
    }
    
    return null;
  }

  /**
   * Get list of all loaded file names
   */
  getLoadedFileNames(): string[] {
    return Array.from(this.loadedFiles.keys());
  }

  /**
   * Clear cached data and force reload - useful when fixing data issues
   */
  clearCache(): void {
    this.loadedFiles.clear();
  }

  /**
   * Clear cache and reload all files - useful after fixing data mapping issues
   */
  async reloadAllFiles(): Promise<CSVLoadResult[]> {
    this.clearCache();
    return await this.autoLoadAvailableFiles();
  }
}

// Export singleton instance
export const csvDataLoader = new CSVDataLoader(); 