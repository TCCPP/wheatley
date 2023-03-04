import { assert, expect } from "chai";

import { CpprefSubIndex } from "../indexes/cppref/types.js";
import { CpprefIndex } from "../src/components/cppref.js";

type TestCase = {
    query: string | string[];
    cref?: string | null;
    cppref?: string | null;
};

function path_to_url(path: string) {
    return `https://${path.replace(/\\/g, "/").replace(".html", "")}`;
}

const cases: TestCase[] = [
    {
        query: [ "printf", "std::printf" ],
        cref: "https://en.cppreference.com/w/c/io/fprintf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/printf"
    },
    {
        query: [ "getline", "std::getline" ],
        cref: "https://en.cppreference.com/w/c/experimental/dynamic/getline",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/getline"
    },
    {
        query: [ "scanf", "std::scanf" ],
        cref: "https://en.cppreference.com/w/c/io/fscanf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/scanf"
    },
    {
        query: [ "strcmp", "std::strcmp" ],
        cref: "https://en.cppreference.com/w/c/string/byte/strcmp",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/strcmp"
    },
    {
        query: [ "strncmp", "std::strncmp" ],
        cref: "https://en.cppreference.com/w/c/string/byte/strncmp",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/strncmp"
    },
    {
        query: [ "vector", "std::vector" ],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/container/vector"
    },
    {
        query: [ "operator precedence", "precedence" ],
        cref: "https://en.cppreference.com/w/c/language/operator_precedence",
        cppref: "https://en.cppreference.com/w/cpp/language/operator_precedence"
    },
    {
        query: [ "memcpy", "std::memcpy" ],
        cref: "https://en.cppreference.com/w/c/string/byte/memcpy",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/memcpy"
    },
    {
        query: ["fgets"],
        cref: "https://en.cppreference.com/w/c/io/fgets",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fgets"
    },
    {
        query: ["std::fgets"],
        cref: "https://en.cppreference.com/w/c/io/fgets",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fgets"
    },
    {
        query: ["sort"],
        cref: "https://en.cppreference.com/w/c/algorithm/qsort",
        cppref: "https://en.cppreference.com/w/cpp/algorithm/sort"
    },
    {
        query: ["std::sort"],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/algorithm/sort"
    },
    {
        query: "pointer",
        cref: "https://en.cppreference.com/w/c/language/pointer",
        cppref: "https://en.cppreference.com/w/cpp/language/pointer"
    },
    {
        query: "null",
        cref: "https://en.cppreference.com/w/c/types/NULL",
        cppref: "https://en.cppreference.com/w/cpp/types/NULL"
    },
    {
        query: "nullptr",
        //cref: "https://en.cppreference.com/w/c/language/nullptr", // TODO: Maybe disable.
        cppref: "https://en.cppreference.com/w/cpp/language/nullptr"
    },
    {
        query: [ "swap", "std::swap" ],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/algorithm/swap"
    },
    {
        query: [ "Order of evaluation", "eval order" ],
        cref: "https://en.cppreference.com/w/c/language/eval_order",
        cppref: "https://en.cppreference.com/w/cpp/language/eval_order"
    },
    {
        query: [ "uniform_int_distribution", "uniform int distribution" ],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/numeric/random/uniform_int_distribution"
    },
    {
        query: [ "member initializer list", "member init list" ], // other algo fails "member init list"
        // cref: null, // TODO: ?
        // called /w/cpp/language/initializer_list.html in the data, /w/cpp/language/constructor on the site
        cppref: "https://en.cppreference.com/w/cpp/language/initializer_list"
    },
    {
        query: [ "ranged for", "range based for", "range based for loop" ],
        //cref: null, // TODO: ?
        cppref: "https://en.cppreference.com/w/cpp/language/range-for"
    },
    {
        /* "init list", "i list" */
        query: ["initializer list"], // other algo fails all
        //cref: null, // TODO: ?
        cppref: "https://en.cppreference.com/w/cpp/utility/initializer_list"
    },
    {
        query: [ "istream::operator>>", "istream>>" ], // other algo fails all
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/io/basic_istream/operator_gtgt"
    },
    {
        query: [ "std::cin", "cin" ], // other algo fails all
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/io/cin"
    },
    {
        query: [ "std::basic_string::erase", "std::string::erase", "string::erase", "string erase" ],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/erase"
    },
    {
        query: [ "std::vector::erase", "vector erase" ],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/container/vector/erase"
    },
    {
        query: ["sizeof"],
        cref: "https://en.cppreference.com/w/c/language/sizeof",
        cppref: "https://en.cppreference.com/w/cpp/language/sizeof"
    },
    {
        query: ["sizeof..."],
        //cref: null, // TODO: ?
        cppref: "https://en.cppreference.com/w/cpp/language/sizeof..."
    }
];

// TODO: more typo test cases

const index = new CpprefIndex().load_data_sync();

describe("cref cases", () => {
    for(const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for(const query of queries) {
            if(test_case.cref) {
                it(`!cref should find ${query}`, done => {
                    const result = index.lookup(query, CpprefSubIndex.C);
                    assert(result, "search did not find a result when it should have");
                    expect(path_to_url(result.path)).to.equal(test_case.cref);
                    done();
                });
            } else if(test_case.cref === null) {
                it(`!cref shouldn't find ${query}`, done => {
                    const result = index.lookup(query, CpprefSubIndex.C);
                    assert(!result, "search found a result when it shouldn't have");
                    done();
                });
            }
        }
    }
});

describe("cppref cases", () => {
    for(const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for(const query of queries) {
            if(test_case.cppref) {
                it(`!cppref should find ${query}`, done => {
                    const result = index.lookup(query, CpprefSubIndex.CPP);
                    assert(result, "search did not find a result when it should have");
                    expect(path_to_url(result.path)).to.equal(test_case.cppref);
                    done();
                });
            } else if(test_case.cppref === null) {
                it(`!cppref shouldn't find ${query}`, done => {
                    const result = index.lookup(query, CpprefSubIndex.CPP);
                    assert(!result, "search found a result when it shouldn't have");
                    done();
                });
            }
        }
    }
});
