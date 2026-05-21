import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useTiling } from '../context/TilingContext';
import { useSharedHaseScripts } from '../hooks/useSharedHaseScripts';
import {
  buildHaseOutline,
  explainWarning,
  registerHaseMonaco,
  validateHaseScript,
} from './haseEditorMonaco';

interface HaseMeta {
  name: string;
  author: string;
  created: string;
  version: string;
}

interface HaseEditorProps {
  isOpen: boolean;
  value: string;
  meta: HaseMeta;
  warnings: string[];
  defaultMeta: HaseMeta;
  onChange: (value: string) => void;
  onClose: () => void;
  onApply: () => void;
  onRun: () => void;
  onFileLoaded?: (fileName: string, text: string) => void;
}

const MIN_WIDTH = 520;
const MIN_HEIGHT = 360;
const INDENT_UNIT = '  ';
/** Above this size, syntax highlighting is skipped (huge <span> DOM freezes scroll/editing). */
const HASE_SYNTAX_HIGHLIGHT_MAX_CHARS = 10000;
/** Above this size, fallback to plain escaped overlay (no token colors). */
const HASE_SYNTAX_MEDIUM_MAX_CHARS = 30000;
const HASE_EDITOR_TEXT_METRICS =
  'text-xs leading-5 font-mono whitespace-pre-wrap break-words [tab-size:2] tracking-normal';
const HASE_COMMAND_SNIPPETS: Array<{ command: string; snippet: string; description: string }> = [
  { command: 'connect', snippet: 'connect <device_id>', description: 'Verbinden mit Gerät' },
  { command: 'disconnect', snippet: 'disconnect', description: 'Verbindung trennen' },
  { command: 'set', snippet: 'set <parameter> <value>', description: 'Parameter schreiben' },
  { command: 'get', snippet: 'get <param> [as <var>]', description: 'Parameter lesen' },
  { command: 'read', snippet: 'read <param> <var>', description: 'Parameter in Variable' },
  { command: 'collect', snippet: 'collect from <ids|all> params <params> [where <cond>] [as <var>]', description: 'Mehrere Geräte lesen' },
  { command: 'collect_cache', snippet: 'collect_cache [clear]', description: 'Collect-Cache prüfen/leeren' },
  { command: 'fb_get', snippet: 'fb_get <path> [as <var>]', description: 'Firebase Wert lesen' },
  { command: 'fb_exists', snippet: 'fb_exists <path> [as <var>]', description: 'Pfad vorhanden?' },
  { command: 'fb_keys', snippet: 'fb_keys <path> shallow prefix 72 [as <var>]', description: 'Keys shallow+schnell' },
  { command: 'fb_tree', snippet: 'fb_tree <path> [depth N] [limit N]', description: 'Firebase Baum anzeigen' },
  { command: 'fb_set', snippet: 'fb_set <path> <value> confirm', description: 'Firebase Wert schreiben' },
  { command: 'fb_update', snippet: 'fb_update <path> <json> confirm', description: 'Objekt-Felder updaten' },
  { command: 'fb_remove', snippet: 'fb_remove <path> confirm', description: 'Pfad löschen' },
  { command: 'fb_copy', snippet: 'fb_copy <from> -> <to> [if_missing] confirm', description: 'Wert kopieren' },
  { command: 'substr', snippet: 'substr <value> <start> <length> as <var>', description: 'Teilstring speichern' },
  { command: 'let', snippet: 'let <name> <value>', description: 'Variable setzen' },
  { command: 'if', snippet: 'if <cond> { ... } else { ... }', description: 'Bedingter Block' },
  { command: 'for', snippet: 'for <var> in 1..3 { ... }', description: 'For-Schleife' },
  { command: 'while', snippet: 'while <cond> { ... }', description: 'While-Schleife' },
  { command: 'try', snippet: 'try { ... } catch { ... }', description: 'Fehlerbehandlung' },
  { command: 'wait', snippet: 'wait <duration>', description: 'Warten' },
  { command: 'sleep', snippet: 'sleep <duration>', description: 'Warten' },
  { command: 'wait_param', snippet: 'wait_param <param> [timeout] [interval]', description: 'Warte auf Parameter' },
  { command: 'log', snippet: 'log "message"', description: 'Text ausgeben' },
];
const HASE_DOCS_TEXT = `# Hase Script — Handbuch (Kurzreferenz + Praxisbeispiele)

## Was ist das?
- Mehrzeilige Befehle für das Terminal: Gerät (RealtimeDB temporaer/konstant) und — mit Rolle developer/super_admin — direkte RTDB-Pfade.
- Editor: Befehl "code" oder .hase-Datei laden. "Run" führt das Skript aus; "Apply" übernimmt den Text in die Terminal-Eingabe.
- .hase-Datei: optionaler Kopf (Metadaten), danach der Skriptkörper.

## Kopfzeilen in .hase-Dateien
Empfohlen (im Hase-Modus mit Warnungen):
  #hase
  #version 1
  #name mein_migrationsskript
  #author Max Mustermann
  #created 2026-03-18

Nur #version 1 wird unterstützt. #created im Format YYYY-MM-DD.

## Kommentare im Skriptkörper
Zeilen, die mit # beginnen, werden beim Ausführen ignoriert (nach dem Kopf). Beispiel:
  # Nur Seriennummern 72xxxx anfassen — alte Ofen-Serien
  fb_keys /historienliste shallow prefix 72 as listeKeys

## Syntax — Grundlagen
- Befehle: durch Zeilenumbruch oder ";" getrennt (außerhalb von Blöcken).
- Blöcke: { ... } für if / else, while, for, try / catch, repeat.
- Variablen: $name — nach Interpolation überall im Befehl nutzbar (z. B. Pfade: /pfad/$id/a).
- Index: $liste[0], $pair[1] — funktioniert, wenn die Variable eine JSON-Liste enthält (siehe "let" mit Arrays).
- Gerät (nach connect): @PARAM für aktuelle Live-Werte; Bedingung "connected" / "!connected".

## Verbindung & Gerät
connect <firebase_geraete_id>
status
disconnect
assert_connected

## Parameter schreiben / lesen
set <parameter> <wert>
get <param> [as <var>]
read <param> <var>
let <name> = @<param>
let <name> = get.<param>
wait_param <param> [timeout] [intervall]

## collect (mehrere Geräte / Cache)
collect from [ID1,ID2] params [T,PL]
collect from all params [T,PL]
collect from all params [T,PL] where T > 70 && PL < 50
collect from $ids params [T,PL] as rows
collect params [T,PL] as current
collect_cache
collect_cache clear

## Variablen & Listen
let modus "auto"
let anzahl 3
let ids = [A,B,C]
let first = $ids[0]
Verschachtelte Paare (Migrationstabellen) als JSON:
  let mappings = [["7247902","7690384"],["7249625","7692744"]]
  for pair in $mappings {
    let alt = $pair[0]
    let neu = $pair[1]
    log "Map: $alt -> $neu"
  }
calc (<ausdruck>) [as <var>]   — Mathe, z. B. calc ($x + 1) as y
vars
unset <name>
substr <text|variable> <start> <laenge> as <var>
  Beispiel: substr 1000028300033490000033 0 7 as seriennummer
  substr $did 7 15 as rest

## Bedingungen & Schleifen
if connected { log "online" } else { log "offline" }
if @T > 70 && connected { log "heiß" }
if $x == "a" { log "a" } else if $y { log "b" } else { log "c" }
if !$hasDst { log "fehlt" }
Operatoren: == != > < >= <= && || !

while connected { log "tick"; wait 1s }
for i in 1..10 { log "i=$i" }
for id in [A,B,C] { connect $id; wait 2s; disconnect }
for id in $ids { connect $id; wait 2s; disconnect }
repeat 5 { set rl_position 40; wait 500ms }
break
continue

Grenzen (Engine): repeat max. 50 Wiederholungen; Zählschleife 1..N max. 5000 Durchläufe; bei "repeat"-Entfaltung max. 200 Einzelbefehle insgesamt. Große Migrationen: äußere for-Schleifen nutzen (werden nicht vorentfaltet).

## try / catch
try { set rl_position 80 } catch { log "set fehlgeschlagen" }
try { fb_exists /pfad as ok } catch { log "fb_exists fehl" }

## Warten & Log
sleep 2s
wait 500ms
log "Hinweis: $var"
log_save [dateiname.txt]

## Presets (lokal im Terminal)
preset_save name { set rl_position 78; wait 2s }
preset_run name
preset_list
preset_show name
preset_delete name

## Firebase — nur developer / super_admin
Voraussetzung: Rolle + initialisierte RTDB. Pfade oft mit führendem /.

fb_cd <pfad>     — Arbeitsverzeichnis für relative Pfade
fb_pwd
fb_get <pfad> [as <var>]
fb_exists <pfad> [as <var>]
fb_keys <pfad> [shallow] [prefix <text>] [as <var>]
  shallow = nur Schlüssel (REST, schnell); erfordert eingeloggten Firebase-Auth.
  Ohne shallow = voller get() unter dem Knoten (bei großen Bäumen langsam).
  prefix filtert Schlüssel beginnend mit <text> (z. B. alte Serien 72…).
fb_tree <pfad> [depth N] [limit N]
fb_set <pfad> <wert> confirm
fb_update <pfad> <json-objekt> confirm
fb_remove <pfad> confirm
fb_copy <von> -> <nach> [if_missing] confirm
  if_missing = Ziel nicht überschreiben, wenn schon vorhanden.

Wichtig: Befehle wie user_*, delete_param sowie das Wort "update" als Terminal-Befehl im Skriptkörper lösen Warnungen im Editor aus (Sicherheit).

---

## Praxisbeispiele (Deutsch, realistisch gekürzt)

### 1) FEPA-Liste: Feld "a" für alle konstant_app-Geräte nachziehen
Seriennummer = erste 7 Zeichen der Firebase-ID; Kopie nur wenn Ziel fehlt.

#hase
#version 1
#name fepa_a_nach_konstant_app
#author Beispiel
#created 2026-03-18

fb_keys /konstant_app as ids

for id in $ids {
  try {
    substr $id 0 7 as seriennummer
    fb_copy /controllertausch/fepaliste/$seriennummer/a -> /konstant_app/$id/a if_missing confirm
  } catch {
    log "skip $id (copy fehlgeschlagen)"
  }
}

### 2) Controller-Tausch: komplette FEPAListe-Zweige Alt-Seriennummer → Neu
Pro Zeile in mappings: [alt, neu]. Quelle muss existieren, Ziel wird bei Kollision übersprungen.

#hase
#version 1
#name fepaliste_serienr_alt_nach_neu
#author Beispiel
#created 2026-03-18

let mappings = [
  ["7247902","7690384"],
  ["7249625","7692744"]
]

for pair in $mappings {
  try {
    let serienr_alt = $pair[0]
    let serienr_neu = $pair[1]
    let src = "/controllertausch/fepaliste/$serienr_alt"
    let dst = "/controllertausch/fepaliste/$serienr_neu"
    fb_exists $src as hasSrc
    fb_exists $dst as hasDst
    if !$hasSrc {
      log "skip $serienr_alt -> $serienr_neu (Quelle fehlt)"
    } else if $hasDst {
      log "skip $serienr_alt -> $serienr_neu (Ziel existiert)"
    } else {
      fb_copy $src -> $dst if_missing confirm
      log "kopiert $serienr_alt -> $serienr_neu"
    }
  } catch {
    log "paar fehlgeschlagen: $pair"
  }
}

### 3) Historien / historienliste: Keys mit Präfix filtern, Serienteil umbiegen
Typischer Ablauf: Keys mit shallow + prefix 72 laden (schnell), dann pro Key Präfix (7 Zeichen) mit alt vergleichen, Rest an neue Seriennummer anhängen, mit fb_copy … if_missing confirm kopieren. Innerhalb try/catch pro Gerät, damit ein Fehler nicht das ganze Skript stoppt.

#hase
#version 1
#name historien_serienr_mig_kurz
#author Beispiel
#created 2026-03-18

# Empfehlung: shallow + prefix bei großen Listen
fb_keys /historienliste shallow prefix 72 as listeKeys
fb_keys /historien shallow prefix 72 as historienKeys

let mappings = [["7247902","7690384"]]

for pair in $mappings {
  try {
    let alt = $pair[0]
    let neu = $pair[1]
    for did in $listeKeys {
      substr $did 0 7 as pre
      if $pre != $alt { continue }
      substr $did 7 15 as tail
      try {
        fb_exists /historienliste/$did as hasL
        if $hasL {
          fb_copy /historienliste/$did -> /historienliste/$neu$tail if_missing confirm
          log "historienliste: $did -> $neu$tail"
        }
      } catch { log "fehler historienliste $did" }
    }
    for did2 in $historienKeys {
      substr $did2 0 7 as pre2
      if $pre2 != $alt { continue }
      substr $did2 7 15 as tail2
      try {
        fb_exists /historien/$did2 as hasH2
        if $hasH2 {
          fb_copy /historien/$did2 -> /historien/$neu$tail2 if_missing confirm
        }
      } catch { log "fehler historien $did2" }
    }
  } catch {
    log "paar übersprungen: $pair"
  }
}

---

## UI & Bibliothek
- Sidebar "Local": Skripte in localStorage (nur dieser Browser).
- Sidebar "Team": gemeinsame Skripte in Firestore (Collection hase_shared_scripts), sichtbar für eingeloggte Nutzer — Firestore-Regeln im Projekt setzen.

## Kurztipps
- Strings in "doppelten" oder 'einfachen' Anführungszeichen.
- Pfade und IDs: nach let mit $variable in fb_* zusammensetzen.
- Vor großen Migrationen: mit fb_tree / fb_keys (shallow) erst prüfen, ob Pfade stimmen.
- Skript im Editor kann mit Team-Bibliothek geteilt werden (gleiche .hase-Logik).`;

