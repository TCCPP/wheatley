import { assert, expect } from "chai";

import { diff_to_human, string_split } from "../src/utils.js";

describe("Diff to Human Tests", () => {
    it("should compute the right values for sub-minute diffs", done => {
        expect(diff_to_human(5500)).to.equal("5.5 seconds");
        expect(diff_to_human(1000)).to.equal("1 second");
        done();
    });

    it("should compute the right values for sub-hours diffs", done => {
        expect(diff_to_human(60_000 + 5500)).to.equal("1 minute 5.5 seconds");
        expect(diff_to_human(2 * 60_000 + 10_000)).to.equal("2 minutes 10 seconds");
        done();
    });

    it("should compute the right values for >hour diffs", done => {
        expect(diff_to_human(61 * 60_000 + 5700)).to.equal("1 hour 1 minute 6 seconds");
        expect(diff_to_human(135 * 60_000 + 10_000)).to.equal("2 hours 15 minutes 10 seconds");
        done();
    });
});

describe("Limited string split tests", () => {
    it("should split below the limit", done => {
        expect(string_split("", " ", 2)).to.deep.equal([""]);
        expect(string_split("hello", " ", 2)).to.deep.equal(["hello"]);
        done();
    });
    it("should split the limit", done => {
        expect(string_split("hello there", " ", 2)).to.deep.equal(["hello", "there"]);
        done();
    });
    it("should split above the limit", done => {
        expect(string_split("hello there general kenobi", " ", 2)).to.deep.equal(["hello", "there general kenobi"]);
        done();
    });
});
