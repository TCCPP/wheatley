import {assert, expect} from "chai";

import { lookup, cppref_testcase_setup, TargetIndex } from "../src/components/cppref";

type TestCase = {
    query: string | string[];
    cref?: string;
    cppref?: string;
};

function path_to_url(path: string) {
    return `https://${path.replace(/\\/g, "/").replace(".html", "")}`;
}

const cases: TestCase[] = [
    {
        query: ["printf", "std::printf"],
        cref: "https://en.cppreference.com/w/c/io/fprintf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fprintf"
    },
    {
        query: ["getline", "std::getline"],
        cref: "https://en.cppreference.com/w/c/experimental/dynamic/getline",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/getline"
    },
    {
        query: ["scanf", "std::scanf"],
        cref: "https://en.cppreference.com/w/c/io/fscanf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fscanf"
    },
    {
        query: ["strcmp", "std::strcmp"],
        cref: "https://en.cppreference.com/w/c/string/byte/strcmp",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/strcmp"
    },
    {
        query: ["strncmp", "std::strncmp"],
        cref: "https://en.cppreference.com/w/c/string/byte/strncmp",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/strncmp"
    },
    {
        query: ["vector", "std::vector"],
        // TODO: Check that it prints out "no results found" for C?
        cppref: "https://en.cppreference.com/w/cpp/container/vector"
    },
    {
        query: ["operator precedence", "precedence"],
        cref: "https://en.cppreference.com/w/c/language/operator_precedence",
        cppref: "https://en.cppreference.com/w/cpp/language/operator_precedence"
    },
    {
        query: ["memcpy", "std::memcpy"],
        cref: "https://en.cppreference.com/w/c/string/byte/memcpy",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/memcpy"
    },
    {
        query: ["fgets", "std::fgets"],
        cref: "https://en.cppreference.com/w/c/io/fgets",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fgets"
    },
    {
        query: ["sort", "std::sort"],
        cref: "https://en.cppreference.com/w/c/algorithm/qsort",
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
        cref: "https://en.cppreference.com/w/c/language/nullptr",
        cppref: "https://en.cppreference.com/w/cpp/language/nullptr"
    },
    {
        query: ["swap", "std::swap"],
        // todo: cref
        cppref: "https://en.cppreference.com/w/cpp/algorithm/swap"
    },
    {
        query: ["Order of evaluation", "eval order"],
        cref: "https://en.cppreference.com/w/c/language/eval_order",
        cppref: "https://en.cppreference.com/w/cpp/language/eval_order"
    },
    {
        query: ["uniform_int_distribution", "uniform int distribution"],
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/numeric/random/uniform_int_distribution"
    },
    {
        query: ["member initializer list", "member init list"], // other algo fails "member init list"
        // todo cref
        // called /w/cpp/language/initializer_list.html in the data, /w/cpp/language/constructor on the site
        cppref: "https://en.cppreference.com/w/cpp/language/initializer_list"
    },
    {
        query: ["ranged for", "range based for", "range based for loop"],
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/language/range-for"
    },
    {
        query: ["initializer list", "init list" /*, "i list"*/], // other algo fails all
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/utility/initializer_list"
    },
    /*{ // TODO: disabled for now. This is a bonus goal.
        // TODO: One idea, rename operator>> to operatorgtgt
        query: ["istream::operator>>", "istream>>", "std::cin>>", "cin>>"], // other algo fails all
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/io/basic_istream/operator_gtgt"
    },*/
    {
        query: ["std::cin", "cin"], // other algo fails all
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/io/cin"
    },
    {
        query: ["std::basic_string::erase", "std::string::erase", "string::erase", "string erase"],
        // todo cref
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/erase"
    }
];

cppref_testcase_setup();

// TODO: more typo test cases

describe("cppref cases", () => {
    for(const test_case of cases) {
        const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
        for(const query of queries) {
            if(test_case.cref) {
                it(`!cref should find ${query}`, done => {
                    const result = lookup(query, TargetIndex.C);
                    assert(result, "search did not find result when it should have");
                    expect(path_to_url(result.path)).to.equal(test_case.cref);
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
                    const result = lookup(query, TargetIndex.CPP);
                    assert(result, "search did not find result when it should have");
                    expect(path_to_url(result.path)).to.equal(test_case.cppref);
                    done();
                });
            }
        }
    }
});
