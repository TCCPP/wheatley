[[[alias ub]]]

# Undefined Behavior

Undefined behavior occurs when you violate rules specified by the language. For example: Reading uninitialized memory,
performing out of bounds memory access, signed integer overflow, and race conditions.


Compilers are not required to provide warnings or errors about UB. Often it is undetectable at compile-time. Performing
actions which are UB can render your entire program's behavior undefined, leading to anything from crashing to summoning
Eldritch Abominations.

## [Example: Uninitialized Data]
```cpp
int i;
while(i < 10) {
    printf("%d\n", i++);
}
```

## [Example: Out of Bounds Access]
```cpp
int arr[10];
for(int i = 0; i < 20; i++) {
    arr[i] = i;
}
```

## More Info

- https://en.cppreference.com/w/cpp/language/ub
- https://64.github.io/cpp-faq/undefined-behaviour/

Sanitizers can help identify UB. For more info, look into address sanitizer (asan) and undefined behavior sanitizer
(ubsan).
