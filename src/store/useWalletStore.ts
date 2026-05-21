import { create } from 'zustand';

/**
 * Demo wallet store. There is no real web3 integration — every
 * "wallet connect" flow resolves to a deterministic synthetic address
 * after a short delay so the UI can showcase wallet-bound UX (owned
 * rigs filter, earnings sheet, payout history) without depending on
 * MetaMask / WalletConnect / RPC infra.
 *
 * Persisted to localStorage so the connection survives page reloads.
 */

const LS_KEY = 'rigwatch-wallet-v1';

export type WalletProvider = 'metamask' | 'walletconnect' | 'phantom' | 'coinbase';

export interface WalletAccount {
  address: string;
  provider: WalletProvider;
  chainId: number;
  connectedAt: number;
}

interface WalletStore {
  account: WalletAccount | null;
  connecting: boolean;
  connect: (provider: WalletProvider) => Promise<WalletAccount>;
  disconnect: () => void;
}

/** Deterministic address per provider — same provider = same address each
 *  time so the demo UX feels persistent. */
const DEMO_ADDRESSES: Record<WalletProvider, string> = {
  metamask:      '0x7a3bD41cD68fE21e3D72bD1ee48b9c52d8C014a3',
  walletconnect: '0xC4f81a5f9F4D2eB28b2C7fAa3cD0d3C28d6e9921',
  phantom:       '0x9E37C5b1D86c2a3DCe19B7DcA1c8F03b67ad3f81',
  coinbase:      '0x4E6c8d4eAB3c19f7e2DcF35cB2a8d1f0a9b27d5c',
};

const restore = (): WalletAccount | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.address === 'string' && typeof parsed.provider === 'string') {
      return parsed as WalletAccount;
    }
  } catch {}
  return null;
};

const persist = (acc: WalletAccount | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (acc) localStorage.setItem(LS_KEY, JSON.stringify(acc));
    else localStorage.removeItem(LS_KEY);
  } catch {}
};

export const useWalletStore = create<WalletStore>((set) => ({
  account: restore(),
  connecting: false,
  connect: async (provider) => {
    set({ connecting: true });
    // Simulate the popup / handshake delay so the UI has a beat to show
    // the "Connecting…" state. Provider-tuned so each one feels distinct.
    const delay = provider === 'walletconnect' ? 1100 : provider === 'phantom' ? 700 : 850;
    await new Promise((r) => setTimeout(r, delay));
    const account: WalletAccount = {
      address: DEMO_ADDRESSES[provider],
      provider,
      chainId: provider === 'phantom' ? 101 : 1, // 101 = Solana, 1 = Ethereum
      connectedAt: Date.now(),
    };
    persist(account);
    set({ account, connecting: false });
    return account;
  },
  disconnect: () => {
    persist(null);
    set({ account: null });
  },
}));

/** Short-form display: 0x7a3b…14a3 */
export const shortAddress = (addr: string, head = 6, tail = 4): string =>
  addr.length > head + tail + 1 ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr;

export const PROVIDER_LABEL: Record<WalletProvider, string> = {
  metamask: 'MetaMask',
  walletconnect: 'WalletConnect',
  phantom: 'Phantom',
  coinbase: 'Coinbase Wallet',
};
