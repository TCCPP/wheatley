# Handling Whitespace in scanf

When the user presses space or enter in the console,
this puts `' '` and `'\n'` *[whitespace](https://en.wikipedia.org/wiki/Whitespace_character)*
characters into `stdio` respectively.
When reading an `int*` with `%d` or `float*` with `%f`, **[scanf](https://en.cppreference.com/w/c/io/fscanf)**
skips any leading whitespace.
However, `%c` for `char*` extracts whitespace characters.

## Example Problem
Say the user enters `"  70 f"`, and we want to read `70` and `f` into `int` and `char` respectively:
```c
int x; char c;
scanf("%d", &x); // OK,  x = 70
scanf("%c", &c); // BAD, c = ' '
```
Instead of reading `f`, we read a space, because `%c` does not skip leading whitespace. Solution:
```c
scanf(" %c", &c);
```
The leading space before `%c` matches any whitespace of any length.