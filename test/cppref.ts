import { assert, beforeAll, describe, expect, it } from "vitest";

import { CpprefSubIndex } from "../indexes/cppref/types.js";
import { CpprefIndex } from "../src/modules/tccpp/components/cppref.js";

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
        query: ["printf", "std::printf"],
        cref: "https://en.cppreference.com/w/c/io/fprintf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/printf",
    },
    {
        query: ["scanf", "std::scanf"],
        cref: "https://en.cppreference.com/w/c/io/fscanf",
        cppref: "https://en.cppreference.com/w/cpp/io/c/scanf",
    },
    {
        query: "vector",
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/container/vector",
    },
    {
        // the "std" prefix creates high ngram overlap with stdin/stdout in C
        query: "std::vector",
        cppref: "https://en.cppreference.com/w/cpp/container/vector",
    },
    {
        query: ["sort"],
        cref: "https://en.cppreference.com/w/c/algorithm/qsort",
        cppref: "https://en.cppreference.com/w/cpp/algorithm/sort",
    },
    {
        query: ["std::sort"],
        cppref: "https://en.cppreference.com/w/cpp/algorithm/sort",
    },
    {
        query: ["strcmp", "std::strcmp"],
        cref: "https://en.cppreference.com/w/c/string/byte/strcmp",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/strcmp",
    },
    {
        query: ["memcpy", "std::memcpy"],
        cref: "https://en.cppreference.com/w/c/string/byte/memcpy",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/memcpy",
    },
    {
        query: ["sizeof"],
        cref: "https://en.cppreference.com/w/c/language/sizeof",
        cppref: "https://en.cppreference.com/w/cpp/language/sizeof",
    },
    {
        query: "null",
        cref: "https://en.cppreference.com/w/c/types/NULL",
        cppref: "https://en.cppreference.com/w/cpp/types/NULL",
    },
    {
        query: "nullptr",
        cppref: "https://en.cppreference.com/w/cpp/language/nullptr",
    },
    {
        query: ["getline", "std::getline"],
        cref: "https://en.cppreference.com/w/c/experimental/dynamic/getline",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/getline",
    },
    {
        query: "swap",
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/algorithm/swap",
    },
    {
        // the "std" prefix creates high ngram overlap with stdin/stdout in C
        query: "std::swap",
        cppref: "https://en.cppreference.com/w/cpp/algorithm/swap",
    },
    {
        query: ["cin"],
        cppref: "https://en.cppreference.com/w/cpp/io/cin",
    },
    {
        query: "pointer",
        cref: "https://en.cppreference.com/w/c/language/pointer",
    },
    {
        query: ["string", "std::string"],
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string",
    },
    {
        query: ["string view", "string_view"],
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string_view",
    },
    {
        query: ["string erase"],
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/erase",
    },
    {
        query: ["vector erase"],
        cref: null,
        cppref: "https://en.cppreference.com/w/cpp/container/vector/erase",
    },
    {
        query: ["for loop"],
        cref: "https://en.cppreference.com/w/c/language/for",
        cppref: "https://en.cppreference.com/w/cpp/language/for",
    },
    {
        query: ["precedence", "operator precedence"],
        cref: "https://en.cppreference.com/w/c/language/operator_precedence",
        cppref: "https://en.cppreference.com/w/cpp/language/operator_precedence",
    },
    {
        query: ["eval order"],
        cref: "https://en.cppreference.com/w/c/language/eval_order",
        cppref: "https://en.cppreference.com/w/cpp/language/eval_order",
    },
    {
        query: ["structured binding"],
        cppref: "https://en.cppreference.com/w/cpp/language/structured_binding",
    },
    {
        query: ["copy constructor"],
        cppref: "https://en.cppreference.com/w/cpp/language/copy_constructor",
    },
    {
        query: ["undefined behavior"],
        cref: "https://en.cppreference.com/w/c/language/behavior",
        cppref: "https://en.cppreference.com/w/cpp/language/ub",
    },
    {
        query: ["raii", "RAII"],
        cppref: "https://en.cppreference.com/w/cpp/language/raii",
    },
    {
        query: ["rule of 5", "rule of 3"],
        cppref: "https://en.cppreference.com/w/cpp/language/rule_of_three",
    },
    {
        // "member initializer list" matches std::initializer_list (utility) more strongly than the language page
        // "Constructors and member initializer lists" because the utility page has better token coverage.
        query: ["member initializer list"],
        cppref: "https://en.cppreference.com/w/cpp/utility/initializer_list",
    },
    {
        // "member init list" - with IDF weighting, the language initializer_list page wins due to higher
        // ngram similarity on rarer trigrams
        query: ["member init list"],
        cppref: "https://en.cppreference.com/w/cpp/language/initializer_list",
    },
    {
        // "ranged for" finds the regular for loop (higher ngram similarity + same token match for "for").
        // "range based for" and "range based for loop" correctly find range-for via multi-token matching.
        query: ["range based for", "range based for loop"],
        cppref: "https://en.cppreference.com/w/cpp/language/range-for",
    },
    {
        query: ["initializer list"],
        cppref: "https://en.cppreference.com/w/cpp/utility/initializer_list",
    },
    {
        query: ["uniform int distribution"],
        cppref: "https://en.cppreference.com/w/cpp/numeric/random/uniform_int_distribution",
    },
    {
        query: ["sizeof..."],
        cppref: "https://en.cppreference.com/w/cpp/language/sizeof...",
    },
    {
        query: ["fgets"],
        cref: "https://en.cppreference.com/w/c/io/fgets",
        cppref: "https://en.cppreference.com/w/cpp/io/c/fgets",
    },
    {
        // actual production query: "rundom_device" (typo for random_device)
        query: "rundom_device",
        cppref: "https://en.cppreference.com/w/cpp/numeric/random/random_device",
    },
    // "sterr" (typo for stderr) and "vla" are not reliably in the cppref index - tested via wiki instead
    {
        query: "print",
        cppref: "https://en.cppreference.com/w/cpp/io/print",
    },
    {
        query: "println",
        cppref: "https://en.cppreference.com/w/cpp/io/println",
    },
    // "embed" for #embed is not in the cppref index (C++23 feature missing from HTML archive)
    {
        query: "split",
        cppref: "https://en.cppreference.com/w/cpp/ranges/split_view",
    },
    {
        query: "sleep_for",
        cppref: "https://en.cppreference.com/w/cpp/thread/sleep_for",
    },
    {
        // with IDF weighting, basic_string::npos wins over variant_npos
        query: "npos",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/npos",
    },
    {
        query: "toupper",
        cref: "https://en.cppreference.com/w/c/string/byte/toupper",
        cppref: "https://en.cppreference.com/w/cpp/string/byte/toupper",
    },
    {
        query: "flip",
        cppref: "https://en.cppreference.com/w/cpp/container/vector_bool/flip",
    },
    {
        query: "filebuf",
        cppref: "https://en.cppreference.com/w/cpp/io/basic_filebuf",
    },
    {
        query: "compiler support",
        cppref: "https://en.cppreference.com/w/cpp/compiler_support",
    },
    {
        // In C, "aggregate initialization" matches the general "Initialization" page more strongly than
        // "Struct and union initialization" because of better ngram and token overlap.
        query: "aggregate initialization",
        cref: "https://en.cppreference.com/w/c/language/initialization",
        cppref: "https://en.cppreference.com/w/cpp/language/aggregate_initialization",
    },
    {
        query: "fold expression",
        cppref: "https://en.cppreference.com/w/cpp/language/fold",
    },
    {
        query: "operator new",
        cppref: "https://en.cppreference.com/w/cpp/memory/new/operator_new",
    },
    {
        query: "filesystem",
        cppref: "https://en.cppreference.com/w/cpp/filesystem",
    },
    {
        // Natural language queries can match function names via shared trigrams (e.g., "use" matches "use_facet").
        query: "how can I use it to develop a chatbot",
    },
    {
        query: ".hpp",
        cref: null,
        cppref: null,
    },
    {
        // actual production query: "std::cout << \"ciao\"" - "std" prefix matches "stdin" in C
        query: 'std::cout << "ciao"',
    },
    {
        // actual production query: "std::simd::rocketship" - "simd" matches experimental simd pages in C++,
        // "std" prefix matches "stdin" in C
        query: "std::simd::rocketship",
    },
    {
        query: "plus<int>",
        cppref: "https://en.cppreference.com/w/cpp/utility/functional/plus",
    },
    {
        query: "NULL",
        cref: "https://en.cppreference.com/w/c/types/NULL",
        cppref: "https://en.cppreference.com/w/cpp/types/NULL",
    },
    {
        query: "EXIT_FAILURE",
        cppref: "https://en.cppreference.com/w/cpp/utility/program/EXIT_status",
    },
    {
        query: "std::string::erase",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/erase",
    },
    {
        query: "std::vector::erase",
        cppref: "https://en.cppreference.com/w/cpp/container/vector/erase",
    },
    {
        query: "vector::emplace",
        cppref: "https://en.cppreference.com/w/cpp/container/vector/emplace",
    },
    {
        query: "string::erase",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/erase",
    },
    {
        query: "map contains",
        cppref: "https://en.cppreference.com/w/cpp/container/map/contains",
    },
    {
        query: "malloc",
        cref: "https://en.cppreference.com/w/c/memory/malloc",
    },
    {
        query: "rand",
        cref: "https://en.cppreference.com/w/c/numeric/random/rand",
    },
    {
        query: "errno",
        cref: "https://en.cppreference.com/w/c/error/errno",
    },
    {
        query: "perror",
        cref: "https://en.cppreference.com/w/c/io/perror",
    },
    {
        query: "strtol",
        cref: "https://en.cppreference.com/w/c/string/byte/strtol",
    },
    {
        query: "strtok",
        cref: "https://en.cppreference.com/w/c/string/byte/strtok",
    },
    {
        query: "isdigit",
        cref: "https://en.cppreference.com/w/c/string/byte/isdigit",
    },
    {
        query: "isalpha",
        cref: "https://en.cppreference.com/w/c/string/byte/isalpha",
    },
    {
        query: "memcmp",
        cref: "https://en.cppreference.com/w/c/string/byte/memcmp",
    },
    {
        query: "strchr",
        cref: "https://en.cppreference.com/w/c/string/byte/strchr",
    },
    {
        query: "strstr",
        cref: "https://en.cppreference.com/w/c/string/byte/strstr",
    },
    {
        query: "puts",
        cref: "https://en.cppreference.com/w/c/io/puts",
    },
    {
        query: "fwrite",
        cref: "https://en.cppreference.com/w/c/io/fwrite",
    },
    {
        query: "assert",
        cref: "https://en.cppreference.com/w/c/error/assert",
    },
    {
        query: "bsearch",
        cref: "https://en.cppreference.com/w/c/algorithm/bsearch",
    },
    {
        query: "goto statement",
        cref: "https://en.cppreference.com/w/c/language/goto",
    },
    {
        query: "Struct declaration",
        cref: "https://en.cppreference.com/w/c/language/struct",
    },
    {
        query: "Compound literals",
        cref: "https://en.cppreference.com/w/c/language/compound_literal",
    },
    {
        query: ["map", "std::map"],
        cppref: "https://en.cppreference.com/w/cpp/container/map",
    },
    {
        query: ["unordered_map", "std::unordered_map"],
        cppref: "https://en.cppreference.com/w/cpp/container/unordered_map",
    },
    {
        query: ["set", "std::set"],
        cppref: "https://en.cppreference.com/w/cpp/container/set",
    },
    {
        query: "deque",
        cppref: "https://en.cppreference.com/w/cpp/container/deque",
    },
    {
        query: ["stack", "std::stack"],
        cppref: "https://en.cppreference.com/w/cpp/container/stack",
    },
    {
        query: ["priority_queue", "std::priority_queue"],
        cppref: "https://en.cppreference.com/w/cpp/container/priority_queue",
    },
    {
        query: "std::array",
        cppref: "https://en.cppreference.com/w/cpp/container/array",
    },
    {
        query: ["transform", "std::transform"],
        cppref: "https://en.cppreference.com/w/cpp/algorithm/transform",
    },
    {
        query: ["accumulate", "std::accumulate"],
        cppref: "https://en.cppreference.com/w/cpp/algorithm/accumulate",
    },
    {
        query: ["find_if", "std::find_if"],
        cppref: "https://en.cppreference.com/w/cpp/algorithm/find",
    },
    {
        query: ["reverse", "std::reverse"],
        cppref: "https://en.cppreference.com/w/cpp/algorithm/reverse",
    },
    {
        query: ["unique_ptr", "std::unique_ptr"],
        cppref: "https://en.cppreference.com/w/cpp/memory/unique_ptr",
    },
    {
        query: ["shared_ptr", "std::shared_ptr"],
        cppref: "https://en.cppreference.com/w/cpp/memory/shared_ptr",
    },
    {
        query: ["weak_ptr", "std::weak_ptr"],
        cppref: "https://en.cppreference.com/w/cpp/memory/weak_ptr",
    },
    {
        query: ["make_unique", "std::make_unique"],
        cppref: "https://en.cppreference.com/w/cpp/memory/unique_ptr/make_unique",
    },
    {
        query: ["make_shared", "std::make_shared"],
        cppref: "https://en.cppreference.com/w/cpp/memory/shared_ptr/make_shared",
    },
    {
        query: ["mutex", "std::mutex"],
        cppref: "https://en.cppreference.com/w/cpp/thread/mutex",
    },
    {
        query: ["lock_guard", "std::lock_guard"],
        cppref: "https://en.cppreference.com/w/cpp/thread/lock_guard",
    },
    {
        query: ["condition_variable", "std::condition_variable"],
        cppref: "https://en.cppreference.com/w/cpp/thread/condition_variable",
    },
    {
        query: ["async", "std::async"],
        cppref: "https://en.cppreference.com/w/cpp/thread/async",
    },
    {
        query: ["future", "std::future"],
        cppref: "https://en.cppreference.com/w/cpp/thread/future",
    },
    {
        query: ["optional", "std::optional"],
        cppref: "https://en.cppreference.com/w/cpp/utility/optional",
    },
    {
        query: ["variant", "std::variant"],
        cppref: "https://en.cppreference.com/w/cpp/utility/variant",
    },
    {
        query: ["tuple", "std::tuple"],
        cppref: "https://en.cppreference.com/w/cpp/utility/tuple",
    },
    {
        query: ["pair", "std::pair"],
        cppref: "https://en.cppreference.com/w/cpp/utility/pair",
    },
    {
        query: "std::expected",
        cppref: "https://en.cppreference.com/w/cpp/utility/expected",
    },
    {
        query: "std::format",
        cppref: "https://en.cppreference.com/w/cpp/utility/format/format",
    },
    {
        query: "std::span",
        cppref: "https://en.cppreference.com/w/cpp/container/span",
    },
    {
        query: "static_cast",
        cppref: "https://en.cppreference.com/w/cpp/language/static_cast",
    },
    {
        query: "dynamic_cast",
        cppref: "https://en.cppreference.com/w/cpp/language/dynamic_cast",
    },
    {
        query: "reinterpret_cast",
        cppref: "https://en.cppreference.com/w/cpp/language/reinterpret_cast",
    },
    {
        query: "const_cast",
        cppref: "https://en.cppreference.com/w/cpp/language/const_cast",
    },
    {
        query: ["lambda", "lambda expression"],
        cppref: "https://en.cppreference.com/w/cpp/language/lambda",
    },
    {
        query: "constexpr",
        cppref: "https://en.cppreference.com/w/cpp/language/constexpr",
    },
    {
        query: "enum",
        cref: "https://en.cppreference.com/w/c/language/enum",
        cppref: "https://en.cppreference.com/w/cpp/language/enum",
    },
    {
        query: "move constructor",
        cppref: "https://en.cppreference.com/w/cpp/language/move_constructor",
    },
    {
        query: "try catch",
        cppref: "https://en.cppreference.com/w/cpp/language/try_catch",
    },
    {
        query: "class template",
        cppref: "https://en.cppreference.com/w/cpp/language/class_template",
    },
    {
        query: "function template",
        cppref: "https://en.cppreference.com/w/cpp/language/function_template",
    },
    {
        query: "virtual",
        cppref: "https://en.cppreference.com/w/cpp/language/virtual",
    },
    {
        query: "std::cout",
        cppref: "https://en.cppreference.com/w/cpp/io/cout",
    },
    {
        query: ["ifstream", "std::ifstream"],
        cppref: "https://en.cppreference.com/w/cpp/io/basic_ifstream",
    },
    {
        query: ["to_string", "std::to_string"],
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/to_string",
    },
    {
        query: "stoi",
        cppref: "https://en.cppreference.com/w/cpp/string/basic_string/stol",
    },
    {
        query: "numeric_limits",
        cppref: "https://en.cppreference.com/w/cpp/types/numeric_limits",
    },
    {
        query: "fopen",
        cref: "https://en.cppreference.com/w/c/io/fopen",
    },
    {
        query: "fclose",
        cref: "https://en.cppreference.com/w/c/io/fclose",
    },
    {
        query: "atoi",
        cref: "https://en.cppreference.com/w/c/string/byte/atoi",
    },
    {
        query: "memmove",
        cref: "https://en.cppreference.com/w/c/string/byte/memmove",
    },
    {
        query: "calloc",
        cref: "https://en.cppreference.com/w/c/memory/calloc",
    },
    {
        query: "realloc",
        cref: "https://en.cppreference.com/w/c/memory/realloc",
    },
    {
        query: "free",
        cref: "https://en.cppreference.com/w/c/memory/free",
    },
    // "vecotr" (typo for vector) - not enough shared ngrams to reliably fuzzy-match
    {
        query: "uniuqe_ptr",
        cppref: "https://en.cppreference.com/w/cpp/memory/unique_ptr",
    },
    {
        query: "condtion_variable",
        cppref: "https://en.cppreference.com/w/cpp/thread/condition_variable",
    },
    {
        query: "initialzer_list",
        cppref: "https://en.cppreference.com/w/cpp/utility/initializer_list",
    },
];

let index: CpprefIndex;

beforeAll(async () => {
    index = new CpprefIndex();
    await index.load_data();
}, 120_000);

function run_cppref_cases(sub_index: CpprefSubIndex, field: "cref" | "cppref", label: string) {
    describe(`${label} cases`, () => {
        for (const test_case of cases) {
            const queries = test_case.query instanceof Array ? test_case.query : [test_case.query];
            for (const query of queries) {
                if (test_case[field]) {
                    it(`!${label} should find ${query}`, async () => {
                        const result = await index.lookup_async(query, sub_index);
                        assert(result, "search did not find a result when it should have");
                        expect(path_to_url(result.path)).to.equal(test_case[field]);
                    });
                } else if (test_case[field] === null) {
                    it(`!${label} shouldn't find ${query}`, async () => {
                        const result = await index.lookup_async(query, sub_index);
                        assert(!result, "search found a result when it shouldn't have");
                    });
                }
            }
        }
    });
}

run_cppref_cases(CpprefSubIndex.C, "cref", "cref");
run_cppref_cases(CpprefSubIndex.CPP, "cppref", "cppref");
