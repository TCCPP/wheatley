<!-- alias ub -->

# Undefined Behavior

Undefined behavior (UB) occurs when you violate rules specified by the language.
For example: Reading uninitialized memory, performing out-of-bounds memory access,
or using an object after it no longer exists.

<!-- inline -->
## Example: Indeterminate Value
```cpp
int i; // uninitialized
while(i < 10) {
    printf("%d\n", i++);
}
```

<!-- inline -->
## Example: Out-of-Bounds Access
```cpp
int arr[10];
for(int i = 0; i < 20; i++) {
    arr[i] = 0;
}
```

## Why it Matters

Compilers often do not give warnings or errors about UB and its existence in your code can cause surprising,
unpredictable, and buggy behavior.

## See Also

- [cppreference: Undefined Behavior](https://en.cppreference.com/w/cpp/language/ub)
- [What is Undefined Behavior?](https://64.github.io/cpp-faq/undefined-behaviour/)
