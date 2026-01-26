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
