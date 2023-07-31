# Overloading the Less Than Operator

The less than operator returns `true` iff one object less than the other. If it establishes a [strict weak ordering][1],
it makes a type *[LessThanComparable][2]*, which allows using the type in a `std::map`, in `std::sort` and other
algorithms.

[1]: https://en.wikipedia.org/wiki/Weak_ordering#Strict_weak_orderings
[2]: https://en.cppreference.com/w/cpp/named_req/LessThanComparable

## Example
```cpp
struct point {
    int x, y;
    // explicit defaulting since C++20
    bool operator>(const point&) const = default;
};
// can also be defined outside the class
bool operator<(point a, point b) {
    return a.x < b.x ||
           a.x == b.x && a.y < b.y;
}
```

## See Also

- [Comparison Operators](https://en.cppreference.com/w/cpp/language/operator_comparison)
- `!wiki strict-weak`
