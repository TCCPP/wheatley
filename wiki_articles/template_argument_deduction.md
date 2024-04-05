# What Is Template Argument Deduction?

Sometimes, it is possible to omit template arguments when using a template,
letting the compiler infer them instead.

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
print<std::string>("Hi");
```

In the first two calls to `print`, no template argument is provided. Since `print`
takes a parameter of type `T`, the compiler can match `T` to the type of
the provided arguments: `int` for `42`, and `const char*` for `"Hello"`.

The third call inhibits deduction by imposing `T`. An `std::string` is constructed
from `"Hi"`, and a copy of it is passed to the function.

The compiler cannot always deduce template parameters, notably when a template
parameter appears only in the return type of a function:

## Template function
?inline
```cpp
template<class T>
T make(int arg) {
  return T(arg);
}
```

## Usage
?inline
```cpp
Foo foo = make<Foo>(42);
// ok, returns Foo
Foo bar = make(45);
// error: cannot deduce T
```

Template parameters can be partially deduced independently of each other:

## Template function
?inline
```cpp
template<class T, class A>
T make(A arg) {
    return T(arg);
}
```

## Usage
?inline
```cpp
Foo foo = make<Foo>(42);
// T = Foo (explicit)
// A = int (deduced)
```