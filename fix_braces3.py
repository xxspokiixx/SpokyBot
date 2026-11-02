with open(r'C:\Users\xxspokiixx\orca\OpenMausBot\android-test\app\src\main\kotlin\com\openmausbot\test\NodeHostService.kt', 'rb') as f:
    content = f.read()

# Find the nvidiaNim line and fix it
idx = content.find(b'nvidiaNim')
if idx >= 0:
    end = content.find(b'\n', idx)
    line = content[idx:end]
    print('Line:', line)
    # The line ends with }}", - we need to add one more }
    # Replace }}", with }}}",
    fixed_line = line.replace(b'}}",', b'}}},')
    print('Fixed line:', fixed_line)
    content = content[:idx] + fixed_line + content[end:]
    with open(r'C:\Users\xxspokiixx\orca\OpenMausBot\android-test\app\src\main\kotlin\com\openmausbot\test\NodeHostService.kt', 'wb') as f:
        f.write(content)
    print('Fixed!')
else:
    print('Not found')