import type { Config } from '../types/config.js';
import {
  F3Phase,
  F3PhaseNames,
  ConfirmationLevel,
  type F3Progress,
  type F3Manifest,
  type F3Certificate,
  type F3InstanceState,
  type ConfirmationStatus,
} from '../types/f3.js';


/**
 * F3 Monitor Service
 * Polls F3GetProgress() and implements safe confirmation heuristics
 */
export class F3Service {
  private lotusEndpoint: string;
  private lotusToken?: string;

  // Current F3 state
  private currentState: F3InstanceState | null = null;
  private manifest: F3Manifest | null = null;

  // Polling state
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  // Certificate cache (instance -> certificate)
  private certificateCache: Map<number, F3Certificate> = new Map();
  private latestCertificate: F3Certificate | null = null;

  // Configuration
  private readonly POLL_INTERVAL_MS = 1000; // Poll every second
  private readonly SAFE_PREPARE_BUFFER_MS = 5000; // 5s buffer for PREPARE heuristic
  private readonly CACHE_MAX_SIZE = 100;

  constructor(config: Config) {
    this.lotusEndpoint = config.lotus.endpoint;
    this.lotusToken = config.lotus.token;
  }

  /**
   * Make a JSON-RPC call to Lotus
   */
  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.lotusToken) {
      headers['Authorization'] = `Bearer ${this.lotusToken}`;
    }

    const response = await fetch(this.lotusEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: `Filecoin.${method}`,
        params,
        id: 1,
      }),
    });

    const data = await response.json() as { error?: { message: string }; result: T };

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    return data.result;
  }

  /**
   * Get F3 manifest (called once at startup)
   */
  async getManifest(): Promise<F3Manifest> {
    return this.rpcCall<F3Manifest>('F3GetManifest');
  }

  /**
   * Get current F3 progress
   */
  async getProgress(): Promise<F3Progress> {
    return this.rpcCall<F3Progress>('F3GetProgress');
  }

  /**
   * Get F3 certificate for a specific instance
   */
  async getCertificate(instance: number): Promise<F3Certificate | null> {
    // Check cache first
    const cached = this.certificateCache.get(instance);
    if (cached) return cached;

    try {
      const cert = await this.rpcCall<F3Certificate>('F3GetCertificate', [instance]);
      if (cert) {
        this.cacheCertificate(instance, cert);
      }
      return cert;
    } catch {
      return null;
    }
  }

  /**
   * Get the latest F3 certificate
   */
  async getLatestCertificate(): Promise<F3Certificate | null> {
    try {
      const cert = await this.rpcCall<F3Certificate>('F3GetLatestCertificate');
      if (cert) {
        this.latestCertificate = cert;
        this.cacheCertificate(cert.GPBFTInstance, cert);
      }
      return cert;
    } catch {
      return null;
    }
  }

  /**
   * Cache a certificate with size limits
   */
  private cacheCertificate(instance: number, cert: F3Certificate): void {
    this.certificateCache.set(instance, cert);

    // Evict old entries if cache is too large
    if (this.certificateCache.size > this.CACHE_MAX_SIZE) {
      const oldestKey = this.certificateCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.certificateCache.delete(oldestKey);
      }
    }
  }

  /**
   * Start the F3 monitor
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting F3 monitor...');

    // Get manifest on startup
    try {
      this.manifest = await this.getManifest();
      console.log(`F3 manifest: network=${this.manifest.NetworkName}, bootstrapEpoch=${this.manifest.BootstrapEpoch}`);
    } catch (error) {
      console.warn('Failed to get F3 manifest:', error);
    }

    // Get initial state
    try {
      const progress = await this.getProgress();
      this.updateState(progress);
      console.log(`F3 initial state: instance=${progress.ID}, round=${progress.Round}, phase=${F3PhaseNames[progress.Phase]}`);
    } catch (error) {
      console.warn('Failed to get initial F3 progress:', error);
    }

    // Start polling
    this.isRunning = true;
    this.pollInterval = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
  }

  /**
   * Stop the F3 monitor
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('F3 monitor stopped');
  }

  /**
   * Poll F3 progress
   */
  private async poll(): Promise<void> {
    try {
      const progress = await this.getProgress();
      this.updateState(progress);
    } catch (error) {
      console.error('F3 poll error:', error);
    }
  }

  /**
   * Update internal state and detect transitions
   */
  private updateState(progress: F3Progress): void {
    const now = Date.now();
    const prev = this.currentState;

    // Detect instance change
    if (!prev || prev.instance !== progress.ID) {
      this.currentState = {
        instance: progress.ID,
        round: progress.Round,
        phase: progress.Phase,
        phaseStartTime: now,
        roundBumps: 0,
      };

      // New instance means previous one finalized - fetch certificate
      if (prev) {
        this.getLatestCertificate().catch(() => {});
      }
      return;
    }

    // Detect round bump (warning signal)
    if (progress.Round > prev.round) {
      this.currentState = {
        ...prev,
        round: progress.Round,
        phase: progress.Phase,
        phaseStartTime: now,
        roundBumps: prev.roundBumps + 1,
      };

      if (prev.roundBumps > 0) {
        console.warn(`F3 round bump detected: instance=${progress.ID}, round=${progress.Round}, bumps=${prev.roundBumps + 1}`);
      }
      return;
    }

    // Detect phase change
    if (progress.Phase !== prev.phase) {
      this.currentState = {
        ...prev,
        phase: progress.Phase,
        phaseStartTime: now,
      };
    }
  }

  /**
   * Check if current state satisfies L2 (FCR safe) heuristic
   *
   * Safe when:
   * - In COMMIT phase (explicit quorum reached), OR
   * - In PREPARE phase + Round 0 + 5s buffer (implicit safety)
   */
  isL2Safe(): boolean {
    if (!this.currentState) return false;

    const { phase, round, phaseStartTime } = this.currentState;

    // COMMIT phase = explicit quorum
    if (phase >= F3Phase.COMMIT) {
      return true;
    }

    // PREPARE + Round 0 + 5s buffer = safe heuristic
    if (phase === F3Phase.PREPARE && round === 0) {
      const timeInPhase = Date.now() - phaseStartTime;
      return timeInPhase >= this.SAFE_PREPARE_BUFFER_MS;
    }

    return false;
  }

  /**
   * Get confirmation status for current state
   */
  getConfirmationStatus(): ConfirmationStatus {
    if (!this.currentState) {
      return {
        level: ConfirmationLevel.L0_MEMPOOL,
        timestamp: Date.now(),
      };
    }

    const { instance, round, phase } = this.currentState;

    // Check if we have a certificate for this instance (L3)
    if (this.latestCertificate && this.latestCertificate.GPBFTInstance >= instance) {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        instance,
        round,
        phase,
        certificateId: this.latestCertificate.GPBFTInstance,
        timestamp: Date.now(),
      };
    }

    // Check L2 safe heuristic
    if (this.isL2Safe()) {
      return {
        level: ConfirmationLevel.L2_FCR_SAFE,
        instance,
        round,
        phase,
        timestamp: Date.now(),
      };
    }

    // At least L1 (included in block)
    return {
      level: ConfirmationLevel.L1_INCLUDED,
      instance,
      round,
      phase,
      timestamp: Date.now(),
    };
  }

  /**
   * Wait for a specific confirmation level
   */
  async waitForConfirmation(
    targetLevel: ConfirmationLevel,
    timeoutMs: number = 120000
  ): Promise<ConfirmationStatus> {
    const startTime = Date.now();

    const levelOrder = [
      ConfirmationLevel.L0_MEMPOOL,
      ConfirmationLevel.L1_INCLUDED,
      ConfirmationLevel.L2_FCR_SAFE,
      ConfirmationLevel.L3_FINALIZED,
    ];

    const targetIndex = levelOrder.indexOf(targetLevel);

    return new Promise((resolve, reject) => {
      const check = () => {
        const status = this.getConfirmationStatus();
        const currentIndex = levelOrder.indexOf(status.level);

        if (currentIndex >= targetIndex) {
          resolve(status);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for ${targetLevel}`));
          return;
        }

        setTimeout(check, 500);
      };

      check();
    });
  }

  /**
   * Derive which F3 instance covers a given tipset height.
   * Uses certificates and current progress — no hardcoded epoch ratios.
   */
  async getInstanceForTipset(
    tipsetHeight: number
  ): Promise<{ instance: number; status: 'pending' | 'active' | 'finalized' }> {
    // 1. Check if already finalized via latest certificate
    const latestCert = await this.getLatestCertificate();
    if (latestCert) {
      const finalizedHeight = this.getMaxHeightFromCert(latestCert);
      if (tipsetHeight <= finalizedHeight) {
        return {
          instance: latestCert.GPBFTInstance,
          status: 'finalized',
        };
      }
    }

    // 2. Get current progress
    let progress: F3Progress;
    try {
      progress = await this.getProgress();
    } catch {
      // Can't determine instance without progress
      return { instance: 0, status: 'pending' };
    }

    // 3. Check if current instance already has a certificate covering this tipset
    const currentCert = await this.getCertificate(progress.ID);
    if (currentCert) {
      const certHeight = this.getMaxHeightFromCert(currentCert);
      if (tipsetHeight <= certHeight) {
        return { instance: progress.ID, status: 'finalized' };
      }
    }

    // 4. If the latest cert's instance is past the current progress instance,
    //    the tipset must be finalized
    if (latestCert && progress.ID <= latestCert.GPBFTInstance) {
      // Walk forward from latest cert to find if a later cert covers it
      // (the latest cert fetch above already checked this, so tipset is pending)
    }

    // 5. The tipset is not yet finalized. It will be covered by the next instance
    //    after the current one (or the current one if it hasn't decided yet).
    if (currentCert) {
      // Current instance already decided, tipset is in the next one
      return { instance: progress.ID + 1, status: 'pending' };
    }

    // Current instance hasn't decided yet — it may cover this tipset
    return { instance: progress.ID, status: 'active' };
  }

  /**
   * Extract the maximum epoch from a certificate's ECChain.
   */
  private getMaxHeightFromCert(cert: F3Certificate): number {
    if (!cert.ECChain || cert.ECChain.length === 0) {
      return 0;
    }
    return Math.max(...cert.ECChain.map((ts) => ts.Epoch));
  }

  /**
   * Evaluate the confirmation level for a specific tipset height.
   * This is the per-payment version of getConfirmationStatus().
   */
  async evaluateConfirmationForTipset(
    tipsetHeight: number
  ): Promise<ConfirmationStatus> {
    if (!this.currentState) {
      return {
        level: ConfirmationLevel.L0_MEMPOOL,
        timestamp: Date.now(),
      };
    }

    // 1. Get instance mapping for this tipset
    const mapping = await this.getInstanceForTipset(tipsetHeight);

    // 2. Already finalized — L3
    if (mapping.status === 'finalized') {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        instance: mapping.instance,
        certificateId: mapping.instance,
        timestamp: Date.now(),
      };
    }

    // 3. Instance is active — evaluate current phase
    if (mapping.status === 'active' && this.currentState.instance === mapping.instance) {
      return this.evaluateActiveInstance(this.currentState);
    }

    // 4. Instance is pending (hasn't started yet) — at best L1
    return {
      level: ConfirmationLevel.L1_INCLUDED,
      instance: mapping.instance,
      timestamp: Date.now(),
    };
  }

  /**
   * Evaluate the active instance and return a typed result
   * with instance/round/phase fields populated.
   */
  private evaluateActiveInstance(
    state: F3InstanceState
  ): ConfirmationStatus {
    const { instance, round, phase, phaseStartTime } = state;

    // DECIDE or later = finalized
    if (phase >= F3Phase.DECIDE) {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        instance,
        round,
        phase,
        timestamp: Date.now(),
      };
    }

    // COMMIT = strong confidence → L2
    if (phase === F3Phase.COMMIT) {
      return {
        level: ConfirmationLevel.L2_FCR_SAFE,
        instance,
        round,
        phase,
        timestamp: Date.now(),
      };
    }

    // PREPARE + Round 0 + 5s buffer → L2
    if (phase === F3Phase.PREPARE && round === 0) {
      const timeInPhase = Date.now() - phaseStartTime;
      if (timeInPhase >= this.SAFE_PREPARE_BUFFER_MS) {
        return {
          level: ConfirmationLevel.L2_FCR_SAFE,
          instance,
          round,
          phase,
          timestamp: Date.now(),
        };
      }
    }

    // Not yet safe → L1
    return {
      level: ConfirmationLevel.L1_INCLUDED,
      instance,
      round,
      phase,
      timestamp: Date.now(),
    };
  }

  /**
   * Get current F3 state (for health checks)
   */
  getCurrentState(): F3InstanceState | null {
    return this.currentState;
  }

  /**
   * Check if F3 is running
   */
  isF3Running(): boolean {
    return this.currentState !== null;
  }

}
