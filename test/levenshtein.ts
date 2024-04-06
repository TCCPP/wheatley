import { describe, expect, it } from "vitest";
import { calculate_nonlinear_substitution_cost, weighted_levenshtein_raw } from "../src/algorithm/levenshtein.js";

describe("levenshtein subst cost fn", () => {
    it("should be correct for s=1", () => {
        expect(calculate_nonlinear_substitution_cost(1)).to.deep.equal(1);
    });
    it("should be correct for s=2", () => {
        expect(calculate_nonlinear_substitution_cost(2)).to.deep.equal(3);
    });
    it("should be correct for s=3", () => {
        expect(calculate_nonlinear_substitution_cost(3)).to.deep.equal(7);
    });
});

describe("levenshtein", () => {
    it("insertion", () => {
        expect(weighted_levenshtein_raw("abd", "abcd")).to.deep.equal([1, 0]);
    });
    it("insertion at the end", () => {
        expect(weighted_levenshtein_raw("abc", "abcd")).to.deep.equal([0.1, 0]);
    });
    it("deletion", () => {
        expect(weighted_levenshtein_raw("abcd", "abc")).to.deep.equal([1, 0]);
    });
    it("basic substitution", () => {
        expect(weighted_levenshtein_raw("cat", "bat")).to.deep.equal([1, 1]);
    });
    it("1 substitution", () => {
        expect(weighted_levenshtein_raw("Saturday", "Zaturday")).to.deep.equal([1, 1]);
    });
    it("2 substitutions", () => {
        expect(weighted_levenshtein_raw("Saturday", "Zazurday")).to.deep.equal([3, 2]);
    });
    it("3 substitutions", () => {
        expect(weighted_levenshtein_raw("Saturday", "Zazurbay")).to.deep.equal([7, 3]);
    });
    it("Mixed 1 substitution", () => {
        expect(weighted_levenshtein_raw("Sunday", "Saturday")).to.deep.equal([3, 1]);
    });
    it("Mixed 2 substitution", () => {
        expect(weighted_levenshtein_raw("Sunday", "Saturdaz")).to.deep.equal([5, 2]);
    });
});
