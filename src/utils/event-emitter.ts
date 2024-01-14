import { unwrap } from "./misc.js";

// Very minimal interface and implementation for a typed EventEmitter
export class TypedEventEmitter<EventMap extends { [x: string]: (...args: any[]) => void }> {
    listeners: {
        [x in keyof EventMap]?: ((...args: any[]) => void)[];
    } = {};

    on<E extends keyof EventMap>(event: E, listener: EventMap[E]) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        unwrap(this.listeners[event]).push(listener);
    }

    off<E extends keyof EventMap>(event: E, listener: EventMap[E]) {
        if (this.listeners[event]) {
            this.listeners[event] = unwrap(this.listeners[event]).filter(callback => callback !== listener);
        }
    }

    emit<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>) {
        if (this.listeners[event]) {
            for (const listener of unwrap(this.listeners[event])) {
                listener(...args);
            }
        }
    }
}
