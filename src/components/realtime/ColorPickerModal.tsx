import React from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface ColorPickerModalProps {
  visible: boolean;
  onSelect: (color: string) => void;
  onClose: () => void;
}

// MAGIC: curated palette chosen to match existing chart theme/colors
const PALETTE = [
  '#d62728', '#2ca02c', '#1f77b4', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
  '#bcbd22', '#17becf', '#6b6ecf', '#b5cf6b', '#393b79', '#637939', '#ad494a', '#de9ed6',
  '#5254a3', '#8ca252', '#9c9ede', '#cedb9c', '#f7b6d2', '#ffbb78', '#c7c7c7', '#aec7e8'
];

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({ visible, onSelect, onClose }) => {
  const { t } = useTranslation();

  // Handle Escape key to close modal
  useEscapeKey(onClose, { enabled: visible });

  if (!visible) return null;
  const handleSelect = (color: string) => {
    onSelect(color);
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card text-foreground rounded-lg p-4 shadow-lg transition-colors border border-border">
        <h3 className="text-sm font-medium mb-3">{t('colorPicker.chooseColorTitle')}</h3>
        <div className="grid grid-cols-8 gap-2 mb-4">
          {PALETTE.map((color) => (
            <button
              key={color}
              className="w-8 h-8 rounded border-2 border-border hover:border-ring cursor-pointer transition-colors"
              style={{ backgroundColor: color }}
              onClick={() => handleSelect(color)}
              title={color}
            />
          ))}
        </div>
        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-muted hover:bg-muted/80 text-foreground rounded text-sm transition-colors border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {t('colorPicker.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal; 