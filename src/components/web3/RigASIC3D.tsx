import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Bounds, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID, ambientForLocation } from '../../lib/mock/rigData';

/**
 * 3D rig visualization. Three.js scene rendered with @react-three/fiber.
 * Stylized ASIC chassis with:
 *   - Slotted intake / exhaust grilles
 *   - 3 hashboards inside, glowing with heat-tinted emissive
 *   - Two spinning axial fans, RPM scaled by live PWM
 *   - Animated airflow particle stream through the chassis
 *
 * Uses live telemetry from useRigStore so the scene "breathes" with the
 * dashboard — clicking from a cool Iceland rig to a hot Texas one swaps
 * the heat palette in real time.
 *
 * Self-contained: the Canvas mounts on first render, OrbitControls let
 * the user drag/zoom, and ContactShadows give it a floating look.
 */

// 4-stop color ramp matching the SVG visualizer — keeps both views
// speaking the same colour language.
const tempToColor = (c: number): THREE.Color => {
  let h: number;
  if (c < 50)       h = 152;
  else if (c < 65)  h = 152 - (c - 50) * 4;
  else if (c < 75)  h =  92 - (c - 65) * 3.2;
  else if (c < 82)  h =  60 - (c - 75) * 5;
  else if (c < 88)  h =  25 - (c - 82) * 3;
  else              h = Math.max(348, 7 - (c - 88));
  return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.55);
};

interface RigASIC3DProps {
  className?: string;
}

