# Data for ML system

## Directory structure

```text
src/data/
├── README.md      # documentation
├── .gitignore     # ignore CSV files
└── *.csv          # your CSV files (ignored by Git)
```

## CSV format

### Supported formats
- German Excel: semicolon `;` as delimiter
- Standard CSV: comma `,` as delimiter

### Required columns
- `T[°C]` or `T[�C]` - temperature (°C)
- `CO2[%]` or `CO₂[%]` - CO2 percent

### Optional columns
- `PLPpos[%]` - primary air (%)
- `SLPos[%]` - secondary air (%)
- `CO[ppm]` - CO concentration
- `t[s]` - time in seconds

## CO2 conversion

Raw CO2 values are converted to percent automatically:

```text
CO2% = (raw_value / 254) * 21
```

## Example CSV header

```csv
;T[°C];PLPpos[%];SLPos[%];TQuer[°C];TQuerAlt[°C];Mkurz[°C/min];M[°C/min];t[s];CO[ppm];CO2[%];B;;;;;;;Bezugswerte (entsprechen 254);
```

## Usage

1. Place CSV files in this directory
2. Open the ML CO2 panel in the app
3. Select files for training
4. Click "Start training"

## Notes

- CSV files are not committed to Git (privacy)
- Multiple files are supported
- Encoding and delimiter are auto-detected
- Invalid rows are filtered automatically