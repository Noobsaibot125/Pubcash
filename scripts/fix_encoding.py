import re

file_path = r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js'

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Fix common encoding issues from the restoration
replacements = {
    "d'invitation": "d\\'invitation",
    "d'utilisateur": "d\\'utilisateur",
    "l'entreprise": "l\\'entreprise",
    "l'inscription": "l\\'inscription",
    "n'est": "n\\'est",
    "n'a": "n\\'a",
    "n'avez": "n\\'avez",
    "n'ont": "n\\'ont",
    "l'email": "l\\'email",
    "l'utilisateur": "l\\'utilisateur",
    "d'email": "d\\'email",
    "d'erreur": "d\\'erreur",
    "d'activité": "d\\'activité",
    "c'est": "c\\'est",
}

for old, new in replacements.items():
    content = content.replace(old, new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Encoding issues fixed.")
