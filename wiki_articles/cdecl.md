# How do I read C Declaration/Type Syntax?

Start at the identifier, and apply postfix operators first, then prefix.
Append whatever is left in the end.
- `()` means *function returning*
- `[]` means *array of*
- `*` means *pointer to*; `* const` means *const pointer to*
- parentheses can be used to apply `*` before `()` or `[]`

## Example 1 - Array of Pointers, Or Pointer to Array?
```cpp
int (*ptr)[10]; // declare
      ptr       // ptr as
    (*___)      // pointer to
    ______[10]  // array[10] of
int __________  // int
// note: int *arr[10] would be an array of pointers
```

## Example 2 - Nested Pointers With `const`
```cpp
int const * const * p; // declare
                    p  // p as
                  * _  // pointer to
          * const _ _  // const pointer to
int const _ _____ _ _  // const int
// note: type is the same with 'const int' on the left
```

## Example 3 - Abstract Declarators: When There Is No Identifier
```cpp
void *(*)()
      (*)    // pointer to
      ___()  // function returning
     *_____  // pointer to
void ______  // void
```

## See Also

**[Use cdecl+](https://cdecl.plus/?q=int%20(*ptr)%5B10%5D;)** to automatically
translate declarations to prose.
