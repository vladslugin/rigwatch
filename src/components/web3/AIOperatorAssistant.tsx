import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Sparkles, Bot, User, Copy, Check, Loader2 } from 'lucide-react';
import { useRigStore } from '../../store/useRigStore';
import { RIG_BY_ID } from '../../lib/mock/rigData';
import { eventsForRig } from '../../lib/mock/events';
import {
  askAssistant,
  buildGreeting,
  buildSuggestions,
  type AssistantMessage,
  type OperatorContext,
} from '../../lib/ai/operatorAssistant';

/**
 * AI Operator Assistant — a chat-style triage helper. Greets the
 * operator with a status-aware intro, offers a few suggested prompts,
 * and answers free-form questions about the connected rig.
 *
 * Backend is dynamic: if `VITE_GEMINI_API_KEY` is set the responses
 * come from Gemini Flash; otherwise the synthetic expert system in
 * `operatorAssistant.ts` produces realistic responses offline.
 */

/** Lightweight markdown renderer — just enough for **bold**, lists, and
    code spans. Avoids pulling in react-markdown for one component. */
const renderMarkdown = (md: string): React.ReactNode => {
  const lines = md.split('\n');
  return lines.map((line, idx) => {
    if (line.trim() === '') return <div key={idx} className="h-2" />;
    if (line.startsWith('- ')) {
      return (
        <div key={idx} className="flex items-start gap-2 pl-1">
          <span className="text-muted-foreground mt-1.5">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      return (
        <div key={idx} className="flex items-start gap-2 pl-1">
          <span className="text-muted-foreground font-mono text-[11px] mt-0.5 shrink-0">{numMatch[1]}.</span>
          <span>{renderInline(numMatch[2])}</span>
        </div>
      );
    }
    return <div key={idx}>{renderInline(line)}</div>;
  });
};

const renderInline = (text: string): React.ReactNode => {
  // Replace **bold** and `code` spans with React nodes.
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={`b${key++}`} className="text-foreground font-semibold">{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={`c${key++}`} className="px-1 py-0.5 rounded bg-muted text-info font-mono text-[11px]">{token.slice(1, -1)}</code>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export const AIOperatorAssistant: React.FC = () => {
  const deviceId = useRigStore((s) => s.deviceId);
  const currentData = useRigStore((s) => s.currentData);
  const profile = deviceId ? RIG_BY_ID.get(deviceId) : undefined;

  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Build context — re-computed on every telemetry tick so the assistant
  // sees fresh numbers when answering.
  const context = useMemo<OperatorContext | null>(() => {
    if (!profile || !deviceId) return null;
    return {
      rig: profile,
      hashrate: typeof currentData.P === 'number' ? currentData.P : 0,
      temp: typeof currentData.T === 'number' ? currentData.T : 0,
      intakePwm: typeof currentData.PL === 'number' ? currentData.PL : 0,
      exhaustPwm: typeof currentData.SL === 'number' ? currentData.SL : 0,
      powerW: typeof currentData.CO2 === 'number' ? currentData.CO2 : 0,
      rigState: typeof currentData.N === 'number' ? currentData.N : 0,
      recentEvents: eventsForRig(deviceId).slice(0, 8).map((e) => ({
        title: e.title,
        severity: e.severity,
        timestamp: e.timestamp,
      })),
    };
  }, [profile, deviceId, currentData]);

  const suggestions = useMemo(
    () => (context ? buildSuggestions(context) : []),
    [context],
  );

  // Seed greeting when the panel first opens
  useEffect(() => {
    if (expanded && context && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: buildGreeting(context),
        timestamp: Date.now(),
        realModel: false,
      }]);
    }
  }, [expanded, context, messages.length]);

  // Reset chat when switching rigs
  useEffect(() => {
    setMessages([]);
  }, [deviceId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinking]);

  const send = async (prompt: string) => {
    if (!context || !prompt.trim() || thinking) return;
    const userMsg: AssistantMessage = {
      role: 'user',
      content: prompt.trim(),
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setThinking(true);
    try {
      const { content, realModel } = await askAssistant(context, prompt.trim());
      const reply: AssistantMessage = {
        role: 'assistant',
        content,
        timestamp: Date.now(),
        realModel,
      };
      setMessages((m) => [...m, reply]);
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Something went wrong on the assistant side. Try again in a moment.',
        timestamp: Date.now(),
      }]);
    } finally {
      setThinking(false);
    }
  };

  const copyMessage = async (idx: number) => {
    const msg = messages[idx];
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1400);
    } catch {}
  };

  if (!deviceId || !profile) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="group w-full rounded-2xl bg-card/40 border border-border hover:border-primary/40 hover:bg-card transition-all px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="inline-flex h-8 w-8 rounded-md bg-primary/15 items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Operator Assistant</span>
            <span className="pill pill-info" style={{ padding: '2px 6px', fontSize: 9 }}>AI</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Ask anything about this rig — thermal, shares, efficiency, firmware
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-primary/80 group-hover:text-primary transition-colors">
          Open →
        </span>
      </button>
    );
  }

  return (
    <div className="relative rounded-2xl bg-card border border-primary/30 overflow-hidden">
      {/* Subtle violet halo */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(168, 85, 247, 0.14), transparent 60%)',
        }}
      />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 rounded-md bg-primary/20 items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              Operator Assistant
              <span className="pill pill-info" style={{ padding: '1px 6px', fontSize: 9 }}>
                {import.meta.env.VITE_GEMINI_API_KEY ? 'GEMINI' : 'DEMO'}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Context-aware triage · scoped to {profile.name}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="relative z-10 max-h-[420px] overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((msg, idx) => (
          <MessageBubble
            key={`${msg.timestamp}-${idx}`}
            msg={msg}
            copied={copiedIdx === idx}
            onCopy={() => copyMessage(idx)}
          />
        ))}
        {thinking && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Thinking…</span>
          </div>
        )}
        {messages.length === 1 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={thinking}
                className="text-[11px] rounded-full border border-border bg-card/60 hover:bg-card hover:border-primary/40 px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="relative z-10 px-5 py-3 border-t border-border">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about thermals, hashrate, shares…"
            disabled={thinking}
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-card/60 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </form>
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          {import.meta.env.VITE_GEMINI_API_KEY
            ? 'Responses generated by Gemini 2.0 Flash · ~150 word limit'
            : 'Demo mode · responses synthesized locally from rig context. Set VITE_GEMINI_API_KEY to enable real Gemini.'}
        </div>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{
  msg: AssistantMessage;
  copied: boolean;
  onCopy: () => void;
}> = ({ msg, copied, onCopy }) => {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <span
        className={`shrink-0 mt-0.5 h-7 w-7 rounded-md inline-flex items-center justify-center ${
          isUser ? 'bg-muted' : 'bg-primary/15'
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
      </span>
      <div className={`max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div
          className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${
            isUser
              ? 'bg-primary/15 text-foreground text-left inline-block'
              : 'bg-card border border-border text-foreground'
          }`}
        >
          {isUser ? <span>{msg.content}</span> : <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>}
        </div>
        {!isUser && (
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              {copied ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {msg.realModel === true && <span className="text-info">· Gemini</span>}
            {msg.realModel === false && <span>· synthetic</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIOperatorAssistant;
