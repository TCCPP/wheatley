import { describe, expect, it } from "vitest";

import { should_block } from "../src/components/anti-invite-links.js";

describe("invite link tests", () => {
    it("should block invite links", () => {
        expect(should_block("discord.gg/foo")).to.equal(true);
        expect(should_block("discord.com/invite/foo")).to.equal(true);
        expect(should_block("discordapp.com/invite/foo")).to.equal(true);
        expect(should_block("disboard.org/server/join/foo")).to.equal(true);
        expect(should_block("discord.me/server/join/foo")).to.equal(true);
        expect(should_block("discord.gg/f")).to.equal(true);
        expect(should_block("foobar https://discord.gg/randomserver foobar")).to.equal(true);
        expect(should_block("foobar discord.gg/randomserver foobar")).to.equal(true);
        expect(should_block("foobar discord.gg/randomserver foobar")).to.equal(true);
        expect(should_block("foobar discord.gg/T897FfR foobar")).to.equal(true);
        expect(should_block("foobar discord.GG/random foobar")).to.equal(true);
        expect(should_block("foobar discord.gg/12*(*^&^)asdggascn foobar")).to.equal(true);
        expect(should_block("discord.gg/1")).to.equal(true);
        expect(
            should_block(`
!wp
# What Is Template Instantiation?

Templates are not real entities until a piece of code uses them with arguments.
When this happens, the compiler replaces the template parameters with the
provided arguments, deriving the generic code into specific code.

The generic code needs to be available in any translation unit that uses it. This
is why templates are typically declared **and** defined entirely in headers.

<!-- inline -->
## Template function
\`\`\`cpp
template<typename T>
void print(T arg) {
    std::cout << arg << ' ';
}
\`\`\`

<!-- inline -->
## Usage
?inline
\`\`\`cpp
discord.gg/randomserver
print(42);
print("Hello");
\`\`\`

## Substitution
On the first call to \`print\`, the compiler substitutes \`T\` for \`int\` in the
template code, _instantiating_ it into a new function. The second call to \`print\`
causes \`T\` to be substituted for \`const char*\`, instantiating the template again.

Here, \`T\` is said to be _deduced_: the compiler infers \`T\` from the type of the
argument to \`print\`.

**Output:**
\`\`\`
42 Hello
\`\`\``),
        ).to.equal(true);
    });

    it("should not block normal messages", () => {
        expect(should_block("foobar")).to.equal(false);
        expect(
            should_block(`
!wp
# What Is Template Instantiation?

Templates are not real entities until a piece of code uses them with arguments.
When this happens, the compiler replaces the template parameters with the
provided arguments, deriving the generic code into specific code.

The generic code needs to be available in any translation unit that uses it. This
is why templates are typically declared **and** defined entirely in headers.

<!-- inline -->
## Template function
\`\`\`cpp
template<typename T>
void print(T arg) {
    std::cout << arg << ' ';
}
\`\`\`

<!-- inline -->
## Usage
?inline
\`\`\`cpp
print(42);
print("Hello");
\`\`\`

## Substitution
On the first call to \`print\`, the compiler substitutes \`T\` for \`int\` in the
template code, _instantiating_ it into a new function. The second call to \`print\`
causes \`T\` to be substituted for \`const char*\`, instantiating the template again.

Here, \`T\` is said to be _deduced_: the compiler infers \`T\` from the type of the
argument to \`print\`.

**Output:**
\`\`\`
42 Hello
\`\`\``),
        ).to.equal(false);
        expect(should_block(".gg/")).to.equal(false);
        expect(should_block("foo .gg/ bar")).to.equal(false);
    });
});
