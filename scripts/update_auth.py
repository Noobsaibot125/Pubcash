import re
import os

file_path = r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js'

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# 1. Update generateAndStoreTokens
# Pattern matches the 90d/365d lines
pattern1 = re.compile(
    r"const accessToken = jwt\.sign\(payload, process\.env\.JWT_SECRET, \{ expiresIn: process\.env\.ACCESS_TOKEN_EXPIRATION \|\| '90d' \}\);\s*"
    r"const refreshToken = jwt\.sign\(payload, process\.env\.JWT_REFRESH_SECRET, \{ expiresIn: process\.env\.REFRESH_TOKEN_EXPIRATION \|\| '365d' \}\);"
)

replacement1 = (
    "const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });\n"
    "    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });"
)

new_content = pattern1.sub(replacement1, content)

if new_content == content:
    print("Warning: Pattern 1 not found!")
else:
    print("Pattern 1 replaced.")

content = new_content

# 2. Update refreshToken function
# Pattern matches the block inside refreshToken
pattern2 = re.compile(
    r"// 3\. .*?\n"
    r"\s*const payload = \{ id: decoded\.id, email: decoded\.email, role: decoded\.role \};\s*"
    r"const newAccessToken = jwt\.sign\(payload, process\.env\.JWT_SECRET, \{ expiresIn: process\.env\.ACCESS_TOKEN_EXPIRATION \|\| '90d' \}\);\s*"
    r"res\.json\(\{ accessToken: newAccessToken \}\);"
, re.DOTALL)

replacement2 = (
    "// 3. Générer un nouvel accessToken ET un nouveau refreshToken (Rotation)\n"
    "        const payload = { id: decoded.id, email: decoded.email, role: decoded.role };\n"
    "        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });\n"
    "        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });\n\n"
    "        // 4. Mettre à jour le refresh token en base de données\n"
    "        await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [newRefreshToken, decoded.id]);\n\n"
    "        // 5. Renvoyer les deux tokens\n"
    "        res.json({ \n"
    "            accessToken: newAccessToken,\n"
    "            refreshToken: newRefreshToken \n"
    "        });"
)

new_content = pattern2.sub(replacement2, content)

if new_content == content:
    print("Warning: Pattern 2 not found!")
else:
    print("Pattern 2 replaced.")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("File updated successfully.")
