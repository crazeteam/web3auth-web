import {
  type AuthUserInfo,
  JRPCRequest,
  JRPCResponse,
  Maybe,
  RequestArguments,
  SafeEventEmitter,
  SendCallBack,
  UX_MODE,
  type UX_MODE_TYPE,
  WEB3AUTH_NETWORK,
  type WEB3AUTH_NETWORK_TYPE,
} from "@web3auth/auth";

import { getChainConfig } from "../chain/config";
import { AdapterNamespaceType, CHAIN_NAMESPACES, ChainNamespaceType, CustomChainConfig } from "../chain/IChainInterface";
import { WalletInitializationError, WalletLoginError, WalletOperationsError, Web3AuthError } from "../errors";
import { ProviderEvents, SafeEventEmitterProvider } from "../provider/IProvider";
import { WALLET_ADAPTERS } from "../wallet";

export type UserInfo = AuthUserInfo;

export { UX_MODE, UX_MODE_TYPE, WEB3AUTH_NETWORK, WEB3AUTH_NETWORK_TYPE };

export const ADAPTER_CATEGORY = {
  EXTERNAL: "external",
  IN_APP: "in_app",
} as const;
export type ADAPTER_CATEGORY_TYPE = (typeof ADAPTER_CATEGORY)[keyof typeof ADAPTER_CATEGORY];

export interface AdapterInitOptions {
  /**
   * Whether to auto connect to the adapter based on redirect mode or saved adapters
   */
  autoConnect?: boolean;
}

export const ADAPTER_STATUS = {
  NOT_READY: "not_ready",
  READY: "ready",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERRORED: "errored",
} as const;

export const ADAPTER_EVENTS = {
  ...ADAPTER_STATUS,
  ADAPTER_DATA_UPDATED: "adapter_data_updated",
  CACHE_CLEAR: "cache_clear",
} as const;
export type ADAPTER_STATUS_TYPE = (typeof ADAPTER_STATUS)[keyof typeof ADAPTER_STATUS];

export type UserAuthInfo = { idToken: string };

export interface BaseAdapterSettings {
  clientId?: string;
  sessionTime?: number;
  chainConfig?: CustomChainConfig;
  web3AuthNetwork?: WEB3AUTH_NETWORK_TYPE;
  useCoreKitKey?: boolean;
}

export interface IProvider extends SafeEventEmitter<ProviderEvents> {
  get chainId(): string;
  request<S, R>(args: RequestArguments<S>): Promise<Maybe<R>>;
  sendAsync<T, U>(req: JRPCRequest<T>, callback: SendCallBack<JRPCResponse<U>>): void;
  sendAsync<T, U>(req: JRPCRequest<T>): Promise<JRPCResponse<U>>;
  send<T, U>(req: JRPCRequest<T>, callback: SendCallBack<JRPCResponse<U>>): void;
}

export interface IBaseProvider<T> extends IProvider {
  provider: SafeEventEmitterProvider | null;
  currentChainConfig: CustomChainConfig;
  setupProvider(provider: T): Promise<void>;
  addChain(chainConfig: CustomChainConfig): void;
  switchChain(params: { chainId: string }): Promise<void>;
  updateProviderEngineProxy(provider: SafeEventEmitterProvider): void;
  setKeyExportFlag(flag: boolean): void;
}

export interface IAdapter<T> extends SafeEventEmitter {
  adapterNamespace: AdapterNamespaceType;
  currentChainNamespace: ChainNamespaceType;
  chainConfigProxy: CustomChainConfig | null;
  type: ADAPTER_CATEGORY_TYPE;
  name: string;
  sessionTime: number;
  web3AuthNetwork: WEB3AUTH_NETWORK_TYPE;
  useCoreKitKey: boolean | undefined;
  clientId: string;
  status: ADAPTER_STATUS_TYPE;
  provider: IProvider | null;
  adapterData?: unknown;
  connnected: boolean;
  isInjected?: boolean;
  addChain(chainConfig: CustomChainConfig): Promise<void>;
  init(options?: AdapterInitOptions): Promise<void>;
  disconnect(options?: { cleanup: boolean }): Promise<void>;
  connect(params?: T): Promise<IProvider | null>;
  getUserInfo(): Promise<Partial<UserInfo>>;
  enableMFA(params?: T): Promise<void>;
  setAdapterSettings(adapterSettings: BaseAdapterSettings): void;
  switchChain(params: { chainId: string }): Promise<void>;
  authenticateUser(): Promise<UserAuthInfo>;
}

