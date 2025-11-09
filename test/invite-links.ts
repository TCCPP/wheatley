import { describe, expect, it } from "vitest";

import { match_invite } from "../src/modules/wheatley/components/anti-invite-links.js";

describe("invite link tests", () => {
    it("should block invite links", () => {
        expect(match_invite("discord.gg/foo")).to.equal("foo");
        expect(match_invite("discord.com/invite/foo")).to.equal("foo");
        expect(match_invite("discordapp.com/invite/foo")).to.equal("foo");
        expect(match_invite("disboard.org/server/join/foo")).to.equal("foo");
        expect(match_invite("discord.me/server/join/foo")).to.equal("foo");
        expect(match_invite("discord.gg/f")).to.equal("f");
        expect(match_invite("foo .gg/bar")).to.equal("bar");
        expect(match_invite("foobar https://discord.gg/randomserver foobar")).to.equal("randomserver");
        expect(match_invite("foobar discord.gg/randomserver foobar")).to.equal("randomserver");
        expect(match_invite("foobar discord.gg/randomserver foobar")).to.equal("randomserver");
        expect(match_invite("foobar discord.gg/T897FfR foobar")).to.equal("T897FfR");
        expect(match_invite("foobar discord.GG/random foobar")).to.equal("random");
        expect(match_invite("foobar discord.gg/12*(*^&^)asdggascn foobar")).to.equal("12*(*^&^)asdggascn");
        expect(match_invite("discord.gg/1")).to.equal("1");
        expect(
            match_invite(`
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
        ).to.equal("randomserver");
    });

    it("should not block normal messages", () => {
        expect(match_invite("foobar")).to.equal(null);
        expect(
            match_invite(`
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
        ).to.equal(null);
        expect(match_invite(".gg/")).to.equal(null);
        expect(match_invite("foo .gg/ bar")).to.equal(null);
        expect(match_invite("foo gg/bar")).to.equal(null);
        expect(match_invite(`Check out https://stunlock.gg/posts/emscripten_with_cmake/ sounds like ...`)).to.equal(
            null,
        );
        expect(match_invite(`paste.gg/p/foobar`)).to.equal(null);
        expect(match_invite(`https://redirect.compiler.gg/foobar`)).to.equal(null);
    });
});
