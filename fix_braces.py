with open(r'C:\Users\xxspokiixx\orca\OpenMausBot\android-test\app\src\main\kotlin\com\openmausbot\test\NodeHostService.kt', 'r') as f:
    content = f.read()

# Find the exact pattern with 4 closing braces
import re
match = re.search(r'("nvidiaNim":\{"driver":"nvidia-nim","displayName":"NVIDIA NIM"\}\}\}\}\")', content)
if match:
    print('Found:', repr(match.group(1)))
    # Replace 4 braces with 2
    fixed = match.group(1).replace('}}}}', '}}')
    print('Fixed:', repr(fixed))
    content = content.replace(match.group(1), fixed)
    with open(r'C:\Users\xxspokiixx\orca\OpenMausBot\android-test\app\src\main\kotlin\com\openmausbot\test\NodeHostService.kt', 'w') as f:
        f.write(content)
    print('Fixed!')
else:
    print('Not found')
    # Try alternative pattern
    match2 = re.search(r'("nvidiaNim":\{"driver":"nvidia-nim","displayName":"NVIDIA NIM"\}\}\}\})', content)
    if match2:
        print('Found alt:', repr(match2.group(1)))