export type CONNECTED_EVENT_DATA = {
  adapter: string;
  provider: IProvider;
  reconnected: boolean;
};

export interface IAdapterDataEvent {
  adapterName: string;
  data: unknown;
}

export type AdapterEvents = {
  [ADAPTER_EVENTS.NOT_READY]: () => void;
  [ADAPTER_EVENTS.READY]: (adapter: string) => void;
  [ADAPTER_EVENTS.CONNECTED]: (data: CONNECTED_EVENT_DATA) => void;
  [ADAPTER_EVENTS.DISCONNECTED]: () => void;
  [ADAPTER_EVENTS.CONNECTING]: (data: { adapter: string }) => void;
  [ADAPTER_EVENTS.ERRORED]: (error: Web3AuthError) => void;
  [ADAPTER_EVENTS.ADAPTER_DATA_UPDATED]: (data: IAdapterDataEvent) => void;
  [ADAPTER_EVENTS.CACHE_CLEAR]: () => void;
};

export abstract class BaseAdapter<T> extends SafeEventEmitter<AdapterEvents> implements IAdapter<T> {
  public adapterData?: unknown = {};

  public sessionTime = 86400;

  public clientId: string;

  public web3AuthNetwork: WEB3AUTH_NETWORK_TYPE = WEB3AUTH_NETWORK.MAINNET;

  public useCoreKitKey: boolean = undefined;

  protected rehydrated = false;

  // should be added in constructor or from setAdapterSettings function
  // before calling init function.
  protected chainConfig: CustomChainConfig | null = null;

  protected knownChainConfigs: Record<CustomChainConfig["chainId"], CustomChainConfig> = {};

  public abstract adapterNamespace: AdapterNamespaceType;

  public abstract currentChainNamespace: ChainNamespaceType;

  public abstract type: ADAPTER_CATEGORY_TYPE;

  public abstract name: string;

  public abstract status: ADAPTER_STATUS_TYPE;

  constructor(options: BaseAdapterSettings = {}) {
    super();
    this.setAdapterSettings(options);
  }

  get chainConfigProxy(): CustomChainConfig | null {
    return this.chainConfig ? { ...this.chainConfig } : null;
  }

  get connnected(): boolean {
    return this.status === ADAPTER_STATUS.CONNECTED;
  }

  public abstract get provider(): IProvider | null;

  public setAdapterSettings(options: BaseAdapterSettings): void {
    if (this.status === ADAPTER_STATUS.READY) return;
    if (options?.sessionTime) {
      this.sessionTime = options.sessionTime;
    }
    if (options?.clientId) {
      this.clientId = options.clientId;
    }
    if (options?.web3AuthNetwork) {
      this.web3AuthNetwork = options.web3AuthNetwork;
    }
    if (options?.useCoreKitKey !== undefined) {
      this.useCoreKitKey = options.useCoreKitKey;
    }
    const customChainConfig = options.chainConfig;
    if (customChainConfig) {
      if (!customChainConfig.chainNamespace) throw WalletInitializationError.notReady("ChainNamespace is required while setting chainConfig");
      this.currentChainNamespace = customChainConfig.chainNamespace;
      // chainId is optional in this function.
      // we go with mainnet chainId by default.
      const defaultChainConfig = getChainConfig(customChainConfig.chainNamespace, customChainConfig.chainId);
      // NOTE: It is being forced casted to CustomChainConfig to handle OTHER Chainnamespace
      // where chainConfig is not required.
      const finalChainConfig = { ...(defaultChainConfig || {}), ...customChainConfig } as CustomChainConfig;

      this.chainConfig = finalChainConfig;
      this.addChainConfig(finalChainConfig);
    }
  }

  checkConnectionRequirements(): void {
    // we reconnect without killing existing wallet connect session on calling connect again.
    if (this.name === WALLET_ADAPTERS.WALLET_CONNECT_V2 && this.status === ADAPTER_STATUS.CONNECTING) return;
    else if (this.status === ADAPTER_STATUS.CONNECTING) throw WalletInitializationError.notReady("Already connecting");

    if (this.status === ADAPTER_STATUS.CONNECTED) throw WalletLoginError.connectionError("Already connected");
    if (this.status !== ADAPTER_STATUS.READY)
      throw WalletLoginError.connectionError(
        "Wallet adapter is not ready yet, Please wait for init function to resolve before calling connect/connectTo function"
      );
  }

