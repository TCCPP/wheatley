<!-- alias pi -->
# How Do I Get Pi and Other Math Constants in C/C++?

## C++
```cpp
// C++20:
constexpr double pi = std::numbers::pi; // from <numbers>
constexpr T      pi = std::numbers::pi_v<T>;
// C++17 or lower:
const double pi = std::acos(-1); // from <cmath>
const T      pi = std::acos(T(-1));
// note: all variables can be constexpr after C++26
```

## C
```cpp
const double pi = acos(-1); // from <math.h>
const T      pi = acos((T) -1); // from <tgmath.h> (C11)
// note: all variables can be constexpr after C23
// warning: do not use M_PI, it is not portable
```

## See Also on cppreference
- [Mathematical constants](https://en.cppreference.com/w/cpp/numeric/constants) i.e. `<numbers>` (C++20)
- [Standard library header `<cmath>`](https://en.cppreference.com/w/cpp/header/cmath) (C++)
- [Common mathematical functions](https://en.cppreference.com/w/c/numeric/math) i.e. `<math.h>` (C)
- Compiler support: [for C23](https://en.cppreference.com/w/c/compiler_support/23) | [for C++26](https://en.cppreference.com/w/cpp/compiler_support/26)
