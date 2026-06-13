import { describe, expect, it } from "vitest";
import { ConfidenceService } from "../../src/ai-insights/confidence.service";

describe("ConfidenceService", () => {
  const service = new ConfidenceService();

  describe("buildFactors", () => {
    it("generates factors with correct weights proportional to input values", () => {
      const factors = service.buildFactors(0.8, 0.6, 0.4, 0.2);

      expect(factors).toHaveLength(4);

      const freshnessFactor = factors.find((f) => f.factor === "data_freshness");
      const sampleFactor = factors.find((f) => f.factor === "sample_size");
      const trendFactor = factors.find((f) => f.factor === "trend_consistency");
      const accuracyFactor = factors.find((f) => f.factor === "historical_accuracy");

      expect(freshnessFactor).toBeDefined();
      expect(sampleFactor).toBeDefined();
      expect(trendFactor).toBeDefined();
      expect(accuracyFactor).toBeDefined();

      // Higher input value should produce higher normalized weight
      expect(freshnessFactor!.weight).toBeGreaterThan(sampleFactor!.weight);
      expect(sampleFactor!.weight).toBeGreaterThan(trendFactor!.weight);
      expect(trendFactor!.weight).toBeGreaterThan(accuracyFactor!.weight);
    });

    it("normalizes weights so they sum to exactly 1.0", () => {
      const factors = service.buildFactors(0.7, 0.3, 0.5, 0.9);

      const sum = factors.reduce((s, f) => s + f.weight, 0);
      // Rounding adjustment ensures exact 1.0
      expect(Math.round(sum * 100) / 100).toBe(1.0);
    });

    it("assigns positive direction for weights >= 0.5 and negative for weights < 0.5", () => {
      // With values [0.9, 0.1, 0.1, 0.1], data_freshness should dominate
      // total = 1.2, data_freshness normalized = 0.9/1.2 = 0.75 (positive)
      // others normalized = 0.1/1.2 = 0.08 (negative)
      const factors = service.buildFactors(0.9, 0.1, 0.1, 0.1);

      const freshnessFactor = factors.find((f) => f.factor === "data_freshness")!;
      const sampleFactor = factors.find((f) => f.factor === "sample_size")!;

      expect(freshnessFactor.direction).toBe("positive");
      expect(sampleFactor.direction).toBe("negative");
    });

    it("handles single-factor confidence when all other weights are zero", () => {
      // Only data_freshness has a value
      const factors = service.buildFactors(1.0, 0, 0, 0);

      expect(factors).toHaveLength(4);

      const freshnessFactor = factors.find((f) => f.factor === "data_freshness")!;
      expect(freshnessFactor.weight).toBe(1.0);
      expect(freshnessFactor.direction).toBe("positive");

      // All others should be 0
      const others = factors.filter((f) => f.factor !== "data_freshness");
      for (const f of others) {
        expect(f.weight).toBe(0);
        expect(f.direction).toBe("negative");
      }

      // Sum must still be 1.0
      const sum = factors.reduce((s, f) => s + f.weight, 0);
      expect(Math.round(sum * 100) / 100).toBe(1.0);
    });

    it("returns equal distribution when all weights are zero", () => {
      const factors = service.buildFactors(0, 0, 0, 0);

      expect(factors).toHaveLength(4);
      for (const f of factors) {
        expect(f.weight).toBe(0.25);
        expect(f.direction).toBe("positive");
      }
    });
  });

  describe("explainConfidence", () => {
    it("returns HIGH level for scores >= 0.8", () => {
      const result = service.explainConfidence({
        confidenceScore: 0.85,
        confidenceFactors: [
          { factor: "data_freshness", weight: 0.5, direction: "positive" },
          { factor: "sample_size", weight: 0.5, direction: "positive" },
        ],
        type: "REVENUE",
        details: {},
      });

      expect(result.score).toBe(0.85);
      expect(result.level).toBe("HIGH");
      expect(result.explanation).toContain("high confidence");
    });

    it("returns MEDIUM level for scores between 0.6 and 0.8", () => {
      const result = service.explainConfidence({
        confidenceScore: 0.65,
        confidenceFactors: [],
        type: "CHURN",
        details: {},
      });

      expect(result.level).toBe("MEDIUM");
      expect(result.explanation).toContain("medium confidence");
    });
  });
});
