# Overloading the Equality Comparison Operator

The equality comparison operator returns `true` iff one object is equal to another.
Defining this operator makes a type *[EqualityComparable][1]*

[1]: https://en.cppreference.com/w/cpp/named_req/EqualityComparable

## Example
```cpp
struct point {
    int x, y;
    // explicit defaulting since C++20
    bool operator!=(const point&) const
        = default;
};
// can also be defined outside the class
bool operator==(point a, point b) {
    return a.x == b.x && a.y == b.y;
}
```
Note: `!=` is often implemented as a wrapper for `==`

## See Also

- [Comparison Operators](https://en.cppreference.com/w/cpp/language/operator_comparison)
