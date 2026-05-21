/**
 * Debug Export Utility
 * 
 * Creates an ASCII table comparing model parameters with current values
 * and triggers a TXT file download after model load completion + 5 seconds
 */

import { ref, get } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';
import { commandQueue } from './commandQueue';

interface ParameterComparison {
  name: string;
  expected: any;
  current: any;
  matches: boolean;
}

/**
 * Start debug monitoring for a model load
 * Waits for command queue to finish + 5 seconds, then generates ASCII table comparison
 */
export async function startDebugMonitoring(
  deviceId: string,
  modelName: string,
  modelData: Record<string, any>
): Promise<void> {
  console.log(`[DebugExport] 🔍 Starting debug monitoring for model: ${modelName}`);
  console.log(`[DebugExport] ⏳ Waiting for command queue to complete...`);

  // Extract model parameters (only primitives, no konstant_, no _variant_info)
  const modelParameters: Array<{ name: string; value: any }> = [];
  
  Object.entries(modelData).forEach(([key, value]) => {
    if (key.startsWith('konstant_') || key === '_variant_info') {
      return;
    }
    
    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      modelParameters.push({ name: key, value });
    }
  });

  // Sort alphabetically
  modelParameters.sort((a, b) => a.name.localeCompare(b.name));

  // Wait for command queue to empty
  await commandQueue.waitUntilEmpty();
  
  console.log(`[DebugExport] ✅ Command queue completed, waiting additional 5 seconds...`);
  
  // Wait additional 5 seconds buffer for controller to process
  await new Promise(resolve => setTimeout(resolve, 5 * 1000));

  console.log(`[DebugExport] 📊 Generating comparison report...`);

  // Fetch ALL current values from Firebase at once
  const comparisons: ParameterComparison[] = [];
  let currentData: Record<string, any> = {};
  
  try {
    if (!realtimeDB) {
      throw new Error('Database not initialized');
    }
    
    // Read the entire temporaer object (same as useFirebase.ts does)
    const temporaerRef = ref(realtimeDB, `temporaer/${deviceId}`);
    const snapshot = await get(temporaerRef);
    
    if (snapshot.exists()) {
      currentData = snapshot.val() || {};
      console.log(`[DebugExport] ✅ Fetched ${Object.keys(currentData).length} parameters from Firebase`);
    } else {
      console.warn(`[DebugExport] ⚠️ No data found at temporaer/${deviceId}`);
    }
  } catch (error) {
    console.error('[DebugExport] Failed to fetch temporaer data:', error);
  }

  // Compare each model parameter with current data
  for (const param of modelParameters) {
    const currentValue = currentData[param.name];
    const normalizedCurrent = normalizeValue(currentValue);
    const normalizedExpected = normalizeValue(param.value);

    comparisons.push({
      name: param.name,
      expected: param.value,
      current: currentValue !== undefined && currentValue !== null ? currentValue : 'N/A',
      matches: normalizedCurrent === normalizedExpected
    });
  }

  // Generate ASCII table
  const tableContent = generateASCIITable(modelName, comparisons);

  // Download as TXT file
  downloadTextFile(tableContent, `debug_${modelName}_${Date.now()}.txt`);

  console.log(`[DebugExport] Debug report generated and downloaded`);
}

/**
 * Generate simple ASCII table with parameter comparison
 */
function generateASCIITable(modelName: string, comparisons: ParameterComparison[]): string {
  const lines: string[] = [];

  // Header
  lines.push('+--------------------------------------------------------------------------------+');
  lines.push(`| DEBUG REPORT: ${modelName.padEnd(62)} |`);
  lines.push(`| Generated: ${new Date().toLocaleString('de-DE').padEnd(65)} |`);
  lines.push('+----+--------------------------------+---------------+---------------+----------+');
  lines.push('| #  | Parameter                      | Expected      | Current       | Status   |');
  lines.push('+----+--------------------------------+---------------+---------------+----------+');

  // Data rows
  comparisons.forEach((comp, index) => {
    const num = String(index + 1).padStart(3);
    const name = comp.name.padEnd(30).substring(0, 30);
    const expected = String(comp.expected).padEnd(13).substring(0, 13);
    const current = String(comp.current).padEnd(13).substring(0, 13);
    const status = comp.matches ? 'OK      ' : 'MISMATCH';

    lines.push(`| ${num} | ${name} | ${expected} | ${current} | ${status} |`);
  });

  // Footer
  lines.push('+----+--------------------------------+---------------+---------------+----------+');

  return lines.join('\n');
}

/**
 * Trigger download of text file
 */
function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Normalize values for comparison
 */
function normalizeValue(value: any): string | number | boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return value;
  }
  return String(value);
}

