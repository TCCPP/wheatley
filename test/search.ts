import {assert, expect} from "chai";
import { parse_title, smart_split_title, strip_parentheses } from "../src/algorithm/search";

describe("nested parentheses handling", () => {
    it("should handle unbalanced parentheses 1", done => {
        expect(strip_parentheses("a)b", "(", ")")).to.equal("a)b");
        done();
    });
    it("should handle unbalanced parentheses 2", done => {
        expect(strip_parentheses("a(b", "(", ")")).to.equal("a(b");
        done();
    });
    it("should handle unbalanced parentheses 3", done => {
        expect(strip_parentheses("a(b))", "(", ")")).to.equal("a)");
        done();
    });
    it("should handle unbalanced parentheses 4", done => {
        expect(strip_parentheses("a((b)", "(", ")")).to.equal("a(");
        done();
    });
    it("should handle nested parentheses 1", done => {
        expect(strip_parentheses("foo(bar((baz)))", "(", ")")).to.equal("foo");
        done();
    });
    it("should handle nested parentheses 2", done => {
        expect(strip_parentheses("foo(bar((baz))))", "(", ")")).to.equal("foo)");
        done();
    });
    it("shouldn't strip operator arguments", done => {
        expect(strip_parentheses("operator==, !=, <, <=, >, >=, <=>(std::optional)", "(", ")"))
            .to.equal("operator==, !=, <, <=, >, >=, <=>(std::optional)");
        expect(strip_parentheses("std::expected<t,e>::operator->, std::expected<t,e>::operator*", "<", ">"))
            .to.equal("std::expected::operator->, std::expected::operator*");
        done();
    });
});

describe("smart splitting", () => {
    it("should smartly split titles", done => {
        expect(smart_split_title("foo(std::string, int), bar(std::string, float)")).to.deep.equal([
            "foo(std::string, int)",
            "bar(std::string, float)"
        ]);
        done();
    });
});

const title_splitting_cases: {
    title: string;
    expected: string[];
}[] = [
    {
        title: "std::experimental::observer_ptr<W>::operator*, std::experimental::observer_ptr<W>::operator->",
        expected: [
            "std::experimental::observer_ptr::operator*",
            "std::experimental::observer_ptr::operator->"
        ]
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
        ]
    },
    {
        // note: it's fine that (int) is added to everything here
        title: "std::atomic<T>::operator++,++(int),--,--(int)",
        expected: [
            "std::atomic::operator++(int)",
            "std::atomic::operator++(int)",
            "std::atomic::operator--(int)",
            "std::atomic::operator--(int)",
        ]
    },
    {
        title: "std::experimental::basic_string_view<CharT,Traits>::to_string, std::experimental::basic_string_view<CharT,Traits>::operator basic_string",
        expected: [
            "std::experimental::basic_string_view::to_string",
            "std::experimental::basic_string_view::operator basic_string"
        ]
    },
    {
        title: "std::coroutine_handle<promise>::operator(), std::coroutine_handle<promise>::resume",
        expected: [
            "std::coroutine_handle::operator()",
            "std::coroutine_handle::resume"
        ]
    },
    {
        title: "std::experimental::propagate_const<t>::operator*, std::experimental::propagate_const<t>::operator->",
        expected: [
            "std::experimental::propagate_const::operator*",
            "std::experimental::propagate_const::operator->"
        ]
    }
];

describe("title splitting", () => {
    for(const test_case of title_splitting_cases) {
        it(`should handle "${test_case.title}"`, done => {
            expect(parse_title(test_case.title)).to.deep.equal(test_case.expected);
            done();
        });
    }
});

