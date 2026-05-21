import { useState } from 'react';
import { Wallet, ChevronDown, Copy, Check, LogOut } from 'lucide-react';
import { useWalletStore, PROVIDER_LABEL, shortAddress } from '../../store/useWalletStore';
import WalletConnectModal from './WalletConnectModal';

/**
 * Header pill that shows "Connect wallet" when disconnected and the
 * truncated address + provider when connected. Click → open the
 * WalletConnectModal (which also doubles as a disconnect surface).
 *
 * `variant="hero"` renders a bigger pill with the violet primary CTA
 * style — used on the pre-connect hero card.
 * `variant="topbar"` is compact, used in the sticky header.
 */

interface Props {
  variant?: 'hero' | 'topbar';
}

export const WalletButton: React.FC<Props> = ({ variant = 'topbar' }) => {
  const account = useWalletStore((s) => s.account);
  const connecting = useWalletStore((s) => s.connecting);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  if (!account) {
    const baseClasses = variant === 'hero'
      ? 'h-11 px-5 text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_0_1px_rgba(168,85,247,0.4),0_0_24px_-4px_rgba(168,85,247,0.55)]'
      : 'h-8 px-3 text-xs rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary/20';
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={connecting}
          className={`${baseClasses} inline-flex items-center gap-2 font-medium transition-all disabled:opacity-60`}
        >
          <Wallet className={variant === 'hero' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          <span>{connecting ? 'Connecting…' : 'Connect wallet'}</span>
        </button>
        <WalletConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  const compact = variant === 'topbar';
  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`group inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 backdrop-blur-md hover:border-primary/40 hover:bg-card transition-all ${
          compact ? 'h-8 pl-2.5 pr-1.5' : 'h-10 pl-3 pr-2'
        }`}
        title={`${PROVIDER_LABEL[account.provider]} · ${account.address}`}
      >
        <span className="dot dot-online shrink-0" />
        <span className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} text-foreground/90`}>
          {shortAddress(account.address)}
        </span>
        <span
          role="button"
          aria-label="Copy address"
          onClick={handleCopy}
          className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </span>
        <ChevronDown className={`text-muted-foreground transition-colors group-hover:text-foreground ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
      </button>
      <WalletConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default WalletButton;