export const RigASIC3D: React.FC<RigASIC3DProps> = ({ className }) => {
  const deviceId = useRigStore((s) => s.deviceId);
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  return (
    <div className={`relative w-full h-72 sm:h-80 rounded-xl overflow-hidden bg-gradient-to-b from-[#070914] to-[#0c0f1f] border border-border/60 ${className ?? ''}`}>
      <Canvas
        camera={{ position: [3.2, 2.4, 4.5], fov: 35 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 6, 4]} intensity={1.1} color="#e0c4ff" />
          <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#5cf2ff" />
          <pointLight position={[0, 1.2, 0]} intensity={0.6} color="#a855f7" distance={4} decay={2} />

          <Bounds fit clip observe margin={1.05}>
            <RigChassis profileId={deviceId} />
          </Bounds>

          <ContactShadows position={[0, -0.5, 0]} opacity={0.45} scale={6} blur={2.4} far={2} />
          <OrbitControls
            enablePan={false}
            enableZoom
            minDistance={3.4}
            maxDistance={9}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2.1}
            autoRotate
            autoRotateSpeed={0.5}
          />
        </Suspense>
      </Canvas>

      {/* Overlay corner label so it's obvious this is 3D */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 flex items-center gap-1.5">
          <span className="dot dot-online" />
          <span>3D · live</span>
        </div>
        {profile && (
          <div className="text-sm text-foreground font-medium mt-0.5">
            {profile.name} · {profile.model}
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="absolute bottom-3 right-3 pointer-events-none text-[10px] text-muted-foreground/70 font-mono">
        drag to rotate · scroll to zoom
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Rig assembly
// ─────────────────────────────────────────────────────────────────────────────

const RigChassis: React.FC<{ profileId: string | null }> = ({ profileId }) => {
  const profile = profileId ? RIG_BY_ID.get(profileId) : null;
  const currentData = useRigStore((s) => s.currentData);

  // Live telemetry → 3D state
  const state = useMemo(() => {
    if (!profile) {
      return {
        intakePct: 0, exhaustPct: 0,
        boardTemps: [40, 40, 40] as [number, number, number],
        ambient: 22,
        offline: true,
      };
    }
    const intakePct = typeof currentData.PL === 'number' ? currentData.PL : 0;
    const exhaustPct = typeof currentData.SL === 'number' ? currentData.SL : 0;
    const ambient = ambientForLocation(profile.location);
    const chipRiseBase =
      profile.behavior === 'efficient'  ? 32 :
      profile.behavior === 'stable'     ? 42 :
      profile.behavior === 'jittery'    ? 44 :
      profile.behavior === 'throttling' ? 56 :
      profile.behavior === 'degraded'   ? 47 :
      0;
    // Use a stable per-rig seed for board temperature offsets so each
    // unit's heat fingerprint stays consistent between renders.
    const seed = profile.id.length * 7;
    const boardTemps: [number, number, number] = [
      ambient + chipRiseBase + ((seed % 5) - 2),
      ambient + chipRiseBase + 4 + ((seed % 7) - 3),
      ambient + chipRiseBase + 1 + ((seed % 11) - 5),
    ];
    return {
      intakePct,
      exhaustPct,
      boardTemps,
      ambient,
      offline: profile.behavior === 'offline',
    };
  }, [profile, currentData]);

  // Chassis dimensions (Antminer-ish proportions: 400×195×290mm → 4:2:3 ratio)
  const W = 4;     // length (along X)
  const H = 2;     // height (along Y)
  const D = 3;     // depth (along Z)

  return (
    <group>
      {/* Main chassis — slotted aluminum extrusion vibe */}
      <Chassis width={W} height={H} depth={D} />

      {/* 3 hashboards stacked along X, perpendicular to airflow */}
      {state.boardTemps.map((temp, idx) => (
        <Hashboard
          key={idx}
          temp={temp}
          position={[-W / 2 + 1 + idx * (W - 2) / 2, 0, 0]}
          height={H * 0.7}
          depth={D * 0.85}
          offline={state.offline}
        />
      ))}

      {/* Front fan (intake, -X side) */}
      <AxialFan
        position={[-W / 2 - 0.1, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        pwmPct={state.intakePct}
      />

      {/* Rear fan (exhaust, +X side) */}
      <AxialFan
        position={[W / 2 + 0.1, 0, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        pwmPct={state.exhaustPct}
      />

      {/* Airflow particle stream */}
      <AirflowParticles
        startX={-W / 2 - 0.3}
        endX={W / 2 + 0.3}
        spreadY={H * 0.4}
        spreadZ={D * 0.4}
        intensity={(state.intakePct + state.exhaustPct) / 200}
        avgTemp={(state.boardTemps[0] + state.boardTemps[1] + state.boardTemps[2]) / 3}
      />
    </group>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Chassis — main metal box with grilled ends
// ─────────────────────────────────────────────────────────────────────────────

const Chassis: React.FC<{ width: number; height: number; depth: number }> = ({ width, height, depth }) => {
  return (
    <group>
      {/* Body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color="#1c1f2e"
          metalness={0.8}
          roughness={0.35}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* Top vent slats */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh
          key={i}
          position={[
            -width / 2 + 0.4 + i * (width - 0.8) / 7,
            height / 2 + 0.01,
            0,
          ]}
        >
          <boxGeometry args={[0.18, 0.02, depth * 0.88]} />
          <meshStandardMaterial color="#0a0c14" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {/* Bottom rubber feet (4 corners) */}
      {[
        [-width / 2 + 0.4, -height / 2 - 0.05,  depth / 2 - 0.4],
        [ width / 2 - 0.4, -height / 2 - 0.05,  depth / 2 - 0.4],
        [-width / 2 + 0.4, -height / 2 - 0.05, -depth / 2 + 0.4],
        [ width / 2 - 0.4, -height / 2 - 0.05, -depth / 2 + 0.4],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <cylinderGeometry args={[0.1, 0.12, 0.1, 16]} />
          <meshStandardMaterial color="#0a0c14" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Hashboard — glowing PCB with heat-tinted emissive
// ─────────────────────────────────────────────────────────────────────────────

const Hashboard: React.FC<{
  temp: number;
  position: [number, number, number];
  height: number;
  depth: number;
  offline: boolean;
}> = ({ temp, position, height, depth, offline }) => {
  const color = useMemo(() => (offline ? new THREE.Color('#334155') : tempToColor(temp)), [temp, offline]);
  // Slight pulse based on temperature — hotter boards pulse faster.
  const pulseFreq = offline ? 0 : 0.5 + Math.min(2, (temp - 60) / 15);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (matRef.current && pulseFreq > 0) {
      const t = clock.getElapsedTime() * pulseFreq;
      const base = offline ? 0 : 1.4;
      matRef.current.emissiveIntensity = base + Math.sin(t) * 0.25;
    }
  });

  return (
    <group position={position}>
      {/* PCB substrate */}
      <mesh castShadow>
        <boxGeometry args={[0.08, height, depth]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={color}
          emissiveIntensity={offline ? 0 : 1.4}
          metalness={0.3}
          roughness={0.5}
        />
      </mesh>
      {/* Chip array — 8×4 grid of small bumps mounted on one side of the PCB */}
      <ChipArray temp={temp} position={[0.05, 0, 0]} height={height} depth={depth} />
      <ChipArray temp={temp} position={[-0.05, 0, 0]} height={height} depth={depth} />
    </group>
  );
};

const ChipArray: React.FC<{
  temp: number;
  position: [number, number, number];
  height: number;
  depth: number;
}> = ({ temp, position, height, depth }) => {
  const cols = 4;
  const rows = 8;
  const chipColor = useMemo(() => tempToColor(temp), [temp]);
  const chips = useMemo(() => {
    const arr: { x: number; y: number; z: number }[] = [];
    const padY = 0.05;
    const padZ = 0.1;
    const stepY = (height - padY * 2) / (cols - 1);
    const stepZ = (depth - padZ * 2) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        arr.push({
          x: 0,
          y: -height / 2 + padY + c * stepY,
          z: -depth / 2 + padZ + r * stepZ,
        });
      }
    }
    return arr;
  }, [cols, rows, height, depth]);

  return (
    <group position={position}>
      {chips.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <boxGeometry args={[0.015, stepEqualize(0.07), stepEqualize(0.07)]} />
          <meshStandardMaterial
            color={chipColor}
            emissive={chipColor}
            emissiveIntensity={1.0 + ((i * 7) % 5) * 0.1}
            metalness={0.2}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
};

// Helper since chip sizing is duplicated — keeps a square footprint.
const stepEqualize = (v: number): number => v;

// ─────────────────────────────────────────────────────────────────────────────
// AxialFan — frame + 9 spinning blades + central hub
// ─────────────────────────────────────────────────────────────────────────────

const AxialFan: React.FC<{
  position: [number, number, number];
  rotation?: [number, number, number];
  pwmPct: number;
}> = ({ position, rotation = [0, 0, 0], pwmPct }) => {
  const bladesRef = useRef<THREE.Group>(null);
  // Spin speed — 100% PWM ≈ 6000 RPM (real ASIC fan spec).
  // 6000 RPM / 60 = 100 rev/s. We slow it down for visual sanity though.
  const radPerSec = (pwmPct / 100) * Math.PI * 2 * 2.2; // 2.2 rev/s at max
  useFrame((_, delta) => {
    if (bladesRef.current) bladesRef.current.rotation.z += radPerSec * delta;
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Outer frame ring */}
      <mesh>
        <torusGeometry args={[1, 0.12, 12, 32]} />
        <meshStandardMaterial color="#1c1f2e" metalness={0.7} roughness={0.5} />
      </mesh>
      {/* Inner spokes (4 corner brackets) */}
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a, i) => (
        <mesh key={i} rotation={[0, 0, a]} position={[0, 0, 0]}>
          <boxGeometry args={[0.2, 0.06, 0.08]} />
          <meshStandardMaterial color="#1c1f2e" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      {/* Blades */}
      <group ref={bladesRef}>
        {Array.from({ length: 9 }).map((_, i) => (
          <FanBlade key={i} angle={(i / 9) * Math.PI * 2} />
        ))}
        {/* Hub */}
        <mesh>
          <cylinderGeometry args={[0.18, 0.18, 0.16, 24]} />
          <meshStandardMaterial color="#0d1020" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.085]}>
          <cylinderGeometry args={[0.06, 0.06, 0.05, 16]} />
          <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  );
};

const FanBlade: React.FC<{ angle: number }> = ({ angle }) => {
  // Custom backward-curved blade geometry. Created once per blade.
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0.18, -0.06);
    shape.quadraticCurveTo(0.5, -0.15, 0.92, -0.04);
    shape.quadraticCurveTo(0.85, 0.02, 0.88, 0.1);
    shape.quadraticCurveTo(0.5, 0.0, 0.18, 0.06);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 1,
    });
  }, []);
  return (
    <mesh rotation={[0, 0, angle]} geometry={geom as unknown as THREE.BufferGeometry}>
      <meshStandardMaterial color="#c7d2fe" metalness={0.55} roughness={0.35} />
    </mesh>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AirflowParticles — animated dots flowing through the chassis
// ─────────────────────────────────────────────────────────────────────────────

const AirflowParticles: React.FC<{
  startX: number;
  endX: number;
  spreadY: number;
  spreadZ: number;
  intensity: number;   // 0-1, controls particle speed
  avgTemp: number;     // for color
}> = ({ startX, endX, spreadY, spreadZ, intensity, avgTemp }) => {
  const COUNT = 120;
  const pointsRef = useRef<THREE.Points>(null);

  // Position + per-particle phase offsets stored in attributes so the
  // shader can animate without React re-rendering.
  const { positions, phases } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = startX + Math.random() * (endX - startX);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2 * spreadY;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * spreadZ;
      phases[i] = Math.random();
    }
    return { positions, phases };
  }, [startX, endX, spreadY, spreadZ]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const geom = pointsRef.current.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const span = endX - startX;
    const baseSpeed = 0.4 + intensity * 2.4; // m/s
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 0] += baseSpeed * delta;
      if (arr[i * 3 + 0] > endX) {
        // Wrap back to the intake side with a fresh y/z position
        arr[i * 3 + 0] = startX - Math.random() * 0.4;
        arr[i * 3 + 1] = (Math.random() - 0.5) * 2 * spreadY;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 2 * spreadZ;
      }
    }
    pos.needsUpdate = true;
  });

  // Color particles slightly toward the warm side as air heats up through
  // the rig — gives the stream a visible temperature gradient.
  const color = useMemo(() => tempToColor(Math.min(90, avgTemp)), [avgTemp]);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-phase"
          count={COUNT}
          array={phases}
          itemSize={1}
          args={[phases, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        color={color}
        transparent
        opacity={0.65}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
};

export default RigASIC3D;
