# Understanding The static Keyword

The ``static`` keyword is a common source of confusion among inexperienced C/C++ developers due to its contextualized nature. Depending on its scope, ``static`` can have different meanings.

``static`` can affect the storage class, accessibility, and linkage of symbols. This should hopefully clarify ``static``'s role in your code.

<!-- inline -->
## [C++] variables at block scope
This will facilitate **static storage duration** (meaning it lasts for the duration of the program instead of its scope) for variables at block scope (usually inside functions), meaning the variable's lifetime will persist with multiple entries into that scope. They will be **initialized only on the first invocation into that scope**, but **can be zero/constant initialized prior**. This initialization is thread-safe since C++11.

```cpp
int increment() {
  static int count = 0; // count's value persists between calls. it will be initialized to zero only once.
  count++;

  {
    static int other = 9; // initialized to zero first, then upon first entry by control is initialized to 9.
  }

  return count; // does not reset, so it will return the accumulated value.
}
```

<!-- inline -->
## [C++] at namespace scope
**This specifies internal linkage, because variables at this scope already have static storage duration**. Internally linking symbols (variables and functions) enables them to become local to the translation unit (the source file being compiled), allowing for multiple TUs to redefine the same symbols without violating the One Definition Rule, as they are all internally linked into their defining TUs. This can also make a mess as it allows TUs to make their own unique mutations.

```cpp
// fileA.cpp and fileB.cpp define these symbols at the top of the file
static int x = 3;
static void foo() { x++; }

// x and foo will be internally linked into each TU that uses them. The x/foo in file A is not the same x/foo in file B.
```

<!-- inline -->
## [C++] at class scope
**Declares a non-instance member of a class**. This means you can access the member (variable or function) without requiring an existing instance. Static methods cannot access instance members. Since non-instanced members are not instantiated alongside a class instance, they must be instantiated manually (or with ``inline``). The rule is that **instances can access non-instance members, but non-instances cannot access instance members**.

```cpp
class foo {
public:
  static int x;
  int y = 2;

  static void bar() {
    std::cout << x; // legal
    y = 4; // ill-formed (non-instance function accessing an instance member) 
  }
};

int foo::x = 4; // must be instanced somewhere, or with inline during declaration.

void test() {
  foo::x = 4; // legal
  foo::bar(); // legal
  foo::y = 2; // ill-formed (cannot assign an instance member without an instance)

  foo f;
  f.y = 9; // legal
}
```

<!-- inline -->
## Note: ``thread_local``
In C++11, you may use static in all 3 circumstances (namespace scope, block scope, and class scope) alongside the ``thread_local`` keyword to convert it from static storage to **thread storage** duration. This means the object lifetime is tied to the thread's lifetime. It will initialize when a thread starts and uninitialize when a thread ends.

## Note: ``const``-qualification
Variables at namespace scope that are const-qualified are **implicitly static**. This extends to ``constexpr``, as ``constexpr`` implies ``const``, and ``const`` implies ``static`` at this scope. 

<!-- inline -->
## What about C?
The rules are very similar, of course accounting for language features present in C. It can facilitate internal linkage (const making it implicit) at file scope (namespaces don't exist), give block scope variables static storage duration, and can become thread local.
