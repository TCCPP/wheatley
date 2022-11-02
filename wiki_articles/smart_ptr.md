# Smart Pointers in C++

Smart pointers are types which manage a raw pointer in their constructors and destructors.
This way, you don't have to use `new`/`delete` manually,
which is easy to forget and hard to do correctly, especially when handling exceptions.

## [std::unique_ptr]
- unique ownership
- not copyable, only movable
- use with **[std::make_unique](https://en.cppreference.com/w/cpp/memory/unique_ptr/make_unique)**

## [std::shared_ptr]
- shared ownership
- copyable (thread-safely)
- use with **[std::make_shared](https://en.cppreference.com/w/cpp/memory/shared_ptr/make_shared)**

## [std::weak_ptr]
- non-owning
- constructed from `std::shared_ptr`
- converted to `std::shared_ptr` when accessing managed object

## Specializations for Arrays
`std::unique_ptr` and `std::shared_ptr` have specializations for array types (since C++11, C++17 respectively).
For example:
```cpp
// Make unique array of 100 ints.
// In practice, use auto = ...;
std::unique_ptr<int[]> =
    std::make_unique<int[]>(100);
```

## Relevant Links
<:cppreference:875716540929015908>
**[std::unique_ptr](https://en.cppreference.com/w/cpp/memory/unique_ptr)**,
**[std::shared_ptr](https://en.cppreference.com/w/cpp/memory/shared_ptr)**,
**[std::weak_ptr](https://en.cppreference.com/w/cpp/memory/weak_ptr)**
<:stackoverflow:874353689031233606>
[What is a smart pointer and when should I use one?](https://stackoverflow.com/q/106508/5740428)
<:cppreference:875716540929015908>
*[Smart Pointer Casts](https://en.cppreference.com/w/cpp/memory/shared_ptr/pointer_cast)*
<:cppreference:875716540929015908>
[Standard library header <memory>](https://en.cppreference.com/w/cpp/header/memory)