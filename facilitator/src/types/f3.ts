/**
 * F3 (Fast Finality) Types
 * Based on Filecoin's GossiPBFT consensus
 */

// F3 consensus phases
export enum F3Phase {
  QUALITY = 0,
  CONVERGE = 1,
  PREPARE = 2,
  COMMIT = 3,
  DECIDE = 4,
}

export const F3PhaseNames: Record<F3Phase, string> = {
  [F3Phase.QUALITY]: 'QUALITY',
  [F3Phase.CONVERGE]: 'CONVERGE',
  [F3Phase.PREPARE]: 'PREPARE',
  [F3Phase.COMMIT]: 'COMMIT',
  [F3Phase.DECIDE]: 'DECIDE',
};

// F3 progress from F3GetProgress()
export interface F3Progress {
  // Current F3 instance number
  ID: number;
  // Current round within the instance
  Round: number;
  // Current phase (0-4)
  Phase: F3Phase;
}

// F3 manifest from F3GetManifest()
export interface F3Manifest {
  NetworkName: string;
  BootstrapEpoch: number;
  InitialInstance: number;
  // Other fields we may need
}

// F3 certificate from F3GetCertificate()
export interface F3Certificate {
  // The instance this certificate is for
  GPBFTInstance: number;
  // The finalized tipset key
  ECChain: F3TipSetKey[];
  // Supplemental data
  SupplementalData: {
    Commitments: number[];
    PowerTable: string;
  };
}

// Tipset key reference
export interface F3TipSetKey {
  Epoch: number;
  Key: string[];
  Commitments: number[];
  PowerTable: string;
}

// Confirmation levels for payments
export enum ConfirmationLevel {
  // Payment in mempool, not yet in block
  L0_MEMPOOL = 'L0',
  // Payment included in EC block
  L1_INCLUDED = 'L1',
  // FCR safe heuristic passed (COMMIT or PREPARE+Round0+5s)
  L2_FCR_SAFE = 'L2',
  // Full F3 certificate issued
  L3_FINALIZED = 'L3',
  // Facilitator bond backstop (for failed settlements)
  LB_BOND = 'LB',
}

export interface ConfirmationStatus {
  level: ConfirmationLevel;
  instance?: number;
  round?: number;
  phase?: F3Phase;
  certificateId?: number;
  timestamp: number;
}

// F3 instance state tracking
export interface F3InstanceState {
  instance: number;
  round: number;
  phase: F3Phase;
  phaseStartTime: number;
  roundBumps: number; // Count of round increases (warning signal)
}
