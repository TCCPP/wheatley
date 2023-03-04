import { assert, expect } from "chai";

import { Man7Index } from "../src/components/man7.js";

type TestCase = {
    query: string | string[];
    path: string;
};

const cases: TestCase[] = [
    {
        query: ["printf"],
        path: "man3/printf.3.html"
    },
    {
        query: ["fprintf"],
        path: "man3/fprintf.3p.html" // TODO: re-evaluate....?
    },
    {
        query: ["man"],
        path: "man1/man.1.html"
    },
    {
        query: ["accept"],
        path: "man2/accept.2.html"
    },
    {
        query: ["hexdump"],
        path: "man1/hexdump.1.html"
    },
    {
        query: ["strtol"],
        path: "man3/strtol.3.html"
    }
];

// TODO: more typo test cases

const index = new Man7Index().load_data_sync();

describe("man cases", () => {
    for(const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for(const query of queries) {
            it(`!cref should find ${query}`, done => {
                const result = index.lookup(query);
                assert(result, "search did not find a result when it should have");
                expect(result.path).to.equal(test_case.path);
                done();
            });
        }
    }
});
