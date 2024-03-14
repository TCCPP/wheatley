# Understanding The static Keyword

The ``static`` keyword is a common source of confusion among inexperienced C/C++ developers due to its contextualized nature. Depending on its scope, ``static`` can have different effects on storage duration (object lifetime), linkage, and access.

<!-- inline -->
## At Function Scope
Variables will have **static storage duration**, meaning the duration is tied to the program instead of the scope. They will be **initialized only on the first entry into that scope**. This initialization is thread-safe since C++11.

```cpp
int increment() {
  static int count = 0; // count's value persists between calls. it will be initialized to zero only once.
  count++;
  return count; // does not reset, so it will return the accumulated value.
}
```

<!-- inline -->
## At Global/Namespace Scope
**Enables internal linkage for functions and variables**. This enables them to become local to the translation unit, which prevents redefinition across TUs from violating the One Definition Rule. Templated variables and ``inline`` cancel this.

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
- In C, ``static`` has similar behaviour. C99 and above allow ``static`` in array declarations (``T x[static n]``) to denote an array of *minimum size n*.
- You can use ``thread_local`` (C++/C23) or ``_Thread_local`` (before C23) to convert storage duration to the thread rather than the program.
