import { useState } from 'react';
import { X, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useWalletStore, PROVIDER_LABEL, shortAddress, type WalletProvider } from '../../store/useWalletStore';

/**
 * Wallet-connect modal — mimics the standard web3 onboarding flow.
 * Each provider is a non-functional demo: clicking simulates a popup
 * delay then resolves with a deterministic address from useWalletStore.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ProviderOption {
  id: WalletProvider;
  /** Inline SVG mark — keeps the modal dependency-free. */
  glyph: React.ReactNode;
  tagline: string;
  trending?: boolean;
}

const OPTIONS: ProviderOption[] = [
  {
    id: 'metamask',
    tagline: 'Most popular EVM wallet',
    trending: true,
    glyph: (
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="meta-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f97316" />
            <stop offset="1" stopColor="#ea580c" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#meta-g)" />
        <path d="M10 12 L17 22 L13 28 Z M30 12 L23 22 L27 28 Z M20 23 L14 28 L20 31 L26 28 Z" fill="#fff" opacity="0.95" />
      </svg>
    ),
  },
  {
    id: 'walletconnect',
    tagline: 'Mobile + cross-chain via QR',
    glyph: (
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="wc-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#wc-g)" />
        <path
          d="M11 20 Q15 14 20 14 Q25 14 29 20 L26 23 Q23 19 20 19 Q17 19 14 23 Z M11 26 Q15 20 20 20 Q25 20 29 26 L26 29 Q23 25 20 25 Q17 25 14 29 Z"
          fill="#fff"
          opacity="0.95"
        />
      </svg>
    ),
  },
  {
    id: 'phantom',
    tagline: 'Solana-native, multi-chain',
    glyph: (
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="ph-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a855f7" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#ph-g)" />
        <path d="M12 22 Q12 14 20 14 Q28 14 28 22 L28 28 Q24 28 22 25 Q20 28 18 25 Q16 28 12 28 Z" fill="#fff" opacity="0.95" />
        <circle cx="17" cy="20" r="1.5" fill="#7c3aed" />
        <circle cx="23" cy="20" r="1.5" fill="#7c3aed" />
      </svg>
    ),
  },
  {
    id: 'coinbase',
    tagline: 'On-ramps + custodial backup',
    glyph: (
      <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
        <rect width="40" height="40" rx="10" fill="#1652f0" />
        <circle cx="20" cy="20" r="9" fill="none" stroke="#fff" strokeWidth="2.5" />
        <rect x="16" y="16" width="8" height="8" rx="1.5" fill="#fff" />
      </svg>
    ),
  },
];

export const WalletConnectModal: React.FC<Props> = ({ open, onClose }) => {
  const { account, connecting, connect, disconnect } = useWalletStore();
  const [activeProvider, setActiveProvider] = useState<WalletProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handlePick = async (provider: WalletProvider) => {
    if (connecting) return;
    setActiveProvider(provider);
    setError(null);
    try {
      await connect(provider);
      setTimeout(onClose, 400);
    } catch (e: any) {
      setError(e?.message ?? 'Connection failed');
    } finally {
      setActiveProvider(null);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-md"
      style={{ background: 'rgba(7, 8, 13, 0.65)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Connect wallet"
        className="glass gradient-border relative w-full max-w-md rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">
            Demo · No on-chain signature
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect <span className="text-gradient">wallet</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Bind a wallet to surface owned rigs, signed actions, and payout
            history. RigWatch never holds keys.
          </p>
        </div>

        {account ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/25 bg-success/5 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-success">
                <Check className="h-3.5 w-3.5" />
                <span>Connected via {PROVIDER_LABEL[account.provider]}</span>
              </div>
              <div className="mt-2 font-mono text-sm break-all">{account.address}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Short: {shortAddress(account.address)} · Chain ID {account.chainId}
              </div>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full rounded-xl border border-border bg-card hover:bg-accent transition-colors py-2.5 text-sm font-medium text-destructive"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {OPTIONS.map((opt) => {
              const isActive = activeProvider === opt.id && connecting;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={connecting}
                  onClick={() => handlePick(opt.id)}
                  className="group w-full flex items-center gap-3 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-all px-3.5 py-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {opt.glyph}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span>{PROVIDER_LABEL[opt.id]}</span>
                      {opt.trending && (
                        <span className="pill pill-info" style={{ padding: '2px 6px', fontSize: 9 }}>POPULAR</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{opt.tagline}</div>
                  </div>
                  {isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                      Connect
                    </span>
                  )}
                </button>
              );
            })}

            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{error}</span>
              </div>
            )}

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              By connecting you agree to the demo terms. No signatures are
              broadcast and no funds move — this is a portfolio build.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletConnectModal;
