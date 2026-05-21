import type * as Monaco from 'monaco-editor';

export interface RigopsOutlineItem {
  id: string;
  label: string;
  line: number;
  depth: number;
}

export interface RigopsValidationIssue {
  message: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  fix?: {
    title: string;
    replacement: string;
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  };
}

const RIGOPS_KEYWORDS = [
  'repeat', 'if', 'else', 'while', 'for', 'in', 'break', 'continue', 'let', 'unset', 'vars',
  'connect', 'disconnect', 'wait', 'sleep', 'get', 'read', 'collect', 'collect_cache', 'from', 'params', 'where', 'as', 'clear',
  'fb_get', 'fb_exists', 'fb_keys', 'fb_tree', 'fb_set', 'fb_update', 'fb_remove', 'fb_copy', 'depth', 'limit', 'confirm', 'if_missing', 'substr',
  'preset_save', 'preset_run', 'preset_list', 'preset_show', 'preset_delete',
  'log', 'assert_connected', 'script_status', 'try', 'catch',
];

const RIGOPS_SNIPPETS: Array<{ command: string; snippet: string; description: string }> = [
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

const RIGOPS_MIGRATION_TEMPLATES: Array<{ label: string; snippet: string; detail: string }> = [
  {
    label: 'migration: fb_copy if_missing',
    detail: 'Migration template for safe key copy',
    snippet: [
      'let mappings = [["7247902","7690384"]]',
      'for pair in $mappings {',
      '  let src = "/controllertausch/fepaliste/$pair[0]"',
      '  let dst = "/controllertausch/fepaliste/$pair[1]"',
      '  fb_copy $src -> $dst if_missing confirm',
      '}',
    ].join('\n'),
  },
  {
    label: 'migration: iterate ids',
    detail: 'ID loop migration template with error handling',
    snippet: [
      'fb_keys /konstant_app as ids',
      'for id in $ids {',
      '  try {',
      '    connect $id',
      '    # TODO migration step',
      '    disconnect',
      '  } catch {',
      '    log "skip $id"',
      '  }',
      '}',
    ].join('\n'),
  },
];

let didRegister = false;

export const registerRigopsMonaco = (monaco: typeof Monaco) => {
  if (didRegister) return;
  didRegister = true;

  monaco.languages.register({ id: 'rigops' });
  monaco.languages.setLanguageConfiguration('rigops', {
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ],
    folding: {
      markers: {
        start: /^\s*.*\{\s*$/,
        end: /^\s*\}/,
      },
    },
  });

  monaco.languages.setMonarchTokensProvider('rigops', {
    keywords: RIGOPS_KEYWORDS,
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/\$[a-zA-Z_]\w*(?:\[\d+\])?/, 'variable'],
        [/@[a-zA-Z_]\w*(?:\[\d+\])?/, 'variable.predefined'],
        [/\d+(?:\.\d+)?(?:ms|s)?/, 'number'],
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/".*?"/, 'string'],
        [/'.*?'/, 'string'],
        [/[{}()[\]]/, 'delimiter.bracket'],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider('rigops', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const lineText = model.getLineContent(position.lineNumber).slice(0, Math.max(0, position.column - 1));
      const lineTrimmed = lineText.trimStart();
      const isFbCopyContext = lineTrimmed.startsWith('fb_copy ');
      const isCollectContext = lineTrimmed.startsWith('collect ');
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const baseSuggestions = RIGOPS_SNIPPETS.map((hint) => ({
        label: hint.command,
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: hint.description,
        insertText: hint.snippet,
        range,
      }));
      const contextualSuggestions: Monaco.languages.CompletionItem[] = [];

      if (isFbCopyContext) {
        contextualSuggestions.push(
          {
            label: 'fb_copy source placeholder',
            kind: monaco.languages.CompletionItemKind.Variable,
            documentation: 'Source path for fb_copy',
            insertText: '/from/path',
            range,
          },
          {
            label: 'fb_copy arrow',
            kind: monaco.languages.CompletionItemKind.Operator,
            documentation: 'Separator: source -> target',
            insertText: '-> ',
            range,
          },
          {
            label: 'fb_copy target placeholder',
            kind: monaco.languages.CompletionItemKind.Variable,
            documentation: 'Destination path for fb_copy',
            insertText: '/to/path if_missing confirm',
            range,
          },
        );
      }

      if (isCollectContext) {
        contextualSuggestions.push({
          label: 'collect from all template',
          kind: monaco.languages.CompletionItemKind.Snippet,
          documentation: 'Template: collect from all params',
          insertText: 'from all params [T,PL] as rows',
          range,
        });
      }

      const templateSuggestions = RIGOPS_MIGRATION_TEMPLATES.map((tpl) => ({
        label: tpl.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: tpl.detail,
        insertText: tpl.snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      }));

      return { suggestions: [...contextualSuggestions, ...baseSuggestions, ...templateSuggestions] };
    },
  });

  monaco.languages.registerHoverProvider('rigops', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const token = word.word.toLowerCase();
      const hint = RIGOPS_SNIPPETS.find((item) => item.command === token);
      if (!hint) return null;
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [
          { value: `**${hint.command}**` },
          { value: hint.description },
          { value: `\`${hint.snippet}\`` },
        ],
      };
    },
  });

  monaco.editor.defineTheme('rigwatch-terminal', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'facc15' },
      { token: 'string', foreground: '34d399' },
      { token: 'number', foreground: '4ade80' },
      { token: 'variable', foreground: '22d3ee' },
      { token: 'variable.predefined', foreground: 'fbbf24' },
      { token: 'comment', foreground: '6b7280' },
    ],
    colors: {
      'editor.background': '#0b0f14',
      'editor.lineHighlightBackground': '#1f293733',
      'editorLineNumber.foreground': '#6b7280',
      'editorLineNumber.activeForeground': '#e5e7eb',
      'editorGutter.background': '#0b0f14',
      'editorCursor.foreground': '#4ade80',
      'editor.selectionBackground': '#37415166',
      'editor.findMatchBackground': '#eab30855',
      'editor.findMatchHighlightBackground': '#eab30833',
    },
  });
};

