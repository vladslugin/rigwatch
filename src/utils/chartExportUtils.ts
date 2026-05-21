import type { Chart } from 'chart.js';
import type { ParameterInfo } from '../types';
import { formatDateWithUserTimezone } from './timezone';

interface ChartDataPoint {
  x: number;
  y: number | null;
  originalY: number | null;
}

interface ChartDataset {
  paramId: string;
  label: string;
  data: ChartDataPoint[];
  hidden: boolean;
}

// Generate CSV data from chart (matches legacy exactly)
export const generateCSVData = (
  chart: Chart | null,
  parameters: ParameterInfo[]
): string | null => {
  if (!chart || !chart.data.datasets) {
    console.warn('[ChartExport] Chart is not ready for CSV export');
    return null;
  }

  const datasets = chart.data.datasets as any as ChartDataset[];
  const visibleDatasets = datasets.filter(ds => !ds.hidden && ds.data.length > 0);
  
  if (visibleDatasets.length === 0) {
    console.warn('[ChartExport] No visible data on the chart to export');
    return null;
  }

  // Collect all unique timestamps
  const allTimestamps = new Set<number>();
  visibleDatasets.forEach(ds => {
    ds.data.forEach(point => {
      if (point && point.x !== undefined) {
        allTimestamps.add(point.x);
      }
    });
  });

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  if (sortedTimestamps.length === 0) {
    console.warn('[ChartExport] No timestamps found in visible data');
    return null;
  }

  // Create CSV headers - match legacy format exactly
  const headers = [
    'Timestamp',
    'Cumulative Time (s)',
    ...visibleDatasets.map(ds => `"${(ds.label || ds.paramId || 'Unknown Series').replace(/"/g, '""')}"`)
  ];
  let csvContent = headers.join(';') + '\r\n';

  // Track last known values for interpolation (like legacy)
  const lastKnownValues: Record<string, string> = {};
  visibleDatasets.forEach(ds => {
    lastKnownValues[ds.paramId || ds.label] = '';
  });

  const firstTimestamp = sortedTimestamps[0];

  // Generate CSV rows
  sortedTimestamps.forEach(timestamp => {
    const date = new Date(timestamp);
    const formattedTimestamp = `${formatDateWithUserTimezone(date, 'de-DE', { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    
    // Calculate cumulative time in seconds with German decimal format
    let cumulativeTimeSec = '';
    if (timestamp === firstTimestamp) {
      cumulativeTimeSec = '0,000';
    } else {
      const deltaMs = timestamp - firstTimestamp;
      cumulativeTimeSec = (deltaMs / 1000).toFixed(3).replace('.', ',');
    }

    const row = [formattedTimestamp, cumulativeTimeSec];

    visibleDatasets.forEach(ds => {
      const point = ds.data.find(p => p && p.x === timestamp);
      let valueToPush = '';

      if (point && point.originalY !== null && point.originalY !== undefined) {
        // Use originalY for CSV (like legacy)
        valueToPush = point.originalY.toString().replace('.', ','); // German decimal format
        lastKnownValues[ds.paramId || ds.label] = valueToPush;
      } else {
        // Use last known value (interpolation like legacy)
        valueToPush = lastKnownValues[ds.paramId || ds.label];
      }
      row.push(valueToPush);
    });

    csvContent += row.join(';') + '\r\n';
  });

  return csvContent;
};

// Export CSV to file (matches legacy behavior)
export const exportChartToCSV = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  downloadFile: boolean = true
): boolean => {
  const csvData = generateCSVData(chart, parameters);
  if (!csvData) return false;

  if (downloadFile) {
    try {
      // Add BOM for proper UTF-8 encoding (like legacy)
      const blob = new Blob(["\uFEFF" + csvData], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        
        // Generate filename with timestamp (like legacy)
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        link.setAttribute("download", `RigWatch_Chart_Data_${timestamp}.csv`);
        
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        console.error('[ChartExport] CSV download not supported by browser');
      }
    } catch (error) {
      console.error('[ChartExport] Failed to download CSV:', error);
    }
  }
  
  // CRITICAL: Copy to clipboard ALWAYS (like legacy) - both for download and copy-only
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(csvData)
      .then(() => {})
      .catch(err => {
        console.error('[ChartExport] Failed to copy CSV to clipboard:', err);
      });
  } else {
    console.error('[ChartExport] Clipboard API not available');
  }
  
  return true;
};

// Enhanced PDF export with improved layout and features
interface PDFExportOptions {
  deviceId?: string;
  rigModel?: string;
  rigModelInfo?: string;
  parameterSet?: string;
  historicalDate?: string | null;
  markers?: Array<{timestamp: number | null, values: Record<string, number>}>;
  includeDataTable?: boolean;
  includeStatistics?: boolean;
}

// Export chart to PDF (enhanced version from cursor_.md)
export const exportChartToPDF = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  options: PDFExportOptions = {}
): boolean => {
  if (!chart) {
    console.error('[ChartExport] No chart provided for PDF export');
    return false;
  }

  const { 
    deviceId = 'N/A', 
    rigModel = 'N/A', 
    rigModelInfo = '', 
    parameterSet = 'N/A',
    historicalDate = null,
    markers = [],
    includeDataTable = true,
    includeStatistics = true
  } = options;

  try {
    const chartImageBase64 = chart.toBase64Image('image/png', 1.0);
    const { jsPDF } = (window as any).jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' }); // A3 landscape with optimized proportions
    
    const pdfWidth = pdf.internal.pageSize.getWidth(); // ~420mm
    const pdfHeight = pdf.internal.pageSize.getHeight(); // ~297mm
    const margin = 8; // Minimal margins
    let currentY = margin;
    
    // Modern header bar with background
    pdf.setFillColor(245, 245, 245); // Light gray background
    pdf.rect(0, 0, pdfWidth, 35, 'F');
    
    // Main title
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(30, 30, 30);
    const title = historicalDate ? `RigWatch - Historical Data Report (${historicalDate})` : 'RigWatch - Live Monitoring Report';
    pdf.text(title, margin + 10, 18);
    
    // Header info in top right
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100, 100, 100);
    const now = new Date();
    pdf.text(`Generated: ${formatDateWithUserTimezone(now, 'de-DE')}`, pdfWidth - margin - 10, 12, { align: 'right' });
    pdf.text(`Rig ID: ${deviceId}`, pdfWidth - margin - 10, 18, { align: 'right' });
    pdf.text(`${rigModel} ${rigModelInfo}`.trim(), pdfWidth - margin - 10, 24, { align: 'right' });
    
    currentY = 40; // Start content after header
    
    // Device Info - compact horizontal bar
    pdf.setFillColor(250, 250, 250);
    pdf.rect(margin + 5, currentY, pdfWidth - 2 * margin - 10, 20, 'F');
    pdf.setDrawColor(220, 220, 220);
    pdf.rect(margin + 5, currentY, pdfWidth - 2 * margin - 10, 20);
    
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(80, 80, 80);
    
    const deviceInfoY = currentY + 7;
    let infoX = margin + 15;
    
    pdf.text(`Parameter Set: ${parameterSet}`, infoX, deviceInfoY);
    infoX += 140; // More space for A3
    
    pdf.text(`Data Type: ${historicalDate ? 'Historical Log' : 'Live Monitoring'}`, infoX, deviceInfoY);
    infoX += 160; // More space for A3
    
    const chartScaleX = chart.scales.x;
    if (chartScaleX && chartScaleX.min !== undefined && chartScaleX.max !== undefined) {
      const startTime = formatDateWithUserTimezone(chartScaleX.min, 'de-DE').split(' ')[0];
      const endTime = formatDateWithUserTimezone(chartScaleX.max, 'de-DE').split(' ')[0];
      pdf.text(`Date Range: ${startTime} - ${endTime}`, infoX, deviceInfoY);
    }
    
    // Markers info in second line if available
    if (markers && markers.length > 0) {
      const markersWithData = markers.filter(m => m.timestamp);
      if (markersWithData.length > 0) {
        pdf.setFontSize(7);
        const markersY = currentY + 15;
        let markerText = 'Chart Markers: ';
        markersWithData.forEach((marker, index) => {
          const markerTime = formatDateWithUserTimezone(marker.timestamp!, 'de-DE');
          markerText += `${index + 1}: ${markerTime}`;
          if (index < markersWithData.length - 1) markerText += ' | ';
        });
        pdf.text(markerText, margin + 15, markersY);
      }
    }
    
    currentY += 28; // Space after info bar
    
    // MAIN CHART - Full width but limited height for A3 proportions
    let chartX = margin + 10;
    const chartWidth = pdfWidth - 2 * margin - 20; // Full A3 width minus margins
    const availableChartHeight = pdfHeight - currentY - margin - 90; // Reserve space for legend/stats below
    
    const imgProps = chart.canvas;
    const aspectRatio = imgProps.width / imgProps.height;
    
    // Calculate proper chart size with A3 optimized proportions
    // CRITICAL: Limit height for better A3 proportions - don't stretch too much
    let pdfImgHeight = Math.min(availableChartHeight * 0.85, 200); // Much larger for A3
    let pdfImgWidth = pdfImgHeight * aspectRatio;
    
    // If width exceeds available space, scale down proportionally
    if (pdfImgWidth > chartWidth) {
      pdfImgWidth = chartWidth;
      pdfImgHeight = pdfImgWidth / aspectRatio;
    }
    
    // Center the chart if it's smaller than full width
    if (pdfImgWidth < chartWidth) {
      const chartXAdjust = (chartWidth - pdfImgWidth) / 2;
      chartX += chartXAdjust;
    }
    
    // Add chart to PDF
    pdf.addImage(chartImageBase64, 'PNG', chartX, currentY, pdfImgWidth, pdfImgHeight);
    currentY += pdfImgHeight + 15; // Space after chart
    
    // BOTTOM SECTION - Two columns for Legend and Statistics (A3 optimized)
    const leftColumnX = margin + 10;
    const leftColumnWidth = (pdfWidth - 2 * margin - 30) / 2; // Two equal columns for A3
    const rightColumnX = leftColumnX + leftColumnWidth + 20;
    
    let sectionStartY = currentY;
    
    // LEFT COLUMN: Parameter Legend (ALWAYS SHOWN)
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(30, 30, 30);
    pdf.text("Parameter Legend", leftColumnX, currentY);
    
    let legendY = currentY + 8;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(80, 80, 80);
    
    const legendItems: Array<{label: string, color: string}> = [];
    if (chart.data.datasets) {
      (chart.data.datasets as any[]).forEach(ds => {
        if (!ds.hidden && ds.data.length > 0) {
          legendItems.push({
            label: ds.label || ds.paramId || 'Unknown Series',
            color: ds.borderColor || '#000000'
          });
        }
      });
    }
    
    if (legendItems.length > 0) {
      legendItems.forEach(item => {
        // Color box
        try {
          const rgb = hexToRgb(item.color);
          if (rgb) {
            pdf.setFillColor(rgb.r, rgb.g, rgb.b);
          } else {
            pdf.setFillColor(128, 128, 128);
          }
        } catch (e) {
          pdf.setFillColor(128, 128, 128);
        }
        pdf.rect(leftColumnX, legendY - 3, 10, 4, 'F'); // Bigger color box for A3
        
        // Label text - NO TRUNCATION for A3 format
        pdf.setTextColor(50, 50, 50);
        pdf.text(item.label, leftColumnX + 15, legendY);
        legendY += 6;
      });
    } else {
      pdf.text("No visible data series", leftColumnX, legendY);
    }
    
    // RIGHT COLUMN: Statistics (if enabled)
    if (includeStatistics) {
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(30, 30, 30);
      pdf.text("Data Statistics", rightColumnX, sectionStartY);
      
      let statsY = sectionStartY + 8;
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(80, 80, 80);
      
      if (chart.data.datasets) {
        (chart.data.datasets as any[]).forEach(ds => {
          if (!ds.hidden && ds.data.length > 0) {
            const data = ds.data.filter((d: any) => d.y !== null && d.y !== undefined).map((d: any) => d.y);
            if (data.length > 0) {
              const min = Math.min(...data).toFixed(1);
              const max = Math.max(...data).toFixed(1);
              const avg = (data.reduce((a: number, b: number) => a + b, 0) / data.length).toFixed(1);
              
              const paramName = ds.label || ds.paramId || 'Unknown';
              pdf.text(`${paramName}: Min: ${min}, Max: ${max}, Avg: ${avg}, Points: ${data.length}`, rightColumnX, statsY);
              statsY += 6;
            }
          }
        });
      }
    }
    
    // Move currentY down after legend/stats sections - reduced space for more Recent Data
    currentY = Math.max(legendY, includeStatistics ? sectionStartY + 60 : sectionStartY + 40);
    // RECENT DATA TABLE: Full width at bottom (for Complete Report only)
    if (includeDataTable && includeStatistics) {
      currentY += 10; // Reduced spacing for more table space
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(30, 30, 30);
      pdf.text("Recent Data (Last 15 from visible range)", leftColumnX, currentY);
      
      let tableY = currentY + 8;
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(60, 60, 60);
      // Get last 15 data points from chart
      const recentData = getRecentDataFromChart(chart, 15);
      
      if (recentData.length > 0) {
        // Header
        pdf.setFont("helvetica", "bold");
        pdf.text("Time", leftColumnX, tableY);
        pdf.text("Parameter Values", leftColumnX + 35, tableY);
        tableY += 5;
        
        pdf.setFont("helvetica", "normal");
        
        recentData.forEach((dataPoint: {timestamp: number; parameters: Array<{name: string; value: string}>}, index: number) => {
          // More generous space check for A3 format
          if (tableY > pdfHeight - margin - 15) {
            return; 
          }
          
          const timeStr = new Date(dataPoint.timestamp).toLocaleTimeString('de-DE', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Europe/Berlin' 
          });
          
          pdf.text(timeStr, leftColumnX, tableY);
          
          // Format parameter values - Use A3 width, NO TRUNCATION
          const values = dataPoint.parameters
            .map((p: {name: string; value: string}) => `${p.name}: ${p.value}`)
            .join(' | ');
          
          // Much more space for A3 format - allows ~140 characters
          const maxValueLength = 140; 
          const displayValues = values.length > maxValueLength ? 
            values.substring(0, maxValueLength - 3) + "..." : values;
          
          pdf.text(displayValues, leftColumnX + 35, tableY);
          tableY += 4;
        });
        
        currentY = tableY + 10;
      } else {
        pdf.text("No recent data available", leftColumnX, tableY);
        currentY = tableY + 15;
      }
    }
    
    // FOOTER with generation info 
    const footerY = pdfHeight - margin + 5;
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(120, 120, 120);
    
    const saveTime = new Date();
    const footerText = `Generated: ${formatDateWithUserTimezone(saveTime, 'de-DE')} | RIGWATCH | Page 1 of 1`;
    const pageWidth = pdfWidth - 2 * margin;
    const footerTextWidth = pdf.getTextWidth(footerText);
    const footerX = margin + (pageWidth - footerTextWidth) / 2; // Center the footer
    
    pdf.text(footerText, footerX, footerY);
    
    // Save PDF with corrected timestamp variable
    const timestamp = `${saveTime.getFullYear()}${String(saveTime.getMonth() + 1).padStart(2, '0')}${String(saveTime.getDate()).padStart(2, '0')}_${String(saveTime.getHours()).padStart(2, '0')}${String(saveTime.getMinutes()).padStart(2, '0')}`;
    pdf.save(`RigWatch_Chart_Export_${timestamp}.pdf`);
    return true;

  } catch (error) {
    console.error('[ChartExport] Error exporting chart to PDF:', error);
    return false;
  }
};

// Legacy-compatible wrapper function 
export const exportChartToPDFLegacy = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  deviceId: string = 'N/A',
  rigModel: string = 'N/A',
  rigModelInfo: string = '',
  parameterSet: string = 'N/A'
): boolean => {
  return exportChartToPDF(chart, parameters, {
    deviceId,
    rigModel,
    rigModelInfo,
    parameterSet,
    includeDataTable: true,
    includeStatistics: true
  });
};

// Enhanced PDF export with chart markers and historical data
export const exportChartToPDFEnhanced = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  options: PDFExportOptions & {
    chartMarkers?: Array<{timestamp: number | null, values: Record<string, number>}>;
    historicalDate?: string | null;
  } = {}
): boolean => {
  return exportChartToPDF(chart, parameters, {
    ...options,
    markers: options.chartMarkers || [],
    includeDataTable: options.includeDataTable ?? true,
    includeStatistics: options.includeStatistics ?? true
  });
};

// Helper function to get recent data from chart for CSV table
function getRecentDataFromChart(chart: any, count: number): Array<{
  timestamp: number;
  parameters: Array<{name: string; value: string}>;
}> {
  if (!chart?.data?.datasets) {
    return [];
  }
  
  // Get current visible range from chart scales (zoom/pan awareness)
  let visibleMinX: number | null = null;
  let visibleMaxX: number | null = null;
  
  if (chart.scales && chart.scales.x) {
    visibleMinX = chart.scales.x.min;
    visibleMaxX = chart.scales.x.max;
  }
  
  // Get all visible datasets
  const visibleDatasets = chart.data.datasets.filter((ds: any) => !ds.hidden && ds.data && ds.data.length > 0);
  if (visibleDatasets.length === 0) return [];
  
  // Collect all unique timestamps from visible datasets within visible range
  const timestampMap = new Map<number, Map<string, {value: number, label: string}>>();
  
  visibleDatasets.forEach((ds: any) => {
    const paramName = ds.label || ds.paramId || 'Unknown';
    ds.data.forEach((point: any, index: number) => {
      if (point && typeof point.x === 'number') {
        const timestamp = point.x;
        
        // Filter by visible range if available
        if (visibleMinX !== null && visibleMaxX !== null) {
          if (timestamp < visibleMinX || timestamp > visibleMaxX) {
            return; // Skip points outside visible range
          }
        }
        
        let value = null;
        
        // Try different ways to get the value
        if (point.originalY !== null && point.originalY !== undefined) {
          value = point.originalY;
        } else if (point.y !== null && point.y !== undefined) {
          value = point.y;
        }
        
        if (value !== null && value !== undefined) {
          if (!timestampMap.has(timestamp)) {
            timestampMap.set(timestamp, new Map());
          }
          
          timestampMap.get(timestamp)!.set(paramName, {
            value: value,
            label: paramName
          });
        }
      }
    });
  });
  // Sort timestamps and take the last N from visible range
  const sortedTimestamps = Array.from(timestampMap.keys()).sort((a, b) => a - b);
  const recentTimestamps = sortedTimestamps.slice(-count);
  // Build result array
  const result: Array<{
    timestamp: number;
    parameters: Array<{name: string; value: string}>;
  }> = [];
  
  recentTimestamps.forEach(timestamp => {
    const parameterMap = timestampMap.get(timestamp);
    if (parameterMap && parameterMap.size > 0) {
      const parameters: Array<{name: string; value: string}> = [];
      
      parameterMap.forEach((paramData, paramName) => {
        parameters.push({
          name: paramName,
          value: paramData.value.toFixed(1)
        });
      });
      
      if (parameters.length > 0) {
        result.push({ timestamp, parameters });
      }
    }
  });
  return result;
}

// Helper function to convert hex to RGB (from legacy)
function hexToRgb(hex: string): {r: number, g: number, b: number} | null {
  if (!hex || typeof hex !== 'string') return null;
  
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function(m, r, g, b) {
    return r + r + g + g + b + b;
  });
  
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Enhanced CSV export functions for dropdown menu options

// Generate CSV data for visible range only (zoom-aware)
export const generateVisibleCSVData = (
  chart: Chart | null,
  parameters: ParameterInfo[]
): string | null => {
  if (!chart || !chart.data.datasets) {
    console.warn('[ChartExport] Chart is not ready for CSV export');
    return null;
  }

  const datasets = chart.data.datasets as any as ChartDataset[];
  const visibleDatasets = datasets.filter(ds => !ds.hidden && ds.data.length > 0);
  
  if (visibleDatasets.length === 0) {
    console.warn('[ChartExport] No visible data on the chart to export');
    return null;
  }

  // Get current visible range from chart scales (zoom/pan awareness)
  let visibleMinX: number | null = null;
  let visibleMaxX: number | null = null;
  
  if (chart.scales && chart.scales.x) {
    visibleMinX = chart.scales.x.min;
    visibleMaxX = chart.scales.x.max;
  }

  // Collect timestamps within visible range
  const allTimestamps = new Set<number>();
  visibleDatasets.forEach(ds => {
    ds.data.forEach(point => {
      if (point && point.x !== undefined) {
        // Filter by visible range if available
        if (visibleMinX !== null && visibleMaxX !== null) {
          if (point.x >= visibleMinX && point.x <= visibleMaxX) {
            allTimestamps.add(point.x);
          }
        } else {
          allTimestamps.add(point.x);
        }
      }
    });
  });

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  if (sortedTimestamps.length === 0) {
    console.warn('[ChartExport] No timestamps found in visible range');
    return null;
  }

  // Create CSV headers
  const headers = [
    'Timestamp',
    'Cumulative Time (s)',
    ...visibleDatasets.map(ds => `"${(ds.label || ds.paramId || 'Unknown Series').replace(/"/g, '""')}"`)
  ];
  let csvContent = headers.join(';') + '\r\n';

  // Track last known values for interpolation
  const lastKnownValues: Record<string, string> = {};
  visibleDatasets.forEach(ds => {
    lastKnownValues[ds.paramId || ds.label] = '';
  });

  const firstTimestamp = sortedTimestamps[0];

  // Generate CSV rows for visible range only
  sortedTimestamps.forEach(timestamp => {
    const date = new Date(timestamp);
    const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    
    // Calculate cumulative time in seconds with German decimal format
    let cumulativeTimeSec = '';
    if (timestamp === firstTimestamp) {
      cumulativeTimeSec = '0,000';
    } else {
      const deltaMs = timestamp - firstTimestamp;
      cumulativeTimeSec = (deltaMs / 1000).toFixed(3).replace('.', ',');
    }

    const row = [formattedTimestamp, cumulativeTimeSec];

    visibleDatasets.forEach(ds => {
      const point = ds.data.find(p => p && p.x === timestamp);
      let valueToPush = '';

      if (point && point.originalY !== null && point.originalY !== undefined) {
        valueToPush = point.originalY.toString().replace('.', ',');
        lastKnownValues[ds.paramId || ds.label] = valueToPush;
      } else {
        valueToPush = lastKnownValues[ds.paramId || ds.label];
      }
      row.push(valueToPush);
    });

    csvContent += row.join(';') + '\r\n';
  });  return csvContent;
};

