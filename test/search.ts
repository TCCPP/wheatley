import { describe, expect, it } from "vitest";
import {
    smart_split_list,
    strip_parentheses,
    normalize_and_sanitize_title,
    normalize_and_split_cppref_title,
} from "../src/algorithm/search.js";

describe("nested parentheses handling", () => {
    it("should handle unbalanced parentheses 1", () => {
        expect(strip_parentheses("a)b", "(", ")")).to.equal("a)b");
    });
    it("should handle unbalanced parentheses 2", () => {
        expect(strip_parentheses("a(b", "(", ")")).to.equal("a(b");
    });
    it("should handle unbalanced parentheses 3", () => {
        expect(strip_parentheses("a(b))", "(", ")")).to.equal("a)");
    });
    it("should handle unbalanced parentheses 4", () => {
        expect(strip_parentheses("a((b)", "(", ")")).to.equal("a(");
    });
    it("should handle nested parentheses 1", () => {
        expect(strip_parentheses("foo(bar((baz)))", "(", ")")).to.equal("foo");
    });
    it("should handle nested parentheses 2", () => {
        expect(strip_parentheses("foo(bar((baz))))", "(", ")")).to.equal("foo)");
    });
    it("shouldn't strip operator arguments", () => {
        expect(strip_parentheses("operator==, !=, <, <=, >, >=, <=>(std::optional)", "(", ")")).to.equal(
            "operator==, !=, <, <=, >, >=, <=>(std::optional)",
        );
        expect(strip_parentheses("std::expected<t,e>::operator->, std::expected<t,e>::operator*", "<", ">")).to.equal(
            "std::expected::operator->, std::expected::operator*",
        );
    });
});

const title_sanitization_test_cases: {
    title: string;
    expected: string;
}[] = [
    {
        title: "std::swap(std::array)",
        expected: "std::swap(std::array)",
    },
    {
        title: "std::get (std::variant)",
        expected: "std::get (std::variant)",
    },
    {
        title: "Concepts library (since C++20)",
        expected: "concepts library",
    },
];

describe("title sanitization", () => {
    for (const test_case of title_sanitization_test_cases) {
        it(`should handle "${test_case.title}"`, () => {
            expect(normalize_and_sanitize_title(test_case.title)).to.equal(test_case.expected);
        });
    }
});

describe("smart splitting", () => {
    it("should smartly split titles", () => {
        expect(smart_split_list("foo(std::string, int), bar(std::string, float)")).to.deep.equal([
            "foo(std::string, int)",
            "bar(std::string, float)",
        ]);
    });
});

/* eslint-disable max-len */
const title_splitting_cases: {
    title: string;
    expected: string[];
}[] = [
    {
        title: "std::experimental::observer_ptr<W>::operator*, std::experimental::observer_ptr<W>::operator->",
        expected: ["std::experimental::observer_ptr::operator*", "std::experimental::observer_ptr::operator->"],
    },
    {
        title: "operator==, !=, <, <=, >, >=, <=>(std::optional)",
        expected: [
            "operator==(std::optional)",
            "operator!=(std::optional)",
            "operator<(std::optional)",
            "operator<=(std::optional)",
            "operator>(std::optional)",
            "operator>=(std::optional)",
            "operator<=>(std::optional)",
        ],
    },
    {
        // note: it's fine that (int) is added to everything here
        title: "std::atomic<T>::operator++,++(int),--,--(int)",
        expected: [
            "std::atomic::operator++(int)",
            "std::atomic::operator++(int)",
            "std::atomic::operator--(int)",
            "std::atomic::operator--(int)",
        ],
    },
    {
        title: "std::experimental::basic_string_view<CharT,Traits>::to_string, std::experimental::basic_string_view<CharT,Traits>::operator basic_string",
        expected: [
            "std::experimental::basic_string_view::to_string",
            "std::experimental::basic_string_view::operator basic_string",
            "std::experimental::string_view::to_string",
            "std::experimental::string_view::operator string",
        ],
    },
    {
        title: "std::coroutine_handle<promise>::operator(), std::coroutine_handle<promise>::resume",
        expected: ["std::coroutine_handle::operator()", "std::coroutine_handle::resume"],
    },
    {
        title: "std::experimental::propagate_const<t>::operator*, std::experimental::propagate_const<t>::operator->",
        expected: ["std::experimental::propagate_const::operator*", "std::experimental::propagate_const::operator->"],
    },
    {
        title: "std::chrono::operator+, std::chrono::operator- (std::chrono::year_month_day)",
        expected: [
            "std::chrono::operator+ (std::chrono::year_month_day)",
            "std::chrono::operator- (std::chrono::year_month_day)",
        ],
    },
    {
        title: "Type support (basic types, RTTI)",
        expected: ["type support (basic types, rtti)"],
    },
    {
        title: "std::basic_string<CharT,Traits,Allocator>::erase",
        expected: ["std::basic_string::erase", "std::string::erase"],
    },
];
/* eslint-enable max-len */

describe("title splitting", () => {
    for (const test_case of title_splitting_cases) {
        it(`should handle "${test_case.title}"`, () => {
            expect(normalize_and_split_cppref_title(test_case.title)).to.deep.equal(test_case.expected);
        });
    }
});
