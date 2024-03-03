# How to configure vscode tasks
We will be focusing on C and C++ in this article. If you have not installed CMake on your system,
we recommend installing it. And install the `CMake Tools` extension pack by Microsoft.
If you prefer Make, we write a task for it manually later on in this article.
You can setup tasks even without needing a build system.

## Using CMake
1. Press `Ctrl-Shift-P` and type `Tasks: Configure Task`, select this option.
2. Select `CMake Build` and `CMake Configure` to be adde the building step to the task.
3. Select any other option if your `CMakeLists.txt` is setup properly for testing, installing etc.
4. Press `Ctrl-Shift-B` and select what you want. You can press a button in the status bar with a gear icon and text close to it. This is the default task.

> You can change the default task in the command palette (`Ctrl-Shift-P`).

## Using Make
1. Press `Ctrl-Shift-P` and type `Tasks: Configure Task`, select this option.
2. Select `Create tasks.json from template`, and then `Others`.
3. This launches an editor for a file called `tasks.json`
4. Change the field for `"command"` to `make all` (replace all with whatever target you like)
5. Change the field for `"label"` to whatever relevant name the task should have. Save the file.
6. Press `Ctrl-Shift-B` and you should see your task. Select it to run it.

## Example tasks.json
```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "echo",
            "type": "shell",
            "command": "make all",
            "windows": {
                "command": "cl.exe /O2 main.c extra.c"
            }
        }
    ]
}
```

The windows field is for running windows specific properties. In this case if the task was on non-windows,
it would run the `make all` command. If on windows, then it would run cl.exe with the O2 optimization flag
and compile `main.c` and `extra.c` files.

## Read more
- [Official Documentation](https://code.visualstudio.com/docs/editor/tasks)