// Copy CSV data to clipboard only (no download)
export const copyCSVToClipboard = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  visibleOnly: boolean = false
): boolean => {
  const csvData = visibleOnly 
    ? generateVisibleCSVData(chart, parameters)
    : generateCSVData(chart, parameters);
    
  if (!csvData) {
    console.error('[ChartExport] No CSV data to copy');
    return false;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(csvData)
      .then(() => {})
      .catch(err => {
        console.error('[ChartExport] Failed to copy CSV to clipboard:', err);
      });
    return true;
  } else {
    console.error('[ChartExport] Clipboard API not available');
    return false;
  }
};

// Export CSV file with download (visible range option)
export const exportCSVFile = (
  chart: Chart | null,
  parameters: ParameterInfo[],
  visibleOnly: boolean = false
): boolean => {
  const csvData = visibleOnly 
    ? generateVisibleCSVData(chart, parameters)
    : generateCSVData(chart, parameters);
    
  if (!csvData) {
    console.error('[ChartExport] No CSV data to export');
    return false;
  }

  try {
    // Add BOM for proper UTF-8 encoding
    const blob = new Blob(["\uFEFF" + csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      
      // Generate filename with timestamp and range indicator
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const rangePrefix = visibleOnly ? 'Visible_' : '';
      link.setAttribute("download", `RigWatch_Chart_${rangePrefix}Data_${timestamp}.csv`);
      
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } else {
      console.error('[ChartExport] CSV download not supported by browser');
      return false;
    }
  } catch (error) {
    console.error('[ChartExport] Failed to download CSV:', error);
    return false;
  }
};
