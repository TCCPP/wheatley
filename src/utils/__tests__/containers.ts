import { describe, expect, beforeEach, afterEach, vi, it } from "vitest";
import { SelfClearingMap, SelfClearingSet, force_clear_containers } from "../containers.js";
import * as p_timers from "node:timers/promises";

import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";

/**
 * Ensure we garbage collect the maps between tests, otherwise we might get false failures
 */
let gc: () => void = global.gc as unknown as () => void;
if (!(gc as unknown as boolean)) {
    setFlagsFromString("--expose_gc");
    gc = runInNewContext("gc"); // nocommit
}

async function moveForwardBy(time: number) {
    return await vi.advanceTimersByTimeAsync(time);
}

describe.sequential("SelfClearingMap", () => {
    beforeEach(() => {
        // tell vitest we use mocked timers
        vi.useFakeTimers({ toFake: ["nextTick", "setTimeout", "setImmediate", "Date", "setInterval"] });
        vi.setSystemTime(0);
    });
    afterEach(async () => {
        await force_clear_containers();
        await p_timers.setImmediate();
        await force_clear_containers();
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

    it.sequential("Should call the on_remove callback", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        const on_remove = vi.fn();
        map.on_remove = on_remove;

        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);

        expect(map.has("a")).to.equal(true);
        expect(on_remove).not.toHaveBeenCalled();

        await moveForwardBy(1002);

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

    it.sequential("Should compute the correct time to the next sweep", async () => {
        const map = new SelfClearingMap<string, number>(1000);

        vi.setSystemTime(500);
        expect(map.next_interval()).to.equal(500);

        vi.setSystemTime(995);
        expect(map.next_interval()).to.equal(1005);

        vi.setSystemTime(1000);
        expect(map.next_interval()).to.equal(1000);
    });

    it.sequential("Should decide whether to run the sweep correctly", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        await vi.advanceTimersToNextTimerAsync();

        vi.setSystemTime(500);
        expect(map.should_run()).to.equal(false);

        vi.setSystemTime(1000);
        expect(map.should_run()).to.equal(true);

        vi.setSystemTime(1001);
        expect(map.should_run()).to.equal(true);

        vi.setSystemTime(995);
        expect(map.should_run()).to.equal(false);

        vi.setSystemTime(1995);
        expect(map.should_run()).to.equal(true);
        map.sweep();

        vi.setSystemTime(2000);
        expect(map.should_run()).to.equal(false);
    });
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

    it.sequential.only("Should call the on_remove callback", async () => {
        const on_remove = vi.fn();
        const set = new SelfClearingSet<string>(1000, 1000, on_remove);

        await vi.advanceTimersToNextTimerAsync();
        set.insert("a");

        expect(set.has("a")).to.equal(true);
        expect(on_remove).not.toHaveBeenCalled();

        await moveForwardBy(1002);

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

    it.sequential("Should compute the correct time to the next sweep", async () => {
        const set = new SelfClearingSet<string>(1000);

        vi.setSystemTime(500);
        expect(set.next_interval()).to.equal(500);

        vi.setSystemTime(995);
        expect(set.next_interval()).to.equal(1005);

        vi.setSystemTime(1000);
        expect(set.next_interval()).to.equal(1000);
    });

    it.sequential("Should decide whether to run the sweep correctly", async () => {
        const set = new SelfClearingSet<string>(1000);
        await vi.advanceTimersToNextTimerAsync();

        vi.setSystemTime(500);
        expect(set.should_run()).to.equal(false);

        vi.setSystemTime(1000);
        expect(set.should_run()).to.equal(true);

        vi.setSystemTime(1001);
        expect(set.should_run()).to.equal(true);

        vi.setSystemTime(995);
        expect(set.should_run()).to.equal(false);

        vi.setSystemTime(1995);
        expect(set.should_run()).to.equal(true);
        set.sweep();

        vi.setSystemTime(2000);
        expect(set.should_run()).to.equal(false);
    });
});

/**
 * TODO: Add more tests, specifically for sets and maps together
 */

describe.sequential("SelfClearingMap and SelfClearingSet", () => {
    it.sequential("should remove expired entries", async () => {
        const map = new SelfClearingMap<string, number>(1000);
        const set = new SelfClearingSet<string>(1000);

        await vi.advanceTimersToNextTimerAsync();
        map.set("a", 0);
        set.insert("a");

        expect(map.has("a")).to.equal(true);
        expect(set.has("a")).to.equal(true);

        await moveForwardBy(1000);

        expect(map.has("a")).to.equal(false);
        expect(set.has("a")).to.equal(false);
    });
});