  checkInitializationRequirements(): void {
    if (!this.clientId) throw WalletInitializationError.invalidParams("Please initialize Web3Auth with a valid clientId in constructor");
    if (!this.chainConfig) throw WalletInitializationError.invalidParams("rpcTarget is required in chainConfig");
    if (!this.chainConfig.rpcTarget && this.chainConfig.chainNamespace !== CHAIN_NAMESPACES.OTHER) {
      throw WalletInitializationError.invalidParams("rpcTarget is required in chainConfig");
    }

    if (!this.chainConfig.chainId && this.chainConfig.chainNamespace !== CHAIN_NAMESPACES.OTHER) {
      throw WalletInitializationError.invalidParams("chainID is required in chainConfig");
    }
    if (this.status === ADAPTER_STATUS.NOT_READY) return;
    if (this.status === ADAPTER_STATUS.CONNECTED) throw WalletInitializationError.notReady("Already connected");
    if (this.status === ADAPTER_STATUS.READY) throw WalletInitializationError.notReady("Adapter is already initialized");
  }

  checkDisconnectionRequirements(): void {
    if (this.status !== ADAPTER_STATUS.CONNECTED) throw WalletLoginError.disconnectionError("Not connected with wallet");
  }

  checkAddChainRequirements(chainConfig: CustomChainConfig, init = false): void {
    if (!init && !this.provider) throw WalletLoginError.notConnectedError("Not connected with wallet.");
    if (this.currentChainNamespace !== chainConfig.chainNamespace) {
      throw WalletOperationsError.chainNamespaceNotAllowed("This adapter doesn't support this chainNamespace");
    }
  }

  checkSwitchChainRequirements({ chainId }: { chainId: string }, init = false): void {
    if (!init && !this.provider) throw WalletLoginError.notConnectedError("Not connected with wallet.");
    if (!this.knownChainConfigs[chainId]) throw WalletLoginError.chainConfigNotAdded("Invalid chainId");
  }

  updateAdapterData(data: unknown): void {
    this.adapterData = data;
    this.emit(ADAPTER_EVENTS.ADAPTER_DATA_UPDATED, { adapterName: this.name, data });
  }

  protected addChainConfig(chainConfig: CustomChainConfig): void {
    const currentConfig = this.knownChainConfigs[chainConfig.chainId];
    this.knownChainConfigs[chainConfig.chainId] = {
      ...(currentConfig || {}),
      ...chainConfig,
    };
  }

  protected getChainConfig(chainId: string): CustomChainConfig | null {
    return this.knownChainConfigs[chainId] || null;
  }

  abstract init(options?: AdapterInitOptions): Promise<void>;
  abstract connect(params?: T): Promise<IProvider | null>;
  abstract disconnect(): Promise<void>;
  abstract getUserInfo(): Promise<Partial<UserInfo>>;
  abstract enableMFA(params?: T): Promise<void>;
  abstract authenticateUser(): Promise<UserAuthInfo>;
  abstract addChain(chainConfig: CustomChainConfig): Promise<void>;
  abstract switchChain(params: { chainId: string }): Promise<void>;
}

export interface BaseAdapterConfig {
  label: string;
  isInjected?: boolean;
  showOnModal?: boolean;
  showOnMobile?: boolean;
  showOnDesktop?: boolean;
}

export type LoginMethodConfig = Record<
  string,
  {
    /**
     * Display Name. If not provided, we use the default for auth app
     */
    name: string;
    /**
     * Description for button. If provided, it renders as a full length button. else, icon button
     */
    description?: string;
    /**
     * Logo to be shown on mouse hover. If not provided, we use the default for auth app
     */
    logoHover?: string;
    /**
     * Logo to be shown on dark background (dark theme). If not provided, we use the default for auth app
     */
    logoLight?: string;
    /**
     * Logo to be shown on light background (light theme). If not provided, we use the default for auth app
     */
    logoDark?: string;
    /**
     * Show login button on the main list
     */
    mainOption?: boolean;
    /**
     * Whether to show the login button on modal or not
     */
    showOnModal?: boolean;
    /**
     * Whether to show the login button on desktop
     */
    showOnDesktop?: boolean;
    /**
     * Whether to show the login button on mobile
     */
    showOnMobile?: boolean;
  }
>;

export type WalletConnectV2Data = {
  uri: string;
};
