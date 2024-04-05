# What Is Template Argument Deduction?

Sometimes, it is possible to omit template arguments when using a template, letting the compiler infer them instead.

<!-- inline -->

## Template function

```cpp
template<typename T>
void print(T arg) {
    std::cout<<arg<<' ';
}
```

<!-- inline -->

## Usage

```cpp
print(42);
print("Hello");
print<std::string>("Hi");
```

## Deduction

In the first two calls to `print`, no template argument is provided. Since `print` takes a parameter of type `T`, the
compiler can match `T` to the type of the provided arguments: `int` for `42`, and `const char*` for `"Hello"`.

The third call inhibits deduction by imposing `T`. A `std::string` is constructed from `"Hi"`, and a copy of it is
passed to the function.

The compiler cannot always deduce template parameters, for example when they appear only in the return type of a
function:

<!-- inline -->

## Template function

```cpp
template<class T>
T make(int arg) {
    return T(arg);
}
```

<!-- inline -->

## Usage

```cpp
Foo foo = make<Foo>(42);
// ok, returns Foo
Foo bar = make(45);
// error: cannot deduce T
```

## Partial deduction

Template parameters can be partially deduced independently of each other:

<!-- inline -->

## Template function

```cpp
template<class T, class A>
T make(A arg) {
    return T(arg);
}
```

<!-- inline -->

## Usage

```cpp
Foo foo = make<Foo>(42);
// T = Foo (explicit)
// A = int (deduced)
```
