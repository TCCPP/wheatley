# Scoped and Unscoped Enumerations

In C++, `enum` introduces an
[unscoped enumeration](https://en.cppreference.com/w/cpp/language/enum#Unscoped_enumerations),
and `enum class` or `enum struct` introduce a
[scoped enumeration](https://en.cppreference.com/w/cpp/language/enum#Scoped_enumerations).
```cpp
enum class Fruit : char {
    NONE, // enumerator-list, NONE = 0
    APPLE = 'a',
    BANANA = 'b'
};
Fruit apple = Fruit::APPLE;
```

## [Scoped Enumeration (C++-only)]
- underlying type is `int`
- requires *enum-name::* to access
- only `=`, `==` and `!=` defined (operator overloading possible)

## [Unscoped Enumeration]
- underlying type is impl.-defined
- access without *enum-name*
- behaves like list of constants in surrounding scope
- inherits ops. from underlying type

## See Also
<:cppreference:875716540929015908>
[Enumeration Declaration](https://en.cppreference.com/w/cpp/language/enum)
<:cppreference:875716540929015908>
[Using-enum-declaration](https://en.cppreference.com/w/cpp/language/enum#Using-enum-declaration) (since C++20)
<:cppreference:875716540929015908>
**[std::underlying_type](https://en.cppreference.com/w/cpp/types/underlying_type)** (since C++11)
<:cppreference:875716540929015908>
**[std::to_underlying](https://en.cppreference.com/w/cpp/utility/to_underlying)** (since C++23)
• [learncpp.com: Enumerated Types](https://www.learncpp.com/cpp-tutorial/enumerated-types/)
