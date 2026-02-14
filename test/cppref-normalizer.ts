import { describe, expect, it } from "vitest";
import {
    smart_split_list,
    strip_parentheses,
    normalize_and_sanitize_title,
    normalize_and_split_cppref_title,
} from "../src/modules/tccpp/cppref-normalizer.js";

const strip_parentheses_cases: {
    input: string;
    opening: string;
    closing: string;
    expected: string;
}[] = [
    { input: "a)b", opening: "(", closing: ")", expected: "a)b" },
    { input: "a(b", opening: "(", closing: ")", expected: "a(b" },
    { input: "a(b))", opening: "(", closing: ")", expected: "a)" },
    { input: "a((b)", opening: "(", closing: ")", expected: "a(" },
    { input: "foo(bar((baz)))", opening: "(", closing: ")", expected: "foo" },
    { input: "foo(bar((baz))))", opening: "(", closing: ")", expected: "foo)" },
    {
        input: "operator==, !=, <, <=, >, >=, <=>(std::optional)",
        opening: "(",
        closing: ")",
        expected: "operator==, !=, <, <=, >, >=, <=>(std::optional)",
    },
    {
        input: "std::expected<t,e>::operator->, std::expected<t,e>::operator*",
        opening: "<",
        closing: ">",
        expected: "std::expected::operator->, std::expected::operator*",
    },
];

describe("nested parentheses handling", () => {
    for (const test_case of strip_parentheses_cases) {
        it(`should handle "${test_case.input}"`, () => {
            expect(strip_parentheses(test_case.input, test_case.opening, test_case.closing)).to.equal(
                test_case.expected,
            );
        });
    }
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

const smart_split_cases: {
    input: string;
    expected: string[];
}[] = [
    {
        input: "foo(std::string, int), bar(std::string, float)",
        expected: ["foo(std::string, int)", "bar(std::string, float)"],
    },
];

describe("smart splitting", () => {
    for (const test_case of smart_split_cases) {
        it(`should handle "${test_case.input}"`, () => {
            expect(smart_split_list(test_case.input)).to.deep.equal(test_case.expected);
        });
    }
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
