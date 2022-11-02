# Value Categories

All expressions since C++11 have two properties, which characterize its value category:
🗑️ *can be moved from*
🆔 *has identity*

Three valid combinations exist, as well as two mixed categories:
- **[lvalue](https://en.cppreference.com/w/cpp/language/value_category#lvalue)** "left-hand value"
- **[prvalue](https://en.cppreference.com/w/cpp/language/value_category#prvalue)** "pure rvalue"
- **[xvalue](https://en.cppreference.com/w/cpp/language/value_category#xvalue)** "eXpiring value"
- **[glvalue](https://en.cppreference.com/w/cpp/language/value_category#glvalue)**
"generalized lvalue" (lvalue or xvalue)
- **[rvalue](https://en.cppreference.com/w/cpp/language/value_category#rvalue)**
"right-hand value" (prvalue or xvalue)

## [lvalue]
🆔 has identity
```cpp
std::cin
(a = b)
"awoo"
```

## [prvalue]
🗑️ is movable
```cpp
42
a && b
[]{} // lambda
```

## [xvalue]
🆔🗑️ has id., movable
```cpp
std::move(x)
rvalue_arr[n]
rvalue.x
```

## [glvalue (lvalue or xvalue)]
🆔 identity, we don't care about movability

Required when assigning, initializing lvalue references, etc.

## [rvalue (prvalue or xvalue)]
🗑 movable, we don't care about identity

Required when initializing rvalue references (move semantics).

## How These Categories Disallow Expressions
`24 = 3;` is ill-formed, because `24` is a prvalue, not a glvalue,
and can thus not appear on the left-hand side of an assignment.

`int y; int &&x = y;` is ill-formed, because `y` is an lvalue, not an rvalue,
and thus rvalue references can not bind to it.

## See Also
<:cppreference:875716540929015908> [Value categories](https://en.cppreference.com/w/cpp/language/value_category)
<:cppreference:875716540929015908> [Reference declaration](https://en.cppreference.com/w/cpp/language/reference)
<:stackoverflow:874353689031233606> [What is move semantics?](https://stackoverflow.com/q/3106110/5740428)
