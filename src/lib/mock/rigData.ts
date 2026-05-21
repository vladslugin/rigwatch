/**
 * 24 mock mining rigs across three sites with distinct "characters".
 * Each rig has a deterministic id, model, location, owner wallet, and a
 * behavior profile that shapes its live telemetry (stable, jittery,
 * throttling, degraded, offline). Reused by the telemetry pumper.
 *
 * IDs use a wallet-style 0x… prefix so the connection input feels
 * native to a web3 audience but is still easy to type/copy.
 */

export type RigBehavior =
  | 'stable'        // Healthy: small noise, full hashrate
  | 'efficient'    // Immersion-cooled, lower temp/power, top efficiency
  | 'jittery'      // Frequent hashrate dips, share rejection spikes
  | 'throttling'   // High temp, fans 100%, hashrate clipped
  | 'degraded'     // Aging ASIC, sub-nominal hashrate
  | 'offline';     // Powered down, no telemetry

export type RigStatus = 'mining' | 'sync' | 'idle' | 'throttling' | 'error' | 'offline';

export interface RigProfile {
  id: string;
  name: string;
  model: string;
  algo: 'SHA-256' | 'kHeavyHash' | 'Scrypt';
  // Hashrate units: SHA-256 in TH/s, KAS in GH/s, scrypt in MH/s
  nominalHashrate: number;
  nominalPowerW: number;
  location: string;
  ownerWallet: string;
  behavior: RigBehavior;
  firmware: string;
  startedAt: number;     // unix ms — used for uptime
  poolName: string;
  poolUrl: string;
  worker: string;
}

const ICELAND = 'Reykjavík-DC1';
const TEXAS = 'Austin-DC2';
const KZ = 'Pavlodar-DC3';

const wallet = (n: number): string =>
  '0x' + n.toString(16).padStart(8, '0') + 'a3f' + ((n * 17) & 0xffff).toString(16).padStart(4, '0');

const rigId = (idx: number): string => `0x${(idx * 0x1a3b + 0xc0de).toString(16).padStart(8, '0')}`;

// Snapshot generated at module load — keeps "startedAt" stable across renders.
const NOW = Date.now();

