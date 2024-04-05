<!-- alias ub -->

# Undefined Behavior

Undefined behavior occurs when you violate rules specified by the language. For example: Reading uninitialized memory,
performing out-of-bounds memory access, signed integer overflow, and race conditions.

<!-- inline -->

## Example: Read Indeterminate Val.

```cpp
int i; // default init,
       // indeterminate value
while(i < 10) {
    printf("%d\n", i++);
}
```

<!-- inline -->

## Example: Out-of-Bounds Access

```cpp
int arr[10];
for(int i = 0; i < 20; i++) {
    arr[i] = i; // [i] out of
                // bounds
}
```

## Consequences of UB

Compilers are not required to provide warnings or errors about UB. Often it is undetectable at compile-time. Performing
actions which are UB can render your entire program's behavior undefined, leading to anything from crashing to summoning
Eldritch Abominations.

## See Also

- [cppreference: Undefined Behavior](https://en.cppreference.com/w/cpp/language/ub)
- [What is Undefined Behavior?](https://64.github.io/cpp-faq/undefined-behaviour/)

Sanitizers can help identify UB. For more info, look into address sanitizer (ASan) and undefined behavior sanitizer
(UBSan). See `!howto asan`
