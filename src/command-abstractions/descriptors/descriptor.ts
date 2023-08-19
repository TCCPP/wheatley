export class BotCommand<Args extends unknown[] = []> {
    constructor(
        public readonly name: string,
        public readonly handler: (...args: Args) => any,
    ) {}
}
