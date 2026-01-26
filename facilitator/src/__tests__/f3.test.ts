import { describe, it, expect, beforeEach } from 'vitest';
import {
  F3Phase,
  F3PhaseNames,
  ConfirmationLevel,
  type F3InstanceState,
} from '../types/f3.js';

describe('F3 Types', () => {
  describe('F3Phase', () => {
    it('should have correct phase values', () => {
      expect(F3Phase.QUALITY).toBe(0);
      expect(F3Phase.CONVERGE).toBe(1);
      expect(F3Phase.PREPARE).toBe(2);
      expect(F3Phase.COMMIT).toBe(3);
      expect(F3Phase.DECIDE).toBe(4);
    });

    it('should have correct phase names', () => {
      expect(F3PhaseNames[F3Phase.QUALITY]).toBe('QUALITY');
      expect(F3PhaseNames[F3Phase.CONVERGE]).toBe('CONVERGE');
      expect(F3PhaseNames[F3Phase.PREPARE]).toBe('PREPARE');
      expect(F3PhaseNames[F3Phase.COMMIT]).toBe('COMMIT');
      expect(F3PhaseNames[F3Phase.DECIDE]).toBe('DECIDE');
    });
  });

  describe('ConfirmationLevel', () => {
    it('should have correct level codes', () => {
      expect(ConfirmationLevel.L0_MEMPOOL).toBe('L0');
      expect(ConfirmationLevel.L1_INCLUDED).toBe('L1');
      expect(ConfirmationLevel.L2_FCR_SAFE).toBe('L2');
      expect(ConfirmationLevel.L3_FINALIZED).toBe('L3');
      expect(ConfirmationLevel.LB_BOND).toBe('LB');
    });
  });
});

describe('L2 Safe Heuristic Logic', () => {
  // Test the heuristic logic directly without the service
  function isL2Safe(state: F3InstanceState, safeBufferMs: number = 5000): boolean {
    const { phase, round, phaseStartTime } = state;

    // COMMIT phase = explicit quorum
    if (phase >= F3Phase.COMMIT) {
      return true;
    }

    // PREPARE + Round 0 + buffer = safe heuristic
    if (phase === F3Phase.PREPARE && round === 0) {
      const timeInPhase = Date.now() - phaseStartTime;
      return timeInPhase >= safeBufferMs;
    }

    return false;
  }

  it('should return true when in COMMIT phase', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.COMMIT,
      phaseStartTime: Date.now(),
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(true);
  });

  it('should return true when in DECIDE phase', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.DECIDE,
      phaseStartTime: Date.now(),
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(true);
  });

  it('should return false when in QUALITY phase', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.QUALITY,
      phaseStartTime: Date.now() - 10000, // 10s ago
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(false);
  });

  it('should return false when in CONVERGE phase', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.CONVERGE,
      phaseStartTime: Date.now() - 10000,
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(false);
  });

  it('should return true when in PREPARE + Round 0 + buffer elapsed', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.PREPARE,
      phaseStartTime: Date.now() - 6000, // 6s ago (> 5s buffer)
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(true);
  });

  it('should return false when in PREPARE + Round 0 but buffer not elapsed', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 0,
      phase: F3Phase.PREPARE,
      phaseStartTime: Date.now() - 2000, // Only 2s ago
      roundBumps: 0,
    };

    expect(isL2Safe(state)).toBe(false);
  });

  it('should return false when in PREPARE but Round > 0', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 1, // Round bump happened
      phase: F3Phase.PREPARE,
      phaseStartTime: Date.now() - 10000,
      roundBumps: 1,
    };

    expect(isL2Safe(state)).toBe(false);
  });

  it('should return false when in PREPARE + Round 2', () => {
    const state: F3InstanceState = {
      instance: 100,
      round: 2,
      phase: F3Phase.PREPARE,
      phaseStartTime: Date.now() - 10000,
      roundBumps: 2,
    };

    expect(isL2Safe(state)).toBe(false);
  });
});
