/**
 * AI Operator Assistant — synthesises realistic Gemini-style responses
 * for mining triage prompts. Works offline (no API key needed) by pattern-
 * matching the prompt against a small expert rulebase, then filling in
 * real numbers from the rig's current telemetry.
 *
 * If `VITE_GEMINI_API_KEY` is set, the actual fetch path is taken instead;
 * see `askGemini` below. The fallback shape is identical so the UI
 * doesn't need to know which path produced the response.
 */

import type { RigProfile } from '../mock/rigData';

export interface OperatorContext {
  rig: RigProfile;
  /** Live telemetry. */
  hashrate: number;
  temp: number;            // hottest hashboard °C
  intakePwm: number;       // %
  exhaustPwm: number;      // %
  powerW: number;
  rigState: number;        // 0-7 mining state
  /** Recent events in the last 14 days, most recent first. */
  recentEvents: Array<{
    title: string;
    severity: 'info' | 'success' | 'warn' | 'error';
    timestamp: number;
  }>;
}

export interface AssistantMessage {
  role: 'assistant' | 'user';
  content: string;
  /** Wall-clock ms when message was created. */
  timestamp: number;
  /** Was this generated with the real Gemini path? */
  realModel?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic expert-system path — used when no API key is configured.
// ─────────────────────────────────────────────────────────────────────────────

type Topic = 'temp' | 'hashrate' | 'shares' | 'efficiency' | 'firmware' | 'pool' | 'general';

const detectTopic = (prompt: string): Topic => {
  const p = prompt.toLowerCase();
  if (/(temp|hot|cool|heat|°c|fan|throttl)/.test(p)) return 'temp';
  if (/(hash|hashrate|th\/s|gh\/s|mh\/s|perform)/.test(p)) return 'hashrate';
  if (/(reject|share|stale|accept)/.test(p)) return 'shares';
  if (/(j\/th|efficien|power|kwh|wattage|watt)/.test(p)) return 'efficiency';
  if (/(firmware|update|version|patch|rollback)/.test(p)) return 'firmware';
  if (/(pool|stratum|payout|switch.*pool)/.test(p)) return 'pool';
  return 'general';
};

const formatRelative = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/**
 * Build a "greeting" assistant message tailored to the rig's current state.
 * Surfaced as the first message in the chat when an operator opens the
 * panel — gives the assistant a chance to flag obvious problems
 * proactively.
 */
export const buildGreeting = (ctx: OperatorContext): string => {
  const { rig, temp, intakePwm, hashrate, recentEvents } = ctx;
  const nominalHash = rig.nominalHashrate;
  const hashDelta = nominalHash > 0 ? ((hashrate - nominalHash) / nominalHash) * 100 : 0;

  const lines: string[] = [];
  lines.push(`👋 Reading **${rig.name}** (${rig.model}) at **${rig.location}**.`);

  // Pick the most pressing issue
  if (temp >= 85) {
    lines.push(`I'm seeing **${temp.toFixed(1)}°C on the hottest hashboard** — that's above the safe envelope. Fans are at ${intakePwm.toFixed(0)}% so cooling is already maxed. Want me to walk through derating options?`);
  } else if (intakePwm >= 95) {
    lines.push(`Fans are running at **${intakePwm.toFixed(0)}% PWM** — that's basically full bore. Worth checking intake temps and recirculation. Ask me about thermal triage.`);
  } else if (hashDelta < -8) {
    lines.push(`Hashrate is **${hashDelta.toFixed(1)}% below nominal** (${hashrate.toFixed(1)} vs. ${nominalHash} ${rig.algo === 'SHA-256' ? 'TH/s' : 'GH/s'}). Could be thermal, share rejection, or ASIC degradation — happy to dig in.`);
  } else if (rig.behavior === 'jittery' && recentEvents.some((e) => e.title.includes('rejection'))) {
    lines.push(`I noticed share rejection spikes in the last few hours. Want a triage walk-through?`);
  } else {
    lines.push(`Rig is within nominal envelope — hashrate **${hashrate.toFixed(1)}** ${rig.algo === 'SHA-256' ? 'TH/s' : 'GH/s'}, hottest board **${temp.toFixed(1)}°C**. Ask me anything about it.`);
  }

  return lines.join('\n\n');
};

/**
 * Returns 3-4 suggested prompts tailored to the rig's current state.
 * Helps an operator who doesn't know what to ask.
 */
export const buildSuggestions = (ctx: OperatorContext): string[] => {
  const { rig, temp, intakePwm } = ctx;
  const out: string[] = [];

  if (temp >= 80 || intakePwm >= 90) {
    out.push('Why is HB2 running hot?');
    out.push('Should I derate the clock?');
  }
  if (rig.behavior === 'jittery') {
    out.push('Why are shares being rejected?');
  }
  if (rig.behavior === 'degraded') {
    out.push('How can I check for chip degradation?');
  }
  if (out.length < 3) {
    out.push('Is this rig profitable right now?');
    out.push('Compare efficiency to spec.');
    out.push('When was the last firmware update?');
  }
  return out.slice(0, 4);
};

/**
 * The synthetic response engine. Given a prompt + rig context, picks a
 * topic, fills in real numbers, and emits a Gemini-flavoured markdown
 * answer.
 */
export const synthesizeReply = (ctx: OperatorContext, prompt: string): string => {
  const topic = detectTopic(prompt);
  const { rig, hashrate, temp, intakePwm, exhaustPwm, powerW } = ctx;
  const nominalHash = rig.nominalHashrate;
  const hashDelta = nominalHash > 0 ? ((hashrate - nominalHash) / nominalHash) * 100 : 0;
  const efficiency = hashrate > 0 ? powerW / hashrate : 0;
  const nominalEff = rig.nominalPowerW / rig.nominalHashrate;
  const effDelta = nominalEff > 0 ? ((efficiency - nominalEff) / nominalEff) * 100 : 0;

  switch (topic) {
    case 'temp': {
      const lines: string[] = [];
      lines.push(`**Thermal snapshot for ${rig.name}:**`);
      lines.push('');
      lines.push(`- Hottest hashboard: **${temp.toFixed(1)}°C** ${temp >= 85 ? '⚠️ above safe envelope' : temp >= 75 ? '· warm but within band' : '· nominal'}`);
      lines.push(`- Intake / exhaust PWM: **${intakePwm.toFixed(0)}% / ${exhaustPwm.toFixed(0)}%**`);
      lines.push(`- Location ambient: ${rig.location.split('-')[0]} (datacenter-dependent)`);
      lines.push('');
      if (temp >= 85) {
        lines.push(`**Recommended next steps:**`);
        lines.push(`1. Verify intake duct temp at the rack — anything > 30°C will cap your cooling headroom.`);
        lines.push(`2. Derate clock by one step (≈ -5% hashrate) to give the chips thermal margin.`);
        lines.push(`3. Inspect the heatsinks for dust if the rig hasn't been cleaned in 90+ days.`);
        lines.push(`4. If pattern persists, escalate to facilities to check the HVAC zone.`);
      } else if (temp >= 75) {
        lines.push(`This is in the warm-but-OK band. Fans are doing their job; no action needed unless the trend keeps climbing.`);
      } else {
        lines.push(`Temps are well-managed. Nothing to do.`);
      }
      return lines.join('\n');
    }

    case 'hashrate': {
      return [
        `**Hashrate analysis for ${rig.name}:**`,
        ``,
        `- Current: **${hashrate.toFixed(1)} ${rig.algo === 'SHA-256' ? 'TH/s' : rig.algo === 'kHeavyHash' ? 'GH/s' : 'MH/s'}**`,
        `- Nominal (model spec): ${nominalHash} ${rig.algo === 'SHA-256' ? 'TH/s' : rig.algo === 'kHeavyHash' ? 'GH/s' : 'MH/s'}`,
        `- Delta: **${hashDelta >= 0 ? '+' : ''}${hashDelta.toFixed(1)}%** vs. nominal`,
        ``,
        hashDelta >= -2
          ? `Performance is within ±2% of spec — nothing to act on. Daily cycles (warmer afternoons → tiny dip) are expected and harmless.`
          : hashDelta >= -8
          ? `You're slightly under spec. Most common cause at this magnitude is mild thermal throttling. If temps are nominal, check pool-side accepted rate — sometimes shares are being computed locally but lost in flight.`
          : `Significant gap. Three likely culprits in order: (1) thermal throttling — check HB temps; (2) share rejection (pool-side or local) eating effective hashrate; (3) one hashboard degraded or running at reduced chip count. Want me to walk through the diagnostic for any of these?`,
      ].join('\n');
    }

    case 'shares': {
      const recentRejection = ctx.recentEvents.find((e) => e.title.toLowerCase().includes('rejection'));
      return [
        `**Share rejection triage for ${rig.name}:**`,
        ``,
        recentRejection
          ? `- I see a rejection event from **${formatRelative(recentRejection.timestamp)}** — that's likely related to your question.`
          : `- No recent rejection events flagged — current symptom may be early.`,
        `- Behavior class: ${rig.behavior}`,
        ``,
        `**Most common causes (ranked):**`,
        `1. **Pool latency degradation** — switch to a regional endpoint and compare 30-min reject rate.`,
        `2. **Worker name collision** — two miners publishing the same worker confuses some pools' difficulty allocator. Confirm uniqueness.`,
        `3. **Local network jitter** — ping the pool from the rig subnet; > 40 ms p95 → bad.`,
        `4. **Hashboard hardware drift** — fixable by reseating the ribbon and re-enumerating chip count.`,
      ].join('\n');
    }

    case 'efficiency': {
      const dailyKwh = (powerW * 24) / 1000;
      return [
        `**Energy efficiency snapshot:**`,
        ``,
        `- Current: **${efficiency.toFixed(1)} J/${rig.algo === 'SHA-256' ? 'TH' : 'GH'}**`,
        `- Spec: ${nominalEff.toFixed(1)} J/${rig.algo === 'SHA-256' ? 'TH' : 'GH'}`,
        `- Delta: **${effDelta >= 0 ? '+' : ''}${effDelta.toFixed(1)}%** vs. spec ${effDelta > 5 ? '⚠️ worse than spec' : effDelta < -2 ? '✅ better than spec' : '· within range'}`,
        `- Daily energy draw: **${dailyKwh.toFixed(1)} kWh**`,
        ``,
        effDelta > 5
          ? `Worth investigating. Try: (1) update to the efficiency-tuned firmware channel; (2) drop hashboard frequency one step — most chips hit peak J/TH ~5% below stock; (3) verify PSU isn't running below its high-efficiency band (< 40% load is wasteful).`
          : `Numbers look healthy — efficient relative to spec.`,
      ].join('\n');
    }

    case 'firmware': {
      const fwEvent = ctx.recentEvents.find((e) => e.title.toLowerCase().includes('firmware'));
      return [
        `**Firmware status for ${rig.name}:**`,
        ``,
        `- Installed: **${rig.firmware}**`,
        fwEvent ? `- Last firmware event: ${fwEvent.title} (${formatRelative(fwEvent.timestamp)})` : `- No firmware events in the last 14 days.`,
        ``,
        `If you're considering a rollout, my advice: (1) update **one rig** first, watch for 24h; (2) confirm pool-side hashrate matches local readout — firmwares sometimes mis-report; (3) keep the previous binary on hand for a rollback if J/TH gets worse.`,
      ].join('\n');
    }

    case 'pool': {
      return [
        `**Pool status for ${rig.name}:**`,
        ``,
        `- Currently mining to: **${rig.poolName}**`,
        `- Worker: \`${rig.worker}\``,
        `- Algorithm: ${rig.algo}`,
        ``,
        `If you're considering a switch, the **Switch pool** action above lets you compare fee + region + ping side by side. For SHA-256 in 2025, Foundry USA and Luxor are the typical "low fee + good US connectivity" picks; AntPool/F2Pool are reliable but pricier on fees.`,
      ].join('\n');
    }

    case 'general':
    default: {
      return [
        `Happy to help with **${rig.name}**. Some things I can dig into:`,
        ``,
        `- Why a specific hashboard is hot`,
        `- Whether your hashrate matches spec`,
        `- Share rejection root-cause walkthrough`,
        `- Energy efficiency vs. model`,
        `- Pool / firmware recommendations`,
        ``,
        `Right now: hashrate **${hashrate.toFixed(1)} ${rig.algo === 'SHA-256' ? 'TH/s' : rig.algo === 'kHeavyHash' ? 'GH/s' : 'MH/s'}**, hottest board **${temp.toFixed(1)}°C**, fans **${intakePwm.toFixed(0)}/${exhaustPwm.toFixed(0)}% PWM**. What do you want to focus on?`,
      ].join('\n');
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Optional real-Gemini path — only used if VITE_GEMINI_API_KEY is set.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const buildSystemContext = (ctx: OperatorContext): string => {
  const lines = [
    `You are RigWatch's mining operations assistant. Reply in plain English, no marketing fluff.`,
    `Limit answers to ~150 words. Use markdown lists for steps. Never invent telemetry — only use the numbers I provide.`,
    ``,
    `Current rig snapshot:`,
    `- Name: ${ctx.rig.name}`,
    `- Model: ${ctx.rig.model} (${ctx.rig.algo}, ${ctx.rig.nominalHashrate} ${ctx.rig.algo === 'SHA-256' ? 'TH/s' : 'GH/s'} nominal)`,
    `- Location: ${ctx.rig.location}`,
    `- Behavior class: ${ctx.rig.behavior}`,
    `- Live hashrate: ${ctx.hashrate.toFixed(1)}`,
    `- Hottest hashboard: ${ctx.temp.toFixed(1)}°C`,
    `- Fans: ${ctx.intakePwm.toFixed(0)}% intake / ${ctx.exhaustPwm.toFixed(0)}% exhaust`,
    `- Power draw: ${(ctx.powerW / 1000).toFixed(2)} kW`,
    `- Pool: ${ctx.rig.poolName}, firmware: ${ctx.rig.firmware}`,
    `- Recent events (latest first):`,
    ...ctx.recentEvents.slice(0, 5).map((e) => `  • [${e.severity}] ${e.title}`),
  ];
  return lines.join('\n');
};

const callGemini = async (ctx: OperatorContext, prompt: string, apiKey: string): Promise<string> => {
  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${buildSystemContext(ctx)}\n\nOperator question:\n${prompt}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 400,
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty Gemini response');
  return text.trim();
};

/**
 * Public entry point. Uses real Gemini if an API key is wired into the
 * environment; otherwise falls back to the synthetic engine. Always
 * resolves — never rejects — so the UI doesn't need error boundaries.
 */
export const askAssistant = async (
  ctx: OperatorContext,
  prompt: string,
): Promise<{ content: string; realModel: boolean }> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (typeof apiKey === 'string' && apiKey.length > 10) {
    try {
      const text = await callGemini(ctx, prompt, apiKey);
      return { content: text, realModel: true };
    } catch (e) {
      console.warn('[AI] Gemini call failed, falling back to synthetic:', e);
    }
  }
  // Simulated thinking delay so the UI has a beat to show "Thinking…"
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 700));
  return { content: synthesizeReply(ctx, prompt), realModel: false };
};