export const RIGS: RigProfile[] = [
  // Iceland-DC1 — high-efficiency immersion cooling
  { id: rigId(1),  name: 'Antares-01',  model: 'Antminer S21 Pro',    algo: 'SHA-256',     nominalHashrate: 234,  nominalPowerW: 3531, location: ICELAND, ownerWallet: wallet(1), behavior: 'efficient', firmware: 'BMOS 1.4.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 32, poolName: 'Foundry USA',  poolUrl: 'stratum+tcp://btc.foundryusapool.com:3333',  worker: 'antares01' },
  { id: rigId(2),  name: 'Antares-02',  model: 'Antminer S21 Pro',    algo: 'SHA-256',     nominalHashrate: 234,  nominalPowerW: 3531, location: ICELAND, ownerWallet: wallet(1), behavior: 'stable',    firmware: 'BMOS 1.4.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 28, poolName: 'Foundry USA',  poolUrl: 'stratum+tcp://btc.foundryusapool.com:3333',  worker: 'antares02' },
  { id: rigId(3),  name: 'Antares-03',  model: 'Whatsminer M60S',     algo: 'SHA-256',     nominalHashrate: 186,  nominalPowerW: 3441, location: ICELAND, ownerWallet: wallet(1), behavior: 'efficient', firmware: 'BTMiner 4.3', startedAt: NOW - 1000 * 60 * 60 * 24 * 19, poolName: 'AntPool',      poolUrl: 'stratum+tcp://stratum.antpool.com:443',      worker: 'antares03' },
  { id: rigId(4),  name: 'Antares-04',  model: 'Whatsminer M60S',     algo: 'SHA-256',     nominalHashrate: 186,  nominalPowerW: 3441, location: ICELAND, ownerWallet: wallet(1), behavior: 'jittery',   firmware: 'BTMiner 4.3', startedAt: NOW - 1000 * 60 * 60 * 24 * 11, poolName: 'AntPool',      poolUrl: 'stratum+tcp://stratum.antpool.com:443',      worker: 'antares04' },
  { id: rigId(5),  name: 'Antares-05',  model: 'Antminer KS5L',       algo: 'kHeavyHash',  nominalHashrate: 12,   nominalPowerW: 3500, location: ICELAND, ownerWallet: wallet(1), behavior: 'stable',    firmware: 'BMOS 1.4.1', startedAt: NOW - 1000 * 60 * 60 * 24 * 9,  poolName: 'WoolyPooly',   poolUrl: 'stratum+tcp://kas.woolypooly.com:3112',      worker: 'antares05' },
  { id: rigId(6),  name: 'Antares-06',  model: 'Antminer KS5L',       algo: 'kHeavyHash',  nominalHashrate: 12,   nominalPowerW: 3500, location: ICELAND, ownerWallet: wallet(1), behavior: 'stable',    firmware: 'BMOS 1.4.1', startedAt: NOW - 1000 * 60 * 60 * 24 * 9,  poolName: 'WoolyPooly',   poolUrl: 'stratum+tcp://kas.woolypooly.com:3112',      worker: 'antares06' },
  { id: rigId(7),  name: 'Antares-07',  model: 'Antminer S19 XP',     algo: 'SHA-256',     nominalHashrate: 140,  nominalPowerW: 3010, location: ICELAND, ownerWallet: wallet(2), behavior: 'stable',    firmware: 'BMOS 1.3.9', startedAt: NOW - 1000 * 60 * 60 * 24 * 47, poolName: 'F2Pool',       poolUrl: 'stratum+tcp://btc.f2pool.com:1314',          worker: 'antares07' },
  { id: rigId(8),  name: 'Antares-08',  model: 'Antminer S19 XP',     algo: 'SHA-256',     nominalHashrate: 140,  nominalPowerW: 3010, location: ICELAND, ownerWallet: wallet(2), behavior: 'degraded',  firmware: 'BMOS 1.3.9', startedAt: NOW - 1000 * 60 * 60 * 24 * 51, poolName: 'F2Pool',       poolUrl: 'stratum+tcp://btc.f2pool.com:1314',          worker: 'antares08' },

  // Texas-DC2 — air-cooled, mid-tier
  { id: rigId(9),  name: 'Orion-01',    model: 'Antminer S21',        algo: 'SHA-256',     nominalHashrate: 200,  nominalPowerW: 3550, location: TEXAS,   ownerWallet: wallet(3), behavior: 'stable',    firmware: 'BMOS 1.4.0', startedAt: NOW - 1000 * 60 * 60 * 24 * 14, poolName: 'ViaBTC',       poolUrl: 'stratum+tcp://btc.viabtc.com:3333',          worker: 'orion01' },
  { id: rigId(10), name: 'Orion-02',    model: 'Antminer S21',        algo: 'SHA-256',     nominalHashrate: 200,  nominalPowerW: 3550, location: TEXAS,   ownerWallet: wallet(3), behavior: 'stable',    firmware: 'BMOS 1.4.0', startedAt: NOW - 1000 * 60 * 60 * 24 * 14, poolName: 'ViaBTC',       poolUrl: 'stratum+tcp://btc.viabtc.com:3333',          worker: 'orion02' },
  { id: rigId(11), name: 'Orion-03',    model: 'Antminer S21',        algo: 'SHA-256',     nominalHashrate: 200,  nominalPowerW: 3550, location: TEXAS,   ownerWallet: wallet(3), behavior: 'throttling',firmware: 'BMOS 1.4.0', startedAt: NOW - 1000 * 60 * 60 * 24 * 14, poolName: 'ViaBTC',       poolUrl: 'stratum+tcp://btc.viabtc.com:3333',          worker: 'orion03' },
  { id: rigId(12), name: 'Orion-04',    model: 'Whatsminer M50S',     algo: 'SHA-256',     nominalHashrate: 126,  nominalPowerW: 3276, location: TEXAS,   ownerWallet: wallet(3), behavior: 'stable',    firmware: 'BTMiner 4.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 22, poolName: 'Foundry USA',  poolUrl: 'stratum+tcp://btc.foundryusapool.com:3333',  worker: 'orion04' },
  { id: rigId(13), name: 'Orion-05',    model: 'Whatsminer M50S',     algo: 'SHA-256',     nominalHashrate: 126,  nominalPowerW: 3276, location: TEXAS,   ownerWallet: wallet(3), behavior: 'jittery',   firmware: 'BTMiner 4.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 22, poolName: 'Foundry USA',  poolUrl: 'stratum+tcp://btc.foundryusapool.com:3333',  worker: 'orion05' },
  { id: rigId(14), name: 'Orion-06',    model: 'Bitmain L7',          algo: 'Scrypt',      nominalHashrate: 9500, nominalPowerW: 3425, location: TEXAS,   ownerWallet: wallet(4), behavior: 'stable',    firmware: 'BMOS 1.3.7', startedAt: NOW - 1000 * 60 * 60 * 24 * 67, poolName: 'LitecoinPool', poolUrl: 'stratum+tcp://stratum.litecoinpool.org:3333', worker: 'orion06' },
  { id: rigId(15), name: 'Orion-07',    model: 'Bitmain L7',          algo: 'Scrypt',      nominalHashrate: 9500, nominalPowerW: 3425, location: TEXAS,   ownerWallet: wallet(4), behavior: 'stable',    firmware: 'BMOS 1.3.7', startedAt: NOW - 1000 * 60 * 60 * 24 * 67, poolName: 'LitecoinPool', poolUrl: 'stratum+tcp://stratum.litecoinpool.org:3333', worker: 'orion07' },
  { id: rigId(16), name: 'Orion-08',    model: 'Antminer KS3',        algo: 'kHeavyHash',  nominalHashrate: 8.3,  nominalPowerW: 3188, location: TEXAS,   ownerWallet: wallet(4), behavior: 'offline',   firmware: 'BMOS 1.3.5', startedAt: NOW - 1000 * 60 * 60 * 24 * 102,poolName: 'WoolyPooly',   poolUrl: 'stratum+tcp://kas.woolypooly.com:3112',      worker: 'orion08' },

  // Pavlodar-DC3 — older fleet, cheap power, more variance
  { id: rigId(17), name: 'Vega-01',     model: 'Antminer S19j Pro',   algo: 'SHA-256',     nominalHashrate: 104,  nominalPowerW: 3068, location: KZ,      ownerWallet: wallet(5), behavior: 'stable',    firmware: 'BMOS 1.3.5', startedAt: NOW - 1000 * 60 * 60 * 24 * 89, poolName: 'AntPool',      poolUrl: 'stratum+tcp://stratum.antpool.com:443',      worker: 'vega01' },
  { id: rigId(18), name: 'Vega-02',     model: 'Antminer S19j Pro',   algo: 'SHA-256',     nominalHashrate: 104,  nominalPowerW: 3068, location: KZ,      ownerWallet: wallet(5), behavior: 'degraded',  firmware: 'BMOS 1.3.5', startedAt: NOW - 1000 * 60 * 60 * 24 * 92, poolName: 'AntPool',      poolUrl: 'stratum+tcp://stratum.antpool.com:443',      worker: 'vega02' },
  { id: rigId(19), name: 'Vega-03',     model: 'Antminer S19j Pro',   algo: 'SHA-256',     nominalHashrate: 104,  nominalPowerW: 3068, location: KZ,      ownerWallet: wallet(5), behavior: 'throttling',firmware: 'BMOS 1.3.5', startedAt: NOW - 1000 * 60 * 60 * 24 * 87, poolName: 'AntPool',      poolUrl: 'stratum+tcp://stratum.antpool.com:443',      worker: 'vega03' },
  { id: rigId(20), name: 'Vega-04',     model: 'Antminer S19',        algo: 'SHA-256',     nominalHashrate: 95,   nominalPowerW: 3250, location: KZ,      ownerWallet: wallet(5), behavior: 'degraded',  firmware: 'BMOS 1.3.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 134,poolName: 'F2Pool',       poolUrl: 'stratum+tcp://btc.f2pool.com:1314',          worker: 'vega04' },
  { id: rigId(21), name: 'Vega-05',     model: 'Antminer S19',        algo: 'SHA-256',     nominalHashrate: 95,   nominalPowerW: 3250, location: KZ,      ownerWallet: wallet(6), behavior: 'stable',    firmware: 'BMOS 1.3.2', startedAt: NOW - 1000 * 60 * 60 * 24 * 134,poolName: 'F2Pool',       poolUrl: 'stratum+tcp://btc.f2pool.com:1314',          worker: 'vega05' },
  { id: rigId(22), name: 'Vega-06',     model: 'Whatsminer M30S++',   algo: 'SHA-256',     nominalHashrate: 112,  nominalPowerW: 3472, location: KZ,      ownerWallet: wallet(6), behavior: 'jittery',   firmware: 'BTMiner 3.9', startedAt: NOW - 1000 * 60 * 60 * 24 * 78, poolName: 'ViaBTC',       poolUrl: 'stratum+tcp://btc.viabtc.com:3333',          worker: 'vega06' },
  { id: rigId(23), name: 'Vega-07',     model: 'Iceriver KS3L',       algo: 'kHeavyHash',  nominalHashrate: 5,    nominalPowerW: 3400, location: KZ,      ownerWallet: wallet(6), behavior: 'stable',    firmware: 'IRMOS 0.9.4', startedAt: NOW - 1000 * 60 * 60 * 24 * 41, poolName: 'WoolyPooly',   poolUrl: 'stratum+tcp://kas.woolypooly.com:3112',      worker: 'vega07' },
  { id: rigId(24), name: 'Vega-08',     model: 'Iceriver KS3L',       algo: 'kHeavyHash',  nominalHashrate: 5,    nominalPowerW: 3400, location: KZ,      ownerWallet: wallet(6), behavior: 'offline',   firmware: 'IRMOS 0.9.4', startedAt: NOW - 1000 * 60 * 60 * 24 * 41, poolName: 'WoolyPooly',   poolUrl: 'stratum+tcp://kas.woolypooly.com:3112',      worker: 'vega08' },
];

export const RIG_BY_ID = new Map<string, RigProfile>(RIGS.map((r) => [r.id, r]));

/**
 * Parameter metadata that the existing UI expects under
 * `masse_und_gewichte/{paramId}` in Firestore. The field names (T, PL, SL,
 * P, N) are retained from the legacy app for now — Phase 3 will rename
 * them to mining-domain identifiers (hashrate, fan_front, etc.).
 */
export const PARAMETER_METADATA: Record<string, {
  name: string;
  einheit: string;
  div: number;
  form: number;
  min?: number;
  max?: number;
  was: string;
  color: string;
  yAxisID?: string;
  favorite?: number;
  position?: number;
  show_in_legend?: boolean;
  visible_on_chart?: boolean;
  dataType?: 'float' | 'int' | 'bool';
  kategorie?: string;
  zugriff?: string;
}> = {
  T:  { name: 'Hashboard Temperature', einheit: '°C',   div: 1, form: 0, min: 0,   max: 100,   was: 'Average hashboard temperature.',                  color: '#ef4444', yAxisID: 'y',  favorite: 1, position: 0, show_in_legend: true,  visible_on_chart: true,  dataType: 'float', kategorie: 'thermal' },
  PL: { name: 'Fan Front',             einheit: '%',    div: 1, form: 0, min: 0,   max: 100,   was: 'Front fan PWM duty.',                              color: '#3b82f6', yAxisID: 'y1', favorite: 1, position: 1, show_in_legend: true,  visible_on_chart: true,  dataType: 'float', kategorie: 'cooling' },
  SL: { name: 'Fan Rear',              einheit: '%',    div: 1, form: 0, min: 0,   max: 100,   was: 'Rear fan PWM duty.',                               color: '#22c55e', yAxisID: 'y1', favorite: 1, position: 2, show_in_legend: true,  visible_on_chart: true,  dataType: 'float', kategorie: 'cooling' },
  P:  { name: 'Hashrate',              einheit: 'TH/s', div: 1, form: 0, min: 0,   max: 250,   was: 'Realtime hashrate measured at controller.',        color: '#f97316', yAxisID: 'y2', favorite: 1, position: 3, show_in_legend: true,  visible_on_chart: true,  dataType: 'float', kategorie: 'performance' },
  N:  { name: 'Worker Status',         einheit: '',     div: 1, form: 1, min: 0,   max: 7,     was: '0=offline, 1=boot, 2=sync, 3=mining, 4=throttling, 5=error, 6=update, 7=idle', color: '#a855f7', yAxisID: 'y',  favorite: 1, position: 4, show_in_legend: true,  visible_on_chart: true,  dataType: 'int',   kategorie: 'status' },
  CO2:{ name: 'Power Draw',            einheit: 'W',    div: 1, form: 0, min: 0,   max: 4000,  was: 'Total system power consumption.',                  color: '#eab308', yAxisID: 'y3', favorite: 0, position: 5, show_in_legend: true,  visible_on_chart: false, dataType: 'float', kategorie: 'power' },
  TRIG1:{name: 'Shares Accepted',      einheit: '/min', div: 1, form: 0, min: 0,   max: 500,   was: 'Accepted share rate.',                             color: '#10b981', yAxisID: 'y3', favorite: 0, position: 6, show_in_legend: false, visible_on_chart: false, dataType: 'int',   kategorie: 'pool' },
};

/** Build the konstant_app/{deviceId} blob the legacy UI consumes. */
export const buildKonstantApp = (rig: RigProfile) => ({
  ofenname: `${rig.name} · ${rig.model}`,
  ofen: rig.model,
  vers: rig.firmware,
  shareData: true,
  f: 0,
  v: false,
  comment: `${rig.location} · ${rig.algo}`,
  active_clients: {},
});

/** Snapshot of the konstant/{deviceId} config. */
export const buildKonstant = (rig: RigProfile) => ({
  verz: 'default',
  d: true,
  u: false,
  // Demo wallet binding — surfaced by the Web3ConnectionPanel later.
  owner: rig.ownerWallet,
  pool: { name: rig.poolName, url: rig.poolUrl, worker: rig.worker },
  algo: rig.algo,
});
