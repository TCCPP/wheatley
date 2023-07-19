<!-- alias asan -->

# How to Use Sanitizers

Sanitizers are tools which generate additional code in your program that can catch many common programming mistakes,
such as:
- [accessing arrays out of bounds](https://cwe.mitre.org/data/definitions/125.html) (caught by ASan)
- [signed integer overflows](https://cwe.mitre.org/data/definitions/190.html) (caught by UBSan)
- [data races](https://cwe.mitre.org/data/definitions/362.html) (caught by ThreadSan)
- [accessing indeterminate memory](https://cwe.mitre.org/data/definitions/457.html) (caught by MemorySan)

## General Advice

Not all sanitizers can be combined, but when they can, use e.g.:<br>
`-fsanitize=address,undefined` to combine them.
Always compile with debug info to get line numbers, variable names, etc.

<!-- inline -->
## GCC
- **[-fsanitize=address](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html#:~:text=-fsanitize%3Daddress)**
- **[-fsanitize=undefined](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html#:~:text=-fsanitize%3Dundefined)**
- **[-fsanitize=thread](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html#:~:text=ThreadSanitizer)**
- `-g` for debug info

<!-- inline -->
## clang
- **[-fsanitize=address](https://clang.llvm.org/docs/AddressSanitizer.html)**
- **[-fsanitize=undefined](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html)**
- **[-fsanitize=thread](https://clang.llvm.org/docs/ThreadSanitizer.html)**
- **[-fsanitize=memory](https://clang.llvm.org/docs/MemorySanitizer.html)**
- `-g` and [llvm-symbolizer](https://clang.llvm.org/docs/AddressSanitizer.html#symbolizing-the-reports) for debug info

<!-- inline -->
## MSVC
- **[-fsanitize=address](https://docs.microsoft.com/en-us/cpp/sanitizers/asan?view=msvc-160)**
- `-Zi` for debug info

<!-- inline -->
## Sample Program
```cpp
int main(void) {
    int x;
    return x;
}
```

<!-- inline -->
## `-fsanitize=memory -g` Output
> SUMMARY: MemorySanitizer: use-of-uninitialized-value /tmp/test.cpp:3:5 in main
> Exiting

(`3:5` is line and column of `return`)

<!-- footer -->
Note: The sanitizer lists for GCC and clang are not exhaustive
