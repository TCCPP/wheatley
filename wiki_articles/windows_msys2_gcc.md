# How to install msys2 and gcc on windows
In this guide, we install msys2 and gcc. There are some optional tools that we recommend
installing, such as `clangd` and `clang-format`. Having an alternative compiler, `clang`
is also recommended. Install location is assumed to be the default.

<!-- inline -->
## Msys2 and GCC Toolchain
1. Visit [msys2.org](https://msys2.org) and follow their installation guide upto step 4.
2. After installing, open the Msys2 Msys terminal environment on windows. It is an app.
3. Type `pacman -Syu` and press Enter to update.
4. Reopen Msys2 Msys, and now we install the entire toolchain group.
5. Type `pacman -S mingw-w64-ucrt-x86_64-toolchain`. This will install all the necessary tools.

<!-- inline -->
## Clang (Optional)
1. Type `pacman -S mingw-w64-ucrt-x86_64-clang` and press enter.
2. (Optional) Install clang tools, `pacman -S mingw-w64-ucrt-x86_64-clang-tools-extra`.

## Add to path
1. Click on Search and type "Edit Environment Variables". Select `Path` and click Edit.
2. In the new window, click on New and then type `C:\msys64\ucrt64\bin` and click Ok.
3. Open powershell and type `gcc -v` to check for correct output. If not, try logging back in.

## Extras
Make is installed as `mingw32-make.exe`.
You can also do this in `Msys2 Msys` to have it available as `make`:
- `ln -sf /mnt/c/msys64/ucrt64/bin/mingw32-make.exe /mnt/c/msys64/ucrt64/bin/make.exe`

## Notes
- `clangd` is a language server, it provides code-completion, compiler errors and warnings etc.
- `clang-format` as the name suggest is a C and C++ code formatter.
- These are recommended because one installs msys2 in combination with vscode, and these tools work well with it.
- Use the `Msys ucrt64` app if you want access to these tools directly.
- `ucrt` is the C runtime provided by default on windows 10 and later. Read [this](https://www.msys2.org/docs/environments/) for more information.
- If you need help, please visit <#331913460080181258>.