# Iterators and Pointers

Iterators in C++ are lightweight, non-owning types which provide a view into a range of elements. They must satisfy
[named requirements](https://en.cppreference.com/w/cpp/named_req), or
[concepts](https://en.cppreference.com/w/cpp/language/constraints#Concepts) (since C++20). For instance, an
_[Iterator](https://en.cppreference.com/w/cpp/named_req/Iterator)_ must have a `++i`, and `*i` operator.

Not all iterators are pointers, but they are modeled after pointers. `++i`, `*i`, `i == j`, etc. for iterators should
have the same semantics as operations between pointers.

<!-- inline -->

## Named Requirements

- _[InputIterator](https://en.cppreference.com/w/cpp/named_req/InputIterator)_
- _[ForwardIterator](https://en.cppreference.com/w/cpp/named_req/ForwardIterator)_
- _[BidirectionalIterator](https://en.cppreference.com/w/cpp/named_req/BidirectionalIterator)_
- _[RandomAccessIterator](https://en.cppreference.com/w/cpp/named_req/RandomAccessIterator)_
- _[ContiguousIterator](https://en.cppreference.com/w/cpp/named_req/ContiguousIterator)_
- _[OutputIterator](https://en.cppreference.com/w/cpp/named_req/OutputIterator)_

<!-- inline -->

## Concepts (since C++20)

- **[std::input_iterator](https://en.cppreference.com/w/cpp/iterator/input_iterator)**
- **[std::forward_iterator](https://en.cppreference.com/w/cpp/iterator/forward_iterator)**
- **[std::bidirectional_iterator](https://en.cppreference.com/w/cpp/iterator/bidirectional_iterator)**
- **[std::random_access_iterator](https://en.cppreference.com/w/cpp/iterator/random_access_iterator)**
- **[std::contiguous_iterator](https://en.cppreference.com/w/cpp/iterator/contiguous_iterator)**
- **[std::output_iterator](https://en.cppreference.com/w/cpp/iterator/output_iterator)**

## Pointers Are Contiguous Iterators

Because pointers satisfy the most capable named requirement
_[ContiguousIterator](https://en.cppreference.com/w/cpp/named_req/ContiguousIterator)_, they can always be used as
iterators, e.g.:

- your `begin()` and `end()` functions can return pointers;
  **[std::array](https://en.cppreference.com/w/cpp/container/array)** is often implemented like this
- you can use pointers in algorithms like **[std::sort](https://en.cppreference.com/w/cpp/algorithm/sort)**

## See Also

- [Iterator Categories](https://en.cppreference.com/w/cpp/iterator)
- [C++20 Iterator Concepts](https://en.cppreference.com/w/cpp/iterator#C.2B.2B20_iterator_concepts)
- **[std::iterator_traits](https://en.cppreference.com/w/cpp/iterator/iterator_traits)**

---

Note: The Iterator named req. is only used as a base for Input/OutputIterator
