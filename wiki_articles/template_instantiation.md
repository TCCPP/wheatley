# What Is Template Instantiation?

Templates are not real entities until a piece code uses them with arguments.
When this happens, the compiler replaces the template parameters with the
provided arguments, deriving the generic code into specific code.

The generic code needs to be available in any translation unit that uses it. This
is why templates are typically declared **and** defined entirely in headers.

## Template function
?inline
```cpp
template<typename T>
void print(T arg) {
    std::cout << arg << ' ';
}
```

## Usage
?inline
```cpp
print(42);
print("Hello");
```

On the first call to `print`, the compiler substitutes `T` for `int` in the
template code, _instantiating_ it into a new function. The second call to `print`
causes `T` to be substituted for `const char*`, instantiating the template again.

Here, `T` is said to be _deduced_: the compiler infers `T` from the type of the
argument to `print`.

**Output:**
```
42 Hello 
```