export const explainWarning = (warning: string): string => {
  const text = warning.toLowerCase();
  if (text.includes('user_')) {
    return 'Commands user_* are marked as risky in scripts. Run them carefully and verify permissions first.';
  }
  if (text.includes('delete_param')) {
    return 'delete_param removes data without easy rollback. Double-check target parameter and prefer dry-run/logging before execution.';
  }
  if (text.includes('update')) {
    return 'update may affect a large data scope. Ensure the target scope is limited and confirm logic is present.';
  }
  return 'This warning points to a potentially dangerous operation. Verify command scope and add protective conditions.';
};

export const validateRigopsScript = (raw: string): RigopsValidationIssue[] => {
  const issues: RigopsValidationIssue[] = [];
  const lines = raw.replace(/\r/g, '').split('\n');
  const stack: Array<{ line: number; column: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '{') stack.push({ line: i + 1, column: j + 1 });
      if (ch === '}') {
        if (stack.length === 0) {
          issues.push({
            severity: 'error',
            message: 'Unexpected closing brace',
            line: i + 1,
            column: j + 1,
            endColumn: j + 2,
          });
        } else {
          stack.pop();
        }
      }
    }

    if (/^fb_copy\b/i.test(trimmed) && !trimmed.includes('->')) {
      const endCol = Math.max(line.length + 1, 2);
      issues.push({
        severity: 'error',
        message: 'Expected syntax: fb_copy <from> -> <to> [if_missing] confirm',
        line: i + 1,
        column: 1,
        endColumn: endCol,
        fix: {
          title: 'Insert fb_copy template',
          replacement: 'fb_copy /from/path -> /to/path if_missing confirm',
          range: { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: endCol },
        },
      });
    }

    if (/^fb_remove\b/i.test(trimmed) && !/\bconfirm\b/i.test(trimmed)) {
      const endCol = Math.max(line.length + 1, 2);
      issues.push({
        severity: 'warning',
        message: 'fb_remove without confirm',
        line: i + 1,
        column: 1,
        endColumn: endCol,
        fix: {
          title: 'Add confirm',
          replacement: `${trimmed} confirm`,
          range: { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: endCol },
        },
      });
    }
  }

  for (const unclosed of stack) {
    issues.push({
      severity: 'error',
      message: 'Unclosed opening brace',
      line: unclosed.line,
      column: unclosed.column,
      endColumn: unclosed.column + 1,
    });
  }

  return issues;
};

export const buildRigopsOutline = (raw: string): RigopsOutlineItem[] => {
  const lines = raw.replace(/\r/g, '').split('\n');
  const outline: RigopsOutlineItem[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#name ')) {
      outline.push({ id: `name-${i}`, label: trimmed, line: i + 1, depth: 0 });
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('}')) {
      depth = Math.max(0, depth - (trimmed.startsWith('}') ? 1 : 0));
      continue;
    }
    if (/^(if|else|for|while|try|catch|repeat)\b/i.test(trimmed)) {
      outline.push({ id: `block-${i}`, label: trimmed.slice(0, 70), line: i + 1, depth: Math.max(0, depth) });
    }
    if (trimmed.endsWith('{')) {
      depth += 1;
    }
  }

  return outline;
};
