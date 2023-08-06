import { assert, expect } from "chai";
import { calculate_nonlinear_substitution_cost, weighted_levenshtein_raw } from "../src/algorithm/levenshtein.js";

describe("levenshtein subst cost fn", () => {
    it("should be correct for s=1", done => {
        expect(calculate_nonlinear_substitution_cost(1)).to.deep.equal(1);
        done();
    });
    it("should be correct for s=2", done => {
        expect(calculate_nonlinear_substitution_cost(2)).to.deep.equal(3);
        done();
    });
    it("should be correct for s=3", done => {
        expect(calculate_nonlinear_substitution_cost(3)).to.deep.equal(7);
        done();
    });
});

describe("levenshtein", () => {
    it("insertion", done => {
        expect(weighted_levenshtein_raw("abd", "abcd")).to.deep.equal([1, 0]);
        done();
    });
    it("insertion at the end", done => {
        expect(weighted_levenshtein_raw("abc", "abcd")).to.deep.equal([0.1, 0]);
        done();
    });
    it("deletion", done => {
        expect(weighted_levenshtein_raw("abcd", "abc")).to.deep.equal([1, 0]);
        done();
    });
    it("basic substitution", done => {
        expect(weighted_levenshtein_raw("cat", "bat")).to.deep.equal([1, 1]);
        done();
    });
    it("1 substitution", done => {
        expect(weighted_levenshtein_raw("Saturday", "Zaturday")).to.deep.equal([1, 1]);
        done();
    });
    it("2 substitutions", done => {
        expect(weighted_levenshtein_raw("Saturday", "Zazurday")).to.deep.equal([3, 2]);
        done();
    });
    it("3 substitutions", done => {
        expect(weighted_levenshtein_raw("Saturday", "Zazurbay")).to.deep.equal([7, 3]);
        done();
    });
    it("Mixed 1 substitution", done => {
        expect(weighted_levenshtein_raw("Sunday", "Saturday")).to.deep.equal([3, 1]);
        done();
    });
    it("Mixed 2 substitution", done => {
        expect(weighted_levenshtein_raw("Sunday", "Saturdaz")).to.deep.equal([5, 2]);
        done();
    });
});
