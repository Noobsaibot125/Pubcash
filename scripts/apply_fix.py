
import re

file_path = r'c:\Users\THEWAYNE\pubcash-api\src\controllers\authController.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: generateAndStoreTokens
target1 = "const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '90d' });\n    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '365d' });"
replacement1 = "const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });\n    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });"

if target1 in content:
    content = content.replace(target1, replacement1)
    print("Fix 1 applied.")
else:
    print("Warning: Fix 1 target not found!")

# Fix 2: refreshToken
# Using regex for this one to handle potential whitespace variations in the restored file
pattern2 = re.compile(
    r"// 3\. G├⌐n├⌐rer un nouvel accessToken\s*"
    r"const payload = \{ id: decoded\.id, email: decoded\.email, role: decoded\.role \};\s*"
    r"const newAccessToken = jwt\.sign\(payload, process\.env\.JWT_SECRET, \{ expiresIn: process\.env\.ACCESS_TOKEN_EXPIRATION \|\| '90d' \}\);\s*"
    r"res\.json\(\{ accessToken: newAccessToken \}\);"
)

replacement2 = """// 3. Générer un nouvel accessToken ET un nouveau refreshToken (Rotation)
        const payload = { id: decoded.id, email: decoded.email, role: decoded.role };
        const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRATION || '15m' });
        const newRefreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' });

        // 4. Mettre à jour le refresh token en base de données
        await pool.execute(`UPDATE ${userTable} SET refresh_token = ? WHERE id = ?`, [newRefreshToken, decoded.id]);

        // 5. Renvoyer les deux tokens
        res.json({ 
            accessToken: newAccessToken,
            refreshToken: newRefreshToken 
        });"""

new_content = pattern2.sub(replacement2, content)

if new_content != content:
    content = new_content
    print("Fix 2 applied.")
else:
    print("Warning: Fix 2 target not found!")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("File updated successfully.")
