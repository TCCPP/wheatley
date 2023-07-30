# What Is a Strict Weak Ordering in C++?

Algorithms like
**[std::sort](https://en.cppreference.com/w/cpp/algorithm/sort)**
and containers like
**[std::set](https://en.cppreference.com/w/cpp/container/map)** require a
*[Compare](https://en.cppreference.com/w/cpp/named_req/Compare)* function,
which induces a *[strict weak ordering](https://en.wikipedia.org/wiki/Weak_ordering#Strict_weak_orderings)*.
This means that the comparison `comp(x, y)` has to behave similar to `x < y`:
1. `x < x` is false (*Irreflexivity*) (this makes it *strict*)
2. `x < y && y < z` implies `x < z` (*Transitivity*)
3. `x < y` implies `!(y < x)` (*Asymmetry*)
4. (see below)

## 4. Transitivity of Equivalence
Elements are allowed to be equivalent, i.e. `equiv(x, y)` is similar to `x == y`:
- let `equiv(x, y)` be `!(x < y) && !(y < x)`
- then `equiv(x, y) && equiv(y, z)` implies `equiv(x, z)` (*Transitivity*)

For example, when ordering strings by length, strings of the same length are
equivalent to each other, but not to other strings.
This satisfies **4.**.

It is **not okay** to have elements like `NaN`, which are equivalent to
`1` and `2`, but `1` and `2` are not equivalent to each other.
`NaN` is equivalent to everything because `NaN < x` is always false.

## See Also
<:stackoverflow:1074747016644661258>
[Operator< and strict weak ordering](https://stackoverflow.com/q/979759/5740428)<br>
- `!wiki overload-less`
