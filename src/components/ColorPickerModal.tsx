import React, { useCallback } from 'react';
import type { ParameterInfo } from '../types';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface ColorPickerModalProps {
  isOpen: boolean;
  parameter: ParameterInfo | null;
  onClose: () => void;
  onColorSelect: (paramId: string, color: string) => Promise<void>;
  autoCloseOnSelect?: boolean;
}

// Color palette from legacy monitoring.js
const COLOR_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
  '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#aec7e8', '#ffbb78',
  '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d2', '#c7c7c7',
  '#dbdb8d', '#9edae5', '#393b79', '#5254a3', '#6b6ecf', '#9c9ede',
  '#637939', '#8ca252', '#b5cf6b', '#cedb9c', '#8c6d31', '#bd9e39',
  '#e7ba52', '#e7cb94', '#843c39', '#ad494a', '#d6616b', '#e7969c',
  '#7b4173', '#a55194', '#ce6dbd', '#de9ed6'
];

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isOpen,
  parameter,
  onClose,
  onColorSelect,
  autoCloseOnSelect = true,
}) => {
  const handleColorSelect = useCallback(async (color: string) => {
    if (!parameter) return;
    
    try {
      await onColorSelect(parameter.originalName, color);
      onClose();
    } catch (error) {
      console.error('Failed to update color:', error);
    }
  }, [parameter, onColorSelect, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: isOpen });

  if (!isOpen || !parameter) return null;

  return (
    <div
      className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-[60]"
      onClick={handleBackdropClick}
    >
      <div className="bg-card rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 transition-colors">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            Set color for {parameter.displayName}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl font-bold transition-colors"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Current Color */}
        <div className="mb-4 p-3 bg-muted rounded-lg transition-colors">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-muted-foreground">Current:</span>
            <div
              className="w-6 h-6 rounded border border-border"
              style={{ backgroundColor: parameter.color }}
            />
            <span className="text-sm text-muted-foreground font-mono">
              {parameter.color}
            </span>
          </div>
        </div>

        {/* Color Palette */}
        <div className="grid grid-cols-8 gap-2 mb-4">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => handleColorSelect(color)}
              className={`w-8 h-8 rounded border-2 hover:scale-110 transition-transform ${
                color.toLowerCase() === parameter.color.toLowerCase()
                  ? 'border-primary border-4'
                  : 'border-border hover:border-muted-foreground'
              }`}
              style={{ backgroundColor: color }}
              title={color}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>

        {/* Custom Color Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-2">
            Or enter custom color:
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              placeholder="#RRGGBB"
              className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-primary text-sm font-mono bg-card text-foreground placeholder-muted-foreground transition-colors"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const input = e.target as HTMLInputElement;
                  const customColor = input.value.trim();
                  if (customColor && /^#[0-9A-Fa-f]{6}$/.test(customColor)) {
                    handleColorSelect(customColor);
                  } else {
                    alert('Please enter a valid hex color (e.g., #FF0000)');
                  }
                }
              }}
            />
            <input
              type="color"
              onChange={(e) => handleColorSelect(e.target.value)}
              className="w-12 h-10 border border-border rounded cursor-pointer"
              title="Pick color"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Enter hex color (e.g., #FF0000) and press Enter, or use the color picker
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal;
