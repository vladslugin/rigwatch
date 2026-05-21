import React, { useMemo, useState } from 'react';
import type { ParameterInfo } from '../types';
import { getPLValues, getSLValues, getRLValues } from '../utils/parameterTypes';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useStoveStore } from '../store/useStoveStore';

interface AirFlowDiagramProps {
  parameters: ParameterInfo[];
}

const AirFlowDiagram: React.FC<AirFlowDiagramProps> = ({
  parameters,
}) => {
  const currentData = useStoveStore(state => state.currentData);
  const { user } = useAuth();
  const { t } = useTranslation();

  // Developer mode state (only for developer/super_admin)
  const [devMode, setDevMode] = useState(false);
  const [devPLAngle, setDevPLAngle] = useState(0);
  const [devPLMotorAngle, setDevPLMotorAngle] = useState(4.2); // Default tolerance
  const [devSLAngle, setDevSLAngle] = useState(0);
  const [devSLMotorAngle, setDevSLMotorAngle] = useState(4.2); // Default tolerance
  const [devRLAngle, setDevRLAngle] = useState(0);
  const [linkPLMotorToFlap, setLinkPLMotorToFlap] = useState(true);
  const [linkSLMotorToFlap, setLinkSLMotorToFlap] = useState(true);

  // Servo parameters from Firebase (or hard‑coded fallback)
  const servoParams = {
    PL_MAX: 57.0, // SERVO_WINKEL_PL_MAX
    PL_MIN: 0.0, // SERVO_WINKEL_PL_MIN
    SL_MAX: 59.0, // SERVO_WINKEL_SL_MAX
    SL_MIN: 0.0, // SERVO_WINKEL_SL_MIN
    TOLERANCE: 4.2, // SERVO_TOLERANZ_WINKEL
  } as const;

  /**
   * Convert a raw servo angle to percent in its allowed range.
   */
  const angleToPercent = (
    angle: number,
    maxAngle: number,
    minAngle: number = 0,
  ): number => {
    const range = maxAngle - minAngle;
    return Math.round((Math.abs(angle) / range) * 100);
  };

  /**
   * Business logic — FLAP moves, MOTOR follows.
   */
  const handleFlapAngleChange = (
    newFlap: number,
    currentMotor: number,
    isIncrease: boolean,
    isLinked: boolean,
  ): number => {
    if (!isLinked) return currentMotor;

    // Increasing → keep motor at TOLERANCE until flap > TOLERANCE
    if (isIncrease) {
      return newFlap <= servoParams.TOLERANCE ? servoParams.TOLERANCE : newFlap;
    }

    // Decreasing → motor moves only when gap > TOLERANCE
    const gap = currentMotor - newFlap;
    return gap > servoParams.TOLERANCE
      ? newFlap + servoParams.TOLERANCE
      : currentMotor;
  };

  /**
   * Business logic — MOTOR moves, FLAP follows.
   */
  const handleMotorAngleChange = (
    newMotor: number,
    currentFlap: number,
    isLinked: boolean,
  ): number => {
    if (!isLinked) return currentFlap;
  
    // Positive diff  → motor leads flap
    // Negative diff  → flap leads motor
    const diff = newMotor - currentFlap;
  
    // Motor ahead by more than tolerance → push flap forward
    if (diff > servoParams.TOLERANCE) {
      return newMotor - servoParams.TOLERANCE;
    }
  
    // Flap ahead by more than tolerance → pull flap back
    if (-diff > servoParams.TOLERANCE) {
      return newMotor + servoParams.TOLERANCE;
    }
  
    // Within +-TOLERANCE dead‑zone → no change
    return currentFlap;
  };

  // Permissions
  const isDeveloper =
    user?.role === 'developer' || user?.role === 'super_admin';

  // Resolve parameter colours
  const getParameterColor = (paramId: string): string => {
    const param = parameters.find((p) => p.originalName === paramId);
    return param?.color ?? '#000000';
  };

  /* ============================ REAL‑TIME VALUES ============================ */
  const screenAirData = useMemo(() => {
    const pl = getPLValues(currentData);
    return {
      angle: pl.winkel,
      motorAngle: pl.motorWinkel,
      percent: pl.prozent.toFixed(0),
      color: getParameterColor('PL'),
    } as const;
  }, [currentData, parameters]);

  const rearAirData = useMemo(() => {
    const sl = getSLValues(currentData);
    return {
      angle: sl.winkel,
      motorAngle: sl.motorWinkel,
      percent: sl.prozent.toFixed(0),
      color: getParameterColor('SL'),
    } as const;
  }, [currentData, parameters]);

  const grateAirData = useMemo(() => {
    const rl = getRLValues(currentData);
    const angle = rl.winkel || rl.prozent; // fallback
    return { angle } as const;
  }, [currentData]);

  /* ================================ SVG DIAGRAM ============================= */
  const renderDiagram = (
    data: {
      screenAir: { angle: number; motorAngle: number; percent: string; color: string };
      rearAir: { angle: number; motorAngle: number; percent: string; color: string };
      grateAir: { angle: number };
    },
    scale = 1,
    suffix = '',
  ) => (
    <svg
      width="100%"
      height={200 * scale}
      viewBox="0 0 450 200"
      preserveAspectRatio="xMidYMid meet"
      className="max-w-full"
      style={{ maxHeight: `${200 * scale}px` }}
    >
      <title>{t('airflow.diagramTitle', { suffix })}</title>

      {/* PL flap (left) */}
      <g
        id={`screen-air-group${suffix}`}
        transform={`rotate(${-data.screenAir.angle} 100 190)`}
      >
        <polygon
          id={`screen-air-flap${suffix}`}
          points="200,190 200,40 150,80 100,190"
          style={{
            stroke: 'black',
            strokeWidth: 1,
            fill: data.screenAir.color,
          }}
        />
        <text
          fontFamily="Arial, sans-serif"
          fontSize="14"
          fontWeight="bold"
          x="150"
          y="185"
          textAnchor="middle"
        >
          {data.screenAir.percent}%
        </text>
      </g>

      {/* SL flap (right) */}
      <g
        id={`rear-air-group${suffix}`}
        transform={`rotate(${data.rearAir.angle} 310 190)`}
      >
        <polygon
          id={`rear-air-flap${suffix}`}
          points="210,190 210,40 260,80 310,190"
          style={{
            stroke: 'black',
            strokeWidth: 1,
            fill: data.rearAir.color,
          }}
        />
        <text
          fontFamily="Arial, sans-serif"
          fontSize="14"
          fontWeight="bold"
          x="260"
          y="185"
          textAnchor="middle"
        >
          {data.rearAir.percent}%
        </text>
      </g>

      {/* RL grate (bottom‑right) */}
      <g
        id={`grate-air-group${suffix}`}
        transform={`rotate(${data.grateAir.angle} 420 100)`}
      >
        <polyline
          points="350,100 420,100 420,120"
          style={{ stroke: 'black', strokeWidth: 5, fill: 'none' }}
        />
      </g>

      {/* Static motor indicators (pink) */}
      <polyline
        points="70,190 130,190"
        style={{ fill: 'none', stroke: 'pink', strokeWidth: 8 }}
        transform={`rotate(${-data.screenAir.motorAngle} 100 190)`}
      />
      <polyline
        points="280,190 340,190"
        style={{ fill: 'none', stroke: 'pink', strokeWidth: 8 }}
        transform={`rotate(${data.rearAir.motorAngle} 310 190)`}
      />
    </svg>
  );

  /* ================================ RENDER ================================ */
  return (
    <div className="bg-card rounded overflow-hidden border-2 border-border">
      {/* Header */}
      <div className="bg-section-header text-section-header-foreground px-3 py-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center">
          <span className="inline-flex w-4 h-4 mr-2 items-center justify-center">
            <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2 2 0 1119.5 12H2" />
            </svg>
          </span>
          {t('airflow.title')}
        </h2>

        {isDeveloper && (
          <button
            onClick={() => setDevMode((v) => !v)}
            className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:brightness-95 transition-colors"
            title={t('airflow.devToggleTitle') as string}
          >
            {devMode ? t('airflow.devToggleOff') : t('airflow.devToggleOn')}
          </button>
        )}
      </div>

      {/* LIVE DIAGRAM */}
      <div className="flex justify-center items-center bg-muted p-2 transition-colors border-t border-border">
        {renderDiagram(
          {
            screenAir: screenAirData,
            rearAir: rearAirData,
            grateAir: grateAirData,
          },
          1,
          '-real',
        )}
      </div>

      {/* DEVELOPER PANEL */}
      {devMode && isDeveloper && (
        <div className="border-t border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center">
            {t('airflow.devHeader')}
            <span className="ml-2 text-xs text-muted-foreground">{t('airflow.devSub')}</span>
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Preview diagram */}
            <div className="bg-card rounded border border-border overflow-hidden">
              <div className="bg-muted px-2 py-1 text-xs font-semibold text-foreground border-b border-border">{t('airflow.testDiagram')}</div>
              <div className="p-2">
                {renderDiagram(
                  {
                    screenAir: {
                      angle: devPLAngle,
                      motorAngle: devPLMotorAngle,
                      percent: angleToPercent(devPLAngle, servoParams.PL_MAX).toFixed(0),
                      color: getParameterColor('PL'),
                    },
                    rearAir: {
                      angle: devSLAngle,
                      motorAngle: devSLMotorAngle,
                      percent: angleToPercent(devSLAngle, servoParams.SL_MAX).toFixed(0),
                      color: getParameterColor('SL'),
                    },
                    grateAir: { angle: devRLAngle },
                  },
                  0.7,
                  '-dev',
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-3">
              {/* PL CONTROLS */}
              <div className="bg-card rounded border border-border p-3 relative">
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  {t('airflow.pl')}
                  <button
                    onClick={() => setLinkPLMotorToFlap((v) => !v)}
                    className="absolute top-2 right-2 text-muted-foreground hover:text-primary transition-colors p-0.5"
                    title={linkPLMotorToFlap ? (t('airflow.unlock') as string) : (t('airflow.lock') as string)}
                  >
                    {linkPLMotorToFlap ? (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                      </svg>
                    )}
                  </button>
                </h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {t('airflow.flap')}: {devPLAngle.toFixed(1)}° ({angleToPercent(devPLAngle, servoParams.PL_MAX)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={servoParams.PL_MAX}
                      step="0.1"
                      value={devPLAngle}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDevPLAngle(val);
                        setDevPLMotorAngle((prev) =>
                          handleFlapAngleChange(val, prev, val > prev, linkPLMotorToFlap),
                        );
                      }}
                      className="w-full h-2 bg-muted rounded appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {t('airflow.motor')}: {devPLMotorAngle.toFixed(1)}° (
                      {angleToPercent(devPLMotorAngle, servoParams.PL_MAX + servoParams.TOLERANCE)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={servoParams.PL_MAX + servoParams.TOLERANCE}
                      step="0.1"
                      value={devPLMotorAngle}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDevPLMotorAngle(val);
                        setDevPLAngle((prev) =>
                          handleMotorAngleChange(val, prev, linkPLMotorToFlap),
                        );
                      }}
                      className="w-full h-2 bg-muted rounded appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* SL CONTROLS */}
              <div className="bg-card rounded border border-border p-3 relative">
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  {t('airflow.sl')}
                  <button
                    onClick={() => setLinkSLMotorToFlap((v) => !v)}
                    className="absolute top-2 right-2 text-muted-foreground hover:text-primary transition-colors p-0.5"
                    title={linkSLMotorToFlap ? (t('airflow.unlock') as string) : (t('airflow.lock') as string)}
                  >
                    {linkSLMotorToFlap ? (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                      </svg>
                    )}
                  </button>
                </h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {t('airflow.flap')}: {devSLAngle.toFixed(1)}° ({angleToPercent(devSLAngle, servoParams.SL_MAX)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={servoParams.SL_MAX}
                      step="0.1"
                      value={devSLAngle}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDevSLAngle(val);
                        setDevSLMotorAngle((prev) =>
                          handleFlapAngleChange(val, prev, val > prev, linkSLMotorToFlap),
                        );
                      }}
                      className="w-full h-2 bg-muted rounded appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {t('airflow.motor')}: {devSLMotorAngle.toFixed(1)}° (
                      {angleToPercent(devSLMotorAngle, servoParams.SL_MAX + servoParams.TOLERANCE)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={servoParams.SL_MAX + servoParams.TOLERANCE}
                      step="0.1"
                      value={devSLMotorAngle}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDevSLMotorAngle(val);
                        setDevSLAngle((prev) =>
                          handleMotorAngleChange(val, prev, linkSLMotorToFlap),
                        );
                      }}
                      className="w-full h-2 bg-muted rounded appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* RL CONTROLS */}
              <div className="bg-card rounded-lg border border-border p-3">
                <h4 className="text-sm font-semibold text-foreground mb-2">{t('airflow.rl')}</h4>
                <label className="text-xs text-muted-foreground">
                  {t('airflow.angle')}: {devRLAngle.toFixed(1)}° ({angleToPercent(devRLAngle, 90)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="0.1"
                  value={devRLAngle}
                  onChange={(e) => setDevRLAngle(Number(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* RESET BUTTON */}
              <button
                onClick={() => {
                  setDevPLAngle(0);
                  setDevPLMotorAngle(servoParams.TOLERANCE);
                  setDevSLAngle(0);
                  setDevSLMotorAngle(servoParams.TOLERANCE);
                  setDevRLAngle(0);
                }}
                className="w-full bg-primary text-primary-foreground text-sm py-2 px-4 rounded hover:brightness-95 transition-colors"
              >
                {t('airflow.resetAll')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AirFlowDiagram;
