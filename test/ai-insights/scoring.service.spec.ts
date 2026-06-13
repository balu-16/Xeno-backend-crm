import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ScoringService } from "../../src/ai-insights/scoring.service";

describe("ScoringService", () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  describe("calculatePriorityScore", () => {
    it("priority score equals impact multiplied by confidence", () => {
      const score = service.calculatePriorityScore(0.8, 0.9);
      expect(score).toBeCloseTo(0.72, 2);

      const score2 = service.calculatePriorityScore(0.5, 0.6);
      expect(score2).toBeCloseTo(0.3, 2);
    });

    it("scores are always in the 0.0 to 1.0 range", () => {
      // Both inputs max at 1.0
      const maxScore = service.calculatePriorityScore(1.0, 1.0);
      expect(maxScore).toBe(1.0);

      // Minimum
      const minScore = service.calculatePriorityScore(0.0, 0.0);
      expect(minScore).toBe(0.0);

      // Various mid-range values
      const midScore = service.calculatePriorityScore(0.5, 0.5);
      expect(midScore).toBeGreaterThanOrEqual(0);
      expect(midScore).toBeLessThanOrEqual(1);
    });

    it("returns zero when impact or confidence is zero", () => {
      const zeroImpact = service.calculatePriorityScore(0, 0.9);
      expect(zeroImpact).toBe(0);

      const zeroConfidence = service.calculatePriorityScore(0.8, 0);
      expect(zeroConfidence).toBe(0);

      const bothZero = service.calculatePriorityScore(0, 0);
      expect(bothZero).toBe(0);
    });
  });

  describe("priorityFromScore", () => {
    it("maps priority labels correctly: CRITICAL/HIGH/MEDIUM/LOW", () => {
      expect(service.priorityFromScore(0.95)).toBe("CRITICAL");
      expect(service.priorityFromScore(0.8)).toBe("CRITICAL");
      expect(service.priorityFromScore(0.79)).toBe("HIGH");
      expect(service.priorityFromScore(0.6)).toBe("HIGH");
      expect(service.priorityFromScore(0.59)).toBe("MEDIUM");
      expect(service.priorityFromScore(0.4)).toBe("MEDIUM");
      expect(service.priorityFromScore(0.39)).toBe("LOW");
      expect(service.priorityFromScore(0.0)).toBe("LOW");
    });
  });

  describe("calculateConfidenceScore", () => {
    it("returns weighted average of data freshness, sample size, and trend consistency", () => {
      // weights: freshness=0.4, sample=0.3, consistency=0.3
      const score = service.calculateConfidenceScore(1.0, 1.0, 1.0);
      expect(score).toBe(1.0);

      const score2 = service.calculateConfidenceScore(0.8, 0.6, 0.7);
      // 0.8*0.4 + 0.6*0.3 + 0.7*0.3 = 0.32 + 0.18 + 0.21 = 0.71
      expect(score2).toBeCloseTo(0.71, 2);
    });

    it("returns zero when all factors are zero", () => {
      const score = service.calculateConfidenceScore(0, 0, 0);
      expect(score).toBe(0);
    });
  });

  describe("calculateImpactScore", () => {
    it("returns ratio of revenue impact to max revenue, capped at 1.0", () => {
      expect(service.calculateImpactScore(5000, 10000)).toBeCloseTo(0.5, 2);
      expect(service.calculateImpactScore(15000, 10000)).toBe(1.0);
      expect(service.calculateImpactScore(0, 10000)).toBe(0);
    });

    it("returns zero when maxRevenue is zero or negative", () => {
      expect(service.calculateImpactScore(5000, 0)).toBe(0);
      expect(service.calculateImpactScore(5000, -100)).toBe(0);
    });
  });
});
