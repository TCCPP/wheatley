# The Copy & Swap Idiom

The copy & swap idiom allows you to implement assignment operators and even the move constructor using a swap operation.
```cpp
void swap(T& a, T& b)¹ noexcept² {
    using std::swap;³ // necessary
    swap(a.x, b.x);
    swap(a.y, b.y);
    // swap every member ...
}
T& T::operator=(T other)⁴ noexcept² {
    swap(*this, other);
    return *this;
}
T::T(T&& other) : T{} noexcept² { // optional
    // default-construct, then swap
    swap(*this, other);
}
```
**\[1\]** `swap` is often implemented as a [hidden friend](https://stackoverflow.com/q/56795676/5740428)<br>
**\[2\]** These operations are almost always **[noexcept](https://en.cppreference.com/w/cpp/language/noexcept_spec)**,
but there are rare exceptions
(e.g. if you have a **[std::list](https://en.cppreference.com/w/cpp/container/list/list)** member)<br>
**\[3\]** Because of [argument-dependent lookup (ADL)](https://en.cppreference.com/w/cpp/language/adl),
overloaded `swap` functions may be called instead of<br>
**[std::swap](https://en.cppreference.com/w/cpp/algorithm/swap)**, which is used as a fallback.<br>
**\[4\]** This copy assignment is also used for move assignment.
We could implement both assignments separately, taking `const T&` and `T&&`.

## Pro & Contra
:white_check_mark: simple implementation of assignments (and move constructor)<br>
:white_check_mark: well-defined self-assignment<br>
:white_check_mark: **[noexcept](https://en.cppreference.com/w/cpp/language/noexcept_spec)** copy/move assignment
if [std::is_nothrow_swappable<T>](https://en.cppreference.com/w/cpp/types/is_swappable)<br>
:x: copying always takes place, even for self-assignment<br>
:x: must implement custom `swap` instead of using `std::swap`

## See Also
<:stackoverflow:874353689031233606>
[What is the copy-and-swap idiom?](https://stackoverflow.com/a/3279550/5740428) (must read!)<br>
- **[Full Example of Copy & Swap Idiom](https://godbolt.org/z/G6fzGjxKo)**
