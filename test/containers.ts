import { describe, expect, beforeEach, afterEach, vi, it } from "vitest";
import { SelfClearingMap, SelfClearingSet } from "../src/utils/containers.js";

import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";

/**
 * Ensure we garbage collect the maps between tests, otherwise we might get false failures
 */
let gc: () => void = global.gc as unknown as () => void;
if (!(gc as unknown as boolean)) {
    setFlagsFromString("--expose_gc");
    gc = runInNewContext("gc");
}

async function moveForwardBy(time: number) {
    return await vi.advanceTimersByTimeAsync(time);
}

describe.sequential("SelfClearingMap", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });
    afterEach(async () => {
        gc();
        vi.runOnlyPendingTimers();
        gc();
    });

    it.sequential("should remove expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        await vi.advanceTimersToNextTimerAsync();
        vi.setSystemTime(0);
        map.set("a", 0);

        expect(map.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(map.has("a")).to.equal(false);
    });

    it.sequential("should not remove non-expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        await vi.advanceTimersToNextTimerAsync();
        vi.setSystemTime(0);
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

    it.sequential("Should call the on_remove callback", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        const on_remove = vi.fn();
        map.on_remove = on_remove;

        await vi.advanceTimersToNextTimerAsync();
        vi.setSystemTime(0);
        map.set("a", 0);

        expect(map.has("a")).to.equal(true);
        expect(on_remove).not.toHaveBeenCalled();

        await moveForwardBy(1002);
        expect(map.has("a")).to.equal(false);

        expect(on_remove).toHaveBeenCalled();
    });

    it.sequential("Should run the sweep only when needed", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        const map2 = new SelfClearingMap<string, number>(3000);
        const spy = vi.spyOn(map, "sweep");
        const spy2 = vi.spyOn(map2, "sweep");
        await vi.advanceTimersToNextTimerAsync();

        spy.mockClear();
        spy2.mockClear();
        map.set("a", 0);
        map2.set("a", 0);

        expect(spy).not.toHaveBeenCalled();
        expect(spy2).not.toHaveBeenCalled();

        await moveForwardBy(1000);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy2).not.toHaveBeenCalled();

        await moveForwardBy(2000);
        expect(spy).toBeCalledTimes(3);
        expect(spy2).toHaveBeenCalledTimes(1);
    });
});

describe.sequential("SelfClearingSet", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate", "Date"] });
        vi.setSystemTime(0);
    });
    afterEach(() => {
        gc();
        vi.runOnlyPendingTimers();
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

    it.sequential("Should call the on_remove callback", async () => {
        const on_remove = vi.fn();
        const set = new SelfClearingSet<string>(1000, 1000, on_remove);
        set.insert("a");

        expect(set.has("a")).to.equal(true);
        expect(on_remove).not.toHaveBeenCalled();

        await moveForwardBy(1000);

        expect(set.has("a")).to.equal(false);
        expect(on_remove).toHaveBeenCalled();
    });

    it.sequential("Should run the sweep only when needed", async () => {
        const set = new SelfClearingSet<string>(1000);
        const set2 = new SelfClearingSet<string>(3000);
        const spy = vi.spyOn(set, "sweep");
        const spy2 = vi.spyOn(set2, "sweep");
        await vi.advanceTimersToNextTimerAsync();

        spy.mockClear();
        spy2.mockClear();
        set.insert("a");
        set2.insert("a");

        expect(spy).not.toHaveBeenCalled();
        expect(spy2).not.toHaveBeenCalled();

        await moveForwardBy(1000);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy2).not.toHaveBeenCalled();

        await moveForwardBy(2000);
        expect(spy).toBeCalledTimes(3);
        expect(spy2).toHaveBeenCalledTimes(1);
    });
});

describe.sequential("SelfClearingMap and SelfClearingSet", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate", "Date"] });
        vi.setSystemTime(0);
    });
    afterEach(async () => {
        gc();
        vi.runOnlyPendingTimers();
        gc();
    });
    it.sequential("should remove expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        const set = new SelfClearingSet<string>(1000);

        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);
        set.insert("a");

        expect(map.has("a")).to.equal(true);
        expect(set.has("a")).to.equal(true);

        await moveForwardBy(1002);

        expect(map.has("a")).to.equal(false);
        expect(set.has("a")).to.equal(false);
    });
});
