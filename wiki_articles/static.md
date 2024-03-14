# Understanding The static Keyword

The ``static`` keyword is a common source of confusion among inexperienced C/C++ developers due to its contextualized nature. Depending on its scope, ``static`` can have different meanings.

<!-- inline -->
## Variables Inside Functions
Variables will have **static storage duration**, meaning the variable's lifetime is tied to the program than the scope. They will be **initialized only on the first entry into that scope**. This initialization is thread-safe since C++11.

```cpp
int increment() {
  static int count = 0; // count's value persists between calls. it will be initialized to zero only once.
  count++;
  return count; // does not reset, so it will return the accumulated value.
}
```

<!-- inline -->
## Globals
**This specifies internal linkage**. Internally linking symbols (variables and functions) enables them to become local to the translation unit, allowing for multiple TUs to redefine the same symbols without violating the One Definition Rule.

```cpp
// fileA.cpp and fileB.cpp define these symbols at the top of the file.
// x and foo will have unique instances for each TU. ODR not violated.
static int x = 3;
static void foo() { x++; }
```

<!-- inline -->
## Classes/Structs
**Declares a non-instance member of a class**. This means you can access the member (variable or function) without requiring an existing instance. **Static methods cannot access instance members**. 

<!-- inline -->
## Notes:
- Global variables that are const-qualified are **implicitly static**.
- In C, the rule is mainly the same to the extent of that language.
- You can use ``thread_local`` (C++) or ``_Thread_local`` (C) to localize storage duration to the thread rather than the program.
