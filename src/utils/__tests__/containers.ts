import { describe, expect, beforeEach, vi, it } from "vitest";
import { SelfClearingMap, SelfClearingSet } from "../containers.js";

import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";
import { afterEach } from "node:test";

/**
 * Ensure we garbage collect the maps between tests, otherwise we might get false failures
 */
let gc: () => void = global.gc as unknown as () => void;
if (!(gc as unknown as boolean)) {
    setFlagsFromString("--expose_gc");
    gc = runInNewContext("gc"); // nocommit
}

async function moveForwardBy(time: number) {
    vi.setSystemTime(vi.getMockedSystemTime()?.getTime() || 0 + time);
    return vi.advanceTimersByTimeAsync(time);
}

describe.sequential("SelfClearingMap", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers({ toFake: ["nextTick", "setTimeout", "setImmediate", "Date"] });
        vi.setSystemTime(0);
    });
    afterEach(() => {
        gc();
        vi.runOnlyPendingTimers();
        gc();
        vi.runOnlyPendingTimers();
        gc();
        vi.clearAllTimers();
        gc();
    });

    it.sequential("should remove expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);

        expect(map.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(map.has("a")).to.equal(false);
    });

    it.sequential("should not remove non-expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);
        expect(map.has("a")).to.equal(true);

        await moveForwardBy(500);

        expect(map.has("a")).to.equal(true);
    });

    it.sequential("should not remove non-expired entries", async () => {
        const map = new SelfClearingMap<string, number>(2000, 1000);
        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);
        expect(map.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(map.has("a")).to.equal(true);
    });

    /**
     * TODO: Add more tests, specifically for the timer logic and multiple maps
     */
});

describe.sequential("SelfClearingSet", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers({ toFake: ["nextTick", "setTimeout", "setImmediate", "Date"] });
        vi.setSystemTime(0);
    });
    afterEach(() => {
        gc();
        vi.runOnlyPendingTimers();
        gc();
        vi.runOnlyPendingTimers();
        gc();
        vi.clearAllTimers();
        gc();
    });

    it.sequential("should remove expired entries", async () => {
        const set = new SelfClearingSet<string>(1000);
        await vi.advanceTimersToNextTimerAsync();
        set.insert("a");

        expect(set.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(set.has("a")).to.equal(false);
    });

    it.sequential("shouldn't remove unexpired entries", async () => {
        const set = new SelfClearingSet<string>(1000);
        await vi.advanceTimersToNextTimerAsync();
        set.insert("a");

        expect(set.has("a")).to.equal(true);

        await moveForwardBy(500);

        expect(set.has("a")).to.equal(true);
    });

    it.sequential("shouldn't remove unexpired entries", async () => {
        const set = new SelfClearingSet<string>(2000, 1000);
        await vi.advanceTimersToNextTimerAsync();
        set.insert("a");

        expect(set.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(set.has("a")).to.equal(true);
    });

    /**
     * TODO: Add more tests, specifically for the timer logic and multiple sets
     */
});

/**
 * TODO: Add more tests, specifically for sets and maps together
 */