const HaseEditor: React.FC<HaseEditorProps> = ({
  isOpen,
  value,
  meta,
  warnings,
  defaultMeta,
  onChange,
  onClose,
  onApply,
  onRun,
  onFileLoaded,
}) => {
  const STORAGE_KEY = 'hase_script_library_v1';
  type LibraryRow = { id: string; name: string; content: string; updatedAt: number; updatedByName?: string };
  const [libraryScripts, setLibraryScripts] = useState<LibraryRow[]>([]);
  const [scriptSource, setScriptSource] = useState<'local' | 'team'>('local');
  const [teamSavePending, setTeamSavePending] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [showDocs, setShowDocs] = useState(false);
  const hasLoadedLibraryRef = useRef(false);
  const monacoEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoApiRef = useRef<typeof Monaco | null>(null);
  const handleLibrarySaveRef = useRef<(targetSource?: 'local' | 'team') => Promise<void>>(async () => {});
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editorHighlightRef = useRef<HTMLPreElement>(null);
  const highlightCacheRef = useRef<{ lines: string[]; highlightedLines: string[] }>({
    lines: [],
    highlightedLines: [],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeStateRef = useRef<{
    resizing: boolean;
    edge: { n: boolean; s: boolean; e: boolean; w: boolean };
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>({
    resizing: false,
    edge: { n: false, s: false, e: false, w: false },
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
    startWidth: 900,
    startHeight: 560,
  });

  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 900, height: 560 });
  const [isDragging, setIsDragging] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [highlightBottomPadPx, setHighlightBottomPadPx] = useState(0);
  const [commandHints, setCommandHints] = useState<Array<{ command: string; snippet: string; description: string }>>([]);
  const [selectedHintIndex, setSelectedHintIndex] = useState(0);
  const [renderedHighlightHtml, setRenderedHighlightHtml] = useState(' ');
  const [useSoftWrap, setUseSoftWrap] = useState(true);
  const [monacoFailed, setMonacoFailed] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [warningExplanation, setWarningExplanation] = useState<string | null>(null);
  const tiling = useTiling();

  const {
    scripts: teamScripts,
    loading: teamScriptsLoading,
    error: teamScriptsError,
    canUse: teamScriptsCanUse,
    saveScript: saveTeamScript,
    deleteScript: deleteTeamScript,
  } = useSharedHaseScripts(isOpen && scriptSource === 'team');

  const displayedScripts: LibraryRow[] = useMemo(
    () => (scriptSource === 'local' ? libraryScripts : teamScripts),
    [scriptSource, libraryScripts, teamScripts],
  );

  const formatScript = useCallback((raw: string) => {
    const lines: string[] = [];
    let depth = 0;
    let buffer = '';

    const pushLine = (line: string, depthOverride?: number) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const indentDepth = depthOverride !== undefined ? depthOverride : depth;
      lines.push(`${INDENT_UNIT.repeat(Math.max(0, indentDepth))}${trimmed}`);
    };

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '\r') continue;
      if (ch === '{') {
        const chunk = buffer.trim();
        if (chunk) {
          lines.push(`${INDENT_UNIT.repeat(depth)}${chunk} {`);
        } else {
          lines.push(`${INDENT_UNIT.repeat(depth)}{`);
        }
        depth += 1;
        buffer = '';
        continue;
      }
      if (ch === '}') {
        const chunk = buffer.trim();
        if (chunk) pushLine(chunk);
        depth = Math.max(0, depth - 1);
        lines.push(`${INDENT_UNIT.repeat(depth)}}`);
        buffer = '';
        continue;
      }
      if (ch === ';' || ch === '\n') {
        const chunk = buffer.trim();
        if (chunk) pushLine(chunk);
        buffer = '';
        continue;
      }
      buffer += ch;
    }
    if (buffer.trim()) pushLine(buffer);

    return lines.join('\n');
  }, []);

  const escapeHtml = useCallback((text: string) => (
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  ), []);

  const highlightScript = useCallback((raw: string, braceMatch?: { open: number; close: number } | null, baseOffset = 0) => {
    const escapeHtml = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const keywordSet = new Set([
      'repeat', 'if', 'else', 'while', 'for', 'in', 'break', 'continue', 'let', 'unset', 'vars',
      'connect', 'disconnect', 'wait', 'sleep', 'get', 'read', 'collect', 'collect_cache', 'from', 'params', 'where', 'as', 'clear',
      'fb_get', 'fb_exists', 'fb_keys', 'fb_tree', 'fb_set', 'fb_update', 'fb_remove', 'fb_copy', 'depth', 'limit', 'confirm', 'if_missing', 'substr',
      'preset_save', 'preset_run', 'preset_list', 'preset_show', 'preset_delete',
      'log', 'assert_connected', 'script_status', 'try', 'catch',
    ]);
    const boolSet = new Set(['true', 'false', 'null']);
    const varRegex = /[$@][a-zA-Z_]\w*(?:\[\d+\])?/y;
    const wordRegex = /[a-zA-Z_]\w*/y;
    const numberRegex = /\d+(?:\.\d+)?(?:ms|s)?/y;

    const emitBrace = (token: string, index: number) => {
      const absoluteIndex = baseOffset + index;
      const isMatch = Boolean(braceMatch && (absoluteIndex === braceMatch.open || absoluteIndex === braceMatch.close));
      const className = isMatch
        ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/40 rounded-sm'
        : 'text-orange-300';
      return `<span class="${className}">${escapeHtml(token)}</span>`;
    };

    let result = '';
    let i = 0;
    let inString: '"' | '\'' | null = null;
    let escaped = false;

    while (i < raw.length) {
      const ch = raw[i];

      if (inString) {
        const start = i;
        while (i < raw.length) {
          const curr = raw[i];
          if (escaped) {
            escaped = false;
            i += 1;
            continue;
          }
          if (curr === '\\') {
            escaped = true;
            i += 1;
            continue;
          }
          i += 1;
          if (curr === inString) {
            inString = null;
            break;
          }
        }
        const chunk = raw.slice(start, i);
        result += `<span class="text-emerald-300">${escapeHtml(chunk)}</span>`;
        continue;
      }

      if (ch === '"' || ch === '\'') {
        inString = ch;
        escaped = false;
        continue;
      }

      varRegex.lastIndex = i;
      const varMatch = varRegex.exec(raw);
      if (varMatch) {
        const token = varMatch[0];
        const className = token.startsWith('@') ? 'text-amber-300' : 'text-cyan-300';
        result += `<span class="${className}">${escapeHtml(token)}</span>`;
        i += token.length;
        continue;
      }

      numberRegex.lastIndex = i;
      const numberMatch = numberRegex.exec(raw);
      if (numberMatch) {
        const token = numberMatch[0];
        result += `<span class="text-green-300">${escapeHtml(token)}</span>`;
        i += token.length;
        continue;
      }

      wordRegex.lastIndex = i;
      const wordMatch = wordRegex.exec(raw);
      if (wordMatch) {
        const token = wordMatch[0];
        const lower = token.toLowerCase();
        if (keywordSet.has(lower)) {
          result += `<span class="text-yellow-300">${escapeHtml(token)}</span>`;
        } else if (boolSet.has(lower)) {
          result += `<span class="text-purple-300">${escapeHtml(token)}</span>`;
        } else {
          result += escapeHtml(token);
        }
        i += token.length;
        continue;
      }

      if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
        result += emitBrace(ch, i);
        i += 1;
        continue;
      }
      if (ch === ';') {
        result += `<span class="text-orange-300">${escapeHtml(ch)}</span>`;
        i += 1;
        continue;
      }

      result += escapeHtml(ch);
      i += 1;
    }

    return result;
  }, []);

  const syncEditorScroll = useCallback(() => {
    const textarea = editorTextareaRef.current;
    const highlight = editorHighlightRef.current;
    if (!textarea || !highlight) return;
    const top = Math.round(textarea.scrollTop);
    const left = Math.round(textarea.scrollLeft);
    if (highlight.scrollTop !== top) highlight.scrollTop = top;
    if (highlight.scrollLeft !== left) highlight.scrollLeft = left;

    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    const heightDelta = textarea.scrollHeight - highlight.scrollHeight;
    const safePad = Math.max(0, Math.min(Math.round(heightDelta), Math.round(lineHeight * 2)));
    setHighlightBottomPadPx(prev => (prev === safePad ? prev : safePad));
  }, []);

  const findMatchingBrace = useCallback((raw: string, cursor: number) => {
    if (!raw) return null;
    const currentChar = raw[cursor];
    const prevChar = cursor > 0 ? raw[cursor - 1] : '';
    const isDelimiter = (ch: string) => ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']';
    const braceIndex = isDelimiter(currentChar)
      ? cursor
      : (isDelimiter(prevChar) ? cursor - 1 : -1);
    if (braceIndex === -1) return null;

    const brace = raw[braceIndex];
    const openToClose: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
    const closeToOpen: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
    let inString: '"' | '\'' | null = null;
    let escaped = false;

    const advanceString = (ch: string) => {
      if (inString) {
        if (escaped) {
          escaped = false;
          return;
        }
        if (ch === '\\') {
          escaped = true;
          return;
        }
        if (ch === inString) {
          inString = null;
        }
        return;
      }
      if (ch === '"' || ch === '\'') {
        inString = ch;
      }
    };

    if (openToClose[brace]) {
      const stack: Array<{ ch: string; index: number }> = [{ ch: brace, index: braceIndex }];
      for (let i = braceIndex + 1; i < raw.length; i += 1) {
        const ch = raw[i];
        advanceString(ch);
        if (inString) continue;
        if (openToClose[ch]) {
          stack.push({ ch, index: i });
          continue;
        }
        if (closeToOpen[ch]) {
          const last = stack[stack.length - 1];
          if (last && openToClose[last.ch] === ch) {
            stack.pop();
            if (stack.length === 0) {
              return { open: braceIndex, close: i };
            }
          }
        }
      }
      return null;
    }

    const stack: Array<{ ch: string; index: number }> = [];
    inString = null;
    escaped = false;
    for (let i = 0; i <= braceIndex; i += 1) {
      const ch = raw[i];
      advanceString(ch);
      if (inString) continue;
      if (openToClose[ch]) {
        stack.push({ ch, index: i });
        continue;
      }
      if (closeToOpen[ch]) {
        const last = stack.pop();
        if (i === braceIndex) {
          if (!last || openToClose[last.ch] !== ch) return null;
          return { open: last.index, close: i };
        }
      }
    }
    return null;
  }, []);

  const applyTextChange = useCallback((nextValue: string, selectionStart: number, selectionEnd = selectionStart) => {
    onChange(nextValue);
    requestAnimationFrame(() => {
      const el = editorTextareaRef.current;
      if (!el) return;
      el.selectionStart = selectionStart;
      el.selectionEnd = selectionEnd;
      setCursorIndex(selectionStart);
      syncEditorScroll();
    });
  }, [onChange, syncEditorScroll]);

  const applyIndentation = useCallback((raw: string, start: number, end: number, direction: 'indent' | 'outdent') => {
    const startLineStart = raw.lastIndexOf('\n', start - 1) + 1;
    const endLineStart = raw.lastIndexOf('\n', Math.max(end - 1, 0)) + 1;
    const endLineEnd = raw.indexOf('\n', endLineStart);
    const blockEnd = endLineEnd === -1 ? raw.length : endLineEnd;
    const block = raw.slice(startLineStart, blockEnd);
    const lines = block.split('\n');

    let totalDelta = 0;
    let firstDelta = 0;

    const updatedLines = lines.map((line, idx) => {
      if (direction === 'indent') {
        const nextLine = `${INDENT_UNIT}${line}`;
        totalDelta += INDENT_UNIT.length;
        if (idx === 0) firstDelta = INDENT_UNIT.length;
        return nextLine;
      }
      let remove = 0;
      if (line.startsWith(INDENT_UNIT)) {
        remove = INDENT_UNIT.length;
      } else if (line.startsWith('\t')) {
        remove = 1;
      } else if (line.startsWith(' ')) {
        remove = 1;
      }
      totalDelta += remove;
      if (idx === 0) firstDelta = remove;
      return line.slice(remove);
    });

    const nextValue = raw.slice(0, startLineStart) + updatedLines.join('\n') + raw.slice(blockEnd);
    if (direction === 'indent') {
      return {
        nextValue,
        nextStart: start + firstDelta,
        nextEnd: end + totalDelta,
      };
    }
    return {
      nextValue,
      nextStart: Math.max(start - firstDelta, startLineStart),
      nextEnd: Math.max(end - totalDelta, startLineStart),
    };
  }, []);

  const handleEditorChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCursorIndex(e.target.selectionStart ?? 0);
  }, [onChange]);

  const handleEditorSelection = useCallback(() => {
    const el = editorTextareaRef.current;
    if (!el) return;
    setCursorIndex(el.selectionStart ?? 0);
  }, []);

  const applyCommandHint = useCallback((hint: { command: string; snippet: string }) => {
    const el = editorTextareaRef.current;
    const currentValue = value;
    if (!el) {
      const nextValue = `${currentValue}${currentValue.endsWith('\n') || !currentValue ? '' : '\n'}${hint.snippet}`;
      onChange(nextValue);
      setCommandHints([]);
      setSelectedHintIndex(0);
      return;
    }
    const start = el.selectionStart ?? 0;
    const lineStart = currentValue.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndRaw = currentValue.indexOf('\n', start);
    const lineEnd = lineEndRaw === -1 ? currentValue.length : lineEndRaw;
    const line = currentValue.slice(lineStart, lineEnd);
    const leading = line.match(/^\s*/)?.[0] ?? '';
    const trimmedLine = line.trim();
    const shouldReplaceLine = trimmedLine.length > 0 && trimmedLine.length <= 40;
    const replacement = `${leading}${hint.snippet}`;
    let nextValue = currentValue;
    let nextCursor = lineStart + replacement.length;
    if (shouldReplaceLine) {
      nextValue = currentValue.slice(0, lineStart) + replacement + currentValue.slice(lineEnd);
    } else {
      const insertText = `${currentValue.endsWith('\n') || currentValue.length === 0 ? '' : '\n'}${replacement}`;
      nextValue = currentValue.slice(0, start) + insertText + currentValue.slice(start);
      nextCursor = start + insertText.length;
    }
    applyTextChange(nextValue, nextCursor, nextCursor);
    setCommandHints([]);
    setSelectedHintIndex(0);
  }, [applyTextChange, onChange, value]);

  const formatWithSelection = useCallback((raw: string, start: number, end: number) => {
    const formatted = formatScript(raw);
    const formattedStart = formatScript(raw.slice(0, start)).length;
    const formattedEnd = formatScript(raw.slice(0, end)).length;
    return { formatted, formattedStart, formattedEnd };
  }, [formatScript]);

  const handleFormatClick = useCallback(() => {
    const el = editorTextareaRef.current;
    if (!el) {
      onChange(formatScript(value));
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const { formatted, formattedStart, formattedEnd } = formatWithSelection(value, start, end);
    applyTextChange(formatted, formattedStart, formattedEnd);
  }, [applyTextChange, formatWithSelection, formatScript, onChange, value]);

  const outlineItems = useMemo(() => buildHaseOutline(value), [value]);
  const validationIssues = useMemo(() => validateHaseScript(value), [value]);

  const handleMonacoMount: OnMount = useCallback((editor, monaco) => {
    monacoEditorRef.current = editor;
    monacoApiRef.current = monaco as typeof Monaco;
    try {
      registerHaseMonaco(monaco as typeof Monaco);
      monaco.editor.setTheme('hase-terminal');
      setMonacoFailed(false);
    } catch (error) {
      console.error('[HaseEditor] Monaco init failed:', error);
      setMonacoFailed(true);
      return;
    }

    editor.addAction({
      id: 'hase-format',
      label: 'Format Hase Script',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: () => {
        const current = editor.getValue();
        const formatted = formatScript(current);
        editor.setValue(formatted);
        onChange(formatted);
      },
    });

    editor.addAction({
      id: 'hase-open-find',
      label: 'Find',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
      run: () => editor.getAction('actions.find')?.run(),
    });

    editor.addAction({
      id: 'hase-open-replace',
      label: 'Replace',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
      run: () => editor.getAction('editor.action.startFindReplaceAction')?.run(),
    });

    editor.addCommand(monaco.KeyCode.Escape, () => {
      onClose();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      onApply();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleLibrarySaveRef.current('local');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
      void handleLibrarySaveRef.current('team');
    });

    monaco.languages.registerCodeActionProvider('hase', {
      provideCodeActions: (model: Monaco.editor.ITextModel, range: Monaco.Range) => {
        const issues = validateHaseScript(model.getValue());
        const actions = issues
          .filter(issue => issue.fix)
          .filter(issue => issue.line >= range.startLineNumber && issue.line <= range.endLineNumber)
          .map(issue => ({
            title: issue.fix!.title,
            kind: 'quickfix',
            edit: {
              edits: [{
                resource: model.uri,
                textEdit: { range: issue.fix!.range, text: issue.fix!.replacement },
              }],
            },
            diagnostics: [],
            isPreferred: true,
          }));
        return { actions, dispose: () => {} };
      },
    });
  }, [formatScript, onApply, onChange, onClose, onRun]);

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = editorTextareaRef.current;
    if (!el) return;

    if (commandHints.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedHintIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedHintIndex(prev => Math.min(commandHints.length - 1, prev + 1));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applyCommandHint(commandHints[selectedHintIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandHints([]);
        setSelectedHintIndex(0);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const { formatted, formattedStart, formattedEnd } = formatWithSelection(value, start, end);
      applyTextChange(formatted, formattedStart, formattedEnd);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      if (start === end) {
        if (e.shiftKey) {
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          const line = value.slice(lineStart);
          let remove = 0;
          if (line.startsWith(INDENT_UNIT)) {
            remove = INDENT_UNIT.length;
          } else if (line.startsWith('\t')) {
            remove = 1;
          } else if (line.startsWith(' ')) {
            remove = 1;
          }
          if (remove > 0) {
            const nextValue = value.slice(0, lineStart) + value.slice(lineStart + remove);
            applyTextChange(nextValue, Math.max(start - remove, lineStart));
          }
        } else {
          const nextValue = value.slice(0, start) + INDENT_UNIT + value.slice(end);
          applyTextChange(nextValue, start + INDENT_UNIT.length);
        }
        return;
      }

      const direction = e.shiftKey ? 'outdent' : 'indent';
      const { nextValue, nextStart, nextEnd } = applyIndentation(value, start, end, direction);
      applyTextChange(nextValue, nextStart, nextEnd);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const linePrefix = value.slice(lineStart, start);
      const baseIndent = linePrefix.match(/^\s*/)?.[0] ?? '';
      const prevChar = value[start - 1];
      const nextChar = value[start];
      if (prevChar === '{' && nextChar === '}') {
        const insertion = `\n${baseIndent}${INDENT_UNIT}\n${baseIndent}`;
        const nextValue = before + insertion + after;
        const nextCursor = start + 1 + baseIndent.length + INDENT_UNIT.length;
        applyTextChange(nextValue, nextCursor);
        return;
      }
      const nextValue = before + `\n${baseIndent}` + after;
      const nextCursor = start + 1 + baseIndent.length;
      applyTextChange(nextValue, nextCursor);
      return;
    }

    const pairs: Record<string, string> = {
      '{': '}',
      '(': ')',
      '[': ']',
      '"': '"',
      '\'': '\'',
    };

    if (pairs[e.key]) {
      e.preventDefault();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const nextChar = value[end];
      if (start === end && (e.key === '"' || e.key === '\'') && nextChar === e.key) {
        applyTextChange(value, start + 1, start + 1);
        return;
      }
      const before = value.slice(0, start);
      const middle = value.slice(start, end);
      const after = value.slice(end);
      const open = e.key;
      const close = pairs[e.key];
      const nextValue = before + open + middle + close + after;
      applyTextChange(nextValue, start + 1, end + 1);
      return;
    }

    if (e.key === '}' || e.key === ')' || e.key === ']') {
      const start = el.selectionStart ?? 0;
      const nextChar = value[start];
      if (nextChar === e.key) {
        e.preventDefault();
        applyTextChange(value, start + 1, start + 1);
      }
    }
  }, [applyCommandHint, applyIndentation, applyTextChange, commandHints, formatWithSelection, onClose, selectedHintIndex, value]);

  useEffect(() => {
    if (!isOpen) return;
    const el = editorTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? cursorIndex;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const linePrefix = value.slice(lineStart, start);
    const trimmed = linePrefix.trim();
    if (!trimmed || /\s/.test(trimmed)) {
      setCommandHints([]);
      setSelectedHintIndex(0);
      return;
    }
    const lower = trimmed.toLowerCase();
    const matched = HASE_COMMAND_SNIPPETS
      .filter(item => item.command.startsWith(lower))
      .slice(0, 6);
    setCommandHints(matched);
    setSelectedHintIndex(prev => Math.min(prev, Math.max(0, matched.length - 1)));
  }, [cursorIndex, isOpen, value]);

  const buildHaseFile = useCallback(() => {
    const lines = value.replace(/\r/g, '').split('\n');
    const firstNonEmpty = lines.map(line => line.trim()).find(line => line.length > 0) || '';
    if (firstNonEmpty.toLowerCase().startsWith('#hase')) {
      return value;
    }
    const today = new Date().toISOString().slice(0, 10);
    const header = [
      '#hase',
      `#version ${meta.version || '1'}`,
      `#name ${meta.name || 'Untitled'}`,
      `#author ${meta.author || 'unknown'}`,
      `#created ${meta.created || today}`,
      '',
    ].join('\n');
    return `${header}${value}`;
  }, [meta.author, meta.created, meta.name, meta.version, value]);

  const updateHeaderValue = useCallback((content: string, key: string, nextValue: string) => {
    const lines = content.replace(/\r/g, '').split('\n');
    const headerKey = `#${key}`;
    let replaced = false;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith('#')) break;
      if (trimmed.toLowerCase().startsWith(headerKey)) {
        lines[i] = `${headerKey} ${nextValue}`;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      return content;
    }
    return lines.join('\n');
  }, []);

  const createTemplate = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [
      '#hase',
      `#version ${defaultMeta.version || '1'}`,
      `#name ${defaultMeta.name || 'Untitled'}`,
      `#author ${defaultMeta.author || 'unknown'}`,
      `#created ${defaultMeta.created || today}`,
      '',
    ].join('\n');
  }, [defaultMeta.author, defaultMeta.created, defaultMeta.name, defaultMeta.version]);

  const loadLibrary = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setLibraryScripts([]);
        hasLoadedLibraryRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Array<{ id: string; name: string; content: string; updatedAt: number }>;
      if (Array.isArray(parsed)) {
        setLibraryScripts(parsed);
      }
      hasLoadedLibraryRef.current = true;
    } catch {
      setLibraryScripts([]);
      hasLoadedLibraryRef.current = true;
    }
  }, [STORAGE_KEY]);

  useEffect(() => {
    if (!isOpen) return;
    loadLibrary();
  }, [isOpen, loadLibrary]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasLoadedLibraryRef.current) return;
    if (scriptSource !== 'local') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(libraryScripts));
    } catch {}
  }, [libraryScripts, STORAGE_KEY, scriptSource]);

  const handleLibrarySave = useCallback(async (targetSource?: 'local' | 'team') => {
    const name = meta.name || defaultMeta.name || 'Untitled';
    const content = value;
    const now = Date.now();
    const resolvedSource = targetSource ?? scriptSource;

    if (resolvedSource === 'team') {
      if (!teamScriptsCanUse) {
        window.alert('Team library: please sign in with Firebase and ensure Firestore is configured.');
        setToast({ type: 'error', text: 'Team save failed: sign in required' });
        return;
      }
      setTeamSavePending(true);
      try {
        const id = await saveTeamScript(selectedScriptId, name, content);
        setSelectedScriptId(id);
        setToast({ type: 'success', text: 'Saved to Team' });
      } catch (e) {
        console.error('[HaseEditor] Team save failed:', e);
        window.alert(e instanceof Error ? e.message : 'Team save failed (check Firestore rules / network).');
        setToast({ type: 'error', text: 'Team save failed' });
      } finally {
        setTeamSavePending(false);
      }
      return;
    }

    if (selectedScriptId && scriptSource === 'local') {
      setLibraryScripts(prev => prev.map(script => (
        script.id === selectedScriptId
          ? { ...script, name, content, updatedAt: now }
          : script
      )));
      setToast({ type: 'success', text: 'Saved to Local' });
      return;
    }
    const id = `script_${now}_${Math.random().toString(36).slice(2, 8)}`;
    setLibraryScripts(prev => [{ id, name, content, updatedAt: now }, ...prev]);
    if (resolvedSource === 'local') {
      setSelectedScriptId(id);
      setToast({ type: 'success', text: 'Saved to Local' });
    }
  }, [defaultMeta.name, meta.name, scriptSource, selectedScriptId, saveTeamScript, teamScriptsCanUse, value]);

  useEffect(() => {
    handleLibrarySaveRef.current = handleLibrarySave;
  }, [handleLibrarySave]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const editor = monacoEditorRef.current;
    if (!editor) return;
    const monaco = monacoApiRef.current;
    if (!monaco) return;
    const model = editor.getModel();
    if (!model) return;

    monaco.editor.setModelMarkers(model, 'hase-validator', validationIssues.map(issue => ({
      startLineNumber: issue.line,
      startColumn: issue.column,
      endLineNumber: issue.line,
      endColumn: issue.endColumn ?? issue.column + 1,
      message: issue.message,
      severity: issue.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
    })));
  }, [validationIssues]);

  const handleLibraryLoad = useCallback((scriptId: string) => {
    const script = displayedScripts.find(item => item.id === scriptId);
    if (!script) return;
    setSelectedScriptId(scriptId);
    onChange(script.content);
  }, [displayedScripts, onChange]);

  const handleLibraryDelete = useCallback(async () => {
    if (!selectedScriptId) return;
    const target = displayedScripts.find(item => item.id === selectedScriptId);
    if (target && !window.confirm(`Delete script "${target.name}"?`)) return;

    if (scriptSource === 'team') {
      try {
        await deleteTeamScript(selectedScriptId);
        setSelectedScriptId(null);
      } catch (e) {
        console.error('[HaseEditor] Team delete failed:', e);
        window.alert(e instanceof Error ? e.message : 'Delete failed');
      }
      return;
    }

    setLibraryScripts(prev => prev.filter(item => item.id !== selectedScriptId));
    setSelectedScriptId(null);
  }, [deleteTeamScript, displayedScripts, scriptSource, selectedScriptId]);

  const startRename = useCallback(() => {
    const target = displayedScripts.find(item => item.id === selectedScriptId);
    if (!target) return;
    setRenameValue(target.name);
    setIsRenaming(true);
  }, [displayedScripts, selectedScriptId]);

  const confirmRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!nextName || !selectedScriptId) {
      setIsRenaming(false);
      return;
    }
    const updatedContent = updateHeaderValue(value, 'name', nextName);

    if (scriptSource === 'team') {
      if (!teamScriptsCanUse) {
        setIsRenaming(false);
        return;
      }
      setTeamSavePending(true);
      try {
        await saveTeamScript(selectedScriptId, nextName, updatedContent);
        onChange(updatedContent);
      } catch (e) {
        console.error('[HaseEditor] Team rename failed:', e);
        window.alert(e instanceof Error ? e.message : 'Rename failed');
      } finally {
        setTeamSavePending(false);
        setIsRenaming(false);
      }
      return;
    }

    setLibraryScripts(prev => prev.map(script => (
      script.id === selectedScriptId
        ? { ...script, name: nextName, content: updateHeaderValue(script.content, 'name', nextName) }
        : script
    )));
    onChange(updatedContent);
    setIsRenaming(false);
  }, [onChange, renameValue, saveTeamScript, scriptSource, selectedScriptId, teamScriptsCanUse, updateHeaderValue, value]);

  const handleLibraryNew = useCallback(() => {
    setSelectedScriptId(null);
    onChange(createTemplate());
  }, [createTemplate, onChange]);

  const handleSave = useCallback(() => {
    const content = buildHaseFile();
    const rawName = meta.name || 'hase-script';
    const safeName = rawName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'hase-script';
    const fileName = `${safeName}.hase`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [buildHaseFile, meta.name]);

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      onFileLoaded?.(file.name, text);
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [onFileLoaded]);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!modalRef.current) return;
    e.preventDefault();
    const rect = modalRef.current.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!modalRef.current) return;
      const rect = modalRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      const maxX = Math.max(0, viewportWidth - rect.width);
      const maxY = Math.max(0, viewportHeight - rect.height);
      setPosition({ x: Math.min(Math.max(0, newX), maxX), y: Math.min(Math.max(0, newY), maxY) });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    tiling.registerWindow('code');
    return () => tiling.unregisterWindow('code');
  }, [tiling.registerWindow, tiling.unregisterWindow]);

  useEffect(() => {
    if (isOpen) {
      tiling.openWindow('code');
    } else {
      tiling.closeWindow('code');
    }
  }, [isOpen, tiling.openWindow, tiling.closeWindow]);

  const beginResize = useCallback((edge: { n: boolean; s: boolean; e: boolean; w: boolean }) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStateRef.current = {
      resizing: true,
      edge,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: position.x,
      startY: position.y,
      startWidth: size.width,
      startHeight: size.height,
    };
    document.body.style.userSelect = 'none';
  }, [position.x, position.y, size.width, size.height]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = resizeStateRef.current;
      if (!st.resizing) return;
      const dx = e.clientX - st.startMouseX;
      const dy = e.clientY - st.startMouseY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let newX = st.startX;
      let newY = st.startY;
      let newWidth = st.startWidth;
      let newHeight = st.startHeight;

      if (st.edge.e) {
        newWidth = Math.max(MIN_WIDTH, Math.min(viewportWidth - newX - 8, st.startWidth + dx));
      }
      if (st.edge.s) {
        newHeight = Math.max(MIN_HEIGHT, Math.min(viewportHeight - newY - 8, st.startHeight + dy));
      }
      if (st.edge.w) {
        const maxLeft = st.startX + st.startWidth - MIN_WIDTH;
        newX = Math.max(0, Math.min(maxLeft, st.startX + dx));
        newWidth = Math.max(MIN_WIDTH, st.startWidth - (newX - st.startX));
      }
      if (st.edge.n) {
        const maxTop = st.startY + st.startHeight - MIN_HEIGHT;
        newY = Math.max(0, Math.min(maxTop, st.startY + dy));
        newHeight = Math.max(MIN_HEIGHT, st.startHeight - (newY - st.startY));
      }

      setPosition({ x: Math.round(newX), y: Math.round(newY) });
      setSize({ width: Math.round(newWidth), height: Math.round(newHeight) });
    };

    const onUp = () => {
      if (resizeStateRef.current.resizing) {
        resizeStateRef.current.resizing = false;
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (tiling.tilingEnabled) {
      const tile = tiling.getTilePosition('code');
      setPosition({ x: tile.x, y: tile.y });
      setSize({ width: tile.width, height: tile.height });
    } else {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const initialWidth = Math.min(900, Math.max(520, viewportWidth - 32));
      const initialHeight = Math.min(600, Math.max(360, Math.floor(viewportHeight * 0.8)));
      const initialX = Math.max(8, Math.round((viewportWidth - initialWidth) / 2));
      const initialY = Math.max(16, Math.round((viewportHeight - initialHeight) / 2));
      setSize({ width: initialWidth, height: initialHeight });
      setPosition({ x: initialX, y: initialY });
    }
    setTimeout(() => {
      if (monacoEditorRef.current) {
        monacoEditorRef.current.focus();
        return;
      }
      editorTextareaRef.current?.focus();
    }, 0);
  }, [isOpen, tiling.getTilePosition, tiling.openWindows, tiling.tilingEnabled]);

  const syntaxHighlightMode = useMemo<'full' | 'medium' | 'off'>(() => {
    if (value.length <= HASE_SYNTAX_HIGHLIGHT_MAX_CHARS) return 'full';
    if (value.length <= HASE_SYNTAX_MEDIUM_MAX_CHARS) return 'medium';
    return 'off';
  }, [value.length]);
  const syntaxHighlightEnabled = syntaxHighlightMode !== 'off';
  const braceMatch = useMemo(
    () => (syntaxHighlightMode === 'full' ? findMatchingBrace(value, cursorIndex) : null),
    [syntaxHighlightMode, findMatchingBrace, value, cursorIndex],
  );
  const getLineIndexAtOffset = useCallback((text: string, offset: number) => {
    if (offset <= 0) return 0;
    const bounded = Math.min(offset, text.length);
    let line = 0;
    for (let i = 0; i < bounded; i += 1) {
      if (text[i] === '\n') line += 1;
    }
    return line;
  }, []);

  useEffect(() => {
    if (!syntaxHighlightEnabled) {
      highlightCacheRef.current = { lines: [], highlightedLines: [] };
      setRenderedHighlightHtml(' ');
      return;
    }

    let rafId: number | null = null;
    // Keep input responsive by deferring DOM-heavy highlight update.
    const timer = window.setTimeout(() => {
      const run = () => {
        if (syntaxHighlightMode === 'medium') {
          const html = value ? escapeHtml(value) : ' ';
          setRenderedHighlightHtml(value.endsWith('\n') ? `${html}\n ` : html);
          highlightCacheRef.current = { lines: [], highlightedLines: [] };
          return;
        }

        const nextLines = value.split('\n');
        const prev = highlightCacheRef.current;
        const prevLines = prev.lines;
        const prevHighlighted = prev.highlightedLines;

        const nextOffsets: number[] = new Array(nextLines.length);
        let accOffset = 0;
        for (let i = 0; i < nextLines.length; i += 1) {
          nextOffsets[i] = accOffset;
          accOffset += nextLines[i].length + 1;
        }

        let firstDiff = 0;
        while (
          firstDiff < prevLines.length
          && firstDiff < nextLines.length
          && prevLines[firstDiff] === nextLines[firstDiff]
        ) {
          firstDiff += 1;
        }

        let prevTail = prevLines.length - 1;
        let nextTail = nextLines.length - 1;
        while (
          prevTail >= firstDiff
          && nextTail >= firstDiff
          && prevLines[prevTail] === nextLines[nextTail]
        ) {
          prevTail -= 1;
          nextTail -= 1;
        }

        let start = Math.min(firstDiff, nextLines.length);
        let end = Math.max(start - 1, nextTail);

        if (braceMatch) {
          const braceLineA = getLineIndexAtOffset(value, braceMatch.open);
          const braceLineB = getLineIndexAtOffset(value, braceMatch.close);
          start = Math.min(start, braceLineA, braceLineB);
          end = Math.max(end, braceLineA, braceLineB);
        }

        const nextHighlighted = new Array(nextLines.length);
        for (let i = 0; i < nextLines.length; i += 1) {
          if (i < start || i > end) {
            nextHighlighted[i] = prevHighlighted[i] ?? highlightScript(nextLines[i], braceMatch, nextOffsets[i]);
          } else {
            nextHighlighted[i] = highlightScript(nextLines[i], braceMatch, nextOffsets[i]);
          }
        }

        let html = nextHighlighted.join('\n');
        if (!html) html = ' ';
        if (value.endsWith('\n')) html += '\n ';
        setRenderedHighlightHtml(html);
        highlightCacheRef.current = { lines: nextLines, highlightedLines: nextHighlighted };
      };

      rafId = window.requestAnimationFrame(run);
    }, 24);

    return () => {
      window.clearTimeout(timer);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [braceMatch, escapeHtml, getLineIndexAtOffset, highlightScript, syntaxHighlightEnabled, syntaxHighlightMode, value]);

  useEffect(() => {
    if (!syntaxHighlightEnabled) return;
    const raf = window.requestAnimationFrame(() => {
      syncEditorScroll();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [syncEditorScroll, syntaxHighlightEnabled, value, size.height, size.width, position.x, position.y, renderedHighlightHtml]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        ref={modalRef}
        className="bg-terminal rounded-theme-lg flex flex-col border border-terminal-border shadow-theme-2xl pointer-events-auto"
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
          opacity: tiling.windowOpacity,
          backdropFilter: tiling.windowOpacity < 1 ? 'blur(4px)' : undefined,
        }}
      >
        <div
          className="flex items-center justify-between px-2 py-1 border-b border-terminal-border/50 bg-terminal-header rounded-t-theme-lg cursor-move select-none relative z-10"
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center gap-2 font-mono text-[11px] text-terminal-foreground">
            <span className="text-terminal-success">┌─</span>
            <span className="text-terminal-command">[</span>
            <span className="text-terminal-prompt">hase</span>
            <span className="text-muted-foreground">@</span>
            <span className="text-info">editor</span>
            <span className="text-terminal-command">]</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="text-muted-foreground hover:text-terminal-error text-xs px-1.5 py-0.5 rounded-theme-sm hover:bg-terminal-border/30 transition-colors font-mono relative z-20"
              title="Close (ESC)"
            >
              [×]
            </button>
          </div>
        </div>

        {(meta.name || meta.author || meta.created || meta.version || warnings.length > 0) && (
          <div className="px-3 py-2 border-b border-terminal-border/50 text-[10px] font-mono text-muted-foreground space-y-1">
            <div className="flex flex-wrap gap-3">
              <span>name: {meta.name || '—'}</span>
              <span>author: {meta.author || '—'}</span>
              <span>created: {meta.created || '—'}</span>
              <span>version: {meta.version || '—'}</span>
            </div>
            {warnings.length > 0 && (
              <div className="space-y-1">
                <div className="text-terminal-warning">
                  warnings: {warnings.join(' | ')}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWarningExplanation(explainWarning(warnings[0]))}
                    className="px-1.5 py-0.5 rounded-theme-sm border border-terminal-border/50 text-[10px] text-warning hover:bg-terminal-border/30"
                  >
                    Explain warning
                  </button>
                  {warningExplanation && (
                    <span className="text-[10px] text-warning/90">{warningExplanation}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 p-3">
          <div className="flex h-full gap-3">
            <div className="w-52 shrink-0 rounded-theme-md border border-terminal-border/50 bg-terminal-header/60 flex flex-col">
              <div className="px-2 py-2 text-[10px] font-mono text-muted-foreground border-b border-terminal-border/50">
                Scripts
              </div>
              <div className="flex gap-1 px-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setScriptSource('local'); setSelectedScriptId(null); }}
                  className={`flex-1 px-1.5 py-0.5 rounded-theme-sm border text-[10px] font-mono ${
                    scriptSource === 'local'
                      ? 'border-terminal-command/60 text-terminal-command bg-terminal-border/40'
                      : 'border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30'
                  }`}
                >
                  Local
                </button>
                <button
                  type="button"
                  onClick={() => { setScriptSource('team'); setSelectedScriptId(null); }}
                  className={`flex-1 px-1.5 py-0.5 rounded-theme-sm border text-[10px] font-mono ${
                    scriptSource === 'team'
                      ? 'border-info/60 text-info bg-terminal-border/40'
                      : 'border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30'
                  }`}
                  title="Shared via Firestore for all signed-in users"
                >
                  Team
                </button>
              </div>
              {scriptSource === 'team' && teamScriptsError && (
                <div className="px-2 py-1 text-[9px] text-terminal-error font-mono break-words">
                  {teamScriptsError}
                </div>
              )}
              {scriptSource === 'team' && !teamScriptsCanUse && (
                <div className="px-2 py-1 text-[9px] text-warning/90 font-mono">
                  Sign in (Firebase) to use Team library. Deploy Firestore rules for &quot;hase_shared_scripts&quot;.
                </div>
              )}
              <div className="flex flex-wrap gap-1 px-2 py-2">
                <button
                  type="button"
                  onClick={handleLibraryNew}
                  className="px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30 text-[10px]"
                >
                  New
                </button>
                <button
                  type="button"
                  onClick={() => void handleLibrarySave()}
                  disabled={teamSavePending || (scriptSource === 'team' && !teamScriptsCanUse)}
                  className="px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30 text-[10px] disabled:opacity-40"
                >
                  {teamSavePending ? '…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDocs(prev => !prev)}
                  className="px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30 text-[10px]"
                >
                  Docs
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-1 pb-2">
                {scriptSource === 'team' && teamScriptsLoading && displayedScripts.length === 0 && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">Loading team scripts…</div>
                )}
                {!teamScriptsLoading && displayedScripts.length === 0 && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    {scriptSource === 'team'
                      ? (teamScriptsCanUse ? 'No team scripts yet' : '')
                      : 'No scripts yet'}
                  </div>
                )}
                {displayedScripts.map(script => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => handleLibraryLoad(script.id)}
                    className={`w-full text-left px-2 py-1 text-[10px] rounded-theme-sm font-mono ${
                      selectedScriptId === script.id
                        ? 'bg-terminal-border/60 text-terminal-foreground'
                        : 'text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30'
                    }`}
                    title={
                      scriptSource === 'team' && script.updatedByName
                        ? `${script.name} · last: ${script.updatedByName}`
                        : script.name
                    }
                  >
                    {script.name}
                  </button>
                ))}
              </div>
              <div className="border-t border-terminal-border/50 px-2 py-2 space-y-2">
                {isRenaming ? (
                  <div className="space-y-1">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="w-full bg-terminal text-terminal-success outline-none font-mono text-[10px] rounded-theme-sm border border-terminal-border/50 px-2 py-1"
                      placeholder="New name"
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void confirmRename()}
                        disabled={teamSavePending}
                        className="flex-1 px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-terminal-command hover:bg-terminal-border/30 text-[10px] disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsRenaming(false)}
                        className="flex-1 px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30 text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={startRename}
                      disabled={!selectedScriptId || (scriptSource === 'team' && !teamScriptsCanUse)}
                      className="flex-1 px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30 disabled:opacity-40 text-[10px]"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLibraryDelete()}
                      disabled={!selectedScriptId || (scriptSource === 'team' && !teamScriptsCanUse)}
                      className="flex-1 px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-error hover:bg-terminal-border/30 disabled:opacity-40 text-[10px]"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="relative w-full h-full rounded-theme-md border border-terminal-border/50 bg-terminal overflow-hidden">
              {commandHints.length > 0 && (
                <div className="absolute top-2 right-2 w-[28rem] max-w-[70%] z-20 rounded-theme-md border border-terminal-border/50 bg-terminal-header/95 shadow-theme-lg overflow-hidden">
                  {commandHints.map((hint, idx) => {
                    const isSelected = idx === selectedHintIndex;
                    return (
                      <button
                        key={`${hint.command}-${idx}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyCommandHint(hint)}
                        className={`w-full text-left px-2 py-1 border-b last:border-b-0 border-terminal-border/30 ${
                          isSelected ? 'bg-terminal-border/60 text-terminal-foreground' : 'text-foreground hover:bg-terminal-border/30'
                        }`}
                      >
                        <div className="font-mono text-[10px]">{hint.snippet}</div>
                        <div className="text-[9px] text-muted-foreground">{hint.description}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              {!monacoFailed ? (
                <div className="absolute inset-0 flex">
                  <div className="flex-1 min-w-0">
                    <Editor
                      height="100%"
                      defaultLanguage="hase"
                      language="hase"
                      value={value}
                      theme="hase-terminal"
                      loading={<div className="p-2 text-[10px] text-muted-foreground font-mono">Loading editor…</div>}
                      onMount={handleMonacoMount}
                      onChange={(next) => onChange(next ?? '')}
                      options={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        fontSize: 12,
                        lineHeight: 20,
                        minimap: { enabled: true, side: 'right' },
                        folding: true,
                        glyphMargin: true,
                        lineNumbers: 'on',
                        renderLineHighlight: 'all',
                        matchBrackets: 'always',
                        stickyScroll: { enabled: false },
                        renderWhitespace: 'selection',
                        quickSuggestions: true,
                        suggestOnTriggerCharacters: true,
                        tabSize: 2,
                        wordWrap: useSoftWrap ? 'on' : 'off',
                        wrappingIndent: 'indent',
                        formatOnPaste: false,
                        formatOnType: false,
                        find: {
                          addExtraSpaceOnTop: false,
                          autoFindInSelection: 'never',
                          seedSearchStringFromSelection: 'always',
                        },
                        multiCursorModifier: 'alt',
                        multiCursorMergeOverlapping: true,
                        scrollBeyondLastLine: false,
                        smoothScrolling: true,
                      }}
                    />
                  </div>
                  <div className="w-56 border-l border-terminal-border/50 bg-terminal-header/40 overflow-y-auto">
                    <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground border-b border-terminal-border/50">
                      Outline
                    </div>
                    {outlineItems.length === 0 ? (
                      <div className="px-2 py-1 text-[10px] text-muted-foreground">No blocks</div>
                    ) : outlineItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          const editor = monacoEditorRef.current;
                          if (!editor) return;
                          editor.revealLineInCenter(item.line);
                          editor.setPosition({ lineNumber: item.line, column: 1 });
                          editor.focus();
                        }}
                        className="w-full text-left px-2 py-1 text-[10px] font-mono text-foreground hover:bg-terminal-border/30 hover:text-terminal-foreground"
                        style={{ paddingLeft: `${8 + item.depth * 10}px` }}
                        title={`Line ${item.line}`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground border-y border-terminal-border/50 mt-2">
                      Problems ({validationIssues.length})
                    </div>
                    {validationIssues.length === 0 ? (
                      <div className="px-2 py-1 text-[10px] text-success">No issues</div>
                    ) : validationIssues.map((issue, idx) => (
                      <button
                        key={`${issue.line}-${issue.column}-${idx}`}
                        type="button"
                        onClick={() => {
                          const editor = monacoEditorRef.current;
                          if (!editor) return;
                          editor.revealLineInCenter(issue.line);
                          editor.setPosition({ lineNumber: issue.line, column: issue.column });
                          editor.focus();
                        }}
                        className={`w-full text-left px-2 py-1 text-[10px] font-mono hover:bg-terminal-border/30 ${
                          issue.severity === 'error' ? 'text-destructive' : 'text-warning'
                        }`}
                        title={`Line ${issue.line}, Col ${issue.column}`}
                      >
                        {issue.severity === 'error' ? 'E' : 'W'}:{issue.line}:{issue.column} {issue.message}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {syntaxHighlightEnabled ? (
                    <pre
                      ref={editorHighlightRef}
                      className={`absolute inset-0 p-2 pointer-events-none overflow-hidden ${HASE_EDITOR_TEXT_METRICS}`}
                      style={{ paddingBottom: `calc(0.5rem + ${highlightBottomPadPx}px)` }}
                      dangerouslySetInnerHTML={{ __html: renderedHighlightHtml }}
                    />
                  ) : (
                    <div className="absolute inset-x-0 top-0 z-[1] px-2 py-1 text-[10px] font-mono text-warning/90 bg-terminal-header/90 border-b border-terminal-border/40 pointer-events-none">
                      Large script ({value.length.toLocaleString()} chars): highlighting off for performance
                    </div>
                  )}
                  <textarea
                    ref={editorTextareaRef}
                    value={value}
                    onChange={handleEditorChange}
                    onScroll={syntaxHighlightEnabled ? syncEditorScroll : undefined}
                    onKeyDown={handleEditorKeyDown}
                    onKeyUp={handleEditorSelection}
                    onClick={handleEditorSelection}
                    onSelect={handleEditorSelection}
                    className={`absolute inset-0 w-full h-full bg-transparent outline-none resize-none p-2 overflow-auto caret-[#4ade80] ${HASE_EDITOR_TEXT_METRICS} ${
                      syntaxHighlightEnabled
                        ? 'text-transparent'
                        : 'text-terminal-foreground pt-7'
                    }`}
                    placeholder="Write multi-line script here..."
                    spellCheck="false"
                  />
                </>
              )}
              {showDocs && (
                <div className="absolute inset-0 bg-terminal/95 backdrop-blur-sm z-10">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border/50 text-[11px] font-mono text-muted-foreground">
                    <span>Hase Docs</span>
                    <button
                      type="button"
                      onClick={() => setShowDocs(false)}
                      className="text-muted-foreground hover:text-terminal-foreground px-1 rounded-theme-sm hover:bg-terminal-border/30"
                    >
                      [×]
                    </button>
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-foreground whitespace-pre-wrap overflow-auto h-full">
                    {HASE_DOCS_TEXT}
                  </pre>
                </div>
              )}
              {toast && (
                <div
                  className={`absolute bottom-2 right-2 z-30 px-2 py-1 rounded-theme-sm border text-[11px] font-mono shadow-theme-lg ${
                    toast.type === 'success'
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-destructive/40 bg-destructive/10 text-destructive'
                  }`}
                >
                  {toast.text}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-terminal-border/50 bg-terminal-header/80 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Ctrl+S Local · Ctrl+Shift+S Team · Ctrl+F/Ctrl+H · Alt+Click · Ctrl+Shift+F · Ctrl+Enter Run · Ctrl+Shift+Enter Apply · Esc</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUseSoftWrap(prev => !prev)}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30"
              title="Toggle line wrapping"
            >
              Wrap: {useSoftWrap ? 'soft' : 'hard'}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30"
            >
              Load .hase
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30"
            >
              Save .hase
            </button>
            <button
              type="button"
              onClick={handleFormatClick}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-foreground hover:bg-terminal-border/30"
            >
              Format
            </button>
            <button
              type="button"
              onClick={onApply}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-terminal-command hover:bg-terminal-border/30"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onRun}
              className="px-2 py-1 rounded-theme-sm border border-terminal-border/50 text-terminal-success hover:bg-terminal-border/30"
            >
              Run
            </button>
          </div>
        </div>

        <div
          className="absolute top-8 bottom-0 left-0 w-1 cursor-w-resize z-0"
          onMouseDown={beginResize({ n: false, s: false, e: false, w: true })}
        />
        <div
          className="absolute top-8 bottom-0 right-0 w-1 cursor-e-resize z-0"
          onMouseDown={beginResize({ n: false, s: false, e: true, w: false })}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-1 cursor-s-resize z-0"
          onMouseDown={beginResize({ n: false, s: true, e: false, w: false })}
        />
        <div
          className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-0"
          onMouseDown={beginResize({ n: false, s: true, e: false, w: true })}
        />
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-0"
          onMouseDown={beginResize({ n: false, s: true, e: true, w: false })}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".hase,.txt"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
};

export default HaseEditor;
