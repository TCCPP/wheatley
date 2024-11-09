import { describe, expect, it } from "vitest";

import { parse_out, string_split } from "../src/utils/strings.js";
import { time_to_human } from "../src/utils/strings.js";

describe("Diff to Human Tests", () => {
    it("should compute the right values for sub-minute diffs", () => {
        expect(time_to_human(5500)).to.equal("5.5 seconds");
        expect(time_to_human(1000)).to.equal("1 second");
    });

    it("should compute the right values for sub-hours diffs", () => {
        expect(time_to_human(60_000 + 5500)).to.equal("1 minute 5.5 seconds");
        expect(time_to_human(2 * 60_000 + 10_000)).to.equal("2 minutes 10 seconds");
    });

    it("should compute the right values for >hour diffs", () => {
        expect(time_to_human(61 * 60_000 + 5700)).to.equal("1 hour 1 minute 6 seconds");
        expect(time_to_human(135 * 60_000 + 10_000)).to.equal("2 hours 15 minutes 10 seconds");
    });
});

describe("Limited string split tests", () => {
    it("should split below the limit", () => {
        expect(string_split("", " ", 2)).to.deep.equal([""]);
        expect(string_split("hello", " ", 2)).to.deep.equal(["hello"]);
    });
    it("should split the limit", () => {
        expect(string_split("hello there", " ", 2)).to.deep.equal(["hello", "there"]);
    });
    it("should split above the limit", () => {
        expect(string_split("hello there general kenobi", " ", 2)).to.deep.equal(["hello", "there general kenobi"]);
    });
});

describe("parse_out tests", () => {
    it("should remove inline code", () => {
        expect(parse_out("foo `foo` asdf")).to.deep.equal("foo  asdf");
        expect(parse_out("foo `foo`asdf")).to.deep.equal("foo asdf");
        expect(parse_out("foo `foo` `bar` asdf")).to.deep.equal("foo   asdf");
        // todo: `foo``bar`
    });
    it("should remove code blocks", () => {
        expect(parse_out("foo ```bar``` baz `foo` asdf")).to.deep.equal("foo  baz  asdf");
    });
    it("should remove mixed", () => {
        expect(parse_out("foo ```bar``` baz `foo` asdf")).to.deep.equal("foo  baz  asdf");
    });
    it("should handle single ticks within other codeblocks", () => {
        // this works, not for the right reasons but it does
        expect(parse_out("foo ```bar `x` bazzz``` baz")).to.deep.equal("foo  baz");
    });
});
