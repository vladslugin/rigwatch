import type { BrennbewertungKnowledgeBase } from '../types/brennbewertung';

/**
 * Default Rig Health Score knowledge base. Seven scoring variables
 * (C0..C6) cover the most common reasons a mining rig deviates from
 * its nominal operating envelope. The legacy variable name
 * "Brennbewertung" is retained on disk for storage/schema continuity
 * — semantically it now means "Mining Health Score".
 *
 * Each entry has:
 *   title       — short headline shown next to the star rating
 *   grund       — likely root causes
 *   auswirkungen — symptoms an operator notices on the dashboard
 *   massnahmen  — concrete operator-level remediations
 *
 * Audience: rig operators / NOC engineers. Wording stays plain and
 * action-oriented.
 */
export const DEFAULT_BRENNBEWERTUNG_KNOWLEDGE: BrennbewertungKnowledgeBase = {
  C0: {
    title: 'Rig is slow to ramp up',
    grund: [
      'Cold ambient intake — thermal headroom collapsing before nominal hashrate is reached',
      'PSU cannot deliver rated wattage (undervolt at the wall)',
      'Firmware boot loop or hashboard handshake retries',
    ],
    auswirkungen: [
      'Time-to-nominal-hashrate is significantly longer than the model baseline',
      'Power draw climbs in steps instead of smoothly',
      'Pool reports stale shares during the first minutes after a restart',
      'Fans audibly cycle while the rig is still under target temperature',
    ],
    massnahmen: [
      'Verify intake air temperature is within model spec (≤30 °C for air-cooled)',
      'Check PSU AC input voltage at the rig — drop >5% under load means a feeder issue',
      'Look at the controller log for hashboard handshake retries; reseat ribbon cables if present',
    ],
  },
  C1: {
    title: 'Thermal throttling',
    grund: [
      'Ambient intake too hot or recirculating exhaust',
      'Dust buildup on hashboard heatsinks',
      'Fan PWM curve too conservative for the workload',
    ],
    auswirkungen: [
      'Hashrate is clipped 8–15% below model nominal',
      'Both intake and exhaust fans pinned at 100% PWM',
      'Hashboard temperature reading sits in the 78–90 °C band',
      'Rejected-share rate ticks up under sustained load',
    ],
    massnahmen: [
      'Lower intake temperature: improve duct routing or add an inline cooler',
      'Schedule a cleaning cycle; expect 4–7 °C improvement on dusty units',
      'Apply a more aggressive fan curve via the controller config (or derate clock by 5–8%)',
    ],
  },
  C2: {
    title: 'Share rejection spike',
    grund: [
      'Pool latency degradation or stratum endpoint instability',
      'Worker name collision (two rigs publishing the same worker id)',
      'Local network jitter / packet loss to the pool',
    ],
    auswirkungen: [
      'Accepted-share rate dips, rejected and stale counters climb',
      'Effective hashrate at the pool drifts below the local controller readout',
      'Daily payout estimate diverges from on-device hashrate',
    ],
    massnahmen: [
      'Failover to a secondary stratum endpoint and compare reject rate over 30 min',
      'Confirm every rig has a unique worker name; rename and reconnect if not',
      'Ping the pool from the rig subnet — >40 ms p95 is the threshold for migration',
    ],
  },
  C3: {
    title: 'Poor energy efficiency',
    grund: [
      'Hashboard ASICs operating off-curve (overclocked beyond efficient band)',
      'Firmware running an outdated power profile',
      'PSU operating outside its high-efficiency load band',
    ],
    auswirkungen: [
      'Joules-per-terahash (J/TH) above the model spec by >5%',
      'Power draw is roughly nominal but hashrate is below nominal',
      'Wallet revenue per kWh is below the fleet baseline',
    ],
    massnahmen: [
      'Switch to a published efficiency-tuned firmware (BMOS / BTMiner stable channel)',
      'Drop hashboard frequency by one step and re-measure — most chips are most efficient ~5% under stock',
      'For PSUs running <40% load, consolidate workloads or swap to a smaller unit',
    ],
  },
  C4: {
    title: 'Hashrate instability',
    grund: [
      'Marginal hashboard chip (degraded with age)',
      'Memory clock running above stability margin',
      'Insufficient cooling causing intermittent thermal trips',
    ],
    auswirkungen: [
      'Hashrate jitter exceeds ±4% across one-minute windows',
      'Status flips between mining and throttling several times per hour',
      'Pool view shows alternating fast/slow accepted-share windows',
    ],
    massnahmen: [
      'Pull controller log for `hashboard X dropped` errors and isolate the chain',
      'Lower memory clock by one step; expect 1–2% hashrate loss for stability',
      'Improve airflow on the affected unit; check that the rig is not in an exhaust shadow',
    ],
  },
  C5: {
    title: 'ASIC degradation / memory errors',
    grund: [
      'Aging hashboard with rising bit-error rate',
      'Memory subsystem running on the edge of its voltage envelope',
      'Solder fatigue on one of the hashboards',
    ],
    auswirkungen: [
      'Recoverable memory errors logged each hour',
      'One hashboard contributes <80% of its expected hashrate',
      'Effective hashrate trends down 0.5–1% per week',
    ],
    massnahmen: [
      'Run the vendor diagnostic and capture per-chip error counts',
      'Increase board voltage by one step if temperature allows; otherwise plan an RMA',
      'Move the rig to a cooler position in the rack — degradation accelerates above 70 °C average',
    ],
  },
  C6: {
    title: 'Cooling saturation',
    grund: [
      'Fans pinned at 100% with no thermal margin left',
      'Room HVAC over capacity or partially failed',
      'Hot aisle recirculation due to gap in containment',
    ],
    auswirkungen: [
      'Both fans at 100% PWM during stable workloads',
      'Hashrate cannot recover above 90% of nominal regardless of load profile',
      'Intake temperature sensors near the model upper limit',
    ],
    massnahmen: [
      'Audit room HVAC: check setpoint, filter pressure drop, and chiller status',
      'Plug recirculation gaps in the containment system',
      'For hydro/immersion units, verify coolant flow rate against the model spec',
    ],
  },
};

/**
 * Star rating thresholds. A C-value of 0 hides the variable entirely; otherwise
 * it gets between 1 and 5 filled stars.
 */
export const starsForCValue = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 80) return 5;
  if (value >= 60) return 4;
  if (value >= 40) return 3;
  if (value >= 20) return 2;
  return 1;
};
